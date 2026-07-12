import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock3,
  ClipboardPaste,
  Copy,
  ExternalLink,
  FileJson2,
  GitPullRequestArrow,
  LoaderCircle,
  PencilLine,
  ShieldCheck,
  ShieldAlert,
  Upload,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  DEMO_CHANGESET,
  TripChangeSetSchema,
  previewChangeSet,
  type ChangeSetPreview,
  type DerivedSnapshot,
  type TripChangeSet,
  type TripSnapshot,
} from '@domain'
import { useParams } from 'react-router-dom'

import { apiRequest } from '@/lib/api'
import { useTripStore } from '@/store/useTripStore'

import {
  Button,
  ButtonLink,
  EmptyState,
  MetricStrip,
  PageHeader,
  PageShell,
  SectionHeading,
  SegmentedControl,
  StatusBadge,
} from '@/features/trips/feature-ui'
import {
  asRecord,
  formatMinutes,
  formatMoney,
  getTripDays,
  getTripId,
  getTripTitle,
  normalizeVersions,
} from '@/features/trips/model'

const MAX_BYTES = 256 * 1024

type StoredChangeSetResponse = {
  changeSet: TripChangeSet
  status: string
}

type AgentTicketResponse = {
  ticket: string
  expiresAt: string
  deliveryEndpoint: string
}

type PreparedChangeSetResponse = {
  preview: ChangeSetPreview
  preparedHash: string | null
  status: 'ready' | 'conflict'
}

function idempotencyHeaders(key: string = crypto.randomUUID()) {
  return { 'idempotency-key': key }
}

async function copyTextWithFallback(value: string): Promise<boolean> {
  try {
    await Promise.race([
      navigator.clipboard.writeText(value),
      new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('clipboard timeout')), 1_200)),
    ])
    return true
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.readOnly = true
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.append(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    textarea.remove()
    return copied
  }
}

function extractJson(input: string): string {
  const fenced = input.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return (fenced?.[1] ?? input).trim()
}

function formatSchemaError(error: unknown): string {
  const record = asRecord(error)
  const issues = Array.isArray(record.issues) ? record.issues : []
  if (!issues.length) return 'JSON 不符合 TripChangeSet v1 契约。'
  return issues
    .slice(0, 4)
    .map((issue) => {
      const item = asRecord(issue)
      const path = Array.isArray(item.path) ? item.path.join('.') : ''
      return `${path || '根节点'}：${String(item.message ?? '格式不正确')}`
    })
    .join('；')
}

function createPreview(
  trip: unknown,
  changeSet: TripChangeSet | null,
  selectedGroupIds: string[],
  currentVersionId?: string,
  derived?: unknown,
  proposalResolutions?: Record<string, string>,
): ChangeSetPreview | null {
  if (!trip || !changeSet) return null
  try {
    return previewChangeSet(trip as TripSnapshot, changeSet, {
      selectedGroupIds,
      currentVersionId,
      proposalResolutions,
      routeLegsBefore: (derived as DerivedSnapshot | undefined)?.routeLegs,
    })
  } catch {
    return null
  }
}

function agentTripContext(trip: TripSnapshot, currentVersionId: string) {
  return {
    tripId: trip.tripId,
    title: trip.title,
    baseVersionId: currentVersionId,
    intent: trip.intent,
    days: trip.days.map((day) => ({
      dayId: day.id,
      dayIndex: day.dayIndex,
      date: day.date,
      startTime: day.startTime,
      overnightStay: day.overnightStay,
      stops: day.stops.map((stop) => ({
        stopId: stop.id,
        placeId: stop.placeId,
        name: trip.placeRefs[stop.placeId]?.name,
        kind: stop.kind,
        plannedStart: stop.plannedStart,
        stayMinutes: stop.stayMinutes,
        locked: stop.locked,
      })),
    })),
    places: Object.values(trip.placeRefs).map((place) => ({
      placeId: place.placeId,
      name: place.name,
      type: place.type,
      address: place.address,
      gcj02: place.gcj02,
      verifiedAt: place.verifiedAt,
    })),
    stayAreas: Object.values(trip.stayAreaRefs).map((area) => ({
      areaId: area.areaId,
      name: area.name,
      region: area.region,
      gcj02: area.gcj02,
    })),
    existingSources: Object.values(trip.sourceRefs).map((source) => ({
      sourceId: source.sourceId,
      title: source.title,
      platform: source.platform,
      url: source.url,
    })),
  }
}

function buildAgentPrompt(
  ticket: AgentTicketResponse,
  trip: TripSnapshot,
  currentVersionId: string,
) {
  const context = agentTripContext(trip, currentVersionId)
  const sourceBrief = ''
  return `你正在为 Jovlo.ai 生成一个待人工审阅的 TripChangeSet v1。\n\n资料链接或任务说明：\n${sourceBrief.trim() || '我会在下一条消息提供小红书、B站或文章内容。'}\n\n工作要求：\n1. 阅读来源，提取地点、价格、营业时间、停车、口味、路况、适合人群等可验证事实。\n2. 对关键事实尽量寻找第二来源交叉验证；商业合作、单一来源、冲突或过期信息必须在 rationale/summary 中明确，不得伪装成已确认事实。\n3. 只能生成下面允许的领域操作，不得修改代码、数据库、部署或绕过人工审阅。\n4. 已有实体必须使用下方 context 的稳定 ID；未知地点使用 PROPOSE_PLACE，不得虚构 placeId。\n5. 每个可独立接受/拒绝的建议放入一个 atomic proposalGroup。删除、换酒店、跨日移动必须单独成组并解释理由。\n6. 每条事实必须关联 sources 中的 sourceRef。不要大段复制原文，只写摘要。\n\n允许的操作：\n- ADD_STOP(dayId,newStopId,placeId|proposalRef,afterStopId,stayMinutes,kind,sourceRefs)\n- REMOVE_STOP(stopId,reason)\n- MOVE_STOP(stopId,targetDayId,afterStopId)\n- UPDATE_STOP(stopId,patch)\n- SET_HOTEL(nightAfterDayId,anchor)\n- UPDATE_TRIP_SETTING(path,value)\n- UPDATE_BUDGET_ASSUMPTION(field,value)\n- LINK_SOURCE(sourceRef,placeId|stopId,fields?)\n- UPSERT_PLACE_CLAIM(placeId,field,value,sourceRefs)\n- PROPOSE_PLACE(proposalRef,name,address?,sourceRefs,coordinate?)\n\n输出必须是严格 JSON，顶层结构：\n{\n  "schemaVersion": 1,\n  "changeSetId": "新 UUID",\n  "tripId": "${trip.tripId}",\n  "baseVersionId": "${currentVersionId}",\n  "idempotencyKey": "至少 8 字符且本次唯一",\n  "createdAt": "ISO 8601",\n  "producer": {"type":"external-agent","name":"Agent","conversationRef":"可选"},\n  "sources": [{"sourceRef":"稳定短标识","platform":"平台","url":"https://...","title":"标题","summary":"摘要","commercialRelationship":"yes|no|unknown"}],\n  "proposalGroups": [{"groupId":"稳定短标识","title":"标题","rationale":"证据和取舍","atomic":true,"operations":[]}]\n}\n\n当前行程 context：\n${JSON.stringify(context, null, 2)}\n\n完成 JSON 后，把它保存为 changeset.json，并执行：\ncurl --fail-with-body -X POST '${ticket.deliveryEndpoint}' \\\n  -H 'Authorization: Jovlo-Agent ${ticket.ticket}' \\\n  -H 'Content-Type: application/json' \\\n  --data-binary @changeset.json\n\n投递成功后，读取响应中的 reviewUrl 并打开。这个口令在 ${ticket.expiresAt} 过期，只能投递待审 ChangeSet，不能直接应用。`
}

function operationLabel(type: TripChangeSet['proposalGroups'][number]['operations'][number]['type']) {
  const labels: Record<typeof type, string> = {
    ADD_STOP: '加入行程',
    REMOVE_STOP: '移除地点',
    MOVE_STOP: '调整顺序',
    UPDATE_STOP: '修改停留',
    SET_HOTEL: '调整住宿',
    UPDATE_TRIP_SETTING: '修改行程设置',
    UPDATE_BUDGET_ASSUMPTION: '调整预算',
    LINK_SOURCE: '关联来源',
    UPSERT_PLACE_CLAIM: '补充地点信息',
    PROPOSE_PLACE: '建议新地点',
  }
  return labels[type]
}

export function ChangeSetPage() {
  const state = useTripStore()
  const { changeSetId: routeChangeSetId } = useParams<{ changeSetId: string }>()
  const versions = normalizeVersions(state.versions)
  const currentVersionId = state.productionSync.currentVersionId ?? versions[0]?.id
  const loadsStoredChangeSet = Boolean(routeChangeSetId && routeChangeSetId !== 'demo-import')
  const productionMode = state.productionSync.mode === 'production'
  const fileRef = useRef<HTMLInputElement>(null)
  const [raw, setRaw] = useState('')
  const [changeSet, setChangeSet] = useState<TripChangeSet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<Record<string, 'accept' | 'reject'>>({})
  const [proposalResolutions, setProposalResolutions] = useState<Record<string, string>>({})
  const [bridgeStatus, setBridgeStatus] = useState<string | null>(null)
  const [storedStatus, setStoredStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState<'load' | 'ticket' | 'apply' | null>(loadsStoredChangeSet ? 'load' : null)
  const [applied, setApplied] = useState(false)

  useEffect(() => {
    if (!loadsStoredChangeSet || !routeChangeSetId) return
    let cancelled = false
    setBusy('load')
    setError(null)
    apiRequest<StoredChangeSetResponse>(`/api/v1/change-sets/${routeChangeSetId}`)
      .then((result) => {
        if (cancelled) return
        setChangeSet(result.changeSet)
        setRaw(JSON.stringify(result.changeSet, null, 2))
        setStoredStatus(result.status)
        setSelection(Object.fromEntries(result.changeSet.proposalGroups.map((group) => [group.groupId, 'accept'])))
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : '暂时无法读取这份 ChangeSet。')
      })
      .finally(() => {
        if (!cancelled) setBusy(null)
      })
    return () => {
      cancelled = true
    }
  }, [loadsStoredChangeSet, routeChangeSetId])

  const selectedGroupIds = changeSet?.proposalGroups
    .filter((group) => selection[group.groupId] !== 'reject')
    .map((group) => group.groupId) ?? []
  const preview = useMemo(
    () => createPreview(state.trip, changeSet, selectedGroupIds, currentVersionId, state.derived, proposalResolutions),
    [state.trip, state.derived, changeSet, selectedGroupIds.join('|'), currentVersionId, JSON.stringify(proposalResolutions)],
  )

  const parse = (text = raw) => {
    setApplied(false)
    const bytes = new TextEncoder().encode(text).byteLength
    if (bytes > MAX_BYTES) {
      setChangeSet(null)
      setError('文件超过 256KB，未创建 ChangeSet。')
      return
    }
    try {
      const json = JSON.parse(extractJson(text)) as unknown
      const result = TripChangeSetSchema.safeParse(json)
      if (!result.success) {
        setChangeSet(null)
        setError(formatSchemaError(result.error))
        return
      }
      setChangeSet(result.data)
      setProposalResolutions({})
      setSelection(Object.fromEntries(result.data.proposalGroups.map((group) => [group.groupId, 'accept'])))
      setError(null)
    } catch {
      setChangeSet(null)
      setError('没有找到可解析的 JSON。可以粘贴纯 JSON，或只含一个 JSON 代码块的 Markdown。')
    }
  }

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > MAX_BYTES) {
      setError('文件超过 256KB，未创建 ChangeSet。')
      return
    }
    const text = await file.text()
    setRaw(text)
    parse(text)
  }

  if (!state.trip) {
    return (
      <PageShell>
        <PageHeader title="导入 ChangeSet" backTo="/trips" />
        <EmptyState icon={FileJson2} title="还没有可导入的行程" />
      </PageShell>
    )
  }

  const tripId = getTripId(state.trip)
  const days = getTripDays(state.trip)
  const conflictCount =
    (preview?.counts.conflicts ?? 0) + (preview?.unresolvedReferences.length ?? 0)
  const scheduleRiskCount = preview?.impact.scheduleWarnings.length ?? 0
  const affectedLabels = preview?.affectedDays.map((dayId) => {
    const day = days.find((candidate) => candidate.id === dayId)
    return day ? `Day ${day.dayIndex}` : dayId.slice(0, 8)
  }) ?? []
  const operationCount = changeSet?.proposalGroups.reduce((sum, group) => sum + group.operations.length, 0) ?? 0
  const impactText = preview
    ? [
        preview.impact.distanceDeltaMeters ? `${preview.impact.distanceDeltaMeters > 0 ? '+' : ''}${(preview.impact.distanceDeltaMeters / 1000).toFixed(0)} km` : '里程不变',
        preview.impact.durationDeltaSeconds ? `${preview.impact.durationDeltaSeconds > 0 ? '+' : ''}${formatMinutes(preview.impact.durationDeltaSeconds / 60)}` : '时长不变',
        preview.impact.budgetDelta ? `${preview.impact.budgetDelta.expected > 0 ? '+' : ''}${formatMoney(preview.impact.budgetDelta.expected)}` : '预算不变',
      ].join(' · ')
    : '等待 dry-run'
  const selectedProposalRefs = [...new Set(changeSet?.proposalGroups
    .filter((group) => selectedGroupIds.includes(group.groupId))
    .flatMap((group) => group.operations
      .filter((operation) => operation.type === 'PROPOSE_PLACE')
      .map((operation) => operation.proposalRef)) ?? [])]
  const placeOptions = Object.values(state.trip.placeRefs)
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))

  const createAgentTask = async () => {
    if (!currentVersionId || state.dirty || busy) return
    setBusy('ticket')
    setError(null)
    setBridgeStatus(null)
    try {
      const ticket = await apiRequest<AgentTicketResponse>(`/api/v1/trips/${tripId}/agent-tickets`, {
        method: 'POST',
        body: '{}',
      })
      const prompt = buildAgentPrompt(ticket, state.trip, currentVersionId)
      const copied = await copyTextWithFallback(prompt)
      const expiry = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' })
        .format(new Date(ticket.expiresAt))
      setBridgeStatus(copied
        ? `连接指令已复制。现在粘贴给 Agent，再发送攻略链接或文字；${expiry} 前可投递一次。`
        : '浏览器没有允许自动复制，请再次点击重试。')
    } catch (taskError) {
      setError(taskError instanceof Error ? taskError.message : '暂时无法创建 Agent 连接。')
    } finally {
      setBusy(null)
    }
  }

  const apply = async () => {
    if (!changeSet || !preview?.canApply || state.dirty || busy) return
    if (!productionMode && changeSet.changeSetId === DEMO_CHANGESET.changeSetId) {
      for (const group of DEMO_CHANGESET.proposalGroups) {
        state.setChangeSetGroupAccepted(group.groupId, selectedGroupIds.includes(group.groupId))
      }
      state.prepareDemoChangeSet(selectedGroupIds)
      state.applyDemoChangeSet()
      setApplied(true)
      return
    }

    setBusy('apply')
    setError(null)
    try {
      if (!storedStatus) {
        await apiRequest(`/api/v1/trips/${tripId}/change-sets`, {
          method: 'POST',
          headers: idempotencyHeaders(changeSet.idempotencyKey),
          body: JSON.stringify(changeSet),
        })
      }
      for (const proposalRef of selectedProposalRefs) {
        const existingPlaceId = proposalResolutions[proposalRef]
        if (!existingPlaceId) continue
        await apiRequest(`/api/v1/change-sets/${changeSet.changeSetId}/place-proposals/${encodeURIComponent(proposalRef)}/resolve`, {
          method: 'POST',
          headers: idempotencyHeaders(),
          body: JSON.stringify({ existingPlaceId, privatePlace: null }),
        })
      }
      const prepared = await apiRequest<PreparedChangeSetResponse>(`/api/v1/change-sets/${changeSet.changeSetId}/dry-run`, {
        method: 'POST',
        headers: idempotencyHeaders(),
        body: JSON.stringify({ selectedGroupIds, proposalResolutions }),
      })
      if (prepared.status !== 'ready' || !prepared.preparedHash) {
        setError('服务端试算发现新的冲突，请检查提案选择和地点匹配。')
        return
      }
      await apiRequest(`/api/v1/change-sets/${changeSet.changeSetId}/apply`, {
        method: 'POST',
        headers: idempotencyHeaders(),
        body: JSON.stringify({ preparedHash: prepared.preparedHash }),
      })
      setApplied(true)
      window.location.assign(`/trips/${tripId}/plan`)
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : '这次应用没有完成，请稍后重试。')
    } finally {
      setBusy(null)
    }
  }

  return (
    <PageShell width={changeSet ? 'wide' : 'reading'} className="changeset-page">
      <PageHeader
        eyebrow={getTripTitle(state.trip)}
        title={changeSet ? '确认这次修改' : '让 Agent 帮你改路书'}
        description={changeSet
          ? 'Agent 已提交建议。先看整体影响，再逐项决定，最后保存为一个可回退的新版本。'
          : '攻略和要求发在 Agent 对话里；这里仅创建一条安全、临时的连接。'}
        backTo={`/trips/${tripId}/plan`}
        meta={applied
          ? <StatusBadge tone="sea">已应用</StatusBadge>
          : changeSet
            ? <StatusBadge tone={preview?.canApply ? 'sky' : 'sun'}>{preview?.canApply ? '等待你的确认' : '有待解决项'}</StatusBadge>
            : <StatusBadge tone="neutral">尚未连接</StatusBadge>}
      />

      {state.dirty ? (
        <section className="feature-section changeset-gate">
          <div className="feature-notice feature-notice--warning">
            <ShieldAlert aria-hidden="true" size={22} />
            <div><strong>先保存当前手工修改</strong><span>Agent 建议以最近发布的版本为基线。先保存检查点，才能准确计算路线、时间和预算变化。</span></div>
          </div>
          <Button variant="primary" icon={CheckCircle2} onClick={() => state.publishVersion('Agent 修改前检查点')}>保存为检查点</Button>
        </section>
      ) : null}

      {!changeSet && busy !== 'load' ? (
        <>
          <section className="feature-section agent-handoff">
            <div className="agent-handoff__lead">
              <div className="agent-handoff__mark"><Bot aria-hidden="true" size={25} /></div>
              <div>
                <p className="agent-handoff__kicker">Agent 协作</p>
                <h2>把攻略交给 Agent，把决定留给自己</h2>
                <p>Agent 可以整理资料并提交修改建议；路线、时间和预算是否改变，最后都由你在 Jovlo 确认。</p>
              </div>
            </div>

            <ol className="agent-handoff__steps" aria-label="Agent 修改流程">
              <li className="is-current"><span>1</span><div><em>当前页面</em><strong>建立安全连接</strong><small>复制一次性连接指令</small></div></li>
              <li><span>2</span><div><em>Agent 对话</em><strong>发送攻略资料</strong><small>链接、正文或修改要求</small></div></li>
              <li><span>3</span><div><em>回到 Jovlo</em><strong>确认修改建议</strong><small>查看影响，逐项接受或拒绝</small></div></li>
            </ol>

            <div className="agent-handoff__command">
              <div className="agent-handoff__command-copy">
                <span>从这里开始</span>
                <strong>创建这次协作的临时入口</strong>
              </div>
              <div className="agent-handoff__action">
                <Button
                  variant="primary"
                  icon={busy === 'ticket' ? LoaderCircle : Copy}
                  onClick={createAgentTask}
                  disabled={state.dirty || !currentVersionId || busy !== null}
                >
                  {busy === 'ticket' ? '正在创建连接' : '复制 Agent 连接指令'}
                </Button>
                <p><ShieldCheck aria-hidden="true" size={16} />15 分钟有效 · 成功投递后失效 · 只能提交待审建议</p>
              </div>
            </div>

            {bridgeStatus ? <p className="agent-handoff__status" role="status"><CheckCircle2 aria-hidden="true" size={18} />{bridgeStatus}</p> : null}
          </section>

          <section className="feature-section changeset-manual-path">
            <PencilLine aria-hidden="true" size={24} />
            <div><h2>只是微调时间、顺序或预算？</h2><p>直接在行程页修改更快，路线、耗时和预算会随之重新计算。</p></div>
            <ButtonLink to={`/trips/${tripId}/plan`} icon={ArrowRight}>回到行程编辑</ButtonLink>
          </section>

          <details className="feature-section changeset-developer">
            <summary><FileJson2 aria-hidden="true" size={19} />开发者工具 · 手动导入变更文件</summary>
            <div className="changeset-developer__body">
              <p>仅用于调试或兼容其他 Agent。接受 UTF-8 JSON 或单个 JSON 代码块，最大 256KB。</p>
              <div className="changeset-input-layout">
                <label className="feature-field">
                  <span className="feature-field-label">TripChangeSet v1</span>
                  <textarea className="changeset-editor" value={raw} onChange={(event) => { setRaw(event.target.value); setError(null) }} disabled={state.dirty} spellCheck={false} placeholder={'{\n  "schemaVersion": 1,\n  "proposalGroups": […]\n}'} />
                </label>
                <div className="changeset-input-actions">
                  <input ref={fileRef} className="jovlo-sr-only" type="file" accept="application/json,.json,.md,text/markdown" onChange={upload} disabled={state.dirty} />
                  <Button icon={Upload} onClick={() => fileRef.current?.click()} disabled={state.dirty}>上传文件</Button>
                  <Button variant="primary" icon={ClipboardPaste} onClick={() => parse()} disabled={state.dirty || !raw.trim()}>校验并预览</Button>
                </div>
              </div>
            </div>
          </details>
        </>
      ) : null}

      {error ? <div className="feature-notice feature-notice--danger changeset-error" role="alert"><AlertTriangle aria-hidden="true" size={20} /><div><strong>未完成</strong><span>{error}</span></div></div> : null}

      {busy === 'load' ? (
        <section className="feature-section changeset-loading" aria-live="polite">
          <LoaderCircle aria-hidden="true" size={22} />正在读取待审建议
        </section>
      ) : null}

      {changeSet ? (
        <>
          <nav className="changeset-review-steps" aria-label="修改确认流程">
            <span className="is-active"><b>1</b>看整体影响</span>
            <span><b>2</b>逐项决定</span>
            <span><b>3</b>保存新版本</span>
          </nav>

          <section className="feature-section">
            <SectionHeading title="先看整体影响" description={changeSet.producer.name ? `${changeSet.producer.name} 提交了 ${changeSet.proposalGroups.length} 组建议` : undefined} />
            <MetricStrip
              metrics={[
                { label: '建议内容', value: `${operationCount} 项`, note: `${preview?.counts.added ?? 0} 新增 · ${preview?.counts.changed ?? 0} 调整 · ${preview?.counts.removed ?? 0} 移除`, tone: 'brand' },
                { label: '路线影响', value: impactText, note: scheduleRiskCount ? `${scheduleRiskCount} 项日程风险需确认` : '会随你的选择重新计算', tone: scheduleRiskCount ? 'sun' : 'neutral' },
                { label: '涉及日期', value: affectedLabels.length ? affectedLabels.join(' / ') : '无日程变化', note: `${preview?.impact.hotelChanges.length ?? 0} 处住宿变化` },
                { label: '需要处理', value: conflictCount, note: conflictCount ? '解决后才能应用' : preview?.canApply ? '当前选择可以应用' : '没有技术阻断', tone: conflictCount ? 'coral' : 'sea' },
              ]}
            />
          </section>

          {changeSet.sources.length ? (
            <section className="feature-section changeset-sources">
              <SectionHeading title="这次建议依据的资料" description="打开原文核对 Agent 的摘要和判断。" />
              <div className="changeset-source-list">
                {changeSet.sources.map((source) => (
                  <a href={source.url} target="_blank" rel="noreferrer" key={source.sourceRef}>
                    <span>{source.platform}</span>
                    <strong>{source.title}</strong>
                    <small>{source.summary}</small>
                    <ExternalLink aria-hidden="true" size={17} />
                  </a>
                ))}
              </div>
            </section>
          ) : null}

          <section className="feature-section">
            <SectionHeading title="逐项决定" description="每组建议可以独立接受或拒绝，路线、时间和预算会随选择重新计算。" />
            <div className="changeset-groups">
              {changeSet.proposalGroups.map((group) => {
                const groupPreview = preview?.proposalGroups.find((item) => item.groupId === group.groupId)
                const decision = selection[group.groupId] ?? 'accept'
                return (
                  <article className={`feature-card changeset-group ${groupPreview?.status === 'conflict' ? 'changeset-group--conflict' : ''}`} key={group.groupId}>
                    <div className="feature-card-header">
                      <div className="feature-card-title">
                        <div className="changeset-group-meta"><StatusBadge tone={group.atomic ? 'brand' : 'neutral'}>建议</StatusBadge><span>{group.operations.length} 项修改</span></div>
                        <h3>{group.title}</h3>
                        <p>{group.rationale}</p>
                      </div>
                      <SegmentedControl
                        label={`${group.title}的处理决定`}
                        value={decision}
                        onChange={(value) => setSelection((current) => ({ ...current, [group.groupId]: value }))}
                        options={[{ value: 'accept', label: '接受' }, { value: 'reject', label: '拒绝' }]}
                      />
                    </div>
                    <div className="changeset-operation-summary">
                      {group.operations.map((operation, index) => <span key={`${operation.type}-${index}`}>{operationLabel(operation.type)}</span>)}
                    </div>
                    {groupPreview?.conflicts.length ? <div className="feature-notice feature-notice--danger"><AlertTriangle aria-hidden="true" size={18} /><div><strong>该组有冲突</strong><span>{groupPreview.conflicts.join('；')}</span></div></div> : null}
                  </article>
                )
              })}
            </div>
          </section>

          {selectedProposalRefs.length ? (
            <section className="feature-section changeset-resolutions">
              <SectionHeading title="匹配新地点" description="Agent 只提交候选名称；选择真实地点后，路线、时间和预算才会进入试算。" />
              <div className="changeset-resolution-list">
                {selectedProposalRefs.map((proposalRef) => {
                  const operation = changeSet.proposalGroups
                    .flatMap((group) => group.operations)
                    .find((candidate) => candidate.type === 'PROPOSE_PLACE' && candidate.proposalRef === proposalRef)
                  return (
                    <label className="changeset-resolution-row" key={proposalRef}>
                      <span><strong>{operation?.type === 'PROPOSE_PLACE' ? operation.name : proposalRef}</strong><small>{proposalRef}</small></span>
                      <select
                        value={proposalResolutions[proposalRef] ?? ''}
                        onChange={(event) => setProposalResolutions((current) => ({ ...current, [proposalRef]: event.target.value }))}
                      >
                        <option value="">选择已有地点</option>
                        {placeOptions.map((place) => <option key={place.placeId} value={place.placeId}>{place.name}</option>)}
                      </select>
                    </label>
                  )
                })}
              </div>
            </section>
          ) : null}

          <section className="feature-section changeset-apply-section">
            <div>
              <h2>把已接受的建议保存为新版本</h2>
              <p>{preview?.canApply ? '历史版本会保留，之后仍可查看差异或回退。' : '当前选择还有冲突、未匹配地点或版本已过期，暂时不能应用。'}</p>
            </div>
            <Button variant="primary" icon={busy === 'apply' ? LoaderCircle : GitPullRequestArrow} onClick={apply} disabled={!preview?.canApply || state.dirty || selectedGroupIds.length === 0 || busy !== null || storedStatus === 'applied'}>{busy === 'apply' ? '正在重新计算' : storedStatus === 'applied' ? '已应用' : `确认应用 ${selectedGroupIds.length} 组建议`}</Button>
          </section>

          <details className="feature-technical">
            <summary>开发者信息 · 原始 ChangeSet</summary>
            <pre>{JSON.stringify(changeSet, null, 2)}</pre>
          </details>
        </>
      ) : null}
    </PageShell>
  )
}

export default ChangeSetPage
