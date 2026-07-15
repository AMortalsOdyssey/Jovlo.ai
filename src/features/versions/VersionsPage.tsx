import { Eye, GitCompareArrows, History, Plus, RotateCcw, Waypoints } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  classifyVersionChange,
  semanticDiff,
  type SemanticDiff,
  type TripVersion,
  type VersionChangeClassification,
} from '@domain'

import { useTripStore } from '@/store/useTripStore'

import {
  Button,
  ButtonLink,
  EmptyState,
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

function buildDiff(older?: TripVersion, newer?: TripVersion): SemanticDiff | null {
  if (!older || !newer) return null
  try {
    return semanticDiff(
      older.snapshot,
      newer.snapshot,
      older.derivedSnapshot,
      newer.derivedSnapshot,
    )
  } catch {
    return null
  }
}

function versionTone(classification: VersionChangeClassification) {
  if (classification.level === 'major') return 'coral' as const
  if (classification.level === 'baseline') return 'sky' as const
  return 'neutral' as const
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

function formatSignedMinutes(value: number): string {
  if (value === 0) return '驾驶时间不变'
  return `${value > 0 ? '+' : '-'}${formatMinutes(Math.abs(value))}`
}

export function VersionsPage() {
  const state = useTripStore()
  const versions = useMemo(
    () => [...state.versions].sort((left, right) => right.versionNo - left.versionNo),
    [state.versions],
  )
  const classifications = useMemo(
    () => new Map(versions.map((version, index) => [
      version.id,
      classifyVersionChange(
        versions[index + 1]?.snapshot,
        version.snapshot,
        versions[index + 1]?.derivedSnapshot,
        version.derivedSnapshot,
      ),
    ])),
    [versions],
  )
  const [selectedId, setSelectedId] = useState<string | null>(versions[0]?.id ?? null)
  const [restoreId, setRestoreId] = useState<string | null>(null)
  const selected = versions.find((version) => version.id === selectedId) ?? versions[0]
  const selectedIndex = selected ? versions.findIndex((version) => version.id === selected.id) : -1
  const older = selectedIndex >= 0 ? versions[selectedIndex + 1] : undefined
  const diff = useMemo(() => buildDiff(older, selected), [older, selected])
  const selectedClassification = selected ? classifications.get(selected.id) : undefined

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
        description="回看不会修改当前路书；恢复会复制旧快照并创建新版本，任何一版都不会丢失。"
        backTo={`/trips/${tripId}/plan`}
        meta={<><SaveStatus status={state.saveStatus} dirty={state.dirty} />{current ? <StatusBadge tone="brand">当前 v{current.versionNo}</StatusBadge> : null}</>}
      />

      {versions.length === 0 ? (
        <EmptyState icon={Waypoints} title="还没有历史版本" description="完成一次编辑后，自动保存、版本比较和恢复会出现在这里。" />
      ) : (
        <>
          <details className="versions-rules">
            <summary>大版本 / 小版本判定</summary>
            <p>天数、日期、出入口、单日大部分地点，或路线 / 耗时 / 预算显著变化记为大版本；单个餐厅、停留时间、来源、备注等局部调整记为小版本。</p>
          </details>
          <section className="feature-section versions-layout">
          <aside className="versions-list-panel" aria-label="版本列表">
            <SectionHeading title={`${versions.length} 个版本`} />
            <ol className="versions-list">
              {versions.map((version, index) => {
                const classification = classifications.get(version.id)
                return (
                <li key={version.id}>
                  <button className={selected?.id === version.id ? 'is-active' : ''} type="button" onClick={() => setSelectedId(version.id)}>
                    <span className="versions-number">v{version.versionNo}</span>
                    <span className="versions-copy"><strong>{version.message}</strong><small>{formatDateLabel(version.createdAt)} · {version.source === 'restore' ? '历史恢复' : version.source === 'agent' || version.source === 'changeset' ? 'Agent 修改' : version.source === 'template' ? '模板创建' : '自动保存'}</small>{classification ? <em>{classification.reasons[0]}</em> : null}</span>
                    <span className="versions-list-status">{index === 0 ? <StatusBadge tone="sea">当前</StatusBadge> : null}{classification ? <StatusBadge tone={versionTone(classification)}>{classification.label}</StatusBadge> : null}</span>
                  </button>
                </li>
                )
              })}
            </ol>
          </aside>

          <div className="versions-detail">
            {selected ? (
              <>
                <div className="feature-section-heading versions-detail-heading">
                  <div><h2>v{selected.versionNo} · {selected.message}</h2><p>{older ? `与 v${older.versionNo} 比较` : '首个版本，无上一版本可比较'}{selectedClassification ? ` · ${selectedClassification.label}` : ''}</p></div>
                  <div className="feature-action-row versions-detail-actions">
                    <ButtonLink icon={Eye} to={`/trips/${tripId}/versions/${selected.id}`}>只读回看</ButtonLink>
                    {selected.id !== current?.id ? <Button icon={RotateCcw} onClick={() => setRestoreId(selected.id)}>恢复此版本</Button> : null}
                  </div>
                </div>

                {selectedClassification ? <div className={`versions-classification versions-classification--${selectedClassification.level}`}><strong>{selectedClassification.label}</strong><span>{selectedClassification.reasons.join(' · ')}</span></div> : null}

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
                      <span>{formatSignedMinutes((diff.impact.durationDeltaSeconds ?? 0) / 60)}</span>
                      <span>{diff.impact.budgetDelta ? `${diff.impact.budgetDelta.expected > 0 ? '+' : ''}${formatMoney(diff.impact.budgetDelta.expected)}` : '预算不变'}</span>
                    </div>
                    {diff.entries.length ? (
                      <ol className="versions-diff-list">
                        {diff.entries.map((entry, index) => {
                          const day = selected.snapshot.days.find((candidate) => candidate.id === (entry.dayId ?? entry.toDayId))
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
        </>
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
