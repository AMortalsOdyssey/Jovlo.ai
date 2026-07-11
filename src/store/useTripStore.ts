import {
  DEMO_ACTUALS,
  DEMO_CANDIDATES,
  DEMO_CHANGESET,
  DEMO_DERIVED,
  DEMO_EXPENSES,
  DEMO_IDS,
  DEMO_REPORTS,
  DEMO_TRIP,
  DEMO_VERSIONS,
  ActualRecordSchema,
  ExpenseSchema,
  ReportGenerationSchema,
  TripSnapshotSchema,
  TripVersionSchema,
  applyChangeSetToSnapshot,
  cloneJson,
  previewChangeSet,
  recalculateTrip,
  semanticDiff,
  stableHash,
  type ActualRecord,
  type ChangeSetPreview,
  type DerivedSnapshot,
  type Expense,
  type ReportGeneration,
  type StayAnchor,
  type TripSnapshot,
  type TripStop,
  type TripVersion,
} from '@domain'
import { addDays, format, parseISO } from 'date-fns'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { persist } from 'zustand/middleware'
import { createId } from '@/lib/id'
import type {
  DisclosureConfig,
  LocalPublication,
  LocalReportSnapshot,
  MobileView,
  PendingAction,
  ProductionHydration,
  ProductionPublishRequest,
  ProductionSyncState,
  SaveStatus,
  SnackbarState,
} from './store-types'
import { buildReferenceRouteLegs } from './reference-routes'

const OWNER_ID = DEMO_IDS.owner

type UndoEntry = {
  trip: TripSnapshot
  derived: DerivedSnapshot
  message: string
}

type SettingsPayload = {
  title?: string
  intent?: Partial<TripSnapshot['intent']> & {
    entryAnchor?: { placeId?: string; label: string }
    exitAnchor?: { placeId?: string; label: string }
    preferenceTags?: string[]
  }
}

type NewExpense = Omit<Expense, 'id' | 'createdAt' | 'updatedAt'> & Partial<Pick<Expense, 'id'>>

export type BudgetAssumptionPatch = {
  lodgingDefaultPerNight?: number
  mealPerPersonPerDay?: number
  fuelLitersPer100Km?: number
  electricityKwhPer100Km?: number
  fuelPricePerLiter?: number
  electricityPricePerKwh?: number
  rentalCarPerDay?: number
  insurancePerDay?: number
  parkingAndTollsPerDay?: number
  contingencyRate?: number
}

export type TripStore = {
  trip: TripSnapshot
  trips: TripSnapshot[]
  derived: DerivedSnapshot
  versions: TripVersion[]
  expenses: Expense[]
  actuals: ActualRecord[]
  reports: ReportGeneration[]
  reportSnapshots: Record<string, LocalReportSnapshot>
  publications: LocalPublication[]
  candidates: typeof DEMO_CANDIDATES
  selectedDayId: string
  selectedStopId: string | null
  mobileView: MobileView
  saveStatus: SaveStatus
  dirty: boolean
  revision: number
  pendingAction: PendingAction | null
  snackbar: SnackbarState
  changeSetPreview: ChangeSetPreview | null
  acceptedChangeSetGroups: string[]
  unassignedStops: TripStop[]
  undoStack: UndoEntry[]
  productionSync: ProductionSyncState
  productionPublishQueue: ProductionPublishRequest[]
  selectDay: (dayId: string) => void
  selectStop: (stopId: string | null) => void
  setMobileView: (view: MobileView) => void
  updateStop: (stopId: string, patch: Partial<Pick<TripStop, 'stayMinutes' | 'plannedStart' | 'publicNote'>>) => void
  toggleStopLock: (stopId: string) => void
  requestMoveStop: (stopId: string, targetDayId: string, targetIndex: number) => void
  moveStop: (stopId: string, targetDayId: string, targetIndex?: number) => void
  requestRemoveStop: (stopId: string) => void
  requestReplaceStop: (stopId: string, placeId: string) => void
  requestStayUpdate: (dayId: string, anchor: StayAnchor) => void
  requestSettingsUpdate: (payload: SettingsPayload) => void
  applyPending: () => void
  discardPending: () => void
  undo: () => void
  dismissSnackbar: () => void
  retrySave: () => void
  publishVersion: (message?: string, source?: TripVersion['source']) => TripVersion
  restoreVersion: (versionId: string) => void
  addCandidateStop: (placeId: string, dayId?: string) => void
  replaceStop: (stopId: string, placeId: string) => void
  updateBudgetAssumptions: (patch: BudgetAssumptionPatch) => void
  addExpense: (expense: NewExpense | Record<string, unknown>) => void
  markActual: (input: Partial<ActualRecord> & { dayId: string; status: 'visited' | 'skipped' }) => void
  delayToday: (minutes: number, dayId?: string) => void
  skipTodayStop: (stopId: string) => void
  prepareDemoChangeSet: (selectedGroupIds?: string[]) => ChangeSetPreview | null
  setChangeSetGroupAccepted: (groupId: string, accepted: boolean) => void
  applyDemoChangeSet: () => void
  generateReport: (type?: 'plan' | 'actual') => ReportGeneration
  createTripPublication: (config: DisclosureConfig) => LocalPublication
  createReportPublication: (reportId: string, config: DisclosureConfig) => LocalPublication | null
  revokePublication: (publicationId: string) => void
  setProductionSync: (patch: Partial<ProductionSyncState>) => void
  hydrateProduction: (payload: ProductionHydration) => void
  acknowledgeProductionDraft: (draftRevision: number, localRevision: number) => void
  completeProductionPublish: (requestId: string, version: TripVersion, draftRevision: number) => void
  failProductionOperation: (message: string, requestId?: string) => void
  resetDemo: () => void
}

function cloneDemo() {
  const reportSnapshots = Object.fromEntries(
    DEMO_REPORTS.map((report) => {
      const version = DEMO_VERSIONS.find((item) => item.id === report.versionId) ?? DEMO_VERSIONS[1]
      return [
        report.id,
        {
          trip: cloneJson(version.snapshot),
          derived: cloneJson(version.derivedSnapshot),
          expenses: cloneJson(DEMO_EXPENSES),
          actuals: cloneJson(DEMO_ACTUALS),
          frozenAt: report.createdAt,
        } satisfies LocalReportSnapshot,
      ]
    }),
  )
  const publications: LocalPublication[] = [
    {
      id: 'f0000000-0000-4000-8000-000000000001',
      token: 'jovlo-demo-trip',
      targetKind: 'version',
      versionId: DEMO_VERSIONS[1].id,
      reportId: null,
      disclosureConfig: { showExactDates: false, showSources: true, showBudget: true },
      createdAt: '2026-07-11T12:30:00+08:00',
      revokedAt: null,
    },
    {
      id: 'f0000000-0000-4000-8000-000000000002',
      token: 'jovlo-demo-report',
      targetKind: 'report',
      versionId: null,
      reportId: DEMO_REPORTS[1].id,
      disclosureConfig: { showExactDates: false, showSources: true, showBudget: true },
      createdAt: '2026-08-15T21:30:00+08:00',
      revokedAt: null,
    },
  ]
  return {
    trip: cloneJson(DEMO_TRIP),
    derived: cloneJson(DEMO_DERIVED),
    versions: cloneJson(DEMO_VERSIONS),
    expenses: cloneJson(DEMO_EXPENSES),
    actuals: cloneJson(DEMO_ACTUALS),
    reports: cloneJson(DEMO_REPORTS),
    reportSnapshots,
    publications,
  }
}

function publicationToken() {
  return `jv-${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`
}

function recalculate(snapshot: TripSnapshot): DerivedSnapshot {
  return recalculateTrip(snapshot, buildReferenceRouteLegs(snapshot))
}

function summarizeImpact(
  before: DerivedSnapshot,
  after: DerivedSnapshot,
  title: string,
  description: string,
  affectedDayIds: string[],
) {
  const totalMinutes = (derived: DerivedSnapshot) => derived.daySchedules
    .reduce((sum, day) => sum + day.drivingMinutes + day.activityMinutes, 0)
  const warnings = after.daySchedules
    .filter((day) => affectedDayIds.includes(day.dayId))
    .flatMap((day) => day.warnings.map((warning) => warning.message))
  return {
    title,
    description,
    affectedDayIds,
    distanceDeltaMeters: after.budget.totalDistanceMeters - before.budget.totalDistanceMeters,
    durationDeltaMinutes: totalMinutes(after) - totalMinutes(before),
    budgetDelta: after.budget.total.expected - before.budget.total.expected,
    warnings: [...new Set(warnings)].slice(0, 4),
  }
}

function updateMoneyRange(
  range: { low: number; expected: number; high: number; currency: 'CNY' },
  expected: number,
) {
  const safeExpected = Number.isFinite(expected) ? Math.max(0, expected) : range.expected
  const lowRatio = range.expected > 0 ? range.low / range.expected : 0.85
  const highRatio = range.expected > 0 ? range.high / range.expected : 1.2
  return {
    low: Math.round(safeExpected * lowRatio * 100) / 100,
    expected: safeExpected,
    high: Math.round(safeExpected * highRatio * 100) / 100,
    currency: range.currency,
  }
}

function findStop(snapshot: TripSnapshot, stopId: string) {
  for (let dayIndex = 0; dayIndex < snapshot.days.length; dayIndex += 1) {
    const stopIndex = snapshot.days[dayIndex].stops.findIndex((stop) => stop.id === stopId)
    if (stopIndex >= 0) return { dayIndex, stopIndex, stop: snapshot.days[dayIndex].stops[stopIndex] }
  }
  return null
}

function makeUndo(state: Pick<TripStore, 'trip' | 'derived'>, message: string): UndoEntry {
  return { trip: cloneJson(state.trip), derived: cloneJson(state.derived), message }
}

function normalizeAnchor(
  current: { placeId: string; label: string },
  proposed: { placeId?: string; label: string } | undefined,
  trip: TripSnapshot,
  role: 'entry' | 'exit',
) {
  if (!proposed) return current
  if (proposed.placeId && trip.placeRefs[proposed.placeId]) {
    return { placeId: proposed.placeId, label: proposed.label }
  }
  const label = proposed.label
  const preferred = Object.values(trip.placeRefs).find((place) => {
    if (role === 'entry' && label.includes('海口')) return place.name.includes('美兰')
    if (role === 'exit' && label.includes('三亚')) return place.name.includes('凤凰')
    if (role === 'entry' && label.includes('三亚')) return place.name.includes('凤凰')
    if (role === 'exit' && label.includes('海口')) return place.name.includes('美兰')
    return place.name.includes(label)
  })
  return preferred ? { placeId: preferred.placeId, label } : current
}

function resizeDays(snapshot: TripSnapshot, count: number, pool: TripStop[]) {
  const target = Math.max(2, Math.min(14, Math.round(count)))
  if (target < snapshot.days.length) {
    const removed = snapshot.days.splice(target)
    removed.forEach((day) => pool.push(...day.stops))
  }
  while (snapshot.days.length < target) {
    const previous = snapshot.days.at(-1)
    const dayIndex = snapshot.days.length + 1
    const previousDate = previous?.date ?? snapshot.intent.startDate
    snapshot.days.push({
      id: crypto.randomUUID(),
      dayIndex,
      date: previousDate ? format(addDays(parseISO(previousDate), 1), 'yyyy-MM-dd') : undefined,
      startTime: '09:00',
      stops: [],
      overnightStay: dayIndex < target ? previous?.overnightStay ?? { kind: 'area', areaId: DEMO_IDS.areas.wanning, label: '万宁住宿锚点区' } : undefined,
    })
  }
  snapshot.days.forEach((day, index) => {
    day.dayIndex = index + 1
    if (index < snapshot.days.length - 1 && !day.overnightStay) {
      day.overnightStay = { kind: 'area', areaId: DEMO_IDS.areas.wanning, label: '万宁住宿锚点区' }
    }
    if (index === snapshot.days.length - 1) delete day.overnightStay
  })
  snapshot.intent.days = snapshot.days.length
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

function scheduleSaved(markSaved: () => void) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(markSaved, 520)
}

export const useTripStore = create<TripStore>()(
  persist(
    immer((set, get) => {
      const demo = cloneDemo()
      const mutate = (recipe: (state: TripStore) => void) =>
        set((state) => recipe(state as unknown as TripStore))

      const commitTrip = (next: TripSnapshot, message: string, showUndo = true) => {
        const current = get()
        const validated = TripSnapshotSchema.parse(next)
        const undo = showUndo ? makeUndo(current, message) : null
        const derived = recalculate(validated)
        mutate((state) => {
          state.trip = validated
          state.trips = [validated]
          state.derived = derived
          state.dirty = true
          state.revision += 1
          state.saveStatus = 'saving'
          if (undo) {
            state.undoStack.push(undo)
            if (state.undoStack.length > 12) state.undoStack.shift()
            state.snackbar = { id: createId('snackbar'), message, actionLabel: '撤销' }
          }
        })
        if (get().productionSync.mode !== 'production') {
          scheduleSaved(() => mutate((state) => void (state.saveStatus = 'saved')))
        }
      }

      const moveNow = (stopId: string, targetDayId: string, targetIndex?: number) => {
        const next = cloneJson(get().trip)
        const found = findStop(next, stopId)
        const targetDay = next.days.find((day) => day.id === targetDayId)
        if (!found || !targetDay) return
        if (found.stop.locked) {
          mutate((state) => void (state.snackbar = { id: createId('snackbar'), message: '锁定地点请先由用户解除锁定' }))
          return
        }
        const [moving] = next.days[found.dayIndex].stops.splice(found.stopIndex, 1)
        const index = Math.max(0, Math.min(targetDay.stops.length, targetIndex ?? targetDay.stops.length))
        targetDay.stops.splice(index, 0, moving)
        commitTrip(next, '地点顺序已调整')
      }

      const replaceNow = (stopId: string, placeId: string) => {
        const candidate = get().candidates.find((place) => place.placeId === placeId)
        if (!candidate) return
        const next = cloneJson(get().trip)
        const found = findStop(next, stopId)
        if (!found) return
        const previousPlaceId = found.stop.placeId
        next.placeRefs[candidate.placeId] = cloneJson(candidate)
        found.stop.placeId = candidate.placeId
        found.stop.sourceIds = [...candidate.sourceIds]
        next.intent.mustPlaceIds = next.intent.mustPlaceIds.map((id) =>
          id === previousPlaceId ? candidate.placeId : id,
        )
        commitTrip(next, `已用 ${candidate.name} 替换原地点`)
        mutate((state) => {
          state.selectedStopId = stopId
        })
      }

      return {
        ...demo,
        trips: [demo.trip],
        candidates: cloneJson(DEMO_CANDIDATES),
        selectedDayId: demo.trip.days[0].id,
        selectedStopId: null,
        mobileView: 'plan',
        saveStatus: 'saved',
        dirty: false,
        revision: 1,
        pendingAction: null,
        snackbar: null,
        changeSetPreview: null,
        acceptedChangeSetGroups: DEMO_CHANGESET.proposalGroups.map((group) => group.groupId),
        unassignedStops: [],
        undoStack: [],
        productionSync: {
          mode: 'demo',
          hydrated: false,
          draftRevision: null,
          currentVersionId: null,
          error: null,
        },
        productionPublishQueue: [],

        selectDay: (dayId) => mutate((state) => void (state.selectedDayId = dayId)),
        selectStop: (stopId) => mutate((state) => void (state.selectedStopId = stopId)),
        setMobileView: (view) => mutate((state) => void (state.mobileView = view)),

        updateStop: (stopId, patch) => {
          const next = cloneJson(get().trip)
          const found = findStop(next, stopId)
          if (!found) return
          Object.assign(found.stop, patch)
          commitTrip(next, '地点信息已更新')
        },

        toggleStopLock: (stopId) => {
          const next = cloneJson(get().trip)
          const found = findStop(next, stopId)
          if (!found) return
          found.stop.locked = !found.stop.locked
          commitTrip(next, found.stop.locked ? '地点已锁定' : '地点已解除锁定')
        },

        requestMoveStop: (stopId, targetDayId, targetIndex) => {
          const current = get()
          const found = findStop(current.trip, stopId)
          if (!found) return
          const sourceDay = current.trip.days[found.dayIndex]
          if (sourceDay.id === targetDayId) {
            moveNow(stopId, targetDayId, targetIndex)
            return
          }
          const next = cloneJson(current.trip)
          const nextFound = findStop(next, stopId)
          const targetDay = next.days.find((day) => day.id === targetDayId)
          if (!nextFound || !targetDay) return
          const [moving] = next.days[nextFound.dayIndex].stops.splice(nextFound.stopIndex, 1)
          targetDay.stops.splice(Math.max(0, Math.min(targetDay.stops.length, targetIndex)), 0, moving)
          mutate((state) => {
            state.pendingAction = {
              id: createId('impact'),
              type: 'move-stop',
              stopId,
              sourceDayId: sourceDay.id,
              targetDayId,
              targetIndex,
              impact: summarizeImpact(
                current.derived,
                recalculate(next),
                '跨日移动地点',
                '两天路线、预计到达和预算将重新计算',
                [sourceDay.id, targetDayId],
              ),
            }
          })
        },

        moveStop: (stopId, targetDayId, targetIndex) => moveNow(stopId, targetDayId, targetIndex),

        requestRemoveStop: (stopId) => {
          const current = get()
          const found = findStop(current.trip, stopId)
          if (!found) return
          if (found.stop.locked) {
            mutate((state) => void (state.snackbar = { id: createId('snackbar'), message: '锁定地点不能直接删除' }))
            return
          }
          const next = cloneJson(current.trip)
          const dayId = next.days[found.dayIndex].id
          next.days[found.dayIndex].stops.splice(found.stopIndex, 1)
          mutate((state) => {
            state.pendingAction = {
              id: createId('impact'),
              type: 'remove-stop',
              dayId,
              stopId,
              impact: summarizeImpact(
                current.derived,
                recalculate(next),
                '移出当天地点',
                '后续到达、结束时间、路线和预算将重新计算',
                [dayId],
              ),
            }
          })
        },

        requestReplaceStop: (stopId, placeId) => {
          const current = get()
          const candidate = current.candidates.find((place) => place.placeId === placeId)
          const next = cloneJson(current.trip)
          const found = findStop(next, stopId)
          if (!candidate || !found) return
          const dayId = next.days[found.dayIndex].id
          next.placeRefs[candidate.placeId] = cloneJson(candidate)
          found.stop.placeId = candidate.placeId
          found.stop.sourceIds = [...candidate.sourceIds]
          mutate((state) => {
            state.pendingAction = {
              id: createId('impact'),
              type: 'replace-stop',
              stopId,
              placeId,
              impact: summarizeImpact(
                current.derived,
                recalculate(next),
                `替换为 ${candidate.name}`,
                '该日路线、到达时间和相关预算将重新计算',
                [dayId],
              ),
            }
          })
        },

        requestStayUpdate: (dayId, anchor) => {
          const current = get()
          const next = cloneJson(current.trip)
          const day = next.days.find((item) => item.id === dayId)
          if (!day) return
          day.overnightStay = anchor
          const dayIndex = next.days.findIndex((item) => item.id === dayId)
          const affectedDayIds = [dayId, next.days[dayIndex + 1]?.id].filter(Boolean) as string[]
          mutate((state) => {
            state.pendingAction = {
              id: createId('impact'),
              type: 'set-stay',
              dayId,
              anchor,
              impact: summarizeImpact(
                current.derived,
                recalculate(next),
                '更换住宿锚点',
                '当日末段、次日首段和住宿预算将重新计算',
                affectedDayIds,
              ),
            }
          })
        },

        requestSettingsUpdate: (payload) => {
          const next = cloneJson(get().trip)
          if (payload.title?.trim()) next.title = payload.title.trim()
          const patch = payload.intent
          if (patch) {
            if (patch.startDate !== undefined) {
              next.intent.startDate = patch.startDate
              next.days.forEach((day, index) => {
                day.date = patch.startDate ? format(addDays(parseISO(patch.startDate), index), 'yyyy-MM-dd') : undefined
              })
            }
            if (patch.days !== undefined) {
              const unassignedStops = cloneJson(get().unassignedStops)
              resizeDays(next, patch.days, unassignedStops)
              mutate((state) => {
                state.unassignedStops = unassignedStops
              })
            }
            next.intent.entryAnchor = normalizeAnchor(next.intent.entryAnchor, patch.entryAnchor, next, 'entry')
            next.intent.exitAnchor = normalizeAnchor(next.intent.exitAnchor, patch.exitAnchor, next, 'exit')
            if (patch.partySize !== undefined) next.intent.partySize = patch.partySize
            if (patch.vehicle?.type) next.intent.vehicle = { ...next.intent.vehicle, ...patch.vehicle }
            if (patch.pace) next.intent.pace = patch.pace
            if (patch.maxDriveMinutesPerDay !== undefined) next.intent.maxDriveMinutesPerDay = patch.maxDriveMinutesPerDay
            if (patch.dayEndLimit) next.intent.dayEndLimit = patch.dayEndLimit
            if (patch.totalBudget !== undefined) next.intent.totalBudget = patch.totalBudget
            if (patch.mustPlaceIds) next.intent.mustPlaceIds = patch.mustPlaceIds.filter((id) => Boolean(next.placeRefs[id]))
            if (patch.avoidTags) next.intent.avoidTags = patch.avoidTags
          }
          commitTrip(next, '行程设置已更新', false)
        },

        applyPending: () => {
          const pending = get().pendingAction
          if (!pending) return
          if (pending.type === 'move-stop') {
            mutate((state) => void (state.pendingAction = null))
            moveNow(pending.stopId, pending.targetDayId, pending.targetIndex)
            return
          }
          const next = cloneJson(get().trip)
          if (pending.type === 'set-stay') {
            const day = next.days.find((item) => item.id === pending.dayId)
            if (day) day.overnightStay = pending.anchor as StayAnchor
          }
          if (pending.type === 'remove-stop') {
            const found = findStop(next, pending.stopId)
            if (found) next.days[found.dayIndex].stops.splice(found.stopIndex, 1)
          }
          if (pending.type === 'replace-stop') {
            mutate((state) => void (state.pendingAction = null))
            replaceNow(pending.stopId, pending.placeId)
            return
          }
          mutate((state) => void (state.pendingAction = null))
          commitTrip(next, pending.impact.title)
        },

        discardPending: () => mutate((state) => void (state.pendingAction = null)),

        undo: () => {
          const entry = get().undoStack.at(-1)
          if (!entry) return
          const restoredTrip = cloneJson(entry.trip)
          const restoredDerived = cloneJson(entry.derived)
          mutate((state) => {
            state.trip = restoredTrip
            state.trips = [restoredTrip]
            state.derived = restoredDerived
            state.undoStack.pop()
            state.pendingAction = null
            state.snackbar = null
            state.dirty = true
            state.revision += 1
            state.saveStatus = 'saving'
          })
          if (get().productionSync.mode !== 'production') {
            scheduleSaved(() => mutate((state) => void (state.saveStatus = 'saved')))
          }
        },

        dismissSnackbar: () => mutate((state) => void (state.snackbar = null)),
        retrySave: () => {
          mutate((state) => {
            state.saveStatus = 'saving'
            if (state.productionSync.hydrated) {
              state.productionSync.mode = 'production'
              state.productionSync.error = null
              state.revision += 1
            }
          })
          if (get().productionSync.mode !== 'production') {
            scheduleSaved(() => mutate((state) => void (state.saveStatus = 'saved')))
          }
        },

        publishVersion: (message = '保存当前行程', source = 'manual') => {
          const state = get()
          const current = state.versions.reduce((best, version) => (version.versionNo > best.versionNo ? version : best))
          const version = TripVersionSchema.parse({
            id: crypto.randomUUID(),
            tripId: state.trip.tripId,
            versionNo: current.versionNo + 1,
            parentVersionId: current.id,
            source,
            message,
            snapshot: state.trip,
            snapshotHash: stableHash(state.trip),
            derivedSnapshot: state.derived,
            derivedHash: stableHash(state.derived),
            createdBy: OWNER_ID,
            createdAt: new Date().toISOString(),
          })
          mutate((draft) => {
            draft.versions.push(version)
            if (draft.productionSync.mode === 'production') {
              draft.productionPublishQueue.push({
                id: crypto.randomUUID(),
                optimisticVersionId: version.id,
                localRevision: draft.revision,
                message,
                source,
                snapshot: cloneJson(draft.trip),
                derivedSnapshot: cloneJson(draft.derived),
              })
              draft.saveStatus = 'saving'
            } else {
              draft.dirty = false
              draft.saveStatus = 'saved'
            }
            draft.pendingAction = null
            draft.snackbar = {
              id: createId('snackbar'),
              message: draft.productionSync.mode === 'production' ? `正在发布 v${version.versionNo}` : `已发布 v${version.versionNo}`,
            }
          })
          return version
        },

        restoreVersion: (versionId) => {
          const target = get().versions.find((version) => version.id === versionId)
          if (!target) return
          const restored = cloneJson(target.snapshot)
          const derived = recalculate(restored)
          mutate((state) => {
            state.trip = restored
            state.trips = [restored]
            state.derived = derived
            state.dirty = true
            state.revision += 1
          })
          get().publishVersion(`恢复自 v${target.versionNo}`, 'restore')
        },

        addCandidateStop: (placeId, dayId) => {
          const candidate = get().candidates.find((place) => place.placeId === placeId)
          if (!candidate) return
          const next = cloneJson(get().trip)
          next.placeRefs[candidate.placeId] = cloneJson(candidate)
          const target = next.days.find((day) => day.id === (dayId ?? get().selectedDayId)) ?? next.days[0]
          target.stops.push({
            id: crypto.randomUUID(),
            placeId: candidate.placeId,
            kind: 'attraction',
            stayMinutes: 90,
            locked: false,
            sourceIds: candidate.sourceIds,
          })
          commitTrip(next, `${candidate.name} 已加入 Day ${target.dayIndex}`)
        },

        replaceStop: (stopId, placeId) => replaceNow(stopId, placeId),

        updateBudgetAssumptions: (patch) => {
          const next = cloneJson(get().trip)
          const assumptions = next.budgetAssumptions
          if (patch.lodgingDefaultPerNight !== undefined) assumptions.lodgingDefaultPerNight = updateMoneyRange(assumptions.lodgingDefaultPerNight, patch.lodgingDefaultPerNight)
          if (patch.mealPerPersonPerDay !== undefined) assumptions.mealPerPersonPerDay = updateMoneyRange(assumptions.mealPerPersonPerDay, patch.mealPerPersonPerDay)
          if (patch.fuelPricePerLiter !== undefined) assumptions.fuelPricePerLiter = updateMoneyRange(assumptions.fuelPricePerLiter, patch.fuelPricePerLiter)
          if (patch.electricityPricePerKwh !== undefined) assumptions.electricityPricePerKwh = updateMoneyRange(assumptions.electricityPricePerKwh, patch.electricityPricePerKwh)
          if (patch.rentalCarPerDay !== undefined) assumptions.rentalCarPerDay = updateMoneyRange(assumptions.rentalCarPerDay, patch.rentalCarPerDay)
          if (patch.insurancePerDay !== undefined) assumptions.insurancePerDay = updateMoneyRange(assumptions.insurancePerDay, patch.insurancePerDay)
          if (patch.parkingAndTollsPerDay !== undefined) assumptions.parkingAndTollsPerDay = updateMoneyRange(assumptions.parkingAndTollsPerDay, patch.parkingAndTollsPerDay)
          if (patch.fuelLitersPer100Km !== undefined && Number.isFinite(patch.fuelLitersPer100Km)) assumptions.fuelLitersPer100Km = Math.max(0.1, Math.min(50, patch.fuelLitersPer100Km))
          if (patch.electricityKwhPer100Km !== undefined && Number.isFinite(patch.electricityKwhPer100Km)) assumptions.electricityKwhPer100Km = Math.max(0.1, Math.min(100, patch.electricityKwhPer100Km))
          if (patch.contingencyRate !== undefined && Number.isFinite(patch.contingencyRate)) assumptions.contingency = { kind: 'percentage', rate: Math.max(0, Math.min(1, patch.contingencyRate)) }
          assumptions.verifiedAt = new Date().toISOString()
          commitTrip(next, '预算假设已更新')
        },

        addExpense: (value) => {
          const now = new Date().toISOString()
          const record = value as Record<string, unknown>
          const expense = ExpenseSchema.parse({
            ...record,
            id: typeof record.id === 'string' ? record.id : crypto.randomUUID(),
            tripId: typeof record.tripId === 'string' ? record.tripId : get().trip.tripId,
            currency: 'CNY',
            createdAt: now,
            updatedAt: now,
          })
          mutate((state) => {
            state.expenses.push(expense)
            state.snackbar = { id: createId('snackbar'), message: `已记录 ¥${expense.amount}` }
          })
        },

        markActual: (input) => {
          const now = new Date().toISOString()
          const currentVersion = get().versions.reduce((best, version) => (version.versionNo > best.versionNo ? version : best))
          const existing = get().actuals.find((item) => item.dayId === input.dayId && item.stopId === input.stopId)
          const actual = ActualRecordSchema.parse({
            id: existing?.id ?? crypto.randomUUID(),
            tripId: get().trip.tripId,
            sourceVersionId: currentVersion.id,
            dayId: input.dayId,
            stopId: input.stopId,
            status: input.status,
            rating: input.rating,
            note: input.note,
            actualStartAt: input.actualStartAt,
            actualEndAt: input.actualEndAt,
            orphaned: false,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          })
          mutate((state) => {
            const index = state.actuals.findIndex((item) => item.id === actual.id)
            if (index >= 0) state.actuals[index] = actual
            else state.actuals.push(actual)
          })
        },

        delayToday: (minutes, dayId) => {
          const next = cloneJson(get().trip)
          const day = next.days.find((item) => item.id === (dayId ?? get().selectedDayId))
          if (!day) return
          const [hours, mins] = day.startTime.split(':').map(Number)
          const total = hours * 60 + mins + minutes
          day.startTime = `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
          commitTrip(next, `当天行程已延后 ${minutes} 分钟`)
        },

        skipTodayStop: (stopId) => {
          const found = findStop(get().trip, stopId)
          if (!found) return
          get().markActual({ dayId: get().trip.days[found.dayIndex].id, stopId, status: 'skipped' })
          const next = cloneJson(get().trip)
          const nextFound = findStop(next, stopId)
          if (!nextFound) return
          next.intent.mustPlaceIds = next.intent.mustPlaceIds.filter((placeId) => placeId !== nextFound.stop.placeId)
          next.days[nextFound.dayIndex].stops.splice(nextFound.stopIndex, 1)
          commitTrip(next, '已记录今天跳过，并重算后续路线')
        },

        prepareDemoChangeSet: (selectedGroupIds) => {
          if (get().dirty) {
            mutate((state) => void (state.snackbar = { id: createId('snackbar'), message: '请先保存当前草稿为版本，再审阅 Agent 变更' }))
            return null
          }
          const selected = selectedGroupIds ?? get().acceptedChangeSetGroups
          const first = previewChangeSet(get().trip, DEMO_CHANGESET, {
            selectedGroupIds: selected,
            currentVersionId: DEMO_CHANGESET.baseVersionId,
            routeLegsBefore: get().derived.routeLegs,
            routeLegsAfter: get().derived.routeLegs,
          })
          const afterLegs = buildReferenceRouteLegs(first.candidateSnapshot)
          const preview = previewChangeSet(get().trip, DEMO_CHANGESET, {
            selectedGroupIds: selected,
            currentVersionId: DEMO_CHANGESET.baseVersionId,
            routeLegsBefore: get().derived.routeLegs,
            routeLegsAfter: afterLegs,
          })
          mutate((state) => void (state.changeSetPreview = preview))
          return preview
        },

        setChangeSetGroupAccepted: (groupId, accepted) => {
          mutate((state) => {
            const groups = new Set(state.acceptedChangeSetGroups)
            if (accepted) groups.add(groupId)
            else groups.delete(groupId)
            state.acceptedChangeSetGroups = [...groups]
          })
          get().prepareDemoChangeSet(get().acceptedChangeSetGroups)
        },

        applyDemoChangeSet: () => {
          if (get().dirty) {
            mutate((state) => void (state.snackbar = { id: createId('snackbar'), message: '存在未发布草稿，请先保存版本' }))
            return
          }
          const preview = get().changeSetPreview ?? get().prepareDemoChangeSet()
          if (!preview?.canApply) return
          const next = applyChangeSetToSnapshot(get().trip, DEMO_CHANGESET, {
            selectedGroupIds: get().acceptedChangeSetGroups,
            currentVersionId: DEMO_CHANGESET.baseVersionId,
          })
          const derived = recalculate(next)
          mutate((state) => {
            state.trip = next
            state.trips = [next]
            state.derived = derived
            state.dirty = true
          })
          get().publishVersion('应用 Agent 资料变更', 'changeset')
          mutate((state) => {
            state.changeSetPreview = null
            state.snackbar = { id: createId('snackbar'), message: 'Agent 变更已原子应用并生成新版本' }
          })
        },

        generateReport: (type = get().actuals.length ? 'actual' : 'plan') => {
          const now = new Date().toISOString()
          const currentVersion = get().versions.reduce((best, version) => (version.versionNo > best.versionNo ? version : best))
          const report = ReportGenerationSchema.parse({
            id: crypto.randomUUID(),
            tripId: get().trip.tripId,
            versionId: currentVersion.id,
            expenseSnapshotId: crypto.randomUUID(),
            actualSnapshotId: crypto.randomUUID(),
            type,
            status: 'ready',
            config: { showSources: true, showExactDates: type === 'actual', generationNo: get().reports.length + 1 },
            configHash: stableHash({ type, reports: get().reports.length + 1 }),
            outputKey: `demo/reports/${type}-${get().reports.length + 1}.html`,
            createdAt: now,
            updatedAt: now,
          })
          mutate((state) => {
            state.reports.push(report)
            state.reportSnapshots[report.id] = {
              trip: cloneJson(currentVersion.snapshot),
              derived: cloneJson(currentVersion.derivedSnapshot),
              expenses: cloneJson(state.expenses),
              actuals: cloneJson(state.actuals),
              frozenAt: now,
            }
            state.snackbar = { id: createId('snackbar'), message: `${type === 'actual' ? '实际' : '计划'}报告已生成` }
          })
          return report
        },

        createTripPublication: (config) => {
          const head = currentVersion(get())
          const existing = get().publications.find(
            (item) => item.targetKind === 'version' && item.versionId === head.id && !item.revokedAt,
          )
          if (existing) return existing
          const publication: LocalPublication = {
            id: crypto.randomUUID(),
            token: publicationToken(),
            targetKind: 'version',
            versionId: head.id,
            reportId: null,
            disclosureConfig: config,
            createdAt: new Date().toISOString(),
            revokedAt: null,
          }
          mutate((state) => {
            state.publications.unshift(publication)
            state.snackbar = { id: createId('snackbar'), message: `已创建 v${head.versionNo} 固定分享` }
          })
          return publication
        },

        createReportPublication: (reportId, config) => {
          const report = get().reports.find((item) => item.id === reportId && item.status === 'ready')
          if (!report) return null
          const existing = get().publications.find(
            (item) => item.targetKind === 'report' && item.reportId === reportId && !item.revokedAt,
          )
          if (existing) return existing
          const publication: LocalPublication = {
            id: crypto.randomUUID(),
            token: publicationToken(),
            targetKind: 'report',
            versionId: null,
            reportId,
            disclosureConfig: config,
            createdAt: new Date().toISOString(),
            revokedAt: null,
          }
          mutate((state) => {
            state.publications.unshift(publication)
            state.snackbar = { id: createId('snackbar'), message: '已创建固定报告分享' }
          })
          return publication
        },

        revokePublication: (publicationId) => {
          const revokedAt = new Date().toISOString()
          mutate((state) => {
            const publication = state.publications.find((item) => item.id === publicationId)
            if (!publication || publication.revokedAt) return
            publication.revokedAt = revokedAt
            state.snackbar = { id: createId('snackbar'), message: '分享已撤销，原链接立即失效' }
          })
        },

        setProductionSync: (patch) => {
          mutate((state) => {
            Object.assign(state.productionSync, patch)
          })
        },

        hydrateProduction: (payload) => {
          const snapshot = TripSnapshotSchema.parse(payload.snapshot)
          mutate((state) => {
            state.trip = cloneJson(snapshot)
            state.trips = [cloneJson(snapshot)]
            state.derived = cloneJson(payload.derived)
            state.versions = cloneJson(payload.versions)
            state.selectedDayId = snapshot.days[0].id
            state.selectedStopId = null
            state.dirty = false
            state.revision += 1
            state.saveStatus = 'saved'
            state.pendingAction = null
            state.undoStack = []
            state.productionPublishQueue = []
            state.productionSync = {
              mode: 'production',
              hydrated: true,
              draftRevision: payload.draftRevision,
              currentVersionId: payload.currentVersionId,
              error: null,
            }
          })
        },

        acknowledgeProductionDraft: (draftRevision, localRevision) => {
          mutate((state) => {
            state.productionSync.draftRevision = draftRevision
            state.productionSync.error = null
            if (state.revision === localRevision && state.productionPublishQueue.length === 0) {
              state.saveStatus = 'saved'
            }
          })
        },

        completeProductionPublish: (requestId, version, draftRevision) => {
          const validated = TripVersionSchema.parse(version)
          mutate((state) => {
            const request = state.productionPublishQueue.find((item) => item.id === requestId)
            if (!request) return
            const optimisticId = request.optimisticVersionId
            const versionIndex = state.versions.findIndex((item) => item.id === optimisticId)
            if (versionIndex >= 0) state.versions[versionIndex] = cloneJson(validated)
            else state.versions.push(cloneJson(validated))
            state.versions.forEach((item) => {
              if (item.parentVersionId === optimisticId) item.parentVersionId = validated.id
            })
            state.productionPublishQueue = state.productionPublishQueue.filter((item) => item.id !== requestId)
            state.productionSync.currentVersionId = validated.id
            state.productionSync.draftRevision = draftRevision
            state.productionSync.error = null
            if (state.revision === request.localRevision) {
              state.dirty = false
              state.saveStatus = 'saved'
            }
            state.snackbar = { id: createId('snackbar'), message: `已发布 v${validated.versionNo}` }
          })
        },

        failProductionOperation: (message, requestId) => {
          mutate((state) => {
            if (requestId) {
              const request = state.productionPublishQueue.find((item) => item.id === requestId)
              if (request) {
                state.versions = state.versions.filter((item) => item.id !== request.optimisticVersionId)
                state.productionPublishQueue = state.productionPublishQueue.filter((item) => item.id !== requestId)
              }
            }
            state.productionSync.mode = 'error'
            state.productionSync.error = message
            state.saveStatus = 'failed'
            state.dirty = true
            state.snackbar = { id: createId('snackbar'), message: `同步失败：${message}`, actionLabel: '重试' }
          })
        },

        resetDemo: () => {
          const fresh = cloneDemo()
          mutate((state) => {
            state.trip = fresh.trip
            state.trips = [fresh.trip]
            state.derived = fresh.derived
            state.versions = fresh.versions
            state.expenses = fresh.expenses
            state.actuals = fresh.actuals
            state.reports = fresh.reports
            state.reportSnapshots = fresh.reportSnapshots
            state.publications = fresh.publications
            state.selectedDayId = fresh.trip.days[0].id
            state.selectedStopId = null
            state.dirty = false
            state.revision = 1
            state.saveStatus = 'saved'
            state.pendingAction = null
            state.snackbar = null
            state.changeSetPreview = null
            state.acceptedChangeSetGroups = DEMO_CHANGESET.proposalGroups.map((group) => group.groupId)
            state.unassignedStops = []
            state.undoStack = []
            state.productionSync = {
              mode: 'demo',
              hydrated: false,
              draftRevision: null,
              currentVersionId: null,
              error: null,
            }
            state.productionPublishQueue = []
          })
        },
      }
    }),
    {
      name: 'jovlo-mvp-state-v1',
      version: 1,
      partialize: (state) => ({
        trip: state.trip,
        trips: state.trips,
        derived: state.derived,
        versions: state.versions,
        expenses: state.expenses,
        actuals: state.actuals,
        reports: state.reports,
        reportSnapshots: state.reportSnapshots,
        publications: state.publications,
        candidates: state.candidates,
        selectedDayId: state.selectedDayId,
        selectedStopId: state.selectedStopId,
        mobileView: state.mobileView,
        saveStatus: state.saveStatus,
        dirty: state.dirty,
        revision: state.revision,
        acceptedChangeSetGroups: state.acceptedChangeSetGroups,
        unassignedStops: state.unassignedStops,
      }),
    },
  ),
)

export function currentVersion(state: Pick<TripStore, 'versions'>): TripVersion {
  return state.versions.reduce((best, version) => (version.versionNo > best.versionNo ? version : best))
}

export function selectedDay(state: Pick<TripStore, 'trip' | 'selectedDayId'>) {
  return state.trip.days.find((day) => day.id === state.selectedDayId) ?? state.trip.days[0]
}

export function currentSemanticDiff(state: Pick<TripStore, 'trip' | 'versions'>) {
  const head = currentVersion(state)
  return semanticDiff(head.snapshot, state.trip)
}
