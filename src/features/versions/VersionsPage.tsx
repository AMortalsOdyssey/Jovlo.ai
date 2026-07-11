import { GitCompareArrows, History, Plus, RotateCcw, Save, Waypoints } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { semanticDiff, type DerivedSnapshot, type SemanticDiff, type TripSnapshot } from '@domain'

import { useTripStore } from '@/store/useTripStore'

import {
  Button,
  EmptyState,
  FormField,
  MetricStrip,
  PageHeader,
  PageShell,
  SaveStatus,
  SectionHeading,
  StatusBadge,
} from '@/features/trips/feature-ui'
import {
  formatDateLabel,
  formatMinutes,
  formatMoney,
  getTripDays,
  getTripId,
  getTripTitle,
  normalizeVersions,
} from '@/features/trips/model'

const kindLabel: Record<string, string> = {
  stop_added: '新增地点',
  stop_removed: '移除地点',
  stop_moved: '移动地点',
  stop_updated: '调整地点',
  place_replaced: '替换地点',
  hotel_changed: '更换住宿',
  setting_changed: '设置变化',
  budget_assumption_changed: '预算假设',
  source_added: '新增来源',
  source_removed: '移除来源',
  source_updated: '更新来源',
}

function buildDiff(older?: ReturnType<typeof normalizeVersions>[number], newer?: ReturnType<typeof normalizeVersions>[number]): SemanticDiff | null {
  if (!older?.snapshot || !newer?.snapshot) return null
  try {
    return semanticDiff(
      older.snapshot as unknown as TripSnapshot,
      newer.snapshot as unknown as TripSnapshot,
      older.derivedSnapshot as unknown as DerivedSnapshot | undefined,
      newer.derivedSnapshot as unknown as DerivedSnapshot | undefined,
    )
  } catch {
    return null
  }
}

function renderChangeValue(value: unknown): string {
  if (value === null || value === undefined) return '无'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return '已变化'
  }
}

export function VersionsPage() {
  const state = useTripStore()
  const versions = useMemo(() => normalizeVersions(state.versions), [state.versions])
  const [selectedId, setSelectedId] = useState<string | null>(versions[0]?.id ?? null)
  const [message, setMessage] = useState('')
  const [restoreId, setRestoreId] = useState<string | null>(null)
  const selected = versions.find((version) => version.id === selectedId) ?? versions[0]
  const selectedIndex = selected ? versions.findIndex((version) => version.id === selected.id) : -1
  const older = selectedIndex >= 0 ? versions[selectedIndex + 1] : undefined
  const diff = useMemo(() => buildDiff(older, selected), [older, selected])

  const publish = (event: FormEvent) => {
    event.preventDefault()
    state.publishVersion(message.trim() || '手动保存')
    setMessage('')
  }

  const restore = () => {
    if (!restoreId) return
    state.restoreVersion(restoreId)
    setRestoreId(null)
  }

  if (!state.trip) {
    return (
      <PageShell>
        <PageHeader title="版本历史" backTo="/trips" />
        <EmptyState icon={History} title="还没有可查看的行程" />
      </PageShell>
    )
  }

  const tripId = getTripId(state.trip)
  const current = versions[0]

  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow={getTripTitle(state.trip)}
        title="版本历史"
        description="版本是明确发布的检查点；恢复会创建新版本，不会移动或删除历史。"
        backTo={`/trips/${tripId}/plan`}
        meta={<><SaveStatus status={state.saveStatus} dirty={state.dirty} />{current ? <StatusBadge tone="brand">当前 v{current.versionNo}</StatusBadge> : null}</>}
      />

      <section className="feature-section versions-publish-section">
        <SectionHeading title="保存当前草稿" description={state.dirty ? '草稿有未发布修改，可加一句版本备注。' : '当前草稿与最近版本一致。'} />
        <form className="versions-publish-form" onSubmit={publish}>
          <FormField label="版本备注" hint="例如：确认万宁住宿并放宽 Day 3">
            <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="这次改了什么" />
          </FormField>
          <Button type="submit" variant="primary" icon={Save} disabled={!state.dirty}>保存版本</Button>
        </form>
      </section>

      {versions.length === 0 ? (
        <EmptyState icon={Waypoints} title="还没有已发布版本" description="保存当前草稿后，版本比较和恢复会出现在这里。" />
      ) : (
        <section className="feature-section versions-layout">
          <aside className="versions-list-panel" aria-label="版本列表">
            <SectionHeading title={`${versions.length} 个版本`} />
            <ol className="versions-list">
              {versions.map((version, index) => (
                <li key={version.id}>
                  <button className={selected?.id === version.id ? 'is-active' : ''} type="button" onClick={() => setSelectedId(version.id)}>
                    <span className="versions-number">v{version.versionNo}</span>
                    <span className="versions-copy"><strong>{version.message}</strong><small>{formatDateLabel(version.createdAt)} · {version.source === 'restore' ? '历史恢复' : version.source === 'changeset' ? 'ChangeSet' : version.source === 'template' ? '模板创建' : '手动发布'}</small></span>
                    {index === 0 ? <StatusBadge tone="sea">当前</StatusBadge> : null}
                  </button>
                </li>
              ))}
            </ol>
          </aside>

          <div className="versions-detail">
            {selected ? (
              <>
                <div className="feature-section-heading versions-detail-heading">
                  <div><h2>v{selected.versionNo} · {selected.message}</h2><p>{older ? `与 v${older.versionNo} 比较` : '首个版本，无上一版本可比较'}</p></div>
                  {selected.id !== current?.id ? <Button icon={RotateCcw} onClick={() => setRestoreId(selected.id)}>恢复此版本</Button> : null}
                </div>

                <MetricStrip
                  className="versions-diff-metrics"
                  metrics={[
                    { label: '新增', value: diff?.counts.added ?? 0, tone: 'sea' },
                    { label: '调整', value: diff?.counts.changed ?? 0, tone: 'brand' },
                    { label: '移除', value: diff?.counts.removed ?? 0, tone: diff?.counts.removed ? 'sun' : 'neutral' },
                    { label: '冲突', value: diff?.counts.conflicts ?? 0, tone: diff?.counts.conflicts ? 'coral' : 'neutral' },
                  ]}
                />

                {diff ? (
                  <>
                    <div className="versions-impact-line">
                      <GitCompareArrows aria-hidden="true" size={18} />
                      <span>{diff.impact.distanceDeltaMeters ? `${diff.impact.distanceDeltaMeters > 0 ? '+' : ''}${(diff.impact.distanceDeltaMeters / 1000).toFixed(0)} km` : '里程不变'}</span>
                      <span>{diff.impact.durationDeltaSeconds ? `${diff.impact.durationDeltaSeconds > 0 ? '+' : ''}${formatMinutes(diff.impact.durationDeltaSeconds / 60)}` : '驾驶时间不变'}</span>
                      <span>{diff.impact.budgetDelta ? `${diff.impact.budgetDelta.expected > 0 ? '+' : ''}${formatMoney(diff.impact.budgetDelta.expected)}` : '预算不变'}</span>
                    </div>
                    {diff.entries.length ? (
                      <ol className="versions-diff-list">
                        {diff.entries.map((entry, index) => {
                          const snapshot = selected.snapshot as unknown as TripSnapshot
                          const day = snapshot.days?.find((candidate) => candidate.id === (entry.dayId ?? entry.toDayId))
                          return (
                            <li key={`${entry.kind}-${entry.entityId}-${index}`}>
                              <span className="versions-diff-marker" />
                              <div>
                                <span className="versions-diff-kind">{kindLabel[entry.kind] ?? entry.kind}{day ? ` · Day ${day.dayIndex}` : ''}</span>
                                <strong>{entry.label}</strong>
                                {entry.changes.map((change) => <p key={change.field}><span>{change.field}</span>{renderChangeValue(change.before)} → {renderChangeValue(change.after)}</p>)}
                              </div>
                            </li>
                          )
                        })}
                      </ol>
                    ) : <div className="versions-no-diff">两个版本的核心行程没有语义变化。</div>}
                  </>
                ) : (
                  <div className="versions-no-diff">{older ? '当前快照暂时无法生成语义 Diff。' : `首版包含 ${getTripDays(selected.snapshot).length} 天行程。`}</div>
                )}
              </>
            ) : null}
          </div>
        </section>
      )}

      {restoreId ? (
        <div className="versions-restore-confirm" role="dialog" aria-modal="true" aria-labelledby="restore-title">
          <div>
            <h2 id="restore-title">恢复 v{versions.find((version) => version.id === restoreId)?.versionNo}</h2>
            <p>将以该快照创建 v{(current?.versionNo ?? 0) + 1}“恢复自旧版本”。现有版本、费用、分享和报告都不会删除。</p>
            <div className="feature-action-row"><Button onClick={() => setRestoreId(null)}>取消</Button><Button variant="primary" icon={Plus} onClick={restore}>创建恢复版本</Button></div>
          </div>
        </div>
      ) : null}
    </PageShell>
  )
}

export default VersionsPage
