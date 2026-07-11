import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  ClipboardPaste,
  Copy,
  FileJson2,
  GitPullRequestArrow,
  Link2,
  LoaderCircle,
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
    await navigator.clipboard.writeText(value)
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
  sourceBrief: string,
) {
  const context = agentTripContext(trip, currentVersionId)
  return `你正在为 Jovlo.ai 生成一个待人工审阅的 TripChangeSet v1。\n\n资料链接或任务说明：\n${sourceBrief.trim() || '我会在下一条消息提供小红书、B站或文章内容。'}\n\n工作要求：\n1. 阅读来源，提取地点、价格、营业时间、停车、口味、路况、适合人群等可验证事实。\n2. 对关键事实尽量寻找第二来源交叉验证；商业合作、单一来源、冲突或过期信息必须在 rationale/summary 中明确，不得伪装成已确认事实。\n3. 只能生成下面允许的领域操作，不得修改代码、数据库、部署或绕过人工审阅。\n4. 已有实体必须使用下方 context 的稳定 ID；未知地点使用 PROPOSE_PLACE，不得虚构 placeId。\n5. 每个可独立接受/拒绝的建议放入一个 atomic proposalGroup。删除、换酒店、跨日移动必须单独成组并解释理由。\n6. 每条事实必须关联 sources 中的 sourceRef。不要大段复制原文，只写摘要。\n\n允许的操作：\n- ADD_STOP(dayId,newStopId,placeId|proposalRef,afterStopId,stayMinutes,kind,sourceRefs)\n- REMOVE_STOP(stopId,reason)\n- MOVE_STOP(stopId,targetDayId,afterStopId)\n- UPDATE_STOP(stopId,patch)\n- SET_HOTEL(nightAfterDayId,anchor)\n- UPDATE_TRIP_SETTING(path,value)\n- UPDATE_BUDGET_ASSUMPTION(field,value)\n- LINK_SOURCE(sourceRef,placeId|stopId,fields?)\n- UPSERT_PLACE_CLAIM(placeId,field,value,sourceRefs)\n- PROPOSE_PLACE(proposalRef,name,address?,sourceRefs,coordinate?)\n\n输出必须是严格 JSON，顶层结构：\n{\n  "schemaVersion": 1,\n  "changeSetId": "新 UUID",\n  "tripId": "${trip.tripId}",\n  "baseVersionId": "${currentVersionId}",\n  "idempotencyKey": "至少 8 字符且本次唯一",\n  "createdAt": "ISO 8601",\n  "producer": {"type":"external-agent","name":"Codex","conversationRef":"可选"},\n  "sources": [{"sourceRef":"稳定短标识","platform":"平台","url":"https://...","title":"标题","summary":"摘要","commercialRelationship":"yes|no|unknown"}],\n  "proposalGroups": [{"groupId":"稳定短标识","title":"标题","rationale":"证据和取舍","atomic":true,"operations":[]}]\n}\n\n当前行程 context：\n${JSON.stringify(context, null, 2)}\n\n完成 JSON 后，把它保存为 changeset.json，并执行：\ncurl --fail-with-body -X POST '${ticket.deliveryEndpoint}' \\\n  -H 'Authorization: Jovlo-Agent ${ticket.ticket}' \\\n  -H 'Content-Type: application/json' \\\n  --data-binary @changeset.json\n\n投递成功后，读取响应中的 reviewUrl 并打开。这个口令在 ${ticket.expiresAt} 过期，只能投递待审 ChangeSet，不能直接应用。`
}

export function ChangeSetPage() {
  const state = useTripStore()
  const { changeSetId: routeChangeSetId } = useParams<{ changeSetId: string }>()
  const versions = normalizeVersions(state.versions)
  const currentVersionId = state.productionSync.currentVersionId ?? versions[0]?.id
  const loadsStoredChangeSet = Boolean(routeChangeSetId && routeChangeSetId !== 'demo-import')
  const productionMode = state.productionSync.mode === 'production'
  const fileRef = useRef<HTMLInputElement>(null)
  const [raw, setRaw] = useState(() => loadsStoredChangeSet ? '' : JSON.stringify(DEMO_CHANGESET, null, 2))
  const [changeSet, setChangeSet] = useState<TripChangeSet | null>(() => loadsStoredChangeSet ? null : DEMO_CHANGESET)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<Record<string, 'accept' | 'reject'>>(() => loadsStoredChangeSet
    ? {}
    : Object.fromEntries(DEMO_CHANGESET.proposalGroups.map((group) => [group.groupId, 'accept'])))
  const [proposalResolutions, setProposalResolutions] = useState<Record<string, string>>({})
  const [sourceBrief, setSourceBrief] = useState('')
  const [bridgeStatus, setBridgeStatus] = useState<string | null>(null)
  const [taskPrompt, setTaskPrompt] = useState<string | null>(null)
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
      const prompt = buildAgentPrompt(ticket, state.trip, currentVersionId, sourceBrief)
      setTaskPrompt(prompt)
      const copied = await copyTextWithFallback(prompt)
      const expiry = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' })
        .format(new Date(ticket.expiresAt))
      setBridgeStatus(copied ? `任务包已复制 · ${expiry} 前可投递一次` : `任务包已生成 · ${expiry} 前可投递一次`)
    } catch (taskError) {
      setError(taskError instanceof Error ? taskError.message : '暂时无法生成 Codex 任务包。')
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
    <PageShell width="wide">
      <PageHeader
        eyebrow={getTripTitle(state.trip)}
        title="审阅 ChangeSet"
        description="先校验基线和草稿，再按提案组决定接受或拒绝；应用时只提交选中的原子组。"
        backTo={`/trips/${tripId}/plan`}
        meta={applied ? <StatusBadge tone="sea">已提交应用</StatusBadge> : changeSet ? <StatusBadge tone={preview?.canApply ? 'sky' : 'sun'}>{preview?.canApply ? '待确认' : '有待解决项'}</StatusBadge> : undefined}
      />

      {state.dirty ? (
        <section className="feature-section changeset-gate">
          <div className="feature-notice feature-notice--warning">
            <ShieldAlert aria-hidden="true" size={22} />
            <div><strong>先处理当前未发布草稿</strong><span>ChangeSet 只基于已发布 HEAD 试算，不会与手工草稿隐式合并。保存检查点后再导入。</span></div>
          </div>
          <Button variant="primary" icon={CheckCircle2} onClick={() => state.publishVersion('导入 ChangeSet 前检查点')}>保存草稿为版本</Button>
        </section>
      ) : null}

      <section className="feature-section agent-bridge">
        <div className="agent-bridge__heading">
          <div className="agent-bridge__mark"><Bot aria-hidden="true" size={24} /></div>
          <div>
            <SectionHeading title="交给 Codex 整理资料" description="一次性连接包只允许提交建议；地点匹配、试算和应用仍由你确认。" />
            <div className="agent-bridge__trust">
              <span><ShieldCheck aria-hidden="true" size={15} />15 分钟</span>
              <span><Clock3 aria-hidden="true" size={15} />成功后失效</span>
              <span><Link2 aria-hidden="true" size={15} />保留来源</span>
            </div>
          </div>
        </div>
        <div className="agent-bridge__compose">
          <label className="feature-field">
            <span className="feature-field-label">资料链接或补充要求</span>
            <textarea
              value={sourceBrief}
              onChange={(event) => setSourceBrief(event.target.value)}
              disabled={state.dirty || busy === 'ticket'}
              placeholder="粘贴小红书、B站、文章链接；也可以留空，稍后在 Codex 对话里补充。"
              rows={3}
            />
          </label>
          <Button
            variant="primary"
            icon={busy === 'ticket' ? LoaderCircle : Copy}
            onClick={createAgentTask}
            disabled={state.dirty || !currentVersionId || busy !== null}
          >
            {busy === 'ticket' ? '正在生成' : '复制 Codex 任务包'}
          </Button>
        </div>
        {bridgeStatus ? <p className="agent-bridge__status" role="status"><CheckCircle2 aria-hidden="true" size={17} />{bridgeStatus}</p> : null}
        {taskPrompt ? (
          <details className="agent-bridge__package">
            <summary>查看任务包</summary>
            <textarea aria-label="Codex 任务包" readOnly value={taskPrompt} rows={8} onFocus={(event) => event.currentTarget.select()} />
            <Button icon={Copy} onClick={async () => setBridgeStatus(await copyTextWithFallback(taskPrompt) ? '任务包已复制' : '请点选文本框后手动复制')}>再次复制</Button>
          </details>
        ) : null}
      </section>

      <section className="feature-section">
        <SectionHeading title="粘贴或上传" description="接受 UTF-8 JSON，或只含一个 JSON 代码块的 Markdown；最大 256KB。" />
        <div className="changeset-input-layout">
          <label className="feature-field">
            <span className="feature-field-label">TripChangeSet v1</span>
            <textarea className="changeset-editor" value={raw} onChange={(event) => { setRaw(event.target.value); setError(null); setChangeSet(null) }} disabled={state.dirty} spellCheck={false} placeholder={'{\n  "schemaVersion": 1,\n  "proposalGroups": […]\n}'} />
          </label>
          <div className="changeset-input-actions">
            <input ref={fileRef} className="jovlo-sr-only" type="file" accept="application/json,.json,.md,text/markdown" onChange={upload} disabled={state.dirty} />
            <Button icon={Upload} onClick={() => fileRef.current?.click()} disabled={state.dirty}>上传文件</Button>
            <Button variant="primary" icon={ClipboardPaste} onClick={() => parse()} disabled={state.dirty || !raw.trim()}>校验并预览</Button>
          </div>
        </div>
        {error ? <div className="feature-notice feature-notice--danger changeset-error" role="alert"><AlertTriangle aria-hidden="true" size={20} /><div><strong>未完成</strong><span>{error}</span></div></div> : null}
      </section>

      {busy === 'load' ? (
        <section className="feature-section changeset-loading" aria-live="polite">
          <LoaderCircle aria-hidden="true" size={22} />正在读取待审建议
        </section>
      ) : null}

      {changeSet ? (
        <>
          <section className="feature-section">
            <SectionHeading title="变更总览" description={changeSet.producer.name ? `由 ${changeSet.producer.name} 生成 · ${changeSet.proposalGroups.length} 个提案组` : undefined} />
            <MetricStrip
              metrics={[
                { label: '改了什么', value: `${operationCount} 项`, note: `${preview?.counts.added ?? 0} 新增 · ${preview?.counts.changed ?? 0} 调整 · ${preview?.counts.removed ?? 0} 移除`, tone: 'brand' },
                { label: '代价', value: impactText, note: scheduleRiskCount ? `${scheduleRiskCount} 项日程风险需确认` : '按当前选择重新试算', tone: scheduleRiskCount ? 'sun' : 'neutral' },
                { label: '影响哪几天', value: affectedLabels.length ? affectedLabels.join(' / ') : '无日程变化', note: `${preview?.impact.hotelChanges.length ?? 0} 处住宿变化` },
                { label: '阻断冲突', value: conflictCount, note: conflictCount ? '解决后才能应用' : preview?.canApply ? '可应用当前选择' : '当前无技术阻断', tone: conflictCount ? 'coral' : 'sea' },
              ]}
            />
          </section>

          <section className="feature-section">
            <SectionHeading title="提案组" description="每组要么整体接受，要么整体拒绝；选择变化会重新 dry-run。" />
            <div className="changeset-groups">
              {changeSet.proposalGroups.map((group) => {
                const groupPreview = preview?.proposalGroups.find((item) => item.groupId === group.groupId)
                const decision = selection[group.groupId] ?? 'accept'
                return (
                  <article className={`feature-card changeset-group ${groupPreview?.status === 'conflict' ? 'changeset-group--conflict' : ''}`} key={group.groupId}>
                    <div className="feature-card-header">
                      <div className="feature-card-title">
                        <div className="changeset-group-meta"><StatusBadge tone={group.atomic ? 'brand' : 'neutral'}>{group.atomic ? '原子组' : '提案组'}</StatusBadge><span>{group.operations.length} 项操作</span></div>
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
                      {group.operations.map((operation, index) => <span key={`${operation.type}-${index}`}>{operation.type.replaceAll('_', ' ')}</span>)}
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
              <h2>应用 {selectedGroupIds.length} 个提案组</h2>
              <p>{preview?.canApply ? '应用会原子创建新版本，并把活动草稿重置为干净副本。' : '当前选择存在阻断、未解析地点或过期基线，不能应用。'}</p>
            </div>
            <Button variant="primary" icon={busy === 'apply' ? LoaderCircle : GitPullRequestArrow} onClick={apply} disabled={!preview?.canApply || state.dirty || selectedGroupIds.length === 0 || busy !== null || storedStatus === 'applied'}>{busy === 'apply' ? '正在试算并应用' : storedStatus === 'applied' ? '已应用' : '应用并创建新版本'}</Button>
          </section>

          <details className="feature-technical">
            <summary>技术详情 · 原始 JSON</summary>
            <pre>{JSON.stringify(changeSet, null, 2)}</pre>
          </details>
        </>
      ) : null}
    </PageShell>
  )
}

export default ChangeSetPage
