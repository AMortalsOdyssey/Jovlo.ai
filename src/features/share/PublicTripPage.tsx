import { BedDouble, ExternalLink, MapPin, Navigation, Route, Timer, WalletCards } from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cloneJson, recalculateTrip, type DerivedSnapshot, type TripSnapshot } from '@domain'
import { useParams } from 'react-router-dom'

import { buildAmapNavigationUrl } from '@/lib/amap'
import { apiRequest } from '@/lib/api'
import { isSupabaseConfigured } from '@/lib/supabase'
import { useTripStore } from '@/store/useTripStore'

import {
  EmptyState,
  RouteSpine,
  RouteSpineItem,
  StatusBadge,
} from '@/features/trips/feature-ui'
import {
  asArray,
  asRecord,
  formatDateLabel,
  formatMinutes,
  formatMoney,
  getDerivedDay,
  getPlaceRefs,
  getPlannedBudget,
  getSourceRefs,
  getTripDays,
  getTripDistanceMeters,
  getTripDriveMinutes,
  getTripTitle,
  readNumber,
  readString,
} from '@/features/trips/model'

export type PublicTripPageProps = {
  snapshot?: TripSnapshot
  derivedSnapshot?: DerivedSnapshot
}

type PublicTripResponse = {
  publicationId: string
  versionId: string
  snapshot: TripSnapshot
  derived: DerivedSnapshot
  disclosureConfig: {
    showExactDates: boolean
    showSources: boolean
    showBudget: boolean
    viewScope?: 'overview' | 'day'
  }
  view: {
    scope: 'overview' | 'day'
    dayId?: string
    overviewToken?: string
  }
}

export function PublicTripPage({ snapshot, derivedSnapshot }: PublicTripPageProps = {}) {
  const state = useTripStore()
  const { token } = useParams<{ token: string }>()
  const localPublication = token
    ? state.publications.find((publication) => publication.token === token && publication.targetKind === 'version')
    : undefined
  const localVersion = localPublication?.versionId
    ? state.versions.find((version) => version.id === localPublication.versionId)
    : !token
      ? state.versions.at(-1)
      : undefined
  const remote = useQuery({
    queryKey: ['public-trip', token],
    queryFn: () => apiRequest<PublicTripResponse>(`/api/v1/public/${encodeURIComponent(token as string)}`),
    enabled: Boolean(token && !snapshot && (isSupabaseConfigured || !localPublication)),
    retry: false,
  })
  const preferRemote = Boolean(token && isSupabaseConfigured)
  const scopedLocal = useMemo(() => {
    if (!localVersion || localPublication?.disclosureConfig.viewScope !== 'day' || !localPublication.disclosureConfig.dayId) {
      return localVersion ? { snapshot: localVersion.snapshot, derived: localVersion.derivedSnapshot } : undefined
    }
    const day = localVersion.snapshot.days.find((item) => item.id === localPublication.disclosureConfig.dayId)
    if (!day) return undefined
    const scoped = cloneJson(localVersion.snapshot)
    scoped.days = [day]
    scoped.intent.days = 1
    scoped.intent.startDate = day.date
    return {
      snapshot: scoped,
      derived: recalculateTrip(scoped, localVersion.derivedSnapshot.routeLegs.filter((leg) => leg.dayId === day.id)),
    }
  }, [localPublication, localVersion])
  const trip = snapshot ?? (preferRemote ? remote.data?.snapshot : scopedLocal?.snapshot ?? remote.data?.snapshot)
  const derived = derivedSnapshot ?? (preferRemote ? remote.data?.derived : scopedLocal?.derived ?? remote.data?.derived)
  const disclosure = remote.data?.disclosureConfig ?? localPublication?.disclosureConfig ?? {
    showExactDates: true,
    showSources: true,
    showBudget: true,
    viewScope: 'overview' as const,
  }
  const view = remote.data?.view ?? {
    scope: disclosure.viewScope ?? 'overview',
    dayId: localPublication?.disclosureConfig.dayId,
    overviewToken: localPublication?.disclosureConfig.overviewToken,
  }
  const days = useMemo(() => getTripDays(trip), [trip])
  const places = useMemo(() => getPlaceRefs(trip), [trip])
  const sources = useMemo(() => getSourceRefs(trip), [trip])
  const [selectedDayId, setSelectedDayId] = useState<string | null>(days[0]?.id ?? null)
  const selectedDay = days.find((day) => day.id === selectedDayId) ?? days[0]

  if (localPublication?.revokedAt || remote.isError || (!remote.isLoading && (!trip || !derived || !selectedDay))) {
    return (
      <main className="public-page public-page--empty">
        <EmptyState icon={Route} title="这份路书链接不可用" description="它可能已被撤销，或固定版本暂时无法读取。" />
      </main>
    )
  }

  if (remote.isLoading || !trip || !derived || !selectedDay) {
    return (
      <main className="public-page public-page--empty">
        <EmptyState icon={Route} title="正在打开固定路书" description="正在验证分享状态与不可变版本。" />
      </main>
    )
  }

  const routeLegs = asArray(asRecord(derived).routeLegs)
  const daySchedule = getDerivedDay(derived, selectedDay.id, selectedDay.dayIndex)
  const schedules = asArray(daySchedule.stops)
  const totalStops = days.reduce((sum, day) => sum + day.stops.length, 0)
  const routeCities = days.map((day) => day.overnightLabel ?? day.stops.at(-1)?.name ?? `Day ${day.dayIndex}`)

  return (
    <main className="public-page public-trip-page">
      <header className="public-trip-hero">
        <div className="public-brand"><img src="/jovlo-mark.svg" alt="" /><span>Jovlo.ai</span></div>
        <div className="public-hero-grid">
          <div className="public-hero-copy">
            <p>{view.scope === 'day' ? '海南自驾 · 单天路书' : '海南自驾路书'}</p>
            <h1>{getTripTitle(trip)}</h1>
            <div className="public-hero-meta"><span>{days.length} 天</span><span>{totalStops} 个停靠点</span><span>{(getTripDistanceMeters(derived) / 1000).toFixed(0)} km</span></div>
          </div>
          <div className="public-route-map" aria-label={`路线概览：${routeCities.join('，')}`}>
            <div className="public-map-label"><MapPin aria-hidden="true" size={16} />路线概览</div>
            <div className="public-map-track" aria-hidden="true" />
            {routeCities.slice(0, 6).map((city, index, list) => (
              <div className={`public-map-stop public-map-stop--${index + 1}`} key={`${city}-${index}`} style={{ '--stop-index': index, '--stop-total': list.length } as React.CSSProperties}>
                <span>{index + 1}</span><strong>{city}</strong>
              </div>
            ))}
          </div>
        </div>
      </header>

      {view.scope === 'day' && view.overviewToken ? (
        <div className="public-overview-link"><a href={`/s/${encodeURIComponent(view.overviewToken)}`}><MapPin aria-hidden="true" size={17} />查看整份路书</a><span>当前为单天只读分享</span></div>
      ) : null}

      <section className="public-summary" aria-label="行程摘要">
        <div><Route aria-hidden="true" size={20} /><span>总距离</span><strong>{(getTripDistanceMeters(derived) / 1000).toFixed(0)} km</strong></div>
        <div><Timer aria-hidden="true" size={20} /><span>计划驾驶</span><strong>{formatMinutes(getTripDriveMinutes(derived))}</strong></div>
        <div><WalletCards aria-hidden="true" size={20} /><span>预算参考</span><strong>{disclosure.showBudget ? formatMoney(getPlannedBudget(trip, derived)) : '未公开'}</strong></div>
        <div><BedDouble aria-hidden="true" size={20} /><span>过夜</span><strong>{Math.max(0, days.length - 1)} 晚</strong></div>
      </section>

      {days.length > 1 ? <nav className="public-day-strip" aria-label="选择日期">
        {days.map((day) => (
          <button className={day.id === selectedDay.id ? 'is-active' : ''} type="button" onClick={() => setSelectedDayId(day.id)} key={day.id}>
            <span>Day {day.dayIndex}</span><small>{disclosure.showExactDates ? formatDateLabel(day.date) : '日期已隐藏'}</small>
          </button>
        ))}
      </nav> : null}

      <article className="public-itinerary">
        <header className="public-day-heading">
          <div><p>{disclosure.showExactDates ? formatDateLabel(selectedDay.date) : `Day ${selectedDay.dayIndex}`}</p><h2>Day {selectedDay.dayIndex} · {selectedDay.overnightLabel ?? selectedDay.stops.at(-1)?.name ?? '海南'}</h2></div>
          <div><span>驾驶</span><strong>{formatMinutes(readNumber(daySchedule, 'drivingMinutes') ?? 0)}</strong></div>
        </header>

        <RouteSpine className="public-route-spine">
          {selectedDay.stops.map((stop, index) => {
            const place = places[stop.placeId]
            const coordinate = asRecord(place?.gcj02)
            const schedule = schedules.find((item) => readString(item, 'stopId') === stop.id)
            const leg = routeLegs.find((item) => {
              const to = asRecord(asRecord(item).to)
              return readString(item, 'dayId') === selectedDay.id && readString(to, 'placeId') === stop.placeId
            })
            const stopSources = disclosure.showSources
              ? [...new Set(stop.sourceIds)].map((sourceId) => sources[sourceId]).filter(Boolean)
              : []
            const sourceCount = stopSources.length
            const navUrl = readNumber(coordinate, 'lon') !== undefined && readNumber(coordinate, 'lat') !== undefined
              ? buildAmapNavigationUrl({ name: stop.name, lon: readNumber(coordinate, 'lon')!, lat: readNumber(coordinate, 'lat')! })
              : undefined
            return (
              <Fragment key={stop.id}>
                {index > 0 && leg ? (
                  <RouteSpineItem
                    marker={<Route aria-hidden="true" size={14} />}
                    title={`${((readNumber(leg, 'distanceMeters') ?? 0) / 1000).toFixed(0)} km · ${formatMinutes((readNumber(leg, 'durationSeconds') ?? 0) / 60)}`}
                    meta={`${readString(leg, 'estimateKind') === 'area-reference' ? '区域锚点预估' : readString(leg, 'provider') === 'amap' ? `高德 ${readString(leg, 'calculatedAt')?.slice(11, 16) ?? ''} 预估` : '模板参考'}`}
                    action={navUrl ? <a className="public-nav-link" href={navUrl} target="_blank" rel="noreferrer"><Navigation aria-hidden="true" size={16} />导航</a> : undefined}
                    kind="leg"
                  />
                ) : null}
                <RouteSpineItem
                  marker={index + 1}
                  title={stop.name}
                  meta={`${readString(schedule, 'arrivalTime') ?? stop.plannedStart ?? '--:--'} · 停留 ${formatMinutes(stop.stayMinutes)}`}
                  note={stop.note ?? readString(place, 'address')}
                  action={sourceCount ? <div className="public-source-actions"><StatusBadge tone={sourceCount >= 2 ? 'sky' : 'sun'}>{sourceCount >= 2 ? `${sourceCount} 源一致` : '单一来源'}</StatusBadge>{stopSources.slice(0, 2).map((source) => <a href={readString(source, 'url')} target="_blank" rel="noreferrer" aria-label={`打开来源：${readString(source, 'title') ?? '资料'}`} key={readString(source, 'sourceId') ?? readString(source, 'url')}><ExternalLink aria-hidden="true" size={15} /></a>)}</div> : undefined}
                />
              </Fragment>
            )
          })}
          {selectedDay.overnightLabel ? <RouteSpineItem marker={<BedDouble aria-hidden="true" size={15} />} title={`宿 · ${selectedDay.overnightLabel}`} meta="前日终点 / 次日起点" kind="stay" /> : null}
        </RouteSpine>
      </article>

      <footer className="public-footer">
        <a href="/" aria-label="访问 Jovlo.ai"><img src="/jovlo-mark.svg" alt="" />用 Jovlo 制作 <ExternalLink aria-hidden="true" size={13} /></a>
        <span>© 2026 Jovlo.ai</span>
      </footer>
    </main>
  )
}

export default PublicTripPage
