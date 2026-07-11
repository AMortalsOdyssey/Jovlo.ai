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
