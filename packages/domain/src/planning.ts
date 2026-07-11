import { calculateBudget } from './budget'
import { stableHash } from './canonical'
import {
  DayScheduleSchema,
  DerivedSnapshotSchema,
  type DaySchedule,
  type DerivedSnapshot,
  type RouteEndpoint,
  type RouteLeg,
  type StayAnchor,
  type TripSnapshot,
  type Warning,
} from './schemas'
import { validateTripSnapshot } from './validation'

const paceBuffers: Record<TripSnapshot['intent']['pace'], number> = {
  relaxed: 20,
  balanced: 15,
  packed: 10,
}

function parseTime(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

function formatTime(minutes: number): string {
  const normalized = ((minutes % 1_440) + 1_440) % 1_440
  const hours = Math.floor(normalized / 60)
  const remainder = normalized % 60
  return `${String(hours).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

function endpointFromStay(stay: StayAnchor): RouteEndpoint {
  return stay.kind === 'place'
    ? { kind: 'place', placeId: stay.placeId }
    : { kind: 'area', areaId: stay.areaId }
}

function endpointKey(endpoint: RouteEndpoint): string {
  return endpoint.kind === 'place' ? `place:${endpoint.placeId}` : `area:${endpoint.areaId}`
}

function endpointsEqual(left: RouteEndpoint, right: RouteEndpoint): boolean {
  return endpointKey(left) === endpointKey(right)
}

function findLeg(
  routeLegs: readonly RouteLeg[],
  dayId: string,
  from: RouteEndpoint,
  to: RouteEndpoint,
): RouteLeg | undefined {
  return routeLegs.find(
    (leg) =>
      leg.dayId === dayId && endpointsEqual(leg.from, from) && endpointsEqual(leg.to, to),
  )
}

export function getDayRouteEndpoints(snapshot: TripSnapshot, dayIndex: number): RouteEndpoint[] {
  const day = snapshot.days[dayIndex]
  if (!day) return []
  const previousStay = dayIndex > 0 ? snapshot.days[dayIndex - 1]?.overnightStay : undefined
  const start: RouteEndpoint = previousStay
    ? endpointFromStay(previousStay)
    : { kind: 'place', placeId: snapshot.intent.entryAnchor.placeId }
  const stopEndpoints = day.stops.map(
    (stop): RouteEndpoint => ({ kind: 'place', placeId: stop.placeId }),
  )
  const end: RouteEndpoint =
    dayIndex === snapshot.days.length - 1
      ? { kind: 'place', placeId: snapshot.intent.exitAnchor.placeId }
      : endpointFromStay(day.overnightStay as StayAnchor)
  return [start, ...stopEndpoints, end]
}

function routeWarning(dayId: string, leg: RouteLeg | undefined): Warning | undefined {
  if (!leg) {
    return {
      code: 'ROUTE_MISSING',
      severity: 'blocking',
      message: '必需路段尚未计算',
      dayId,
    }
  }
  if (leg.status === 'failed') {
    return {
      code: 'ROUTE_FAILED',
      severity: 'blocking',
      message: '必需路段计算失败',
      dayId,
    }
  }
  if (leg.provider === 'reference' || leg.estimateKind !== 'road') {
    return {
      code: 'ROUTE_REFERENCE_ONLY',
      severity: 'info',
      message: '该路段使用参考或区域中心估算，尚非实时道路结果',
      dayId,
    }
  }
  return undefined
}

export function calculateSchedule(
  input: TripSnapshot,
  routeLegs: readonly RouteLeg[],
): DaySchedule[] {
  const snapshot = validateTripSnapshot(input)
  return snapshot.days.map((day, dayPosition) => {
    const endpoints = getDayRouteEndpoints(snapshot, dayPosition)
    const warnings: Warning[] = []
    const scheduledStops: DaySchedule['stops'] = []
    const bufferPerLeg = paceBuffers[snapshot.intent.pace]
    let currentMinute = parseTime(day.startTime)
    let drivingMinutes = 0
    let activityMinutes = 0
    let bufferMinutes = 0
    let dataUnconfirmed = false

    day.stops.forEach((stop, stopPosition) => {
      const leg = findLeg(routeLegs, day.id, endpoints[stopPosition], endpoints[stopPosition + 1])
      const warning = routeWarning(day.id, leg)
      if (warning) warnings.push(warning)
      if (!leg || leg.status === 'failed') dataUnconfirmed = true
      const legMinutes = leg && leg.status !== 'failed' ? Math.ceil(leg.durationSeconds / 60) : 0
      drivingMinutes += legMinutes
      currentMinute += legMinutes + bufferPerLeg
      bufferMinutes += bufferPerLeg

      if (stop.plannedStart) {
        const plannedStart = parseTime(stop.plannedStart)
        if (plannedStart > currentMinute) {
          bufferMinutes += plannedStart - currentMinute
          currentMinute = plannedStart
        }
      }

      const arrivalMinute = currentMinute
      const departureMinute = arrivalMinute + stop.stayMinutes
      scheduledStops.push({
        stopId: stop.id,
        arrivalMinute,
        departureMinute,
        arrivalTime: formatTime(arrivalMinute),
        departureTime: formatTime(departureMinute),
      })
      activityMinutes += stop.stayMinutes
      currentMinute = departureMinute
    })

    const lastLeg = findLeg(
      routeLegs,
      day.id,
      endpoints[endpoints.length - 2],
      endpoints[endpoints.length - 1],
    )
    const lastWarning = routeWarning(day.id, lastLeg)
    if (lastWarning) warnings.push(lastWarning)
    if (!lastLeg || lastLeg.status === 'failed') dataUnconfirmed = true
    const lastLegMinutes =
      lastLeg && lastLeg.status !== 'failed' ? Math.ceil(lastLeg.durationSeconds / 60) : 0
    drivingMinutes += lastLegMinutes
    currentMinute += lastLegMinutes + bufferPerLeg
    bufferMinutes += bufferPerLeg

    const endLimit = parseTime(snapshot.intent.dayEndLimit)
    const freeMinutes = endLimit - currentMinute
    if (drivingMinutes > snapshot.intent.maxDriveMinutesPerDay) {
      warnings.push({
        code: 'DRIVE_LIMIT_EXCEEDED',
        severity: 'warning',
        message: `驾驶 ${drivingMinutes} 分钟，超过偏好上限 ${snapshot.intent.maxDriveMinutesPerDay} 分钟`,
        dayId: day.id,
      })
    }
    if (currentMinute > endLimit) {
      warnings.push({
        code: 'DAY_END_LIMIT_EXCEEDED',
        severity: 'blocking',
        message: `预计 ${formatTime(currentMinute)} 结束，晚于 ${snapshot.intent.dayEndLimit}`,
        dayId: day.id,
      })
    }

    let health: DaySchedule['health'] = 'comfortable'
    if (dataUnconfirmed) health = 'data_unconfirmed'
    else if (currentMinute > endLimit || drivingMinutes > snapshot.intent.maxDriveMinutesPerDay * 1.25)
      health = 'overloaded'
    else if (freeMinutes < 60 || drivingMinutes > snapshot.intent.maxDriveMinutesPerDay * 0.9)
      health = 'tight'

    return DayScheduleSchema.parse({
      dayId: day.id,
      dayIndex: day.dayIndex,
      startTime: day.startTime,
      expectedEndTime: formatTime(currentMinute),
      expectedEndMinute: currentMinute,
      drivingMinutes,
      activityMinutes,
      bufferMinutes,
      freeMinutes,
      health,
      stops: scheduledStops,
      warnings,
    })
  })
}

export function recalculateTrip(
  input: TripSnapshot,
  routeLegs: readonly RouteLeg[],
  calculatedAt = new Date().toISOString(),
): DerivedSnapshot {
  const snapshot = validateTripSnapshot(input)
  return DerivedSnapshotSchema.parse({
    schemaVersion: 1,
    inputHash: stableHash(snapshot),
    routeLegs: [...routeLegs],
    daySchedules: calculateSchedule(snapshot, routeLegs),
    budget: calculateBudget(snapshot, routeLegs, calculatedAt),
    calculatedAt,
  })
}
