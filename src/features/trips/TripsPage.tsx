import { CalendarDays, CarFront, Map, Plus, Route, WalletCards } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useTripStore } from '@/store/useTripStore'

import {
  ButtonLink,
  EmptyState,
  MetricStrip,
  PageHeader,
  PageShell,
  SaveStatus,
  StatusBadge,
} from './feature-ui'
import {
  formatDateLabel,
  formatMinutes,
  formatMoney,
  getOptionalTripList,
  getPlannedBudget,
  getTripDays,
  getTripDistanceMeters,
  getTripDriveMinutes,
  getTripId,
  getTripIntent,
  getTripTitle,
  normalizeVersions,
  readString,
} from './model'

export function TripsPage() {
  const state = useTripStore()
  const trips = getOptionalTripList(state)
  const versions = normalizeVersions(state.versions)

  return (
    <PageShell>
      <PageHeader
        trail={[]}
        title="我的路书"
        description="继续完善正在规划的路线，或从一组高影响条件开始新的海南自驾草案。"
        actions={<ButtonLink to="/trips/new" variant="primary" icon={Plus}>新建路书</ButtonLink>}
      />

      {trips.length === 0 ? (
        <EmptyState
          icon={Route}
          title="还没有路书"
          description="先把日期、进出岛地点和旅行节奏定下来，首份草案大约一分钟可编辑。"
          action={<ButtonLink to="/trips/new" variant="primary" icon={Plus}>创建海南自驾路书</ButtonLink>}
        />
      ) : (
        <section className="feature-section" aria-label="路书列表">
          <ul className="feature-card-list trips-list">
            {trips.map((tripValue, index) => {
              const tripId = getTripId(tripValue)
              const title = getTripTitle(tripValue)
              const days = getTripDays(tripValue)
              const intent = getTripIntent(tripValue)
              const entry = readString(intent.entryAnchor, 'label') ?? '入口待定'
              const exit = readString(intent.exitAnchor, 'label') ?? '出口待定'
              const distance = index === 0 ? getTripDistanceMeters(state.derived) : 0
              const driveMinutes = index === 0 ? getTripDriveMinutes(state.derived) : 0
              const budget = index === 0 ? getPlannedBudget(tripValue, state.derived) : 0
              const startDate = readString(intent, 'startDate') ?? days[0]?.date
              const lastDate = days.at(-1)?.date
              const currentVersion = index === 0 ? versions[0]?.versionNo : undefined

              return (
                <li className="feature-card trips-card" key={tripId}>
                  <div className="feature-card-header">
                    <div className="feature-card-title">
                      <div className="trips-card-kicker">
                        <StatusBadge tone={readString(tripValue, 'status') === 'completed' ? 'sea' : 'brand'}>
                          {readString(tripValue, 'status') === 'completed' ? '已完成' : '规划中'}
                        </StatusBadge>
                        {currentVersion ? <StatusBadge>v{currentVersion}</StatusBadge> : null}
                        {index === 0 ? <SaveStatus status={state.saveStatus} dirty={state.dirty} /> : null}
                      </div>
                      <h2>
                        <Link to={`/trips/${tripId}/plan`}>{title}</Link>
                      </h2>
                      <p>{entry} → {exit}</p>
                    </div>
                    <div className="trips-date-block">
                      <CalendarDays aria-hidden="true" size={18} />
                      <span>{formatDateLabel(startDate)}{lastDate ? ` – ${formatDateLabel(lastDate)}` : ''}</span>
                    </div>
                  </div>

                  <MetricStrip
                    className="trips-card-metrics"
                    metrics={[
                      { label: '天数', value: `${days.length || readString(intent, 'days') || 0} 天`, note: `${days.reduce((sum, day) => sum + day.stops.length, 0)} 个停靠点` },
                      { label: '总驾驶', value: driveMinutes ? formatMinutes(driveMinutes) : '待计算', note: distance ? `${(distance / 1000).toFixed(0)} km` : '路线摘要待生成' },
                      { label: '计划预算', value: budget ? formatMoney(budget) : '待估算', note: readString(intent, 'pace') === 'relaxed' ? '轻松节奏' : '按当前设置' },
                      { label: '路线', value: `${entry}–${exit}`, note: '海南自驾' },
                    ]}
                  />

                  <div className="feature-card-footer">
                    <div className="trips-card-shortcuts" aria-label="路书快捷入口">
                      <Link to={`/trips/${tripId}/today`}><Map aria-hidden="true" size={16} />今日</Link>
                      <Link to={`/trips/${tripId}/budget`}><WalletCards aria-hidden="true" size={16} />预算</Link>
                      <Link to={`/trips/${tripId}/settings`}><CarFront aria-hidden="true" size={16} />设置</Link>
                    </div>
                    <ButtonLink to={`/trips/${tripId}/plan`} variant="primary">继续规划</ButtonLink>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </PageShell>
  )
}

export default TripsPage
