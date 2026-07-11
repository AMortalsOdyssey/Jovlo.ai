import { BedDouble, BookOpen, ChevronDown, ChevronUp, Clock3, FileClock, Map as MapIcon, ReceiptText, RefreshCcw, Settings, Sparkles, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import type { DayHealthStatus, EvidenceTone, FormalMapPoint } from './types'
import { DayHealthBar } from './DayHealthBar'
import { DayRail } from './DayRail'
import { HotelAnchor } from './HotelAnchor'
import { ImpactBar } from './ImpactBar'
import { LegRow } from './LegRow'
import { MapCanvas } from './MapCanvas'
import { MobileDayStrip } from './MobileDayStrip'
import { MobileNav } from './MobileNav'
import { PlaceInspector } from './PlaceInspector'
import { PlannerWorkspace } from './PlannerWorkspace'
import { RouteTimeline } from './RouteTimeline'
import { Snackbar } from './Snackbar'
import { StopCard } from './StopCard'
import { TripOverview } from './TripOverview'
import { TripHeader } from './TripHeader'
import { buildAmapNavigationUrl } from '@/lib/amap'
import { apiRequest } from '@/lib/api'
import { formatCurrency, formatDistance, formatDuration } from '@/lib/format'
import { currentVersion, selectedDay, useTripStore } from '@/store/useTripStore'
import { recalculateTrip, stableHash, type RouteEndpoint, type RouteLeg, type TripPlaceSnapshot, type TripStop } from '@domain'
import './plan-page.css'

type RouteProviderNotice = {
  code: 'rate_limited' | 'quota_exceeded' | 'configuration' | 'no_route' | 'unavailable' | 'not_configured'
  message: string
  retryable: boolean
  retryAfterSeconds?: number
  failedLegs: number
}

type RouteDryRunResponse = {
  providerMode: 'amap' | 'mixed' | 'reference'
  authoritative: boolean
  legs: RouteLeg[]
  warning: string | null
  providerNotice: RouteProviderNotice | null
  inputHash: string
}

type RouteRequestPoint = {
  endpoint: RouteEndpoint
  coordinate: { crs: 'GCJ02'; lon: number; lat: number }
}

type LiveRouteResult = RouteDryRunResponse & { tripHash: string }

const HEALTH_STATUS: Record<string, DayHealthStatus> = {
  comfortable: 'comfortable',
  tight: 'tight',
  overloaded: 'overloaded',
  data_unconfirmed: 'unconfirmed',
}

const CATEGORY_LABEL: Record<string, string> = {
  lodging: '住宿',
  meals: '餐饮',
  tickets: '门票活动',
  energy: '油电',
  rental: '租车',
  insurance: '保险',
  parking_tolls: '停车路费',
  contingency: '机动预算',
}

function evidenceTone(place: TripPlaceSnapshot): EvidenceTone {
  if (!place.verifiedAt) return 'pending'
  if (place.sourceIds.length > 1) return 'consistent'
  return place.sourceIds.length === 1 ? 'single-source' : 'pending'
}

function evidenceLabel(place: TripPlaceSnapshot) {
  if (!place.verifiedAt) return '待核验'
  return place.sourceIds.length > 1 ? `${place.sourceIds.length} 源一致` : '单一来源'
}

function compactWarning(message: string) {
  if (message.includes('参考或区域中心估算')) return '参考估算 · 非实时路况'
  return message
}

function placeCoordinate(place?: TripPlaceSnapshot) {
  if (!place) return undefined
  return { name: place.name, lon: place.gcj02.lon, lat: place.gcj02.lat }
}

function openNavigation(place?: TripPlaceSnapshot) {
  const target = placeCoordinate(place)
  if (target) window.open(buildAmapNavigationUrl(target), '_blank', 'noopener,noreferrer')
}

function StopEditor({
  stop,
  place,
  onClose,
  onSave,
  onToggleLock,
}: {
  stop: TripStop
  place: TripPlaceSnapshot
  onClose: () => void
  onSave: (stayMinutes: number, plannedStart: string, publicNote: string) => void
  onToggleLock: () => void
}) {
  const [stayMinutes, setStayMinutes] = useState(stop.stayMinutes)
  const [plannedStart, setPlannedStart] = useState(stop.plannedStart ?? '')
  const [publicNote, setPublicNote] = useState(stop.publicNote ?? '')
  const durationDelta = stayMinutes - stop.stayMinutes

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSave(Math.max(5, Math.min(720, stayMinutes)), plannedStart, publicNote.trim())
  }

  return (
    <div className="plan-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="plan-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stop-editor-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>编辑地点</span>
            <h2 id="stop-editor-title">{place.name}</h2>
          </div>
          <button type="button" className="jovlo-button jovlo-button--secondary" onClick={onClose}>关闭</button>
        </header>
        <form onSubmit={submit}>
          <label>
            <span>计划到达</span>
            <input
              type="time"
              value={plannedStart}
              onChange={(event) => setPlannedStart(event.target.value)}
            />
          </label>
          <label>
            <span>停留时长（分钟）</span>
            <input
              type="number"
              min="5"
              max="720"
              step="5"
              value={stayMinutes}
              onChange={(event) => setStayMinutes(Number(event.target.value))}
            />
          </label>
          <label>
            <span>公开备注</span>
            <textarea
              rows={4}
              maxLength={1000}
              value={publicNote}
              onChange={(event) => setPublicNote(event.target.value)}
              placeholder="例如停车、预约或游玩提醒"
            />
          </label>
          <div className="plan-dialog__impact" role="status">
            <Clock3 aria-hidden="true" size={17} />
            <span>{durationDelta === 0 ? '保存后重新校验当天时间链' : `当天后续时间预计${durationDelta > 0 ? '顺延' : '提前'} ${Math.abs(durationDelta)} 分钟`}</span>
            <small>地点未变时，里程与项目预算保持不变</small>
          </div>
          <div className="plan-dialog__actions">
            <button type="button" className="jovlo-button jovlo-button--secondary" onClick={onToggleLock}>
              {stop.locked ? '解除锁定' : '锁定地点'}
            </button>
            <button type="submit" className="jovlo-button jovlo-button--primary">保存并重算</button>
          </div>
        </form>
      </section>
    </div>
  )
}

export function PlanPage() {
  const navigate = useNavigate()
  const state = useTripStore()
  const day = selectedDay(state)
  const version = currentVersion(state)
  const [candidateId, setCandidateId] = useState<string | null>(null)
  const [editingStopId, setEditingStopId] = useState<string | null>(null)
  const [impactDetailsOpen, setImpactDetailsOpen] = useState(false)
  const [overviewOpen, setOverviewOpen] = useState(false)
  const [mobileMapCollapsed, setMobileMapCollapsed] = useState(false)
  const [routeRetryNonce, setRouteRetryNonce] = useState(0)
  const [liveRoutes, setLiveRoutes] = useState<Record<string, LiveRouteResult>>({})
  const routeCache = useRef(new Map<string, RouteDryRunResponse>())

  const dayRoutePoints = useMemo<FormalMapPoint[]>(() => {
    const points: FormalMapPoint[] = []
    const dayIndex = state.trip.days.findIndex((item) => item.id === day.id)
    const previousStay = dayIndex > 0 ? state.trip.days[dayIndex - 1]?.overnightStay : undefined
    const startPlace = previousStay?.kind === 'place'
      ? state.trip.placeRefs[previousStay.placeId]
      : previousStay?.kind === 'area'
        ? state.trip.stayAreaRefs[previousStay.areaId]
        : state.trip.placeRefs[state.trip.intent.entryAnchor.placeId]
    if (startPlace) {
      points.push({ id: `start-${day.id}`, order: 1, name: previousStay?.label ?? state.trip.intent.entryAnchor.label, lng: startPlace.gcj02.lon, lat: startPlace.gcj02.lat })
    }
    day.stops.forEach((stop) => {
      const place = state.trip.placeRefs[stop.placeId]
      if (place) points.push({ id: stop.id, order: points.length + 1, name: place.name, lng: place.gcj02.lon, lat: place.gcj02.lat })
    })
    const endPlace = day.overnightStay?.kind === 'place'
      ? state.trip.placeRefs[day.overnightStay.placeId]
      : day.overnightStay?.kind === 'area'
        ? state.trip.stayAreaRefs[day.overnightStay.areaId]
        : state.trip.placeRefs[state.trip.intent.exitAnchor.placeId]
    if (endPlace) {
      points.push({ id: `end-${day.id}`, order: points.length + 1, name: day.overnightStay?.label ?? state.trip.intent.exitAnchor.label, lng: endPlace.gcj02.lon, lat: endPlace.gcj02.lat })
    }
    return points
  }, [day, state.trip])

  const routeRequestPoints = useMemo<RouteRequestPoint[]>(() => {
    const points: RouteRequestPoint[] = []
    const append = (endpoint: RouteEndpoint, place?: { gcj02: { lon: number; lat: number } }) => {
      if (!place) return
      const previous = points.at(-1)
      if (
        previous &&
        previous.coordinate.lon === place.gcj02.lon &&
        previous.coordinate.lat === place.gcj02.lat
      ) return
      points.push({
        endpoint,
        coordinate: { crs: 'GCJ02', lon: place.gcj02.lon, lat: place.gcj02.lat },
      })
    }
    const dayIndex = state.trip.days.findIndex((item) => item.id === day.id)
    const previousStay = dayIndex > 0 ? state.trip.days[dayIndex - 1]?.overnightStay : undefined
    if (previousStay?.kind === 'place') {
      append({ kind: 'place', placeId: previousStay.placeId }, state.trip.placeRefs[previousStay.placeId])
    } else if (previousStay?.kind === 'area') {
      append({ kind: 'area', areaId: previousStay.areaId }, state.trip.stayAreaRefs[previousStay.areaId])
    } else {
      append(
        { kind: 'place', placeId: state.trip.intent.entryAnchor.placeId },
        state.trip.placeRefs[state.trip.intent.entryAnchor.placeId],
      )
    }
    day.stops.forEach((stop) => {
      append({ kind: 'place', placeId: stop.placeId }, state.trip.placeRefs[stop.placeId])
    })
    if (day.overnightStay?.kind === 'place') {
      append({ kind: 'place', placeId: day.overnightStay.placeId }, state.trip.placeRefs[day.overnightStay.placeId])
    } else if (day.overnightStay?.kind === 'area') {
      append({ kind: 'area', areaId: day.overnightStay.areaId }, state.trip.stayAreaRefs[day.overnightStay.areaId])
    } else {
      append(
        { kind: 'place', placeId: state.trip.intent.exitAnchor.placeId },
        state.trip.placeRefs[state.trip.intent.exitAnchor.placeId],
      )
    }
    return points
  }, [day, state.trip])

  const tripHash = useMemo(() => stableHash(state.trip), [state.trip])
  const routeInputHash = useMemo(
    () => stableHash({ tripHash, dayId: day.id, points: routeRequestPoints, strategy: '32' }),
    [day.id, routeRequestPoints, tripHash],
  )

  useEffect(() => {
    if (routeRequestPoints.length < 2 || routeRequestPoints.length > 9) return
    const cached = routeCache.current.get(routeInputHash)
    if (cached) {
      setLiveRoutes((current) => ({
        ...current,
        [day.id]: { ...cached, tripHash },
      }))
      return
    }

    const controller = new AbortController()
    apiRequest<RouteDryRunResponse>('/api/v1/routes/dry-run', {
      method: 'POST',
      signal: controller.signal,
      body: JSON.stringify({
        dayId: day.id,
        points: routeRequestPoints,
        strategy: '32',
        inputHash: routeInputHash,
      }),
    }).then((result) => {
      routeCache.current.set(routeInputHash, result)
      setLiveRoutes((current) => ({
        ...current,
        [day.id]: { ...result, tripHash },
      }))
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      setLiveRoutes((current) => ({
        ...current,
        [day.id]: {
          providerMode: 'reference',
          authoritative: false,
          legs: [],
          warning: '路线服务暂时不可用，已继续使用参考路线',
          providerNotice: {
            code: 'unavailable',
            message: '路线服务暂时不可用，已继续使用参考路线',
            retryable: true,
            retryAfterSeconds: 2,
            failedLegs: Math.max(0, routeRequestPoints.length - 1),
          },
          inputHash: routeInputHash,
          tripHash,
        },
      }))
      console.warn('Route refresh failed', error instanceof Error ? error.name : 'unknown')
    })
    return () => controller.abort()
  }, [day.id, routeInputHash, routeRequestPoints, routeRetryNonce, tripHash])

  const derived = useMemo(() => {
    const validRoutes = Object.entries(liveRoutes).filter(([, result]) => result.tripHash === tripHash && result.legs.length)
    if (!validRoutes.length) return state.derived
    const refreshedDays = new Set(validRoutes.map(([dayId]) => dayId))
    const routeLegs = state.derived.routeLegs.filter((leg) => !refreshedDays.has(leg.dayId))
    validRoutes.forEach(([, result]) => routeLegs.push(...result.legs))
    return recalculateTrip(state.trip, routeLegs)
  }, [liveRoutes, state.derived, state.trip, tripHash])

  const currentRouteResult = liveRoutes[day.id]?.tripHash === tripHash ? liveRoutes[day.id] : undefined
  const schedule = derived.daySchedules.find((item) => item.dayId === day.id)
  const dayLegs = derived.routeLegs.filter((leg) => leg.dayId === day.id)
  const daySummaries = state.trip.days.map((item) => {
    const itemSchedule = derived.daySchedules.find((entry) => entry.dayId === item.id)
    const finalPlace = state.trip.placeRefs[item.stops.at(-1)?.placeId ?? '']
    const area = item.overnightStay?.label ?? finalPlace?.address?.split('市')[0] ?? '路线待定'
    const hotel = item.overnightStay?.kind === 'place' ? item.overnightStay.label : undefined
    return {
      id: item.id,
      dayNumber: item.dayIndex,
      area,
      hotel,
      driveDuration: itemSchedule ? formatDuration(itemSchedule.drivingMinutes) : '待计算',
      riskCount: itemSchedule?.warnings.filter((warning) => warning.severity !== 'info').length ?? 0,
      healthStatus: HEALTH_STATUS[itemSchedule?.health ?? 'data_unconfirmed'],
      date: item.date,
      stopCount: item.stops.length,
    }
  })

  const overviewRoutePoints = useMemo<FormalMapPoint[]>(() => {
    const points: FormalMapPoint[] = []
    const appendPoint = (
      id: string,
      name: string,
      place?: { gcj02: { lon: number; lat: number } },
    ) => {
      if (!place) return
      const previous = points.at(-1)
      if (previous && previous.name === name && previous.lng === place.gcj02.lon && previous.lat === place.gcj02.lat) return
      points.push({
        id,
        order: points.length + 1,
        name,
        lng: place.gcj02.lon,
        lat: place.gcj02.lat,
      })
    }

    appendPoint(
      'overview-entry',
      state.trip.intent.entryAnchor.label,
      state.trip.placeRefs[state.trip.intent.entryAnchor.placeId],
    )
    state.trip.days.forEach((item) => {
      item.stops.forEach((stop) => {
        const place = state.trip.placeRefs[stop.placeId]
        appendPoint(stop.id, place?.name ?? '未命名地点', place)
      })
      if (item.overnightStay?.kind === 'place') {
        appendPoint(`overview-stay-${item.id}`, item.overnightStay.label, state.trip.placeRefs[item.overnightStay.placeId])
      } else if (item.overnightStay?.kind === 'area') {
        appendPoint(`overview-stay-${item.id}`, item.overnightStay.label, state.trip.stayAreaRefs[item.overnightStay.areaId])
      }
    })
    appendPoint(
      'overview-exit',
      state.trip.intent.exitAnchor.label,
      state.trip.placeRefs[state.trip.intent.exitAnchor.placeId],
    )
    return points
  }, [state.trip])

  const routePoints = overviewOpen ? overviewRoutePoints : dayRoutePoints

  const candidatePoints = state.candidates.map((place) => ({
    id: place.placeId,
    name: place.name,
    lng: place.gcj02.lon,
    lat: place.gcj02.lat,
    type: place.type === 'meal' ? ('food' as const) : place.type === 'hotel' ? ('hotel' as const) : ('other' as const),
  }))

  const selectedStop = state.trip.days.flatMap((item) => item.stops).find((stop) => stop.id === state.selectedStopId)
  const selectedCandidate = state.candidates.find((place) => place.placeId === candidateId)
  const inspectedPlace = selectedCandidate ?? (selectedStop ? state.trip.placeRefs[selectedStop.placeId] : undefined)
  const editingStop = state.trip.days.flatMap((item) => item.stops).find((stop) => stop.id === editingStopId)
  const editingPlace = editingStop ? state.trip.placeRefs[editingStop.placeId] : undefined

  const updateDay = (dayId: string) => {
    setOverviewOpen(false)
    state.selectDay(dayId)
    state.selectStop(null)
    setCandidateId(null)
  }

  const openOverview = () => {
    setOverviewOpen(true)
    state.setMobileView('plan')
    state.selectStop(null)
    setCandidateId(null)
  }

  const selectMapPoint = (id: string) => {
    const ownerDay = state.trip.days.find((item) => item.stops.some((stop) => stop.id === id))
    if (!ownerDay) return
    setOverviewOpen(false)
    state.selectDay(ownerDay.id)
    state.selectStop(id)
    setCandidateId(null)
  }

  const toggleMobileMap = () => {
    const nextCollapsed = !mobileMapCollapsed
    setMobileMapCollapsed(nextCollapsed)
    if (nextCollapsed && state.mobileView === 'map') state.setMobileView('plan')
  }

  const selectMobileView = (view: typeof state.mobileView) => {
    if (view === 'map') setMobileMapCollapsed(false)
    state.setMobileView(view)
  }

  const moveStop = (stop: TripStop, delta: number) => {
    const index = day.stops.findIndex((item) => item.id === stop.id)
    state.moveStop(stop.id, day.id, Math.max(0, Math.min(day.stops.length - 1, index + delta)))
  }

  const moveToNextDay = (stop: TripStop) => {
    const currentIndex = state.trip.days.findIndex((item) => item.id === day.id)
    const target = state.trip.days[(currentIndex + 1) % state.trip.days.length]
    if (target.id !== day.id) state.requestMoveStop(stop.id, target.id, target.stops.length)
  }

  const alternateStay = () => {
    const stay = day.overnightStay
    if (!stay) return
    if (stay.kind === 'area') {
      const hotel = Object.values(state.trip.placeRefs).find((place) => place.type === 'hotel')
      if (hotel) state.requestStayUpdate(day.id, { kind: 'place', placeId: hotel.placeId, label: hotel.name })
      return
    }
    const area = Object.values(state.trip.stayAreaRefs).find((item) => item.region === '万宁') ?? Object.values(state.trip.stayAreaRefs)[0]
    if (area) state.requestStayUpdate(day.id, { kind: 'area', areaId: area.areaId, label: area.name })
  }

  const sourceEvidence = inspectedPlace?.sourceIds.map((sourceId) => state.trip.sourceRefs[sourceId]).filter(Boolean) ?? []
  const selectedPrice = inspectedPlace?.selectedVariant?.priceRange?.expected
  const totalSpent = state.expenses.reduce((sum, expense) => sum + expense.amount, 0)

  const budgetPanel = (
    <section className="plan-mobile-panel" aria-label="预算摘要">
      <header><span>当前估算</span><strong>{formatCurrency(derived.budget.total.expected)}</strong></header>
      <div className="plan-budget-range"><span>{formatCurrency(derived.budget.total.low)}</span><span>至</span><span>{formatCurrency(derived.budget.total.high)}</span></div>
      <dl>{derived.budget.categories.map((item) => <div key={item.category}><dt>{CATEGORY_LABEL[item.category] ?? item.category}</dt><dd>{formatCurrency(item.amount.expected)}</dd></div>)}</dl>
      <p>已记账 {formatCurrency(totalSpent)} · {formatDistance(derived.budget.totalDistanceMeters)}</p>
      <Link className="jovlo-button jovlo-button--primary" to={`/trips/${state.trip.tripId}/budget`}>打开预算与记账</Link>
    </section>
  )

  const morePanel = (
    <nav className="plan-mobile-panel plan-more-links" aria-label="更多功能">
      <Link to={`/trips/${state.trip.tripId}/sources`}><BookOpen aria-hidden="true" />来源与证据</Link>
      <Link to={`/trips/${state.trip.tripId}/versions`}><FileClock aria-hidden="true" />版本历史</Link>
      <Link to={`/trips/${state.trip.tripId}/imports/demo-import`}><Sparkles aria-hidden="true" />Agent 变更审阅</Link>
      <Link to={`/trips/${state.trip.tripId}/reports`}><ReceiptText aria-hidden="true" />汇总报告</Link>
      <Link to={`/trips/${state.trip.tripId}/settings`}><Settings aria-hidden="true" />行程设置</Link>
    </nav>
  )

  const timeline = (
    <div className="plan-timeline-shell">
      <div className="plan-day-heading">
        <div><span>{day.date ?? '日期待定'}</span><h1>Day {day.dayIndex} · {daySummaries.find((item) => item.id === day.id)?.area}</h1></div>
        <small aria-label={`预计 ${schedule?.expectedEndTime ?? '--:--'} 结束`}><Clock3 aria-hidden="true" size={14} />{schedule?.expectedEndTime ?? '--:--'}</small>
      </div>
      <DayHealthBar
        metrics={{
          driving: formatDuration(schedule?.drivingMinutes ?? 0),
          playing: formatDuration(schedule?.activityMinutes ?? 0),
          buffer: schedule ? formatDuration(Math.max(0, schedule.freeMinutes)) : '待确认',
          budget: formatCurrency(derived.budget.total.expected / state.trip.days.length),
        }}
        status={HEALTH_STATUS[schedule?.health ?? 'data_unconfirmed']}
      />
      {currentRouteResult?.providerNotice || schedule?.warnings.length ? (
        <div className="plan-warning-strip" role="status">
          <TriangleAlert aria-hidden="true" size={15} />
          <span>{currentRouteResult?.providerNotice?.message ?? compactWarning(schedule!.warnings[0].message)}</span>
          {currentRouteResult?.providerNotice?.retryable ? (
            <button
              type="button"
              aria-label="重新计算高德路线"
              title="重新计算高德路线"
              onClick={() => {
                routeCache.current.delete(routeInputHash)
                setRouteRetryNonce((value) => value + 1)
              }}
            >
              <RefreshCcw aria-hidden="true" size={15} />
            </button>
          ) : null}
        </div>
      ) : null}
      <RouteTimeline>
        {day.stops.map((stop, index) => {
          const place = state.trip.placeRefs[stop.placeId]
          const scheduled = schedule?.stops.find((item) => item.stopId === stop.id)
          const leg = dayLegs[index]
          const selected = stop.id === state.selectedStopId
          const replacement = state.candidates.find((item) => !Object.hasOwn(state.trip.placeRefs, item.placeId)) ?? state.candidates[0]
          return (
            <div className="plan-route-fragment" key={stop.id}>
              <LegRow
                distance={leg ? formatDistance(leg.distanceMeters) : undefined}
                duration={leg ? formatDuration(leg.durationSeconds / 60) : undefined}
                eta={scheduled?.arrivalTime}
                status={leg?.status === 'failed' ? 'error' : 'ready'}
                estimated={leg?.provider === 'reference' || leg?.estimateKind !== 'road'}
                onNavigate={() => openNavigation(place)}
              />
              <StopCard
                order={index + 1}
                name={place?.name ?? '地点待确认'}
                plannedTime={scheduled?.arrivalTime ?? stop.plannedStart ?? '--:--'}
                duration={formatDuration(stop.stayMinutes)}
                evidenceLabel={place ? evidenceLabel(place) : '待核验'}
                evidenceTone={place ? evidenceTone(place) : 'pending'}
                tags={[...new Set([stop.locked ? '已锁定' : stop.kind, ...(place?.type ? [place.type] : [])])]}
                selected={selected}
                onSelect={() => { state.selectStop(stop.id); setCandidateId(null) }}
                actions={{
                  onEdit: () => setEditingStopId(stop.id),
                  onReplace: () => replacement && state.requestReplaceStop(stop.id, replacement.placeId),
                  onMoveEarlier: () => moveStop(stop, -1),
                  onMoveLater: () => moveStop(stop, 1),
                  onMoveToDay: () => moveToNextDay(stop),
                  onSkip: () => state.skipTodayStop(stop.id),
                  onDelete: () => state.requestRemoveStop(stop.id),
                }}
              />
            </div>
          )
        })}
        {day.overnightStay ? (
          <div className="plan-route-fragment">
            <LegRow
              distance={dayLegs.at(-1) ? formatDistance(dayLegs.at(-1)!.distanceMeters) : undefined}
              duration={dayLegs.at(-1) ? formatDuration(dayLegs.at(-1)!.durationSeconds / 60) : undefined}
              status={dayLegs.at(-1)?.status === 'failed' ? 'error' : 'ready'}
              estimated={dayLegs.at(-1)?.provider === 'reference' || dayLegs.at(-1)?.estimateKind !== 'road'}
            />
            <HotelAnchor
              kind={day.overnightStay.kind}
              name={day.overnightStay.label}
              relation="both"
              impactPreview="变更后将先展示路线和预算影响"
              onChooseHotel={alternateStay}
              onChangeHotel={alternateStay}
            />
          </div>
        ) : null}
      </RouteTimeline>
    </div>
  )

  const overview = (
    <TripOverview
      days={daySummaries}
      totalDistance={formatDistance(derived.budget.totalDistanceMeters)}
      totalDriving={formatDuration(derived.daySchedules.reduce((sum, item) => sum + item.drivingMinutes, 0))}
      totalBudget={formatCurrency(derived.budget.total.expected)}
      totalStops={state.trip.days.reduce((sum, item) => sum + item.stops.length, 0)}
      onSelectDay={updateDay}
    />
  )

  return (
    <>
      <PlannerWorkspace
        activeMobileView={state.mobileView}
        mobileMapCollapsed={mobileMapCollapsed}
        header={<TripHeader title={state.trip.title} version={version.versionNo} saveStatus={state.saveStatus === 'failed' ? 'error' : state.saveStatus} onBack={() => navigate('/trips')} onImport={() => navigate(`/trips/${state.trip.tripId}/imports/demo-import`)} onHistory={() => navigate(`/trips/${state.trip.tripId}/versions`)} onShare={() => navigate(`/trips/${state.trip.tripId}/share`)} onSaveVersion={() => state.publishVersion()} onRetrySave={state.retrySave} />}
        dayRail={<DayRail days={daySummaries} selectedDayId={day.id} overviewSelected={overviewOpen} onSelectOverview={openOverview} onSelectDay={updateDay} />}
        dayStrip={<MobileDayStrip days={daySummaries} selectedDayId={day.id} overviewSelected={overviewOpen} onSelectOverview={openOverview} onSelectDay={updateDay} />}
        timeline={overviewOpen ? overview : timeline}
        map={(
          <div className="plan-map-shell" id="planner-route-map">
            <div className="plan-map-content" id="planner-route-map-content">
              <MapCanvas routePoints={routePoints} candidatePoints={candidatePoints} selectedPointId={state.selectedStopId ?? candidateId ?? undefined} onSelectFormalPoint={selectMapPoint} onSelectCandidateCluster={(ids) => { setCandidateId(ids[0] ?? null); state.selectStop(null) }} />
            </div>
            <button
              type="button"
              className="plan-map-toggle"
              aria-expanded={!mobileMapCollapsed}
              aria-controls="planner-route-map-content"
              onClick={toggleMobileMap}
            >
              {mobileMapCollapsed ? <MapIcon aria-hidden="true" size={17} /> : <ChevronUp aria-hidden="true" size={17} />}
              <span>{mobileMapCollapsed ? '展开地图' : '收起地图'}</span>
              {mobileMapCollapsed ? <ChevronDown aria-hidden="true" size={17} /> : null}
            </button>
          </div>
        )}
        budget={budgetPanel}
        more={morePanel}
        inspector={inspectedPlace ? <PlaceInspector open name={inspectedPlace.name} openingHours={inspectedPlace.selectedVariant?.openingHours ? '以来源中的当日公告为准' : undefined} suggestedStay={selectedStop ? formatDuration(selectedStop.stayMinutes) : '建议 90 min'} price={selectedPrice ? `约 ${formatCurrency(selectedPrice)}` : undefined} parking={inspectedPlace.selectedVariant?.parkingNote} sourceSummary={sourceEvidence.map((source) => source.summary).join('；') || undefined} evidence={sourceEvidence.map((source) => ({ id: source.sourceId, source: source.title, statement: source.summary, statusLabel: source.commercialRelationship === 'yes' ? '商业关联' : '来源可追溯' }))} addLabel={selectedCandidate ? `加入 Day ${day.dayIndex}` : '已在行程'} onAdd={selectedCandidate ? () => { state.addCandidateStop(selectedCandidate.placeId, day.id); setCandidateId(null) } : undefined} onNavigate={() => openNavigation(inspectedPlace)} onOpenEvidence={(id) => { const source = state.trip.sourceRefs[id]; if (source) window.open(source.url, '_blank', 'noopener,noreferrer') }} onShowAllEvidence={() => navigate(`/trips/${state.trip.tripId}/sources`)} onClose={() => { state.selectStop(null); setCandidateId(null) }} /> : undefined}
        mobileNav={<MobileNav activeView={state.mobileView} isTravelingToday={day.date === new Date().toISOString().slice(0, 10)} onSelectView={selectMobileView} />}
      />

      {state.pendingAction ? <ImpactBar delayMinutes={state.pendingAction.impact.durationDeltaMinutes ?? 0} affectedPlaces={state.pendingAction.impact.affectedDayIds.length} budgetDelta={state.pendingAction.impact.budgetDelta} onViewDetails={() => setImpactDetailsOpen(true)} onApply={state.applyPending} onDiscard={state.discardPending} /> : null}
      {impactDetailsOpen && state.pendingAction ? <div className="plan-impact-details" role="dialog" aria-modal="true" aria-label="影响详情"><span>{state.pendingAction.impact.title}</span><strong>{state.pendingAction.impact.description}</strong><p>{formatDistance(state.pendingAction.impact.distanceDeltaMeters ?? 0)} · {formatDuration(Math.abs(state.pendingAction.impact.durationDeltaMinutes ?? 0))} · {formatCurrency(state.pendingAction.impact.budgetDelta ?? 0)}</p><button type="button" className="jovlo-button jovlo-button--primary" onClick={() => setImpactDetailsOpen(false)}>知道了</button></div> : null}
      <Snackbar open={Boolean(state.snackbar)} message={state.snackbar?.message ?? ''} actionLabel={state.snackbar?.actionLabel} onAction={state.snackbar?.actionLabel ? state.undo : undefined} onDismiss={state.dismissSnackbar} />
      {editingStop && editingPlace ? <StopEditor stop={editingStop} place={editingPlace} onClose={() => setEditingStopId(null)} onToggleLock={() => state.toggleStopLock(editingStop.id)} onSave={(stayMinutes, plannedStart, publicNote) => { state.updateStop(editingStop.id, { stayMinutes, plannedStart: plannedStart || undefined, publicNote: publicNote || undefined }); setEditingStopId(null) }} /> : null}
    </>
  )
}

export default PlanPage
