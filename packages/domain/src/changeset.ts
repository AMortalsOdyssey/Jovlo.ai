import { calculateBudget } from './budget'
import { cloneJson, stableUuid } from './canonical'
import { semanticDiff, type SemanticDiff, type SemanticHotelChange } from './diff'
import { calculateSchedule } from './planning'
import {
  TripChangeSetSchema,
  TripSnapshotSchema,
  TripSourceSnapshotSchema,
  type DomainOperation,
  type RouteLeg,
  type TripChangeSet,
  type TripSnapshot,
  type Warning,
} from './schemas'
import { validateTripSnapshot } from './validation'

export type UnresolvedReference = {
  kind: 'place_proposal' | 'source' | 'entity' | 'stale_base'
  ref: string
  groupId?: string
  operationIndex?: number
  message: string
}

export type ProposalPreview = {
  groupId: string
  title: string
  atomic: boolean
  selected: boolean
  status: 'applied' | 'conflict' | 'unselected'
  conflicts: string[]
}

export type ChangeSetPreview = {
  changeSetId: string
  baseVersionId: string
  basedOnCurrentHead: boolean
  canApply: boolean
  counts: { added: number; changed: number; removed: number; conflicts: number }
  affectedDays: string[]
  impact: {
    distanceDeltaMeters?: number
    durationDeltaSeconds?: number
    budgetDelta?: { low: number; expected: number; high: number }
    hotelChanges: SemanticHotelChange[]
    scheduleWarnings: Warning[]
  }
  proposalGroups: ProposalPreview[]
  unresolvedReferences: UnresolvedReference[]
  diff: SemanticDiff
  candidateSnapshot: TripSnapshot
}

export type PreviewChangeSetOptions = {
  selectedGroupIds?: readonly string[]
  currentVersionId?: string
  proposalResolutions?: Readonly<Record<string, string>>
  sourceResolutions?: Readonly<Record<string, string>>
  routeLegsBefore?: readonly RouteLeg[]
  routeLegsAfter?: readonly RouteLeg[]
}

class DomainOperationError extends Error {
  readonly kind: UnresolvedReference['kind']
  readonly ref: string

  constructor(message: string, kind: UnresolvedReference['kind'], ref: string) {
    super(message)
    this.name = 'DomainOperationError'
    this.kind = kind
    this.ref = ref
  }
}

function findStop(snapshot: TripSnapshot, stopId: string) {
  for (let dayIndex = 0; dayIndex < snapshot.days.length; dayIndex += 1) {
    const stopIndex = snapshot.days[dayIndex].stops.findIndex((stop) => stop.id === stopId)
    if (stopIndex >= 0) return { dayIndex, stopIndex, stop: snapshot.days[dayIndex].stops[stopIndex] }
  }
  throw new DomainOperationError(`Stop ${stopId} does not exist`, 'entity', stopId)
}

function findDayIndex(snapshot: TripSnapshot, dayId: string): number {
  const dayIndex = snapshot.days.findIndex((day) => day.id === dayId)
  if (dayIndex < 0) throw new DomainOperationError(`Day ${dayId} does not exist`, 'entity', dayId)
  return dayIndex
}

function resolveSource(
  snapshot: TripSnapshot,
  sourceRef: string,
  options: PreviewChangeSetOptions,
): string {
  if (snapshot.sourceRefs[sourceRef]) return sourceRef
  const sourceId = options.sourceResolutions?.[sourceRef]
  if (sourceId && snapshot.sourceRefs[sourceId]) return sourceId
  throw new DomainOperationError(`Source ${sourceRef} is unresolved`, 'source', sourceRef)
}

function operationSourceRefs(operation: DomainOperation): string[] {
  switch (operation.type) {
    case 'ADD_STOP':
    case 'UPSERT_PLACE_CLAIM':
    case 'PROPOSE_PLACE':
      return operation.sourceRefs
    case 'LINK_SOURCE':
      return [operation.sourceRef]
    default:
      return []
  }
}

function materializeGroupSources(
  snapshot: TripSnapshot,
  changeSet: TripChangeSet,
  operations: readonly DomainOperation[],
  sourceResolutions: Record<string, string>,
): void {
  const sourcesByRef = new Map(changeSet.sources.map((source) => [source.sourceRef, source]))
  const sourceRefs = new Set(operations.flatMap(operationSourceRefs))
  for (const sourceRef of sourceRefs) {
    if (snapshot.sourceRefs[sourceRef]) {
      sourceResolutions[sourceRef] = sourceRef
      continue
    }
    const source = sourcesByRef.get(sourceRef)
    if (!source) continue
    const sourceId =
      sourceResolutions[sourceRef] ?? stableUuid({ changeSetId: changeSet.changeSetId, sourceRef })
    sourceResolutions[sourceRef] = sourceId
    if (!snapshot.sourceRefs[sourceId]) {
      snapshot.sourceRefs[sourceId] = TripSourceSnapshotSchema.parse({
        sourceId,
        platform: source.platform,
        url: source.url,
        title: source.title,
        author: source.author,
        publishedAt: source.publishedAt,
        summary: source.summary,
        commercialRelationship: source.commercialRelationship,
      })
    }
  }
}

function resolvePlace(
  snapshot: TripSnapshot,
  operation: Extract<DomainOperation, { type: 'ADD_STOP' }>,
  options: PreviewChangeSetOptions,
): string {
  if (operation.placeId) return operation.placeId
  const proposalRef = operation.proposalRef as string
  const placeId = options.proposalResolutions?.[proposalRef]
  if (!placeId) {
    throw new DomainOperationError(
      `Place proposal ${proposalRef} must be resolved before apply`,
      'place_proposal',
      proposalRef,
    )
  }
  return placeId
}

function assertHainanCoordinate(operation: Extract<DomainOperation, { type: 'PROPOSE_PLACE' }>) {
  if (!operation.coordinate) return
  const { lon, lat } = operation.coordinate
  if (lon < 108.4 || lon > 111.4 || lat < 18 || lat > 20.4) {
    throw new DomainOperationError(
      `Place proposal ${operation.proposalRef} is outside the Hainan boundary`,
      'place_proposal',
      operation.proposalRef,
    )
  }
}

function applyOperation(
  snapshot: TripSnapshot,
  operation: DomainOperation,
  options: PreviewChangeSetOptions,
): void {
  switch (operation.type) {
    case 'ADD_STOP': {
      try {
        findStop(snapshot, operation.newStopId)
        throw new DomainOperationError(
          `Stop ${operation.newStopId} already exists`,
          'entity',
          operation.newStopId,
        )
      } catch (error) {
        if (error instanceof DomainOperationError && error.message.includes('does not exist')) {
          // Expected: a new stable ID must not already exist.
        } else {
          throw error
        }
      }
      const dayIndex = findDayIndex(snapshot, operation.dayId)
      const placeId = resolvePlace(snapshot, operation, options)
      if (!snapshot.placeRefs[placeId]) {
        throw new DomainOperationError(`Place ${placeId} does not exist`, 'entity', placeId)
      }
      const sourceIds = operation.sourceRefs.map((sourceRef) =>
        resolveSource(snapshot, sourceRef, options),
      )
      const insertionIndex = operation.afterStopId
        ? snapshot.days[dayIndex].stops.findIndex((stop) => stop.id === operation.afterStopId) + 1
        : 0
      if (operation.afterStopId && insertionIndex === 0) {
        throw new DomainOperationError(
          `afterStopId ${operation.afterStopId} is not in target day`,
          'entity',
          operation.afterStopId,
        )
      }
      snapshot.days[dayIndex].stops.splice(insertionIndex, 0, {
        id: operation.newStopId,
        placeId,
        kind: operation.kind,
        stayMinutes: operation.stayMinutes,
        locked: false,
        sourceIds,
      })
      return
    }
    case 'REMOVE_STOP': {
      const location = findStop(snapshot, operation.stopId)
      if (location.stop.locked) {
        throw new DomainOperationError(
          `Locked stop ${operation.stopId} cannot be removed`,
          'entity',
          operation.stopId,
        )
      }
      if (snapshot.intent.mustPlaceIds.includes(location.stop.placeId)) {
        throw new DomainOperationError(
          `Required place ${location.stop.placeId} cannot be removed`,
          'entity',
          location.stop.placeId,
        )
      }
      snapshot.days[location.dayIndex].stops.splice(location.stopIndex, 1)
      return
    }
    case 'MOVE_STOP': {
      const location = findStop(snapshot, operation.stopId)
      if (location.stop.locked) {
        throw new DomainOperationError(
          `Locked stop ${operation.stopId} cannot be moved`,
          'entity',
          operation.stopId,
        )
      }
      if (operation.afterStopId === operation.stopId) {
        throw new DomainOperationError(
          'A stop cannot be moved after itself',
          'entity',
          operation.stopId,
        )
      }
      const targetDayIndex = findDayIndex(snapshot, operation.targetDayId)
      const [moving] = snapshot.days[location.dayIndex].stops.splice(location.stopIndex, 1)
      const insertionIndex = operation.afterStopId
        ? snapshot.days[targetDayIndex].stops.findIndex((stop) => stop.id === operation.afterStopId) + 1
        : 0
      if (operation.afterStopId && insertionIndex === 0) {
        throw new DomainOperationError(
          `afterStopId ${operation.afterStopId} is not in target day`,
          'entity',
          operation.afterStopId,
        )
      }
      snapshot.days[targetDayIndex].stops.splice(insertionIndex, 0, moving)
      return
    }
    case 'UPDATE_STOP': {
      const { stop } = findStop(snapshot, operation.stopId)
      if (operation.patch.stayMinutes !== undefined) stop.stayMinutes = operation.patch.stayMinutes
      if (operation.patch.plannedStart === null) delete stop.plannedStart
      else if (operation.patch.plannedStart !== undefined)
        stop.plannedStart = operation.patch.plannedStart
      if (operation.patch.publicNote === null) delete stop.publicNote
      else if (operation.patch.publicNote !== undefined) stop.publicNote = operation.patch.publicNote
      return
    }
    case 'SET_HOTEL': {
      const dayIndex = findDayIndex(snapshot, operation.nightAfterDayId)
      if (dayIndex === snapshot.days.length - 1) {
        throw new DomainOperationError(
          'The final day has no required overnight anchor',
          'entity',
          operation.nightAfterDayId,
        )
      }
      if (
        operation.anchor.kind === 'place' &&
        !snapshot.placeRefs[operation.anchor.placeId]
      ) {
        throw new DomainOperationError(
          `Hotel place ${operation.anchor.placeId} does not exist`,
          'entity',
          operation.anchor.placeId,
        )
      }
      if (
        operation.anchor.kind === 'area' &&
        !snapshot.stayAreaRefs[operation.anchor.areaId]
      ) {
        throw new DomainOperationError(
          `Hotel area ${operation.anchor.areaId} does not exist`,
          'entity',
          operation.anchor.areaId,
        )
      }
      snapshot.days[dayIndex].overnightStay = cloneJson(operation.anchor)
      return
    }
    case 'UPDATE_TRIP_SETTING': {
      switch (operation.path) {
        case 'pace':
          snapshot.intent.pace = operation.value as TripSnapshot['intent']['pace']
          return
        case 'maxDriveMinutesPerDay':
          snapshot.intent.maxDriveMinutesPerDay = operation.value as number
          return
        case 'mustPlaceIds':
          snapshot.intent.mustPlaceIds = operation.value as string[]
          return
        case 'avoidTags':
          snapshot.intent.avoidTags = operation.value as string[]
          return
      }
      return
    }
    case 'UPDATE_BUDGET_ASSUMPTION': {
      switch (operation.field) {
        case 'fuelLitersPer100Km':
        case 'electricityKwhPer100Km':
          snapshot.budgetAssumptions[operation.field] = operation.value as number
          return
        case 'mealPerPersonPerDay':
        case 'fuelPricePerLiter':
        case 'electricityPricePerKwh':
        case 'rentalCarPerDay':
        case 'insurancePerDay':
        case 'parkingAndTollsPerDay':
          snapshot.budgetAssumptions[operation.field] = operation.value as never
          return
        case 'contingency':
          snapshot.budgetAssumptions.contingency = operation.value as never
          return
      }
      return
    }
    case 'LINK_SOURCE': {
      const sourceId = resolveSource(snapshot, operation.sourceRef, options)
      if (operation.placeId) {
        const place = snapshot.placeRefs[operation.placeId]
        if (!place) {
          throw new DomainOperationError(
            `Place ${operation.placeId} does not exist`,
            'entity',
            operation.placeId,
          )
        }
        if (!place.sourceIds.includes(sourceId)) place.sourceIds.push(sourceId)
      } else {
        const { stop } = findStop(snapshot, operation.stopId as string)
        if (!stop.sourceIds.includes(sourceId)) stop.sourceIds.push(sourceId)
      }
      return
    }
    case 'UPSERT_PLACE_CLAIM': {
      if (!snapshot.placeRefs[operation.placeId]) {
        throw new DomainOperationError(
          `Place ${operation.placeId} does not exist`,
          'entity',
          operation.placeId,
        )
      }
      operation.sourceRefs.forEach((sourceRef) => resolveSource(snapshot, sourceRef, options))
      return
    }
    case 'PROPOSE_PLACE': {
      assertHainanCoordinate(operation)
      if (!options.proposalResolutions?.[operation.proposalRef]) {
        throw new DomainOperationError(
          `Place proposal ${operation.proposalRef} is unresolved`,
          'place_proposal',
          operation.proposalRef,
        )
      }
      return
    }
  }
}

export function previewChangeSet(
  inputSnapshot: TripSnapshot,
  inputChangeSet: TripChangeSet,
  options: PreviewChangeSetOptions = {},
): ChangeSetPreview {
  const snapshot = validateTripSnapshot(inputSnapshot)
  const changeSet = TripChangeSetSchema.parse(inputChangeSet)
  const selectedGroupIds = new Set(
    options.selectedGroupIds ?? changeSet.proposalGroups.map((group) => group.groupId),
  )
  const unresolvedReferences: UnresolvedReference[] = []
  const proposalGroups: ProposalPreview[] = []
  const sourceResolutions: Record<string, string> = { ...options.sourceResolutions }
  const runtimeOptions: PreviewChangeSetOptions = { ...options, sourceResolutions }
  let candidate = cloneJson(snapshot)
  let basedOnCurrentHead =
    options.currentVersionId === undefined || options.currentVersionId === changeSet.baseVersionId

  if (changeSet.tripId !== snapshot.tripId) {
    basedOnCurrentHead = false
    unresolvedReferences.push({
      kind: 'entity',
      ref: changeSet.tripId,
      message: 'ChangeSet tripId does not match snapshot tripId',
    })
  }
  if (!basedOnCurrentHead) {
    unresolvedReferences.push({
      kind: 'stale_base',
      ref: changeSet.baseVersionId,
      message: 'ChangeSet base version is stale',
    })
  }

  for (const group of changeSet.proposalGroups) {
    if (!selectedGroupIds.has(group.groupId)) {
      proposalGroups.push({
        groupId: group.groupId,
        title: group.title,
        atomic: group.atomic,
        selected: false,
        status: 'unselected',
        conflicts: [],
      })
      continue
    }

    const groupCandidate = cloneJson(candidate)
    materializeGroupSources(groupCandidate, changeSet, group.operations, sourceResolutions)
    const conflicts: string[] = []
    group.operations.forEach((operation, operationIndex) => {
      if (conflicts.length > 0) return
      try {
        applyOperation(groupCandidate, operation, runtimeOptions)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown operation conflict'
        conflicts.push(message)
        if (error instanceof DomainOperationError) {
          unresolvedReferences.push({
            kind: error.kind,
            ref: error.ref,
            groupId: group.groupId,
            operationIndex,
            message,
          })
        }
      }
    })

    if (conflicts.length === 0) {
      const validation = TripSnapshotSchema.safeParse(groupCandidate)
      if (!validation.success) {
        const message = validation.error.issues.map((issue) => issue.message).join('; ')
        conflicts.push(message)
        unresolvedReferences.push({
          kind: 'entity',
          ref: group.groupId,
          groupId: group.groupId,
          message,
        })
      } else {
        candidate = validation.data
      }
    }

    proposalGroups.push({
      groupId: group.groupId,
      title: group.title,
      atomic: group.atomic,
      selected: true,
      status: conflicts.length > 0 ? 'conflict' : 'applied',
      conflicts,
    })
  }

  const routeLegsBefore = options.routeLegsBefore ?? []
  const routeLegsAfter = options.routeLegsAfter ?? routeLegsBefore
  const beforeBudget = calculateBudget(snapshot, routeLegsBefore, changeSet.createdAt)
  const afterBudget = calculateBudget(candidate, routeLegsAfter, changeSet.createdAt)
  const diff = semanticDiff(snapshot, candidate)
  const conflicts = proposalGroups.filter((group) => group.status === 'conflict').length +
    (basedOnCurrentHead ? 0 : 1)
  diff.counts.conflicts = conflicts
  const scheduleWarnings =
    routeLegsAfter.length > 0
      ? calculateSchedule(candidate, routeLegsAfter).flatMap((schedule) => schedule.warnings)
      : []
  const distanceBefore = routeLegsBefore.reduce((total, leg) => total + leg.distanceMeters, 0)
  const distanceAfter = routeLegsAfter.reduce((total, leg) => total + leg.distanceMeters, 0)
  const durationBefore = routeLegsBefore.reduce((total, leg) => total + leg.durationSeconds, 0)
  const durationAfter = routeLegsAfter.reduce((total, leg) => total + leg.durationSeconds, 0)

  return {
    changeSetId: changeSet.changeSetId,
    baseVersionId: changeSet.baseVersionId,
    basedOnCurrentHead,
    canApply: basedOnCurrentHead && conflicts === 0 && unresolvedReferences.length === 0,
    counts: diff.counts,
    affectedDays: diff.affectedDays,
    impact: {
      distanceDeltaMeters: distanceAfter - distanceBefore,
      durationDeltaSeconds: durationAfter - durationBefore,
      budgetDelta: {
        low: afterBudget.total.low - beforeBudget.total.low,
        expected: afterBudget.total.expected - beforeBudget.total.expected,
        high: afterBudget.total.high - beforeBudget.total.high,
      },
      hotelChanges: diff.hotelChanges,
      scheduleWarnings,
    },
    proposalGroups,
    unresolvedReferences,
    diff,
    candidateSnapshot: candidate,
  }
}

export function applyChangeSetToSnapshot(
  snapshot: TripSnapshot,
  changeSet: TripChangeSet,
  options: PreviewChangeSetOptions = {},
): TripSnapshot {
  const preview = previewChangeSet(snapshot, changeSet, options)
  if (!preview.canApply) {
    const reasons = [
      ...preview.unresolvedReferences.map((reference) => reference.message),
      ...preview.proposalGroups.flatMap((group) => group.conflicts),
    ]
    throw new Error(`ChangeSet cannot be applied: ${[...new Set(reasons)].join('; ')}`)
  }
  return cloneJson(preview.candidateSnapshot)
}
