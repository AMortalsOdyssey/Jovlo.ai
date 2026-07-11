import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPaste,
  FileJson2,
  GitPullRequestArrow,
  ShieldAlert,
  Upload,
} from 'lucide-react'
import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  DEMO_CHANGESET,
  TripChangeSetSchema,
  previewChangeSet,
  type ChangeSetPreview,
  type DerivedSnapshot,
  type TripChangeSet,
  type TripSnapshot,
} from '@domain'

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
): ChangeSetPreview | null {
  if (!trip || !changeSet) return null
  try {
    return previewChangeSet(trip as TripSnapshot, changeSet, {
      selectedGroupIds,
      currentVersionId,
      routeLegsBefore: (derived as DerivedSnapshot | undefined)?.routeLegs,
    })
  } catch {
    return null
  }
}

export function ChangeSetPage() {
  const state = useTripStore()
  const versions = normalizeVersions(state.versions)
  const currentVersionId = versions[0]?.id
  const fileRef = useRef<HTMLInputElement>(null)
  const [raw, setRaw] = useState(() => JSON.stringify(DEMO_CHANGESET, null, 2))
  const [changeSet, setChangeSet] = useState<TripChangeSet | null>(DEMO_CHANGESET)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<Record<string, 'accept' | 'reject'>>(() =>
    Object.fromEntries(DEMO_CHANGESET.proposalGroups.map((group) => [group.groupId, 'accept'])),
  )
  const [applied, setApplied] = useState(false)
  const selectedGroupIds = changeSet?.proposalGroups
    .filter((group) => selection[group.groupId] !== 'reject')
    .map((group) => group.groupId) ?? []
  const preview = useMemo(
    () => createPreview(state.trip, changeSet, selectedGroupIds, currentVersionId, state.derived),
    [state.trip, state.derived, changeSet, selectedGroupIds.join('|'), currentVersionId],
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

  const apply = () => {
    if (!changeSet || !preview?.canApply || state.dirty) return
    if (changeSet.changeSetId !== DEMO_CHANGESET.changeSetId) {
      setError('当前本地数据适配器只允许应用内置演示 ChangeSet；该文件已完成校验和 dry-run，没有写入行程。')
      return
    }
    for (const group of DEMO_CHANGESET.proposalGroups) {
      state.setChangeSetGroupAccepted(group.groupId, selectedGroupIds.includes(group.groupId))
    }
    state.prepareDemoChangeSet(selectedGroupIds)
    state.applyDemoChangeSet()
    setApplied(true)
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
        {error ? <div className="feature-notice feature-notice--danger changeset-error" role="alert"><AlertTriangle aria-hidden="true" size={20} /><div><strong>格式无效</strong><span>{error}</span></div></div> : null}
      </section>

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

          <section className="feature-section changeset-apply-section">
            <div>
              <h2>应用 {selectedGroupIds.length} 个提案组</h2>
              <p>{preview?.canApply ? '应用会原子创建新版本，并把活动草稿重置为干净副本。' : '当前选择存在阻断、未解析地点或过期基线，不能应用。'}</p>
            </div>
            <Button variant="primary" icon={GitPullRequestArrow} onClick={apply} disabled={!preview?.canApply || state.dirty || selectedGroupIds.length === 0}>应用并创建新版本</Button>
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
