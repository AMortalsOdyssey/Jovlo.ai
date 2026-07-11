import { beforeEach, describe, expect, it } from 'vitest'

import { useTripStore } from './useTripStore'

describe('trip editing impact loop', () => {
  beforeEach(() => {
    useTripStore.getState().resetDemo()
  })

  it('previews a replacement with calculated route, time, and budget impact before applying', () => {
    const before = useTripStore.getState()
    const stop = before.trip.days[0].stops[0]
    const candidate = before.candidates.find((place) => !before.trip.placeRefs[place.placeId])
    expect(candidate).toBeDefined()

    before.requestReplaceStop(stop.id, candidate!.placeId)
    const pending = useTripStore.getState().pendingAction
    expect(pending?.type).toBe('replace-stop')
    expect(pending?.impact.affectedDayIds).toEqual([before.trip.days[0].id])
    expect(pending?.impact.distanceDeltaMeters).toEqual(expect.any(Number))
    expect(pending?.impact.durationDeltaMinutes).toEqual(expect.any(Number))
    expect(pending?.impact.budgetDelta).toEqual(expect.any(Number))
    expect(useTripStore.getState().trip.days[0].stops[0].placeId).toBe(stop.placeId)

    useTripStore.getState().applyPending()
    expect(useTripStore.getState().trip.days[0].stops[0].placeId).toBe(candidate!.placeId)
    expect(useTripStore.getState().dirty).toBe(true)
  })

  it('recalculates the plan when a budget assumption changes', () => {
    const before = useTripStore.getState().derived.budget.total.expected
    useTripStore.getState().updateBudgetAssumptions({
      mealPerPersonPerDay: useTripStore.getState().trip.budgetAssumptions.mealPerPersonPerDay.expected + 100,
    })
    const after = useTripStore.getState()
    expect(after.derived.budget.total.expected).toBeGreaterThan(before)
    expect(after.dirty).toBe(true)
    expect(after.snackbar?.message).toBe('预算假设已更新')
  })

  it('keeps planned arrival and stay duration in the same editable stop snapshot', () => {
    const stop = useTripStore.getState().trip.days[0].stops[0]
    useTripStore.getState().updateStop(stop.id, { plannedStart: '10:30', stayMinutes: 135 })
    const updated = useTripStore.getState().trip.days[0].stops[0]
    expect(updated.plannedStart).toBe('10:30')
    expect(updated.stayMinutes).toBe(135)
    expect(useTripStore.getState().dirty).toBe(true)
  })
})
