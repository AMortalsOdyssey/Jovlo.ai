import { describe, expect, it } from 'vitest'
import {
  DEMO_DERIVED,
  DEMO_IDS,
  DEMO_ROUTE_LEGS,
  DEMO_TRIP,
  RouteLegSchema,
  TripSnapshotSchema,
  calculateBudget,
  calculateSchedule,
  cloneJson,
  semanticDiff,
  stableCanonicalString,
  stableHash,
  validateTripSnapshot,
} from '../../packages/domain/src/index'

describe('TripSnapshotV1 and planning', () => {
  it('validates the complete five-day seed and both stay anchor forms', () => {
    const snapshot = validateTripSnapshot(DEMO_TRIP)
    expect(snapshot.days).toHaveLength(5)
    expect(snapshot.days[0].overnightStay).toMatchObject({ kind: 'area' })
    expect(snapshot.days[3].overnightStay).toMatchObject({ kind: 'place' })
  })

  it('rejects an area stay that is not present in stayAreaRefs', () => {
    const snapshot = cloneJson(DEMO_TRIP)
    snapshot.days[0].overnightStay = {
      kind: 'area',
      areaId: '40000000-0000-4000-8000-999999999999',
      label: '不存在的住宿区域',
    }
    expect(TripSnapshotSchema.safeParse(snapshot).success).toBe(false)
  })

  it('uses departure = arrival + stay exactly once in downstream scheduling', () => {
    const snapshot = cloneJson(DEMO_TRIP)
    snapshot.intent.days = 1
    snapshot.intent.pace = 'packed'
    snapshot.intent.mustPlaceIds = []
    snapshot.days = [cloneJson(snapshot.days[0])]
    snapshot.days[0].startTime = '09:00'
    snapshot.days[0].stops[0].stayMinutes = 60
    snapshot.days[0].stops[1].stayMinutes = 60
    delete snapshot.days[0].overnightStay

    const dayId = snapshot.days[0].id
    const [first, second] = snapshot.days[0].stops
    const routeLegs = [
      RouteLegSchema.parse({
        id: '71000000-0000-4000-8000-000000000001',
        dayId,
        provider: 'reference',
        from: { kind: 'place', placeId: snapshot.intent.entryAnchor.placeId },
        to: { kind: 'place', placeId: first.placeId },
        distanceMeters: 20_000,
        durationSeconds: 1_800,
        strategy: 'test',
        calculatedAt: '2026-07-11T12:00:00+08:00',
        status: 'stale',
        estimateKind: 'reference',
      }),
      RouteLegSchema.parse({
        id: '71000000-0000-4000-8000-000000000002',
        dayId,
        provider: 'reference',
        from: { kind: 'place', placeId: first.placeId },
        to: { kind: 'place', placeId: second.placeId },
        distanceMeters: 20_000,
        durationSeconds: 1_800,
        strategy: 'test',
        calculatedAt: '2026-07-11T12:00:00+08:00',
        status: 'stale',
        estimateKind: 'reference',
      }),
      RouteLegSchema.parse({
        id: '71000000-0000-4000-8000-000000000003',
        dayId,
        provider: 'reference',
        from: { kind: 'place', placeId: second.placeId },
        to: { kind: 'place', placeId: snapshot.intent.exitAnchor.placeId },
        distanceMeters: 20_000,
        durationSeconds: 1_800,
        strategy: 'test',
        calculatedAt: '2026-07-11T12:00:00+08:00',
        status: 'stale',
        estimateKind: 'reference',
      }),
    ]

    const schedule = calculateSchedule(TripSnapshotSchema.parse(snapshot), routeLegs)[0]
    expect(schedule.stops[0]).toMatchObject({ arrivalTime: '09:40', departureTime: '10:40' })
    expect(schedule.stops[1]).toMatchObject({ arrivalTime: '11:20', departureTime: '12:20' })
  })
})

describe('budget, canonical hash, and semantic diff', () => {
  it('calculates lodging from area and place anchors plus interval totals', () => {
    const budget = calculateBudget(DEMO_TRIP, DEMO_ROUTE_LEGS, '2026-07-11T12:00:00+08:00')
    const lodging = budget.categories.find((category) => category.category === 'lodging')
    expect(lodging?.amount.expected).toBe(1_730)
    expect(budget.total.low).toBeLessThanOrEqual(budget.total.expected)
    expect(budget.total.expected).toBeLessThanOrEqual(budget.total.high)
    expect(budget.totalDistanceMeters).toBe(608_000)
  })

  it('recalculates an area lodging anchor without requiring a hotel place', () => {
    const snapshot = cloneJson(DEMO_TRIP)
    snapshot.days[3].overnightStay = {
      kind: 'area',
      areaId: DEMO_IDS.areas.wanning,
      label: '日月湾住宿锚点区',
    }
    const budget = calculateBudget(TripSnapshotSchema.parse(snapshot), DEMO_ROUTE_LEGS)
    const lodging = budget.categories.find((category) => category.category === 'lodging')
    expect(lodging?.amount.expected).toBe(1_630)
  })

  it('produces stable canonical values across object key order', () => {
    expect(stableCanonicalString({ b: 2, a: 1 })).toBe(stableCanonicalString({ a: 1, b: 2 }))
    expect(stableHash({ b: 2, a: 1 })).toBe(stableHash({ a: 1, b: 2 }))
    expect(stableHash({ a: 2 })).not.toBe(stableHash({ a: 1 }))
  })

  it('classifies moved and updated stops by stable ID', () => {
    const next = cloneJson(DEMO_TRIP)
    const [moved] = next.days[3].stops.splice(0, 1)
    moved.stayMinutes = 180
    next.days[4].stops.splice(1, 0, moved)
    const diff = semanticDiff(DEMO_TRIP, TripSnapshotSchema.parse(next), DEMO_DERIVED, DEMO_DERIVED)
    expect(diff.entries.some((entry) => entry.kind === 'stop_moved' && entry.entityId === moved.id)).toBe(true)
    expect(diff.entries.some((entry) => entry.kind === 'stop_updated' && entry.entityId === moved.id)).toBe(true)
    expect(diff.affectedDays).toEqual(expect.arrayContaining([DEMO_IDS.days[3], DEMO_IDS.days[4]]))
  })
})
