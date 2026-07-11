import { AlertCircle, BarChart3, Clock3, FileChartColumn, RefreshCw, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

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
  type Tone,
} from '@/features/trips/feature-ui'
import {
  asRecord,
  formatDateLabel,
  formatMoney,
  getPlannedBudget,
  getTripDays,
  getTripDistanceMeters,
  getTripDriveMinutes,
  getTripId,
  getTripTitle,
  normalizeActuals,
  normalizeExpenses,
  normalizeReports,
  normalizeVersions,
  readString,
} from '@/features/trips/model'

type ReportType = 'plan' | 'actual'
type ReportFilter = 'all' | 'plan' | 'actual' | 'failed'

const reportStatus: Record<string, { label: string; tone: Tone }> = {
  queued: { label: '排队中', tone: 'neutral' },
  generating: { label: '生成中', tone: 'sky' },
  ready: { label: '可查看', tone: 'sea' },
  stale: { label: '数据已过期', tone: 'sun' },
  failed: { label: '生成失败', tone: 'coral' },
}

export function ReportsPage() {
  const state = useTripStore()
  const reports = useMemo(() => normalizeReports(state.reports), [state.reports])
  const versions = useMemo(() => normalizeVersions(state.versions), [state.versions])
  const actuals = useMemo(() => normalizeActuals(state.actuals), [state.actuals])
  const expenses = useMemo(() => normalizeExpenses(state.expenses), [state.expenses])
  const [type, setType] = useState<ReportType>('plan')
  const [filter, setFilter] = useState<ReportFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(reports[0]?.id ?? null)
  const currentVersionNo = versions[0]?.versionNo
  const canGenerateActual = actuals.some((actual) => actual.status !== 'unrecorded')
  const visible = reports.filter((report) =>
    filter === 'all' ? true : filter === 'failed' ? report.status === 'failed' : report.type === filter,
  )
  const selected = visible.find((report) => report.id === selectedId) ?? visible[0]
  const selectedVersionNo = selected
    ? selected.versionNo ?? versions.find((version) => version.id === selected.versionId)?.versionNo
    : undefined
  const selectedIsStale = selected
    ? selected.status === 'stale' || Boolean(selected.versionId && selected.versionId !== versions[0]?.id)
    : false

  if (!state.trip) {
    return (
      <PageShell>
        <PageHeader title="报告" backTo="/trips" />
        <EmptyState icon={FileChartColumn} title="还没有可生成报告的行程" />
      </PageShell>
    )
  }

  const tripId = getTripId(state.trip)
  const days = getTripDays(state.trip)
  const plannedBudget = getPlannedBudget(state.trip, state.derived)
  const spent = expenses.reduce((sum, expense) => sum + expense.amount, 0)
  const visited = actuals.filter((actual) => actual.status === 'visited').length
  const skipped = actuals.filter((actual) => actual.status === 'skipped').length

  const generate = () => {
    if (type === 'actual' && !canGenerateActual) return
    state.generateReport(type)
  }

  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow={getTripTitle(state.trip)}
        title="报告"
        description="计划报告只使用发布版本与估算；实际报告只写入明确记录的到访、体验和花销。"
        backTo={`/trips/${tripId}/plan`}
        meta={<><StatusBadge tone="brand">{reports.length} 次生成</StatusBadge><StatusBadge>{currentVersionNo ? `当前行程 v${currentVersionNo}` : '草稿'}</StatusBadge></>}
      />

      <section className="feature-section reports-generate">
        <div>
          <SectionHeading title="生成新报告" description="每次生成都会保留独立历史；失败不会覆盖上一份可用报告。" />
          <SegmentedControl
            label="报告类型"
            value={type}
            onChange={setType}
            options={[{ value: 'plan', label: '计划报告' }, { value: 'actual', label: '实际报告' }]}
          />
          {type === 'actual' && !canGenerateActual ? <div className="reports-actual-gate"><AlertCircle aria-hidden="true" size={18} /><span>还没有到访或跳过记录，不能生成伪实际体验。先在今日页记录至少一站。</span></div> : null}
        </div>
        <Button variant="primary" icon={Sparkles} onClick={generate} disabled={type === 'actual' && !canGenerateActual}>生成{type === 'actual' ? '实际' : '计划'}报告</Button>
      </section>

      <MetricStrip
        metrics={[
          { label: '行程', value: `${days.length} 天`, note: `${(getTripDistanceMeters(state.derived) / 1000).toFixed(0)} km` },
          { label: '计划驾驶', value: `${Math.round(getTripDriveMinutes(state.derived) / 60 * 10) / 10} 小时`, note: '发布版本口径' },
          { label: '预算', value: formatMoney(plannedBudget), note: `实际 ${formatMoney(spent)}`, tone: spent > plannedBudget ? 'sun' : 'sea' },
          { label: '实际记录', value: `${visited} 到访 · ${skipped} 跳过`, note: `${expenses.length} 笔费用`, tone: canGenerateActual ? 'brand' : 'neutral' },
        ]}
      />

      <section className="feature-section reports-history-layout">
        <aside className="reports-history">
          <SectionHeading title="生成历史" />
          <div className="reports-filter" aria-label="筛选报告">
            {([['all', '全部'], ['plan', '计划'], ['actual', '实际'], ['failed', '失败']] as Array<[ReportFilter, string]>).map(([value, label]) => <button className={filter === value ? 'is-active' : ''} type="button" onClick={() => setFilter(value)} key={value}>{label}</button>)}
          </div>
          {visible.length ? (
            <ol className="reports-list">
              {visible.map((report) => {
                const boundVersion = versions.find((version) => version.id === report.versionId)
                const reportVersionNo = report.versionNo ?? boundVersion?.versionNo
                const staleByVersion = report.status === 'ready' && Boolean(report.versionId && report.versionId !== versions[0]?.id)
                const displayStatus = staleByVersion ? 'stale' : report.status
                const status = reportStatus[displayStatus] ?? reportStatus.failed
                return (
                  <li key={report.id}>
                    <button className={selected?.id === report.id ? 'is-active' : ''} type="button" onClick={() => setSelectedId(report.id)}>
                      <span className={`reports-type reports-type--${report.type}`}>{report.type === 'actual' ? '实' : '计'}</span>
                      <span><strong>{report.type === 'actual' ? '实际' : '计划'}报告第 {report.generationNo} 版</strong><small>{formatDateLabel(report.createdAt)} · 行程 v{reportVersionNo ?? '?'}</small></span>
                      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                    </button>
                  </li>
                )
              })}
            </ol>
          ) : <div className="reports-empty-filter">当前筛选下没有报告。</div>}
        </aside>

        <div className="reports-preview">
          {selected ? (
            <>
              <div className="reports-preview-head">
                <div><span>{selected.type === 'actual' ? '实际报告' : '计划报告'}</span><h2>报告第 {selected.generationNo} 版</h2><p>基于行程 v{selectedVersionNo ?? '?'} · 费用快照 {readString(selected.raw, 'expenseSnapshotId')?.slice(0, 8) ?? '已冻结'} · 实际记录快照 {readString(selected.raw, 'actualSnapshotId')?.slice(0, 8) ?? '已冻结'}</p></div>
                {(selected.status === 'ready' || selected.status === 'stale') ? <Link className="feature-button feature-button--primary" to={`/r/${selected.token ?? selected.id}`}>查看只读报告</Link> : null}
              </div>
              {selected.status === 'failed' ? (
                <div className="reports-failed"><AlertCircle aria-hidden="true" size={28} /><h3>这次生成没有完成</h3><p>{selected.failureReason ?? '产物生成失败，上一份报告仍保持可用。'}</p><Button icon={RefreshCw} onClick={() => state.generateReport(selected.type)}>重新生成</Button></div>
              ) : selected.status === 'generating' || selected.status === 'queued' ? (
                <div className="reports-generating"><Clock3 aria-hidden="true" size={28} /><h3>正在生成</h3><p>报告会绑定当前发布版本和两个快照，不会读取后续草稿。</p></div>
              ) : (
                <div className="reports-document-preview">
                  <div className="reports-cover-mini"><BarChart3 aria-hidden="true" size={28} /><span>{getTripTitle(state.trip)}</span><strong>{days.length} 日海南自驾</strong></div>
                  <div className="reports-preview-stats"><span>总距离<strong>{(getTripDistanceMeters(state.derived) / 1000).toFixed(0)} km</strong></span><span>计划预算<strong>{formatMoney(plannedBudget)}</strong></span><span>{selected.type === 'actual' ? '完成记录' : '停靠点'}<strong>{selected.type === 'actual' ? `${visited}/${days.reduce((sum, day) => sum + day.stops.length, 0)}` : days.reduce((sum, day) => sum + day.stops.length, 0)}</strong></span></div>
                  {selectedIsStale ? <div className="feature-notice feature-notice--warning"><AlertCircle aria-hidden="true" size={18} /><div><strong>数据已过期</strong><span>当前行程已更新到 v{currentVersionNo}；这份内容仍保持生成时的固定快照。</span></div></div> : null}
                </div>
              )}
            </>
          ) : (
            <EmptyState icon={FileChartColumn} title="还没有报告历史" />
          )}
        </div>
      </section>
    </PageShell>
  )
}

export default ReportsPage
