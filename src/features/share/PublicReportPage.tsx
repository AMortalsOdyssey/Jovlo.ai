import { AlertCircle, BedDouble, CheckCircle2, ExternalLink, MapPin, Route, Star, WalletCards } from 'lucide-react'
import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { DerivedSnapshot, ReportGeneration, TripSnapshot } from '@domain'

import { apiRequest } from '@/lib/api'
import { isSupabaseConfigured } from '@/lib/supabase'
import { useTripStore } from '@/store/useTripStore'

import { EmptyState, RouteSpine, RouteSpineItem, StatusBadge } from '@/features/trips/feature-ui'
import {
  formatDateLabel,
  formatMinutes,
  formatMoney,
  getPlannedBudget,
  getSourceRefs,
  getTripDays,
  getTripDistanceMeters,
  getTripDriveMinutes,
  getTripTitle,
  normalizeActuals,
  normalizeExpenses,
  normalizeReports,
  readString,
} from '@/features/trips/model'

type PublicReportResponse = {
  report: ReportGeneration
  snapshot: TripSnapshot | null
  derived: DerivedSnapshot | null
  expenseSummary: { count: number; total: number }
  actualSummary: { visited: number; skipped: number }
  disclosureConfig: {
    showExactDates: boolean
    showSources: boolean
    showBudget: boolean
    viewScope?: 'overview' | 'day'
  }
}

export function PublicReportPage() {
  const state = useTripStore()
  const { token } = useParams<{ token: string }>()
  const localPublication = token
    ? state.publications.find((publication) => publication.token === token && publication.targetKind === 'report')
    : undefined
  const localReportEntity = state.reports.find((item) =>
    item.id === (localPublication?.reportId ?? token),
  ) ?? (!token ? state.reports.find((item) => item.status === 'ready') : undefined)
  const localSnapshot = localReportEntity ? state.reportSnapshots[localReportEntity.id] : undefined
  const remote = useQuery({
    queryKey: ['public-report', token],
    queryFn: () => apiRequest<PublicReportResponse>(`/api/v1/public/reports/${encodeURIComponent(token as string)}`),
    enabled: Boolean(token && (isSupabaseConfigured || (!localReportEntity && !localPublication))),
    retry: false,
  })
  const preferRemote = Boolean(token && isSupabaseConfigured)
  const report = !preferRemote && localReportEntity
    ? normalizeReports([localReportEntity])[0]
    : remote.data?.report
      ? normalizeReports([remote.data.report])[0]
      : undefined
  const trip = preferRemote ? remote.data?.snapshot ?? undefined : localSnapshot?.trip ?? remote.data?.snapshot ?? undefined
  const derived = preferRemote ? remote.data?.derived ?? undefined : localSnapshot?.derived ?? remote.data?.derived ?? undefined
  const days = useMemo(() => getTripDays(trip), [trip])
  const actuals = useMemo(() => normalizeActuals(localSnapshot?.actuals ?? []), [localSnapshot])
  const expenses = useMemo(() => normalizeExpenses(localSnapshot?.expenses ?? []), [localSnapshot])
  const sources = useMemo(() => Object.values(getSourceRefs(trip)), [trip])
  const disclosure = remote.data?.disclosureConfig ?? localPublication?.disclosureConfig ?? {
    showExactDates: true,
    showSources: true,
    showBudget: true,
    viewScope: 'overview' as const,
  }

  if (localPublication?.revokedAt || remote.isError || (!remote.isLoading && (!trip || !derived || !report))) {
    return (
      <main className="public-page public-page--empty">
        <EmptyState icon={AlertCircle} title="这份报告链接不可用" description="它可能已被撤销，或固定报告暂时无法读取。" />
      </main>
    )
  }

  if (remote.isLoading || !trip || !derived || !report) {
    return (
      <main className="public-page public-page--empty">
        <EmptyState icon={AlertCircle} title="正在打开固定报告" description="正在验证分享状态与生成快照。" />
      </main>
    )
  }

  const plannedBudget = getPlannedBudget(trip, derived)
  const spent = localSnapshot
    ? expenses.reduce((sum, expense) => sum + expense.amount, 0)
    : remote.data?.expenseSummary.total ?? 0
  const visited = actuals.filter((actual) => actual.status === 'visited')
  const skipped = actuals.filter((actual) => actual.status === 'skipped')
  const visitedCount = localSnapshot ? visited.length : remote.data?.actualSummary.visited ?? 0
  const skippedCount = localSnapshot ? skipped.length : remote.data?.actualSummary.skipped ?? 0
  const rated = visited.filter((actual) => actual.rating).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
  const stopById = new Map(days.flatMap((day) => day.stops.map((stop) => [stop.id, stop] as const)))
  const isActual = report.type === 'actual'
  const reportVersionNo = report.versionNo ?? state.versions.find((version) => version.id === localReportEntity?.versionId)?.versionNo

  return (
    <main className="public-page public-report-page">
      <header className="report-cover">
        <div className="public-brand public-brand--light"><img src="/jovlo-mark.svg" alt="" /><span>Jovlo</span></div>
        <div className="report-cover-copy">
          <p>{isActual ? '实际旅行报告' : '计划路书报告'} · 第 {report.generationNo} 版</p>
          <h1>{getTripTitle(trip)}</h1>
          <div className="report-cover-route"><MapPin aria-hidden="true" size={18} /><span>{days[0]?.stops[0]?.name ?? '起点待定'} → {days.at(-1)?.stops.at(-1)?.name ?? '终点待定'}</span></div>
        </div>
        <div className="report-cover-meta"><span>基于行程 v{reportVersionNo ?? '?'}</span><span>生成于 {formatDateLabel(report.createdAt)}</span></div>
      </header>

      <section className="report-kpis" aria-label="核心指标">
        <div><span>天数</span><strong>{days.length}</strong><small>天</small></div>
        <div><span>总距离</span><strong>{(getTripDistanceMeters(derived) / 1000).toFixed(0)}</strong><small>km</small></div>
        <div><span>{isActual ? '实际花销' : '计划预算'}</span><strong>{disclosure.showBudget ? Math.round(isActual ? spent : plannedBudget).toLocaleString('zh-CN') : '未公开'}</strong><small>{disclosure.showBudget ? '元' : ''}</small></div>
        <div><span>{isActual ? '到访记录' : '停靠点'}</span><strong>{isActual ? visitedCount : days.reduce((sum, day) => sum + day.stops.length, 0)}</strong><small>{isActual ? '处' : '站'}</small></div>
      </section>

      <article className="report-body">
        <section className="report-section report-overview">
          <div className="report-section-number">01</div>
          <div><p className="report-kicker">路线概览</p><h2>{days.length} 天，计划驾驶 {formatMinutes(getTripDriveMinutes(derived))}</h2><p>从固定的行程版本整理路线、住宿和预算。{isActual ? '实际口径只包含用户明确记录的到访、跳过与支出。' : '未发生的体验与耗时不作推断。'}</p></div>
        </section>

        <section className="report-section">
          <div className="report-section-number">02</div>
          <div className="report-section-main">
            <p className="report-kicker">每日章节</p>
            <h2>沿路线脊柱回看每一天</h2>
            <div className="report-days">
              {days.map((day) => (
                <article className="report-day" key={day.id}>
                  <header><span>Day {day.dayIndex}</span><h3>{day.overnightLabel ?? day.stops.at(-1)?.name ?? '目的地待定'}</h3><small>{disclosure.showExactDates ? formatDateLabel(day.date) : '日期已隐藏'}</small></header>
                  <RouteSpine>
                    {day.stops.map((stop, index) => {
                      const actual = actuals.find((item) => item.stopId === stop.id)
                      return <RouteSpineItem key={stop.id} marker={actual?.status === 'visited' ? <CheckCircle2 aria-hidden="true" size={15} /> : index + 1} title={stop.name} meta={`计划停留 ${formatMinutes(stop.stayMinutes)}`} note={isActual ? actual?.note ?? (actual?.status === 'skipped' ? '实际记录：跳过' : '实际体验未记录') : stop.note} action={isActual && actual?.rating ? <span className="report-rating"><Star aria-hidden="true" size={14} fill="currentColor" />{actual.rating}</span> : undefined} />
                    })}
                    {day.overnightLabel ? <RouteSpineItem marker={<BedDouble aria-hidden="true" size={14} />} title={`宿 · ${day.overnightLabel}`} kind="stay" /> : null}
                  </RouteSpine>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="report-section">
          <div className="report-section-number">03</div>
          <div className="report-section-main">
            <p className="report-kicker">预算分析</p><h2>{disclosure.showBudget ? (isActual ? `实际记录 ${formatMoney(spent)}` : `计划预算 ${formatMoney(plannedBudget)}`) : '预算未公开'}</h2>
            {disclosure.showBudget ? <div className="report-budget-row"><div><WalletCards aria-hidden="true" size={20} /><span>计划</span><strong>{formatMoney(plannedBudget)}</strong></div><div><Route aria-hidden="true" size={20} /><span>实际</span><strong>{(localSnapshot ? expenses.length : remote.data?.expenseSummary.count) ? formatMoney(spent) : '未记录'}</strong></div><div><CheckCircle2 aria-hidden="true" size={20} /><span>差额</span><strong>{(localSnapshot ? expenses.length : remote.data?.expenseSummary.count) ? formatMoney(plannedBudget - spent) : '待旅行后填写'}</strong></div></div> : null}
          </div>
        </section>

        <section className="report-section">
          <div className="report-section-number">04</div>
          <div className="report-section-main">
            <p className="report-kicker">体验与建议</p><h2>{isActual ? '明确记录的体验' : '旅行后再填写'}</h2>
            {isActual && rated.length ? <div className="report-experience-list">{rated.slice(0, 3).map((actual) => <div key={actual.id}><span>{actual.rating} / 5</span><strong>{actual.stopId ? stopById.get(actual.stopId)?.name ?? '地点记录' : '行程记录'}</strong><p>{actual.note ?? '用户未填写文字备注'}</p></div>)}</div> : <p className="report-placeholder">没有用户记录时，Jovlo 不会用模板补写“最佳体验”或满意度。</p>}
            {isActual && skippedCount ? <p className="report-skipped">本次明确记录跳过 {skippedCount} 站；未记录的地点不自动视为未完成。</p> : null}
          </div>
        </section>

        <section className="report-section report-sources">
          <div className="report-section-number">05</div>
          <div className="report-section-main">
            <p className="report-kicker">来源附录</p><h2>{disclosure.showSources ? `${sources.length} 个公开来源` : '来源未公开'}</h2>
            {disclosure.showSources ? <ol>{sources.map((source, index) => <li key={readString(source, 'sourceId') ?? index}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{readString(source, 'title') ?? '来源'}</strong><p>{readString(source, 'summary')}</p></div>{readString(source, 'url') ? <a href={readString(source, 'url')} target="_blank" rel="noreferrer" aria-label="打开来源"><ExternalLink aria-hidden="true" size={17} /></a> : null}</li>)}</ol> : null}
          </div>
        </section>
      </article>

      <footer className="public-footer report-footer"><a href="/"><img src="/jovlo-mark.svg" alt="" />用 Jovlo 制作</a><span>报告第 {report.generationNo} 版 · 固定快照</span></footer>
    </main>
  )
}

export default PublicReportPage
