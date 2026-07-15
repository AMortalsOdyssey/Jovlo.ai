import { z } from 'zod'

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
)

export const UuidSchema = z.string().uuid()
export const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const DateTimeSchema = z.string().datetime({ offset: true })
export const TimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a 24-hour HH:mm time')

export const CoordinateSchema = z
  .object({
    lon: z.number().finite().min(-180).max(180),
    lat: z.number().finite().min(-90).max(90),
    crs: z.enum(['WGS84', 'GCJ02']),
  })
  .strict()

export const MoneyRangeSchema = z
  .object({
    low: z.number().finite().nonnegative(),
    expected: z.number().finite().nonnegative(),
    high: z.number().finite().nonnegative(),
    currency: z.literal('CNY'),
  })
  .strict()
  .superRefine((range, context) => {
    if (range.low > range.expected || range.expected > range.high) {
      context.addIssue({
        code: 'custom',
        message: 'Money range must satisfy low <= expected <= high',
      })
    }
  })

export type MoneyRange = z.infer<typeof MoneyRangeSchema>

export const StayAnchorSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('place'),
      placeId: UuidSchema,
      label: z.string().trim().min(1).max(120),
      checkInNote: z.string().trim().max(500).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('area'),
      areaId: UuidSchema,
      label: z.string().trim().min(1).max(120),
      checkInNote: z.string().trim().max(500).optional(),
    })
    .strict(),
])

export type StayAnchor = z.infer<typeof StayAnchorSchema>

export const StayAreaSnapshotSchema = z
  .object({
    areaId: UuidSchema,
    name: z.string().trim().min(1).max(120),
    region: z.string().trim().min(1).max(120),
    wgs84: CoordinateSchema.refine((coordinate) => coordinate.crs === 'WGS84'),
    gcj02: CoordinateSchema.refine((coordinate) => coordinate.crs === 'GCJ02'),
    priceReference: MoneyRangeSchema,
    verifiedAt: DateTimeSchema,
    bookingUrl: z.string().url().startsWith('https://').optional(),
  })
  .strict()

export type StayAreaSnapshot = z.infer<typeof StayAreaSnapshotSchema>

export const TripPlaceSnapshotSchema = z
  .object({
    placeId: UuidSchema,
    catalogRevision: z.number().int().positive().optional(),
    name: z.string().trim().min(1).max(160),
    type: z.string().trim().min(1).max(60),
    address: z.string().trim().max(300).optional(),
    wgs84: CoordinateSchema.refine((coordinate) => coordinate.crs === 'WGS84'),
    gcj02: CoordinateSchema.refine((coordinate) => coordinate.crs === 'GCJ02'),
    selectedVariant: z
      .object({
        variantId: UuidSchema.optional(),
        openingHours: JsonValueSchema.optional(),
        priceRange: MoneyRangeSchema.optional(),
        parkingNote: z.string().trim().max(500).optional(),
      })
      .strict()
      .optional(),
    sourceIds: z.array(UuidSchema).max(50),
    verifiedAt: DateTimeSchema.optional(),
  })
  .strict()

export type TripPlaceSnapshot = z.infer<typeof TripPlaceSnapshotSchema>

export const TripSourceSnapshotSchema = z
  .object({
    sourceId: UuidSchema,
    platform: z.string().trim().min(1).max(60),
    url: z.string().url().startsWith('https://').max(2_048),
    title: z.string().trim().min(1).max(300),
    author: z.string().trim().max(160).optional(),
    publishedAt: DateSchema.optional(),
    summary: z.string().trim().min(1).max(1_200),
    commercialRelationship: z.enum(['yes', 'no', 'unknown']).optional(),
  })
  .strict()

export type TripSourceSnapshot = z.infer<typeof TripSourceSnapshotSchema>

export const BudgetAssumptionsSchema = z
  .object({
    currency: z.literal('CNY'),
    lodgingDefaultPerNight: MoneyRangeSchema,
    lodgingByArea: z.record(UuidSchema, MoneyRangeSchema),
    mealPerPersonPerDay: MoneyRangeSchema,
    fuelLitersPer100Km: z.number().finite().positive().max(50),
    electricityKwhPer100Km: z.number().finite().positive().max(100),
    fuelPricePerLiter: MoneyRangeSchema,
    electricityPricePerKwh: MoneyRangeSchema,
    rentalCarPerDay: MoneyRangeSchema,
    insurancePerDay: MoneyRangeSchema,
    parkingAndTollsPerDay: MoneyRangeSchema,
    ticketByPlaceId: z.record(UuidSchema, MoneyRangeSchema),
    specialMealByStopId: z.record(UuidSchema, MoneyRangeSchema),
    contingency: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('fixed'), amount: MoneyRangeSchema }).strict(),
      z
        .object({
          kind: z.literal('percentage'),
          rate: z.number().finite().min(0).max(1),
        })
        .strict(),
    ]),
    verifiedAt: DateTimeSchema,
  })
  .strict()

export type BudgetAssumptions = z.infer<typeof BudgetAssumptionsSchema>

export const TripStopSchema = z
  .object({
    id: UuidSchema,
    placeId: UuidSchema,
    kind: z.enum(['attraction', 'meal', 'activity', 'custom']),
    plannedStart: TimeSchema.optional(),
    stayMinutes: z.number().int().min(5).max(720),
    locked: z.boolean(),
    publicNote: z.string().trim().max(1_000).optional(),
    privateNote: z.string().trim().max(1_000).optional(),
    sourceIds: z.array(UuidSchema).max(50),
  })
  .strict()

export type TripStop = z.infer<typeof TripStopSchema>

export const TripDaySchema = z
  .object({
    id: UuidSchema,
    dayIndex: z.number().int().positive().max(30),
    date: DateSchema.optional(),
    startTime: TimeSchema,
    overnightStay: StayAnchorSchema.optional(),
    stops: z.array(TripStopSchema).max(20),
    override: z
      .object({
        reason: z.string().trim().min(1).max(500),
        acceptedWarnings: z.array(z.string().trim().min(1).max(120)).max(30),
      })
      .strict()
      .optional(),
  })
  .strict()

export type TripDay = z.infer<typeof TripDaySchema>

export const TripSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    tripId: UuidSchema,
    title: z.string().trim().min(1).max(160),
    timezone: z.literal('Asia/Shanghai'),
    intent: z
      .object({
        startDate: DateSchema.optional(),
        days: z.number().int().min(1).max(30),
        entryAnchor: z
          .object({ placeId: UuidSchema, label: z.string().trim().min(1).max(120) })
          .strict(),
        exitAnchor: z
          .object({ placeId: UuidSchema, label: z.string().trim().min(1).max(120) })
          .strict(),
        partySize: z.number().int().min(1).max(50),
        vehicle: z
          .object({
            type: z.enum(['fuel', 'ev', 'hybrid']),
            consumption: z.number().finite().positive().max(100).optional(),
          })
          .strict(),
        pace: z.enum(['relaxed', 'balanced', 'packed']),
        maxDriveMinutesPerDay: z.number().int().min(30).max(1_440),
        dayEndLimit: TimeSchema,
        totalBudget: z.number().finite().positive().optional(),
        mustPlaceIds: z.array(UuidSchema).max(50),
        avoidTags: z.array(z.string().trim().min(1).max(60)).max(50),
      })
      .strict(),
    placeRefs: z.record(UuidSchema, TripPlaceSnapshotSchema),
    sourceRefs: z.record(UuidSchema, TripSourceSnapshotSchema),
    stayAreaRefs: z.record(UuidSchema, StayAreaSnapshotSchema),
    days: z.array(TripDaySchema).min(1).max(30),
    budgetAssumptions: BudgetAssumptionsSchema,
    userNotes: z.string().trim().max(4_000).optional(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.intent.days !== snapshot.days.length) {
      context.addIssue({
        code: 'custom',
        path: ['intent', 'days'],
        message: 'intent.days must equal days.length',
      })
    }

    const placeIds = new Set(Object.keys(snapshot.placeRefs))
    const sourceIds = new Set(Object.keys(snapshot.sourceRefs))
    const areaIds = new Set(Object.keys(snapshot.stayAreaRefs))

    for (const [key, place] of Object.entries(snapshot.placeRefs)) {
      if (key !== place.placeId) {
        context.addIssue({
          code: 'custom',
          path: ['placeRefs', key, 'placeId'],
          message: 'placeRefs key must match placeId',
        })
      }
      for (const sourceId of place.sourceIds) {
        if (!sourceIds.has(sourceId)) {
          context.addIssue({
            code: 'custom',
            path: ['placeRefs', key, 'sourceIds'],
            message: `Unknown source ${sourceId}`,
          })
        }
      }
    }

    for (const [key, source] of Object.entries(snapshot.sourceRefs)) {
      if (key !== source.sourceId) {
        context.addIssue({
          code: 'custom',
          path: ['sourceRefs', key, 'sourceId'],
          message: 'sourceRefs key must match sourceId',
        })
      }
    }

    for (const [key, area] of Object.entries(snapshot.stayAreaRefs)) {
      if (key !== area.areaId) {
        context.addIssue({
          code: 'custom',
          path: ['stayAreaRefs', key, 'areaId'],
          message: 'stayAreaRefs key must match areaId',
        })
      }
    }

    for (const [name, placeId] of [
      ['entryAnchor', snapshot.intent.entryAnchor.placeId],
      ['exitAnchor', snapshot.intent.exitAnchor.placeId],
    ] as const) {
      if (!placeIds.has(placeId)) {
        context.addIssue({
          code: 'custom',
          path: ['intent', name, 'placeId'],
          message: `${name} must reference placeRefs`,
        })
      }
    }

    const seenDayIds = new Set<string>()
    const seenStopIds = new Set<string>()
    const scheduledPlaceIds = new Set<string>([
      snapshot.intent.entryAnchor.placeId,
      snapshot.intent.exitAnchor.placeId,
    ])

    snapshot.days.forEach((day, dayPosition) => {
      if (day.dayIndex !== dayPosition + 1) {
        context.addIssue({
          code: 'custom',
          path: ['days', dayPosition, 'dayIndex'],
          message: 'dayIndex must be unique and contiguous from 1',
        })
      }
      if (seenDayIds.has(day.id)) {
        context.addIssue({
          code: 'custom',
          path: ['days', dayPosition, 'id'],
          message: 'TripDay.id must be unique',
        })
      }
      seenDayIds.add(day.id)

      if (dayPosition < snapshot.days.length - 1 && !day.overnightStay) {
        context.addIssue({
          code: 'custom',
          path: ['days', dayPosition, 'overnightStay'],
          message: 'Every overnight day requires a place or area stay anchor',
        })
      }

      if (day.overnightStay?.kind === 'place') {
        if (!placeIds.has(day.overnightStay.placeId)) {
          context.addIssue({
            code: 'custom',
            path: ['days', dayPosition, 'overnightStay', 'placeId'],
            message: 'Stay place must reference placeRefs',
          })
        }
        scheduledPlaceIds.add(day.overnightStay.placeId)
      }
      if (day.overnightStay?.kind === 'area' && !areaIds.has(day.overnightStay.areaId)) {
        context.addIssue({
          code: 'custom',
          path: ['days', dayPosition, 'overnightStay', 'areaId'],
          message: 'Stay area must reference stayAreaRefs',
        })
      }

      day.stops.forEach((stop, stopPosition) => {
        if (seenStopIds.has(stop.id)) {
          context.addIssue({
            code: 'custom',
            path: ['days', dayPosition, 'stops', stopPosition, 'id'],
            message: 'TripStop.id must be unique across the trip',
          })
        }
        seenStopIds.add(stop.id)
        scheduledPlaceIds.add(stop.placeId)
        if (!placeIds.has(stop.placeId)) {
          context.addIssue({
            code: 'custom',
            path: ['days', dayPosition, 'stops', stopPosition, 'placeId'],
            message: 'Stop place must reference placeRefs',
          })
        }
        for (const sourceId of stop.sourceIds) {
          if (!sourceIds.has(sourceId)) {
            context.addIssue({
              code: 'custom',
              path: ['days', dayPosition, 'stops', stopPosition, 'sourceIds'],
              message: `Unknown source ${sourceId}`,
            })
          }
        }
      })
    })

    for (const mustPlaceId of snapshot.intent.mustPlaceIds) {
      if (!scheduledPlaceIds.has(mustPlaceId)) {
        context.addIssue({
          code: 'custom',
          path: ['intent', 'mustPlaceIds'],
          message: `Required place ${mustPlaceId} is not scheduled`,
        })
      }
    }
  })

export type TripSnapshot = z.infer<typeof TripSnapshotSchema>
export type TripSnapshotV1 = TripSnapshot

export const RouteEndpointSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('place'), placeId: UuidSchema }).strict(),
  z.object({ kind: z.literal('area'), areaId: UuidSchema }).strict(),
])

export type RouteEndpoint = z.infer<typeof RouteEndpointSchema>

export const RouteLegSchema = z
  .object({
    id: UuidSchema,
    dayId: UuidSchema,
    provider: z.enum(['amap', 'reference']),
    from: RouteEndpointSchema,
    to: RouteEndpointSchema,
    distanceMeters: z.number().int().nonnegative(),
    durationSeconds: z.number().int().nonnegative(),
    tollsCny: z.number().finite().nonnegative().optional(),
    trafficLights: z.number().int().nonnegative().optional(),
    polyline: z.array(CoordinateSchema).max(10_000).optional(),
    strategy: z.string().trim().min(1).max(80),
    calculatedAt: DateTimeSchema,
    status: z.enum(['fresh', 'stale', 'failed']),
    estimateKind: z.enum(['road', 'reference', 'area-reference']),
  })
  .strict()

export type RouteLeg = z.infer<typeof RouteLegSchema>

export const WarningSchema = z
  .object({
    code: z.string().trim().min(1).max(80),
    severity: z.enum(['info', 'warning', 'blocking']),
    message: z.string().trim().min(1).max(500),
    dayId: UuidSchema,
    stopId: UuidSchema.optional(),
  })
  .strict()

export type Warning = z.infer<typeof WarningSchema>

export const ScheduledStopSchema = z
  .object({
    stopId: UuidSchema,
    arrivalMinute: z.number().int().nonnegative(),
    departureMinute: z.number().int().nonnegative(),
    arrivalTime: TimeSchema,
    departureTime: TimeSchema,
  })
  .strict()

export const DayScheduleSchema = z
  .object({
    dayId: UuidSchema,
    dayIndex: z.number().int().positive(),
    startTime: TimeSchema,
    expectedEndTime: TimeSchema,
    expectedEndMinute: z.number().int().nonnegative(),
    drivingMinutes: z.number().int().nonnegative(),
    activityMinutes: z.number().int().nonnegative(),
    bufferMinutes: z.number().int().nonnegative(),
    freeMinutes: z.number().int(),
    health: z.enum(['comfortable', 'tight', 'overloaded', 'data_unconfirmed']),
    stops: z.array(ScheduledStopSchema),
    warnings: z.array(WarningSchema),
  })
  .strict()

export type DaySchedule = z.infer<typeof DayScheduleSchema>

export const BudgetCategorySchema = z
  .object({
    category: z.enum([
      'lodging',
      'meals',
      'tickets',
      'energy',
      'rental',
      'insurance',
      'parking_tolls',
      'contingency',
    ]),
    amount: MoneyRangeSchema,
    assumption: z.string().trim().min(1).max(500),
  })
  .strict()

export const BudgetEstimateSchema = z
  .object({
    currency: z.literal('CNY'),
    categories: z.array(BudgetCategorySchema),
    total: MoneyRangeSchema,
    perPerson: MoneyRangeSchema,
    totalDistanceMeters: z.number().int().nonnegative(),
    warnings: z.array(z.string().trim().min(1).max(500)),
    calculatedAt: DateTimeSchema,
  })
  .strict()

export type BudgetEstimate = z.infer<typeof BudgetEstimateSchema>

export const DerivedSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    inputHash: z.string().trim().min(1).max(160),
    routeLegs: z.array(RouteLegSchema),
    daySchedules: z.array(DayScheduleSchema),
    budget: BudgetEstimateSchema,
    calculatedAt: DateTimeSchema,
  })
  .strict()

export type DerivedSnapshot = z.infer<typeof DerivedSnapshotSchema>

export const TripVersionSchema = z
  .object({
    id: UuidSchema,
    tripId: UuidSchema,
    versionNo: z.number().int().positive(),
    parentVersionId: UuidSchema.nullable(),
    source: z.enum(['manual', 'manual_auto', 'agent', 'changeset', 'restore', 'template']),
    message: z.string().trim().min(1).max(500),
    snapshot: TripSnapshotSchema,
    snapshotHash: z.string().trim().min(1).max(160),
    derivedSnapshot: DerivedSnapshotSchema,
    derivedHash: z.string().trim().min(1).max(160),
    createdBy: UuidSchema,
    createdAt: DateTimeSchema,
  })
  .strict()

export type TripVersion = z.infer<typeof TripVersionSchema>

export const ExpenseSchema = z
  .object({
    id: UuidSchema,
    tripId: UuidSchema,
    dayId: UuidSchema.optional(),
    stopId: UuidSchema.optional(),
    category: z.enum([
      'lodging',
      'meals',
      'fuel_charging_tolls',
      'tickets_activities',
      'parking',
      'transport',
      'other',
    ]),
    amount: z.number().finite().positive(),
    currency: z.literal('CNY'),
    occurredOn: DateSchema,
    note: z.string().trim().max(500).optional(),
    receiptAssetKey: z.string().trim().max(500).optional(),
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
  })
  .strict()

export type Expense = z.infer<typeof ExpenseSchema>

export const ActualRecordSchema = z
  .object({
    id: UuidSchema,
    tripId: UuidSchema,
    sourceVersionId: UuidSchema,
    dayId: UuidSchema,
    stopId: UuidSchema.optional(),
    status: z.enum(['visited', 'skipped']),
    rating: z.number().int().min(1).max(5).optional(),
    note: z.string().trim().max(1_000).optional(),
    actualStartAt: DateTimeSchema.optional(),
    actualEndAt: DateTimeSchema.optional(),
    orphaned: z.boolean(),
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
  })
  .strict()

export type ActualRecord = z.infer<typeof ActualRecordSchema>

export const ReportGenerationSchema = z
  .object({
    id: UuidSchema,
    tripId: UuidSchema,
    versionId: UuidSchema,
    expenseSnapshotId: UuidSchema,
    actualSnapshotId: UuidSchema,
    type: z.enum(['plan', 'actual']),
    status: z.enum(['pending', 'ready', 'failed', 'revoked']),
    config: JsonValueSchema,
    configHash: z.string().trim().min(1).max(160),
    outputKey: z.string().trim().max(500).optional(),
    errorCode: z.string().trim().max(120).optional(),
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
  })
  .strict()

export type ReportGeneration = z.infer<typeof ReportGenerationSchema>

export const RouteTemplateSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9-]+$/).min(1).max(80),
    version: z.number().int().positive(),
    name: z.string().trim().min(1).max(160),
    days: z.number().int().min(1).max(30),
    entryPlaceId: UuidSchema,
    exitPlaceId: UuidSchema,
    tags: z.array(z.string().trim().min(1).max(60)).max(30),
    dayAreas: z
      .array(
        z
          .object({
            dayIndex: z.number().int().positive(),
            region: z.string().trim().min(1).max(120),
            overnightAreaId: UuidSchema.optional(),
          })
          .strict(),
      )
      .min(1),
    corridorGeoJson: JsonValueSchema,
    status: z.enum(['draft', 'verified', 'retired']),
    verifiedAt: DateTimeSchema,
  })
  .strict()

export type RouteTemplate = z.infer<typeof RouteTemplateSchema>

const AddStopOperationSchema = z
  .object({
    type: z.literal('ADD_STOP'),
    dayId: UuidSchema,
    newStopId: UuidSchema,
    placeId: UuidSchema.optional(),
    proposalRef: z.string().trim().min(1).max(120).optional(),
    afterStopId: UuidSchema.nullable(),
    stayMinutes: z.number().int().min(5).max(720),
    kind: z.enum(['attraction', 'meal', 'activity', 'custom']),
    sourceRefs: z.array(z.string().trim().min(1).max(120)).max(50),
  })
  .strict()
  .superRefine((operation, context) => {
    if ((operation.placeId ? 1 : 0) + (operation.proposalRef ? 1 : 0) !== 1) {
      context.addIssue({
        code: 'custom',
        message: 'ADD_STOP requires exactly one of placeId or proposalRef',
      })
    }
  })

const RemoveStopOperationSchema = z
  .object({
    type: z.literal('REMOVE_STOP'),
    stopId: UuidSchema,
    reason: z.string().trim().min(1).max(500),
  })
  .strict()

const MoveStopOperationSchema = z
  .object({
    type: z.literal('MOVE_STOP'),
    stopId: UuidSchema,
    targetDayId: UuidSchema,
    afterStopId: UuidSchema.nullable(),
  })
  .strict()

const UpdateStopOperationSchema = z
  .object({
    type: z.literal('UPDATE_STOP'),
    stopId: UuidSchema,
    patch: z
      .object({
        stayMinutes: z.number().int().min(5).max(720).optional(),
        plannedStart: TimeSchema.nullable().optional(),
        publicNote: z.string().trim().max(1_000).nullable().optional(),
      })
      .strict()
      .refine((patch) => Object.keys(patch).length > 0, 'UPDATE_STOP patch cannot be empty'),
  })
  .strict()

const SetHotelOperationSchema = z
  .object({
    type: z.literal('SET_HOTEL'),
    nightAfterDayId: UuidSchema,
    anchor: StayAnchorSchema,
  })
  .strict()

const UpdateTripSettingOperationSchema = z
  .object({
    type: z.literal('UPDATE_TRIP_SETTING'),
    path: z.enum(['pace', 'maxDriveMinutesPerDay', 'mustPlaceIds', 'avoidTags']),
    value: JsonValueSchema,
  })
  .strict()
  .superRefine((operation, context) => {
    const valid =
      (operation.path === 'pace' &&
        ['relaxed', 'balanced', 'packed'].includes(String(operation.value))) ||
      (operation.path === 'maxDriveMinutesPerDay' &&
        typeof operation.value === 'number' &&
        Number.isInteger(operation.value) &&
        operation.value >= 30 &&
        operation.value <= 1_440) ||
      (operation.path === 'mustPlaceIds' &&
        Array.isArray(operation.value) &&
        operation.value.every((value) => UuidSchema.safeParse(value).success)) ||
      (operation.path === 'avoidTags' &&
        Array.isArray(operation.value) &&
        operation.value.every((value) => typeof value === 'string' && value.length > 0))
    if (!valid) {
      context.addIssue({ code: 'custom', path: ['value'], message: 'Value does not match setting' })
    }
  })

const BudgetFieldSchema = z.enum([
  'mealPerPersonPerDay',
  'fuelLitersPer100Km',
  'electricityKwhPer100Km',
  'fuelPricePerLiter',
  'electricityPricePerKwh',
  'rentalCarPerDay',
  'insurancePerDay',
  'parkingAndTollsPerDay',
  'contingency',
])

const UpdateBudgetAssumptionOperationSchema = z
  .object({
    type: z.literal('UPDATE_BUDGET_ASSUMPTION'),
    field: BudgetFieldSchema,
    value: JsonValueSchema,
  })
  .strict()
  .superRefine((operation, context) => {
    const numericFields = new Set(['fuelLitersPer100Km', 'electricityKwhPer100Km'])
    const rangeFields = new Set([
      'mealPerPersonPerDay',
      'fuelPricePerLiter',
      'electricityPricePerKwh',
      'rentalCarPerDay',
      'insurancePerDay',
      'parkingAndTollsPerDay',
    ])
    let valid = false
    if (numericFields.has(operation.field)) {
      valid = typeof operation.value === 'number' && operation.value > 0
    } else if (rangeFields.has(operation.field)) {
      valid = MoneyRangeSchema.safeParse(operation.value).success
    } else {
      valid = z
        .discriminatedUnion('kind', [
          z.object({ kind: z.literal('fixed'), amount: MoneyRangeSchema }).strict(),
          z.object({ kind: z.literal('percentage'), rate: z.number().min(0).max(1) }).strict(),
        ])
        .safeParse(operation.value).success
    }
    if (!valid) {
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Value does not match budget assumption field',
      })
    }
  })

const LinkSourceOperationSchema = z
  .object({
    type: z.literal('LINK_SOURCE'),
    sourceRef: z.string().trim().min(1).max(120),
    placeId: UuidSchema.optional(),
    stopId: UuidSchema.optional(),
    fields: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  })
  .strict()
  .superRefine((operation, context) => {
    if ((operation.placeId ? 1 : 0) + (operation.stopId ? 1 : 0) !== 1) {
      context.addIssue({
        code: 'custom',
        message: 'LINK_SOURCE requires exactly one of placeId or stopId',
      })
    }
  })

const UpsertPlaceClaimOperationSchema = z
  .object({
    type: z.literal('UPSERT_PLACE_CLAIM'),
    placeId: UuidSchema,
    field: z.enum([
      'opening_hours',
      'price_range',
      'parking',
      'taste',
      'road_condition',
      'suitable_for',
    ]),
    value: JsonValueSchema,
    sourceRefs: z.array(z.string().trim().min(1).max(120)).min(1).max(50),
  })
  .strict()

const ProposePlaceOperationSchema = z
  .object({
    type: z.literal('PROPOSE_PLACE'),
    proposalRef: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(160),
    address: z.string().trim().max(300).optional(),
    sourceRefs: z.array(z.string().trim().min(1).max(120)).min(1).max(50),
    coordinate: CoordinateSchema.optional(),
  })
  .strict()

export const DomainOperationSchema = z.discriminatedUnion('type', [
  AddStopOperationSchema,
  RemoveStopOperationSchema,
  MoveStopOperationSchema,
  UpdateStopOperationSchema,
  SetHotelOperationSchema,
  UpdateTripSettingOperationSchema,
  UpdateBudgetAssumptionOperationSchema,
  LinkSourceOperationSchema,
  UpsertPlaceClaimOperationSchema,
  ProposePlaceOperationSchema,
])

export type DomainOperation = z.infer<typeof DomainOperationSchema>

export const TripChangeSetSchema = z
  .object({
    schemaVersion: z.literal(1),
    changeSetId: UuidSchema,
    tripId: UuidSchema,
    baseVersionId: UuidSchema,
    idempotencyKey: z.string().trim().min(8).max(160),
    createdAt: DateTimeSchema,
    producer: z
      .object({
        type: z.literal('external-agent'),
        name: z.string().trim().min(1).max(120),
        conversationRef: z.string().trim().max(300).optional(),
      })
      .strict(),
    sources: z
      .array(
        z
          .object({
            sourceRef: z.string().trim().min(1).max(120),
            platform: z.string().trim().min(1).max(60),
            url: z.string().url().startsWith('https://').max(2_048),
            title: z.string().trim().min(1).max(300),
            author: z.string().trim().max(160).optional(),
            publishedAt: DateSchema.optional(),
            summary: z.string().trim().min(1).max(1_200),
            contentFingerprint: z.string().trim().max(200).optional(),
            commercialRelationship: z.enum(['yes', 'no', 'unknown']),
          })
          .strict(),
      )
      .max(50),
    proposalGroups: z
      .array(
        z
          .object({
            groupId: z.string().trim().min(1).max(120),
            title: z.string().trim().min(1).max(200),
            rationale: z.string().trim().min(1).max(1_000),
            atomic: z.boolean(),
            operations: z.array(DomainOperationSchema).min(1).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .superRefine((changeSet, context) => {
    const sourceRefs = new Set<string>()
    changeSet.sources.forEach((source, index) => {
      if (sourceRefs.has(source.sourceRef)) {
        context.addIssue({
          code: 'custom',
          path: ['sources', index, 'sourceRef'],
          message: 'sourceRef must be unique',
        })
      }
      sourceRefs.add(source.sourceRef)
    })

    const groupIds = new Set<string>()
    const proposalRefs = new Set<string>()
    changeSet.proposalGroups.forEach((group, groupIndex) => {
      if (groupIds.has(group.groupId)) {
        context.addIssue({
          code: 'custom',
          path: ['proposalGroups', groupIndex, 'groupId'],
          message: 'groupId must be unique',
        })
      }
      groupIds.add(group.groupId)
      group.operations.forEach((operation, operationIndex) => {
        const operationSources =
          operation.type === 'ADD_STOP' ||
          operation.type === 'UPSERT_PLACE_CLAIM' ||
          operation.type === 'PROPOSE_PLACE'
            ? operation.sourceRefs
            : operation.type === 'LINK_SOURCE'
              ? [operation.sourceRef]
              : []
        for (const sourceRef of operationSources) {
          if (!sourceRefs.has(sourceRef)) {
            context.addIssue({
              code: 'custom',
              path: ['proposalGroups', groupIndex, 'operations', operationIndex],
              message: `Unknown sourceRef ${sourceRef}`,
            })
          }
        }
        if (operation.type === 'PROPOSE_PLACE') {
          if (proposalRefs.has(operation.proposalRef)) {
            context.addIssue({
              code: 'custom',
              path: ['proposalGroups', groupIndex, 'operations', operationIndex, 'proposalRef'],
              message: 'proposalRef must be unique',
            })
          }
          proposalRefs.add(operation.proposalRef)
        }
      })
    })
  })

export type TripChangeSet = z.infer<typeof TripChangeSetSchema>
