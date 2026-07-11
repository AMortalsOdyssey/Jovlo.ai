import { z } from 'zod'
import {
  ActualRecordSchema,
  CoordinateSchema,
  DerivedSnapshotSchema,
  ExpenseSchema,
  JsonValueSchema,
  RouteEndpointSchema,
  RouteLegSchema,
  TripChangeSetSchema,
  TripPlaceSnapshotSchema,
  TripSnapshotSchema,
  UuidSchema,
} from '../packages/domain/src/index'

export const TripCreateRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    snapshot: TripSnapshotSchema,
  })
  .strict()

export const DraftSaveRequestSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    snapshot: TripSnapshotSchema,
  })
  .strict()

export const PublishVersionRequestSchema = z
  .object({
    baseVersionId: UuidSchema.nullable(),
    draftRevision: z.number().int().nonnegative(),
    snapshot: TripSnapshotSchema,
    derivedSnapshot: DerivedSnapshotSchema,
    message: z.string().trim().min(1).max(500),
    source: z.enum(['manual', 'template']).default('manual'),
  })
  .strict()

export const PlanGenerateRequestSchema = z
  .object({
    templateSlug: z.literal('hainan-east-5d-haikou-sanya'),
    days: z.literal(5).default(5),
    title: z.string().trim().min(1).max(160).optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    partySize: z.number().int().min(1).max(50).optional(),
    vehicle: z
      .object({
        type: z.enum(['fuel', 'ev', 'hybrid']),
        consumption: z.number().finite().positive().max(100).optional(),
      })
      .strict()
      .optional(),
    pace: z.enum(['relaxed', 'balanced', 'packed']).optional(),
    maxDriveMinutesPerDay: z.number().int().min(30).max(1_440).optional(),
    totalBudget: z.number().finite().positive().optional(),
  })
  .strict()

const HainanCoordinateSchema = CoordinateSchema.superRefine((coordinate, context) => {
  if (coordinate.crs !== 'GCJ02') {
    context.addIssue({ code: 'custom', message: 'AMap route points must use GCJ02' })
  }
  if (coordinate.lon < 108.4 || coordinate.lon > 111.4 || coordinate.lat < 18 || coordinate.lat > 20.4) {
    context.addIssue({ code: 'custom', message: 'Route point is outside the Hainan boundary' })
  }
})

export const RouteDryRunRequestSchema = z
  .object({
    dayId: UuidSchema,
    points: z
      .array(
        z
          .object({
            endpoint: RouteEndpointSchema,
            coordinate: HainanCoordinateSchema,
          })
          .strict(),
      )
      .min(2)
      .max(9),
    strategy: z.enum(['32', '34', '35']).default('32'),
    inputHash: z.string().trim().min(1).max(160),
  })
  .strict()

export type RouteDryRunRequest = z.infer<typeof RouteDryRunRequestSchema>

export const AgentBridgeTicketRequestSchema = z.object({}).strict()

export const BudgetRequestSchema = z
  .object({
    snapshot: TripSnapshotSchema,
    routeLegs: z.array(RouteLegSchema).max(200),
  })
  .strict()

const PreviewOptionsFields = {
  selectedGroupIds: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  currentVersionId: UuidSchema.optional(),
  proposalResolutions: z.record(z.string().trim().min(1).max(120), UuidSchema).optional(),
  sourceResolutions: z.record(z.string().trim().min(1).max(120), UuidSchema).optional(),
  routeLegsBefore: z.array(RouteLegSchema).max(200).optional(),
  routeLegsAfter: z.array(RouteLegSchema).max(200).optional(),
}

export const ChangeSetPreviewRequestSchema = z
  .object({
    snapshot: TripSnapshotSchema,
    changeSet: TripChangeSetSchema,
    ...PreviewOptionsFields,
  })
  .strict()

export const StoredChangeSetDryRunRequestSchema = z
  .object({
    snapshot: TripSnapshotSchema.optional(),
    changeSet: TripChangeSetSchema.optional(),
    ...PreviewOptionsFields,
  })
  .strict()

export const ApplyChangeSetRequestSchema = z
  .object({
    preparedHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict()

export const ReportCreateRequestSchema = z
  .object({
    versionId: UuidSchema,
    type: z.enum(['plan', 'actual']),
    config: JsonValueSchema,
    snapshot: TripSnapshotSchema.optional(),
    expenses: z.array(ExpenseSchema).max(1_000).optional(),
    actuals: z.array(ActualRecordSchema).max(1_000).optional(),
  })
  .strict()

export const TripPublicationRequestSchema = z
  .object({
    versionId: UuidSchema,
    disclosureConfig: JsonValueSchema,
  })
  .strict()

export const ReportPublicationRequestSchema = z
  .object({
    disclosureConfig: JsonValueSchema,
  })
  .strict()

export const ExpenseMutationSchema = z
  .object({
    id: UuidSchema.optional(),
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
    currency: z.literal('CNY').default('CNY'),
    occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: z.string().trim().max(500).optional(),
    receiptAssetKey: z.string().trim().max(500).optional(),
  })
  .strict()

export const ActualMutationSchema = z
  .object({
    id: UuidSchema.optional(),
    sourceVersionId: UuidSchema,
    dayId: UuidSchema,
    stopId: UuidSchema.optional(),
    status: z.enum(['visited', 'skipped']),
    rating: z.number().int().min(1).max(5).optional(),
    note: z.string().trim().max(1_000).optional(),
    actualStartAt: z.string().datetime({ offset: true }).optional(),
    actualEndAt: z.string().datetime({ offset: true }).optional(),
    orphaned: z.boolean().default(false),
  })
  .strict()

export const PrivateSourceRequestSchema = z
  .object({
    platform: z.string().trim().min(1).max(60),
    url: z.string().url().startsWith('https://').max(2_048),
    title: z.string().trim().min(1).max(300),
    author: z.string().trim().max(160).optional(),
    publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    summary: z.string().trim().min(1).max(1_200),
    contentFingerprint: z.string().trim().max(200).optional(),
    commercialRelationship: z.enum(['yes', 'no', 'unknown']).default('unknown'),
  })
  .strict()

export const PlaceProposalResolveRequestSchema = z
  .object({
    existingPlaceId: UuidSchema.nullable(),
    privatePlace: TripPlaceSnapshotSchema.nullable(),
  })
  .strict()
  .superRefine((input, context) => {
    if ((input.existingPlaceId ? 1 : 0) + (input.privatePlace ? 1 : 0) !== 1) {
      context.addIssue({
        code: 'custom',
        message: 'Choose exactly one of existingPlaceId or privatePlace',
      })
    }
  })

export const RestoreRequestSchema = z
  .object({
    targetVersionId: UuidSchema,
    derivedSnapshot: DerivedSnapshotSchema,
    message: z.string().trim().min(1).max(500),
  })
  .strict()
