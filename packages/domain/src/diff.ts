import { stableCanonicalString } from './canonical'
import type { DerivedSnapshot, StayAnchor, TripSnapshot, TripStop } from './schemas'

export type SemanticDiffKind =
  | 'stop_added'
  | 'stop_removed'
  | 'stop_moved'
  | 'stop_updated'
  | 'place_replaced'
  | 'hotel_changed'
  | 'setting_changed'
  | 'budget_assumption_changed'
  | 'source_added'
  | 'source_removed'
  | 'source_updated'

export type SemanticFieldChange = {
  field: string
  before: unknown
  after: unknown
}

export type SemanticDiffEntry = {
  kind: SemanticDiffKind
  entityId: string
  dayId?: string
  fromDayId?: string
  toDayId?: string
  label: string
  changes: SemanticFieldChange[]
}

export type SemanticHotelChange = {
  dayId: string
  before: StayAnchor | null
  after: StayAnchor | null
}

export type SemanticDiff = {
  counts: { added: number; changed: number; removed: number; conflicts: number }
  affectedDays: string[]
  entries: SemanticDiffEntry[]
  hotelChanges: SemanticHotelChange[]
  impact: {
    distanceDeltaMeters?: number
    durationDeltaSeconds?: number
    budgetDelta?: { low: number; expected: number; high: number }
  }
}

export type VersionChangeLevel = 'baseline' | 'minor' | 'major'

export type VersionChangeClassification = {
  level: VersionChangeLevel
  label: '基线版本' | '小版本' | '大版本'
  reasons: string[]
  affectedDays: number
  changedStops: number
  thresholds: {
    affectedDayRatio: number
    changedStopRatio: number
    distanceRatio?: number
    durationRatio?: number
    budgetRatio?: number
  }
}

type StopLocation = {
  dayId: string
  dayIndex: number
  position: number
  stop: TripStop
}

function indexStops(snapshot: TripSnapshot): Map<string, StopLocation> {
  const result = new Map<string, StopLocation>()
  snapshot.days.forEach((day) => {
    day.stops.forEach((stop, position) => {
      result.set(stop.id, { dayId: day.id, dayIndex: day.dayIndex, position, stop })
    })
  })
  return result
}

function fieldChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: readonly string[],
): SemanticFieldChange[] {
  return fields.flatMap((field) =>
    stableCanonicalString(before[field]) === stableCanonicalString(after[field])
      ? []
      : [{ field, before: before[field], after: after[field] }],
  )
}

function totalDuration(derived: DerivedSnapshot): number {
  return derived.routeLegs.reduce(
    (total, leg) => total + (leg.status === 'failed' ? 0 : leg.durationSeconds),
    0,
  )
}

function changeRatio(before: number, after: number): number {
  if (before === after) return 0
  if (before === 0) return 1
  return Math.abs(after - before) / Math.abs(before)
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function uniqueReasons(reasons: string[]): string[] {
  return [...new Set(reasons)].slice(0, 3)
}

/**
 * Uses product impact rather than raw field count to classify a saved version.
 * The result is calculated from immutable snapshots, so old versions do not
 * need a database migration when the rules are refined.
 */
export function classifyVersionChange(
  before: TripSnapshot | undefined,
  after: TripSnapshot,
  beforeDerived?: DerivedSnapshot,
  afterDerived?: DerivedSnapshot,
): VersionChangeClassification {
  if (!before) {
    return {
      level: 'baseline',
      label: '基线版本',
      reasons: [`建立 ${after.days.length} 天路书基线`],
      affectedDays: after.days.length,
      changedStops: after.days.reduce((total, day) => total + day.stops.length, 0),
      thresholds: { affectedDayRatio: 1, changedStopRatio: 1 },
    }
  }

  const diff = semanticDiff(before, after, beforeDerived, afterDerived)
  const beforeDays = new Map(before.days.map((day) => [day.id, day]))
  const afterDays = new Map(after.days.map((day) => [day.id, day]))
  const allDayIds = new Set([...beforeDays.keys(), ...afterDays.keys()])
  const affectedDayIds = new Set(diff.affectedDays)
  const majorReasons: string[] = []
  const minorReasons: string[] = []
  let changedStops = 0

  for (const dayId of allDayIds) {
    const previous = beforeDays.get(dayId)
    const next = afterDays.get(dayId)
    if (!previous || !next) {
      affectedDayIds.add(dayId)
      changedStops += previous?.stops.length ?? next?.stops.length ?? 0
      majorReasons.push(previous ? `删除 Day ${previous.dayIndex}` : `新增 Day ${next?.dayIndex ?? ''}`.trim())
      continue
    }

    const previousById = new Map(previous.stops.map((stop) => [stop.id, stop]))
    const nextById = new Map(next.stops.map((stop) => [stop.id, stop]))
    const changedIds = new Set<string>()
    for (const stopId of new Set([...previousById.keys(), ...nextById.keys()])) {
      const previousStop = previousById.get(stopId)
      const nextStop = nextById.get(stopId)
      if (!previousStop || !nextStop || previousStop.placeId !== nextStop.placeId) changedIds.add(stopId)
    }

    const commonBefore = previous.stops.filter((stop) => nextById.has(stop.id)).map((stop) => stop.id)
    const commonAfter = next.stops.filter((stop) => previousById.has(stop.id)).map((stop) => stop.id)
    if (stableCanonicalString(commonBefore) !== stableCanonicalString(commonAfter)) {
      commonBefore.forEach((stopId, index) => {
        if (commonAfter[index] !== stopId) changedIds.add(stopId)
      })
    }

    if (changedIds.size > 0) affectedDayIds.add(dayId)
    changedStops += changedIds.size
    const dayStopBase = Math.max(previous.stops.length, next.stops.length, 1)
    const dayChangeRatio = changedIds.size / dayStopBase
    if (changedIds.size >= 2 && dayChangeRatio >= 0.5) {
      majorReasons.push(`Day ${next.dayIndex} 调整 ${changedIds.size}/${dayStopBase} 个地点`)
    }
  }

  if (before.days.length !== after.days.length) {
    majorReasons.push(`天数从 ${before.days.length} 天调整为 ${after.days.length} 天`)
  }
  if (before.intent.startDate !== after.intent.startDate) majorReasons.push('整体出发日期发生变化')
  if (
    stableCanonicalString(before.intent.entryAnchor) !== stableCanonicalString(after.intent.entryAnchor) ||
    stableCanonicalString(before.intent.exitAnchor) !== stableCanonicalString(after.intent.exitAnchor)
  ) {
    majorReasons.push('行程出入口发生变化')
  }

  const dayBase = Math.max(before.days.length, after.days.length, 1)
  const stopBase = Math.max(
    before.days.reduce((total, day) => total + day.stops.length, 0),
    after.days.reduce((total, day) => total + day.stops.length, 0),
    1,
  )
  const affectedDayRatio = affectedDayIds.size / dayBase
  const changedStopRatio = changedStops / stopBase
  if (affectedDayIds.size >= 3 && affectedDayRatio >= 0.5 && changedStops >= 4) {
    majorReasons.push(`影响 ${affectedDayIds.size}/${dayBase} 天行程`)
  }
  if (changedStops >= 4 && changedStopRatio >= 0.35) {
    majorReasons.push(`调整 ${changedStops}/${stopBase} 个地点`)
  }

  let distanceRatio: number | undefined
  let durationRatio: number | undefined
  let budgetRatio: number | undefined
  if (beforeDerived && afterDerived) {
    const beforeDistance = beforeDerived.budget.totalDistanceMeters
    const afterDistance = afterDerived.budget.totalDistanceMeters
    const distanceDelta = Math.abs(afterDistance - beforeDistance)
    distanceRatio = changeRatio(beforeDistance, afterDistance)
    if (distanceDelta >= 60_000 && distanceRatio >= 0.2) {
      majorReasons.push(`路线里程变化 ${(distanceDelta / 1000).toFixed(0)} km（${formatPercent(distanceRatio)}）`)
    }

    const beforeDuration = totalDuration(beforeDerived)
    const afterDuration = totalDuration(afterDerived)
    const durationDelta = Math.abs(afterDuration - beforeDuration)
    durationRatio = changeRatio(beforeDuration, afterDuration)
    if (durationDelta >= 5_400 && durationRatio >= 0.25) {
      majorReasons.push(`驾驶时间变化 ${Math.round(durationDelta / 60)} 分钟（${formatPercent(durationRatio)}）`)
    }

    const beforeBudget = beforeDerived.budget.total.expected
    const afterBudget = afterDerived.budget.total.expected
    const budgetDelta = Math.abs(afterBudget - beforeBudget)
    budgetRatio = changeRatio(beforeBudget, afterBudget)
    if (budgetDelta >= 1_000 && budgetRatio >= 0.25) {
      majorReasons.push(`预计预算变化 ¥${Math.round(budgetDelta)}（${formatPercent(budgetRatio)}）`)
    }
  }

  if (changedStops > 0) minorReasons.push(`调整 ${changedStops} 个地点`)
  if (changedStops === 0) {
    const editedStops = new Set(
      diff.entries
        .filter((entry) => entry.kind === 'stop_updated' || entry.kind === 'stop_moved' || entry.kind === 'place_replaced')
        .map((entry) => entry.entityId),
    )
    if (editedStops.size > 0) minorReasons.push(`微调 ${editedStops.size} 个地点`)
  }
  if (diff.hotelChanges.length > 0) minorReasons.push(`调整 ${diff.hotelChanges.length} 处住宿`)
  if (diff.entries.some((entry) => entry.kind.startsWith('source_'))) minorReasons.push('补充或更新资料来源')
  if (diff.entries.some((entry) => entry.kind === 'budget_assumption_changed')) minorReasons.push('更新预算假设')
  if (diff.entries.some((entry) => entry.kind === 'setting_changed')) minorReasons.push('微调行程设置')
  if (minorReasons.length === 0) minorReasons.push('更新标题、备注或生成检查点')

  const level = majorReasons.length > 0 ? 'major' : 'minor'
  return {
    level,
    label: level === 'major' ? '大版本' : '小版本',
    reasons: uniqueReasons(level === 'major' ? majorReasons : minorReasons),
    affectedDays: affectedDayIds.size,
    changedStops,
    thresholds: {
      affectedDayRatio,
      changedStopRatio,
      ...(distanceRatio === undefined ? {} : { distanceRatio }),
      ...(durationRatio === undefined ? {} : { durationRatio }),
      ...(budgetRatio === undefined ? {} : { budgetRatio }),
    },
  }
}

export function semanticDiff(
  before: TripSnapshot,
  after: TripSnapshot,
  beforeDerived?: DerivedSnapshot,
  afterDerived?: DerivedSnapshot,
): SemanticDiff {
  const entries: SemanticDiffEntry[] = []
  const affectedDays = new Set<string>()
  const beforeStops = indexStops(before)
  const afterStops = indexStops(after)

  for (const [stopId, location] of afterStops) {
    const previous = beforeStops.get(stopId)
    if (!previous) {
      affectedDays.add(location.dayId)
      entries.push({
        kind: 'stop_added',
        entityId: stopId,
        dayId: location.dayId,
        label: after.placeRefs[location.stop.placeId]?.name ?? stopId,
        changes: [{ field: 'stop', before: null, after: location.stop }],
      })
      continue
    }
    if (previous.dayId !== location.dayId || previous.position !== location.position) {
      affectedDays.add(previous.dayId)
      affectedDays.add(location.dayId)
      entries.push({
        kind: 'stop_moved',
        entityId: stopId,
        fromDayId: previous.dayId,
        toDayId: location.dayId,
        label: after.placeRefs[location.stop.placeId]?.name ?? stopId,
        changes: [
          {
            field: 'position',
            before: { dayId: previous.dayId, position: previous.position },
            after: { dayId: location.dayId, position: location.position },
          },
        ],
      })
    }
    if (previous.stop.placeId !== location.stop.placeId) {
      affectedDays.add(location.dayId)
      entries.push({
        kind: 'place_replaced',
        entityId: stopId,
        dayId: location.dayId,
        label: `${before.placeRefs[previous.stop.placeId]?.name ?? previous.stop.placeId} -> ${
          after.placeRefs[location.stop.placeId]?.name ?? location.stop.placeId
        }`,
        changes: [
          { field: 'placeId', before: previous.stop.placeId, after: location.stop.placeId },
        ],
      })
    }
    const changes = fieldChanges(previous.stop, location.stop, [
      'kind',
      'plannedStart',
      'stayMinutes',
      'locked',
      'publicNote',
      'privateNote',
      'sourceIds',
    ])
    if (changes.length > 0) {
      affectedDays.add(location.dayId)
      entries.push({
        kind: 'stop_updated',
        entityId: stopId,
        dayId: location.dayId,
        label: after.placeRefs[location.stop.placeId]?.name ?? stopId,
        changes,
      })
    }
  }

  for (const [stopId, location] of beforeStops) {
    if (afterStops.has(stopId)) continue
    affectedDays.add(location.dayId)
    entries.push({
      kind: 'stop_removed',
      entityId: stopId,
      dayId: location.dayId,
      label: before.placeRefs[location.stop.placeId]?.name ?? stopId,
      changes: [{ field: 'stop', before: location.stop, after: null }],
    })
  }

  const hotelChanges: SemanticHotelChange[] = []
  const afterDaysById = new Map(after.days.map((day) => [day.id, day]))
  const beforeDaysById = new Map(before.days.map((day) => [day.id, day]))
  for (const dayId of new Set([...beforeDaysById.keys(), ...afterDaysById.keys()])) {
    const previousStay = beforeDaysById.get(dayId)?.overnightStay ?? null
    const nextStay = afterDaysById.get(dayId)?.overnightStay ?? null
    if (stableCanonicalString(previousStay) === stableCanonicalString(nextStay)) continue
    affectedDays.add(dayId)
    hotelChanges.push({ dayId, before: previousStay, after: nextStay })
    entries.push({
      kind: 'hotel_changed',
      entityId: dayId,
      dayId,
      label: `Day ${afterDaysById.get(dayId)?.dayIndex ?? beforeDaysById.get(dayId)?.dayIndex}`,
      changes: [{ field: 'overnightStay', before: previousStay, after: nextStay }],
    })
  }

  const settingChanges = fieldChanges(before.intent, after.intent, [
    'pace',
    'maxDriveMinutesPerDay',
    'dayEndLimit',
    'partySize',
    'vehicle',
    'totalBudget',
    'mustPlaceIds',
    'avoidTags',
  ])
  if (settingChanges.length > 0) {
    entries.push({
      kind: 'setting_changed',
      entityId: after.tripId,
      label: '行程设置',
      changes: settingChanges,
    })
  }

  const budgetChanges = fieldChanges(before.budgetAssumptions, after.budgetAssumptions, [
    'lodgingDefaultPerNight',
    'lodgingByArea',
    'mealPerPersonPerDay',
    'fuelLitersPer100Km',
    'electricityKwhPer100Km',
    'fuelPricePerLiter',
    'electricityPricePerKwh',
    'rentalCarPerDay',
    'insurancePerDay',
    'parkingAndTollsPerDay',
    'ticketByPlaceId',
    'specialMealByStopId',
    'contingency',
  ])
  if (budgetChanges.length > 0) {
    entries.push({
      kind: 'budget_assumption_changed',
      entityId: after.tripId,
      label: '预算假设',
      changes: budgetChanges,
    })
  }

  const sourceIds = new Set([...Object.keys(before.sourceRefs), ...Object.keys(after.sourceRefs)])
  for (const sourceId of sourceIds) {
    const previous = before.sourceRefs[sourceId]
    const next = after.sourceRefs[sourceId]
    if (!previous && next) {
      entries.push({
        kind: 'source_added',
        entityId: sourceId,
        label: next.title,
        changes: [{ field: 'source', before: null, after: next }],
      })
    } else if (previous && !next) {
      entries.push({
        kind: 'source_removed',
        entityId: sourceId,
        label: previous.title,
        changes: [{ field: 'source', before: previous, after: null }],
      })
    } else if (
      previous &&
      next &&
      stableCanonicalString(previous) !== stableCanonicalString(next)
    ) {
      entries.push({
        kind: 'source_updated',
        entityId: sourceId,
        label: next.title,
        changes: [{ field: 'source', before: previous, after: next }],
      })
    }
  }

  const added = entries.filter((entry) => entry.kind === 'stop_added' || entry.kind === 'source_added')
    .length
  const removed = entries.filter(
    (entry) => entry.kind === 'stop_removed' || entry.kind === 'source_removed',
  ).length
  const changed = entries.length - added - removed
  const impact: SemanticDiff['impact'] = {}
  if (beforeDerived && afterDerived) {
    impact.distanceDeltaMeters =
      afterDerived.budget.totalDistanceMeters - beforeDerived.budget.totalDistanceMeters
    impact.durationDeltaSeconds = totalDuration(afterDerived) - totalDuration(beforeDerived)
    impact.budgetDelta = {
      low: afterDerived.budget.total.low - beforeDerived.budget.total.low,
      expected: afterDerived.budget.total.expected - beforeDerived.budget.total.expected,
      high: afterDerived.budget.total.high - beforeDerived.budget.total.high,
    }
  }

  return {
    counts: { added, changed, removed, conflicts: 0 },
    affectedDays: [...affectedDays].sort(
      (left, right) =>
        (afterDaysById.get(left)?.dayIndex ?? beforeDaysById.get(left)?.dayIndex ?? 0) -
        (afterDaysById.get(right)?.dayIndex ?? beforeDaysById.get(right)?.dayIndex ?? 0),
    ),
    entries,
    hotelChanges,
    impact,
  }
}
