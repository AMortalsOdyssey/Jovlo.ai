import { Hono } from 'hono'
import { ZodError } from 'zod'
import {
  DEMO_ACTUALS,
  DEMO_CANDIDATES,
  DEMO_CHANGESET,
  DEMO_DERIVED,
  DEMO_EXPENSES,
  DEMO_REPORTS,
  DEMO_ROUTE_LEGS,
  DEMO_SOURCES,
  DEMO_TEMPLATES,
  DEMO_TRIP,
  DEMO_VERSIONS,
  ActualRecordSchema,
  ExpenseSchema,
  ReportGenerationSchema,
  TripChangeSetSchema,
  TripSnapshotSchema,
  TripVersionSchema,
  UuidSchema,
  calculateBudget,
  cloneJson,
  previewChangeSet,
  recalculateTrip,
  semanticDiff,
  stableHash,
  stableUuid,
  type ChangeSetPreview,
  type DerivedSnapshot,
  type Expense,
  type JsonValue,
  type ActualRecord,
  type ReportGeneration,
  type TripChangeSet,
  type TripSnapshot,
  type TripVersion,
} from '../packages/domain/src/index'
import { AppError } from './lib/errors'
import { hashPublicationToken, sha256Canonical } from './lib/crypto'
import {
  failure,
  parseJson,
  requireIdempotencyKey,
  runtimeMode,
  success,
} from './lib/http'
import {
  ApplyChangeSetRequestSchema,
  ActualMutationSchema,
  BudgetRequestSchema,
  ChangeSetPreviewRequestSchema,
  DraftSaveRequestSchema,
  ExpenseMutationSchema,
  PlaceProposalResolveRequestSchema,
  PlanGenerateRequestSchema,
  PrivateSourceRequestSchema,
  PublishVersionRequestSchema,
  ReportCreateRequestSchema,
  ReportPublicationRequestSchema,
  RestoreRequestSchema,
  RouteDryRunRequestSchema,
  StoredChangeSetDryRunRequestSchema,
  TripPublicationRequestSchema,
  TripCreateRequestSchema,
} from './schemas'
import { calculateRouteLegs, proxyAmapJsApiRequest } from './services/amap'
import {
  callSupabaseRpc,
  readSupabaseRow,
  readSupabaseRows,
  requireAuthenticatedUser,
} from './services/supabase'
import type { AppBindings, AppContext, RuntimeMode } from './types'

type StoredDemoChangeSet = {
  ownerId: string
  snapshot: TripSnapshot
  changeSet: TripChangeSet
  preview?: ChangeSetPreview
  preparedHash?: string
  derived?: DerivedSnapshot
  appliedVersion?: TripVersion
}

type DemoPublication = {
  id: string
  ownerId: string
  tripId: string
  targetKind: 'version' | 'report'
  versionId: string | null
  reportId: string | null
  token: string
  disclosureConfig: JsonValue
  revokedAt: string | null
}

type DemoTripState = {
  snapshot: TripSnapshot
  draftRevision: number
  currentVersionId: string | null
  versions: TripVersion[]
}

const demoChangeSets = new Map<string, StoredDemoChangeSet>()
const demoTrips = new Map<string, DemoTripState>([
  [
    DEMO_TRIP.tripId,
    {
      snapshot: cloneJson(DEMO_TRIP),
      draftRevision: 2,
      currentVersionId: DEMO_VERSIONS[1].id,
      versions: cloneJson(DEMO_VERSIONS),
    },
  ],
])
const demoExpenses = new Map<string, Expense[]>([[DEMO_TRIP.tripId, cloneJson(DEMO_EXPENSES)]])
const demoActuals = new Map<string, ActualRecord[]>([[DEMO_TRIP.tripId, cloneJson(DEMO_ACTUALS)]])
const demoReports = new Map<string, ReportGeneration>(
  DEMO_REPORTS.map((report) => [report.id, report]),
)
const demoIdempotency = new Map<string, { bodyHash: string; result: unknown }>()
const demoPublications = new Map<string, DemoPublication>([
  [
    'jovlo-demo-trip',
    {
      id: 'f0000000-0000-4000-8000-000000000001',
      ownerId: 'd0000000-0000-4000-8000-000000000001',
      tripId: DEMO_TRIP.tripId,
      targetKind: 'version',
      versionId: DEMO_VERSIONS[1].id,
      reportId: null,
      token: 'jovlo-demo-trip',
      disclosureConfig: { showExactDates: false, showSources: true },
      revokedAt: null,
    },
  ],
  [
    'jovlo-demo-report',
    {
      id: 'f0000000-0000-4000-8000-000000000002',
      ownerId: 'd0000000-0000-4000-8000-000000000001',
      tripId: DEMO_TRIP.tripId,
      targetKind: 'report',
      versionId: null,
      reportId: DEMO_REPORTS[1].id,
      token: 'jovlo-demo-report',
      disclosureConfig: { showExactDates: false, showSources: true },
      revokedAt: null,
    },
  ],
  [
    'jovlo-revoked',
    {
      id: 'f0000000-0000-4000-8000-000000000003',
      ownerId: 'd0000000-0000-4000-8000-000000000001',
      tripId: DEMO_TRIP.tripId,
      targetKind: 'version',
      versionId: DEMO_VERSIONS[0].id,
      reportId: null,
      token: 'jovlo-revoked',
      disclosureConfig: {},
      revokedAt: '2026-07-11T12:00:00+08:00',
    },
  ],
])

const app = new Hono<AppBindings>()

const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self' https://webapi.amap.com https://*.amap.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.amap.com https://*.autonavi.com; font-src 'self' data:; connect-src 'self' https://*.supabase.co https://restapi.amap.com https://*.amap.com https://*.autonavi.com; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"

function setSecurityHeaders(headers: Headers, currentRequestId: string, mode: RuntimeMode) {
  const contentSecurityPolicy = mode === 'demo'
    ? CONTENT_SECURITY_POLICY.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
    : CONTENT_SECURITY_POLICY
  headers.set('x-request-id', currentRequestId)
  headers.set('x-content-type-options', 'nosniff')
  headers.set('referrer-policy', 'strict-origin-when-cross-origin')
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(self)')
  headers.set('x-frame-options', 'DENY')
  headers.set('content-security-policy', contentSecurityPolicy)
}

function requestId(context: AppContext): string {
  const incoming = context.req.header('x-request-id')
  return incoming && /^[A-Za-z0-9_-]{8,100}$/.test(incoming)
    ? incoming
    : crypto.randomUUID()
}

app.use('*', async (context, next) => {
  const startedAt = Date.now()
  context.set('requestId', requestId(context))
  context.set('mode', runtimeMode(context.env))
  const responseHeaders = new Headers()
  setSecurityHeaders(responseHeaders, context.get('requestId'), context.get('mode'))
  responseHeaders.forEach((value, name) => context.header(name, value))

  const origin = context.req.header('origin')
  const ownOrigin = new URL(context.req.url).origin
  if (origin === ownOrigin) {
    context.header('access-control-allow-origin', origin)
    context.header('access-control-allow-credentials', 'true')
    context.header('vary', 'Origin')
  }
  if (context.req.method === 'OPTIONS') {
    if (origin && origin !== ownOrigin) {
      throw new AppError('FORBIDDEN', '不允许跨域访问该接口', 403)
    }
    context.header('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS')
    context.header('access-control-allow-headers', 'authorization,content-type,idempotency-key,x-request-id')
    context.header('access-control-max-age', '600')
    return context.body(null, 204)
  }

  try {
    await next()
  } finally {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        requestId: context.get('requestId'),
        route: `${context.req.method} ${new URL(context.req.url).pathname}`,
        status: context.res.status,
        durationMs: Date.now() - startedAt,
        mode: context.get('mode'),
      }),
    )
  }
})

app.onError((error, context) => {
  if (error instanceof AppError) return failure(context, error)
  if (error instanceof ZodError) {
    return failure(
      context,
      new AppError('VALIDATION_FAILED', '请求或领域数据校验失败', 400, {
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      }),
    )
  }
  console.error(
    JSON.stringify({
      requestId: context.get('requestId'),
      code: 'INTERNAL_ERROR',
      name: error.name,
    }),
  )
  return failure(
    context,
    new AppError('INTERNAL_ERROR', '服务暂时没有完成请求', 500, {
      retryable: true,
      userAction: '请携带 requestId 联系支持人员',
    }),
  )
})

app.notFound(async (context) => {
  const pathname = new URL(context.req.url).pathname
  const isAssetRequest =
    (context.req.method === 'GET' || context.req.method === 'HEAD') &&
    !pathname.startsWith('/api/') &&
    !pathname.startsWith('/_AMapService/')
  if (isAssetRequest && context.env.ASSETS) {
    const assetResponse = await context.env.ASSETS.fetch(context.req.raw)
    const headers = new Headers(assetResponse.headers)
    setSecurityHeaders(headers, context.get('requestId'), context.get('mode'))
    return new Response(assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers,
    })
  }
  return failure(context, new AppError('VALIDATION_FAILED', '接口不存在', 404))
})

function validateUuid(value: string, label: string): string {
  const parsed = UuidSchema.safeParse(value)
  if (!parsed.success) throw new AppError('VALIDATION_FAILED', `${label} 不是有效 UUID`, 400)
  return parsed.data
}

function addDays(date: string, offset: number): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + offset)
  return value.toISOString().slice(0, 10)
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function requirePepper(context: AppContext): string {
  if (!context.env.SHARE_TOKEN_PEPPER) {
    throw new AppError('DEPENDENCY_UNAVAILABLE', '生产模式缺少分享 token pepper', 503, {
      userAction: '请联系管理员检查服务配置',
    })
  }
  return context.env.SHARE_TOKEN_PEPPER
}

async function runDemoIdempotent<T>(
  ownerId: string,
  scope: string,
  key: string,
  body: unknown,
  operation: () => T | Promise<T>,
): Promise<T> {
  const recordKey = `${ownerId}:${scope}:${key}`
  const bodyHash = stableHash(body)
  const existing = demoIdempotency.get(recordKey)
  if (existing) {
    if (existing.bodyHash !== bodyHash) {
      throw new AppError('IDEMPOTENCY_KEY_REUSED', '同一幂等键已用于不同请求', 409, {
        userAction: '请为新请求生成新的幂等键',
      })
    }
    return cloneJson(existing.result as T)
  }
  const result = await operation()
  demoIdempotency.set(recordKey, { bodyHash, result: cloneJson(result) })
  return result
}

function disclosureFlag(config: JsonValue, key: string): boolean {
  return typeof config === 'object' && config !== null && !Array.isArray(config) && config[key] === true
}

function publicSnapshot(snapshot: TripSnapshot, disclosureConfig: JsonValue) {
  const output = cloneJson(snapshot)
  delete output.userNotes
  output.days.forEach((day) => {
    day.stops.forEach((stop) => delete stop.privateNote)
    if (!disclosureFlag(disclosureConfig, 'showExactDates')) delete day.date
  })
  if (!disclosureFlag(disclosureConfig, 'showExactDates')) delete output.intent.startDate
  if (!disclosureFlag(disclosureConfig, 'showSources')) {
    output.sourceRefs = {}
    Object.values(output.placeRefs).forEach((place) => {
      place.sourceIds = []
    })
    output.days.forEach((day) => day.stops.forEach((stop) => (stop.sourceIds = [])))
  }
  return output
}

async function parseChangeSetUpload(context: AppContext): Promise<TripChangeSet> {
  const maximumBytes = 256 * 1_024
  const contentLength = Number(context.req.header('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new AppError('CHANGESET_INVALID', 'ChangeSet 超过 256KB 限制', 413)
  }
  const contentType = (context.req.header('content-type') ?? '').toLowerCase()
  let value: unknown
  try {
    if (contentType.includes('application/json')) {
      value = await context.req.json()
    } else if (contentType.includes('text/plain') || contentType.includes('text/markdown')) {
      const text = await context.req.text()
      if (new TextEncoder().encode(text).byteLength > maximumBytes) {
        throw new AppError('CHANGESET_INVALID', 'ChangeSet 超过 256KB 限制', 413)
      }
      const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
      if (blocks.length > 1) {
        throw new AppError('CHANGESET_INVALID', 'Markdown 只能包含一个 JSON 代码块', 400)
      }
      value = JSON.parse((blocks[0]?.[1] ?? text).trim())
    } else {
      throw new AppError('CHANGESET_INVALID', '只接受 JSON、纯文本或 Markdown', 415)
    }
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('CHANGESET_INVALID', 'ChangeSet 不是有效 JSON', 400)
  }
  const parsed = TripChangeSetSchema.safeParse(value)
  if (!parsed.success) {
    throw new AppError('CHANGESET_INVALID', 'ChangeSet schema 校验失败', 400, {
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    })
  }
  return parsed.data
}

const health = (context: AppContext) =>
  success(context, {
    ok: true,
    service: 'jovlo-worker',
    buildSha: context.env.BUILD_SHA ?? context.env.CF_VERSION_METADATA?.id ?? 'development',
    persistence: context.get('mode') === 'demo' ? 'demo-ephemeral' : 'supabase-rls-rpc',
    now: new Date().toISOString(),
  })

app.get('/api/health', health)
app.get('/api/v1/health', health)

app.all('/_AMapService/*', (context) =>
  proxyAmapJsApiRequest(context.req.raw, context.env),
)

app.get('/api/v1/demo/bootstrap', (context) => {
  if (context.get('mode') !== 'demo') {
    throw new AppError('VALIDATION_FAILED', '接口不存在', 404)
  }
  context.header('cache-control', 'public, max-age=60')
  return success(context, {
    snapshot: DEMO_TRIP,
    derived: DEMO_DERIVED,
    versions: DEMO_VERSIONS,
    expenses: DEMO_EXPENSES,
    actuals: DEMO_ACTUALS,
    reports: DEMO_REPORTS,
    changeSet: DEMO_CHANGESET,
    templates: DEMO_TEMPLATES,
    candidates: DEMO_CANDIDATES,
    sources: DEMO_SOURCES,
    publicTokens: {
      trip: 'jovlo-demo-trip',
      report: 'jovlo-demo-report',
      revoked: 'jovlo-revoked',
    },
    demoContract: {
      enabledOnlyWhen: 'JOVLO_MODE=demo',
      persistence: 'ephemeral isolate memory',
      productionAuth: 'Supabase /auth/v1/user verification plus database RLS',
    },
  })
})

app.get('/api/v1/trips', async (context) => {
  const user = await requireAuthenticatedUser(context)
  if (context.get('mode') === 'demo') {
    return success(
      context,
      [...demoTrips.values()].map((state) => ({
        id: state.snapshot.tripId,
        title: state.snapshot.title,
        status: state.currentVersionId ? 'active' : 'draft',
        currentVersionId: state.currentVersionId,
        draftRevision: state.draftRevision,
        days: state.snapshot.days.length,
      })),
    )
  }
  const rows = await readSupabaseRows<Record<string, unknown>>(
    context,
    'trips',
    'select=id,title,status,current_version_id,current_draft_id,timezone,updated_at&order=updated_at.desc',
    user.token as string,
  )
  return success(context, rows)
})

app.post('/api/v1/trips', async (context) => {
  const user = await requireAuthenticatedUser(context)
  const idempotencyKey = requireIdempotencyKey(context)
  const input = await parseJson(context, TripCreateRequestSchema)
  if (input.snapshot.title !== input.title) {
    throw new AppError('VALIDATION_FAILED', 'title 必须与 snapshot.title 一致', 400)
  }
  if (context.get('mode') === 'demo') {
    const result = await runDemoIdempotent(
      user.id,
      'create_trip',
      idempotencyKey,
      input,
      () => {
        if (demoTrips.has(input.snapshot.tripId)) {
          throw new AppError('IDEMPOTENCY_KEY_REUSED', 'tripId 已存在', 409)
        }
        demoTrips.set(input.snapshot.tripId, {
          snapshot: cloneJson(input.snapshot),
          draftRevision: 0,
          currentVersionId: null,
          versions: [],
        })
        demoExpenses.set(input.snapshot.tripId, [])
        demoActuals.set(input.snapshot.tripId, [])
        return {
          tripId: input.snapshot.tripId,
          draftId: crypto.randomUUID(),
          revision: 0,
          currentVersionId: null,
        }
      },
    )
    return success(context, result, 201)
  }
  const result = await callSupabaseRpc<Record<string, unknown>>(
    context,
    'create_trip',
    {
      p_title: input.title,
      p_snapshot: input.snapshot,
      p_idempotency_key: idempotencyKey,
    },
    user.token,
  )
  return success(context, result, 201)
})

app.get('/api/v1/trips/:tripId', async (context) => {
  const user = await requireAuthenticatedUser(context)
  const tripId = validateUuid(context.req.param('tripId'), 'tripId')
  if (context.get('mode') === 'demo') {
    const state = demoTrips.get(tripId)
    if (!state) throw new AppError('FORBIDDEN', '行程不存在或无权访问', 403)
    return success(context, {
      tripId,
      currentVersionId: state.currentVersionId,
      draft: { snapshot: state.snapshot, revision: state.draftRevision },
      versionCount: state.versions.length,
    })
  }
  const trip = await readSupabaseRow<Record<string, unknown>>(
    context,
    'trips',
    `id=eq.${tripId}&select=*`,
    user.token as string,
  )
  const draft = await readSupabaseRow<Record<string, unknown>>(
    context,
    'trip_drafts',
    `trip_id=eq.${tripId}&select=id,base_version_id,snapshot,revision,updated_at`,
    user.token as string,
  )
  if (!trip || !draft) throw new AppError('FORBIDDEN', '行程不存在或无权访问', 403)
  return success(context, { trip, draft })
})

app.put('/api/v1/trips/:tripId/draft', async (context) => {
  const user = await requireAuthenticatedUser(context)
  const tripId = validateUuid(context.req.param('tripId'), 'tripId')
  const idempotencyKey = requireIdempotencyKey(context)
  const input = await parseJson(context, DraftSaveRequestSchema)
  if (input.snapshot.tripId !== tripId) {
    throw new AppError('VALIDATION_FAILED', 'snapshot 不属于路径 tripId', 400)
  }
  if (context.get('mode') === 'demo') {
    const result = await runDemoIdempotent(
      user.id,
      `save_draft:${tripId}`,
      idempotencyKey,
      input,
      () => {
        const state = demoTrips.get(tripId)
        if (!state) throw new AppError('FORBIDDEN', '行程不存在或无权访问', 403)
        if (state.draftRevision !== input.revision) {
          throw new AppError('DRAFT_REVISION_STALE', '草稿 revision 已变化', 409, {
            userAction: '请刷新草稿后比较修改',
          })
        }
        state.snapshot = cloneJson(input.snapshot)
        state.draftRevision += 1
        return { tripId, revision: state.draftRevision, snapshotHash: stableHash(state.snapshot) }
      },
    )
    return success(context, result)
  }
  const result = await callSupabaseRpc<Record<string, unknown>>(
    context,
    'save_draft',
    {
      p_trip_id: tripId,
      p_expected_revision: input.revision,
      p_snapshot: input.snapshot,
      p_idempotency_key: idempotencyKey,
    },
    user.token,
  )
  return success(context, result)
})

app.post('/api/v1/trips/:tripId/publish', async (context) => {
  const user = await requireAuthenticatedUser(context)
  const tripId = validateUuid(context.req.param('tripId'), 'tripId')
  const idempotencyKey = requireIdempotencyKey(context)
  const input = await parseJson(context, PublishVersionRequestSchema)
  if (input.snapshot.tripId !== tripId) {
    throw new AppError('VALIDATION_FAILED', 'snapshot 不属于路径 tripId', 400)
  }
  if (context.get('mode') === 'demo') {
    const result = await runDemoIdempotent(
      user.id,
      `publish_trip_version:${tripId}`,
      idempotencyKey,
      input,
      () => {
        const state = demoTrips.get(tripId)
        if (!state) throw new AppError('FORBIDDEN', '行程不存在或无权访问', 403)
        if (state.currentVersionId !== input.baseVersionId) {
          throw new AppError('BASE_VERSION_STALE', '发布基线已变化', 409)
        }
        if (state.draftRevision !== input.draftRevision) {
          throw new AppError('DRAFT_REVISION_STALE', '草稿 revision 已变化', 409)
        }
        if (stableHash(state.snapshot) !== stableHash(input.snapshot)) {
          throw new AppError('DRAFT_REVISION_STALE', '发布快照与锁定草稿不一致', 409)
        }
        const version = TripVersionSchema.parse({
          id: crypto.randomUUID(),
          tripId,
          versionNo: state.versions.length + 1,
          parentVersionId: state.currentVersionId,
          source: input.source,
          message: input.message,
          snapshot: input.snapshot,
          snapshotHash: stableHash(input.snapshot),
          derivedSnapshot: input.derivedSnapshot,
          derivedHash: stableHash(input.derivedSnapshot),
          createdBy: user.id,
          createdAt: new Date().toISOString(),
        })
        state.versions.push(version)
        state.currentVersionId = version.id
        state.draftRevision += 1
        return { version, draftRevision: state.draftRevision }
      },
    )
    return success(context, result, 201, { currentVersionId: result.version.id })
  }
  const result = await callSupabaseRpc<Record<string, unknown>>(
    context,
    'publish_trip_version',
    {
      p_trip_id: tripId,
      p_base_version_id: input.baseVersionId,
      p_draft_revision: input.draftRevision,
      p_snapshot: input.snapshot,
      p_derived_snapshot: input.derivedSnapshot,
      p_message: input.message,
      p_source: input.source,
      p_idempotency_key: idempotencyKey,
    },
    user.token,
  )
  const versionId = String(result.versionId ?? result.version_id ?? '')
  const versionNo = Number(result.versionNo ?? result.version_no)
  const draftRevision = Number(result.draftRevision ?? result.draft_revision)
  if (!versionId || !Number.isInteger(versionNo) || !Number.isInteger(draftRevision)) {
    throw new AppError('DEPENDENCY_UNAVAILABLE', '数据库返回了无法识别的版本结果', 502, {
      retryable: true,
    })
  }
  const version = TripVersionSchema.parse({
    id: versionId,
    tripId,
    versionNo,
    parentVersionId: input.baseVersionId,
    source: input.source,
    message: input.message,
    snapshot: input.snapshot,
    snapshotHash: result.snapshotHash ?? result.snapshot_hash,
    derivedSnapshot: input.derivedSnapshot,
    derivedHash: result.derivedHash ?? result.derived_hash,
    createdBy: user.id,
    createdAt: new Date().toISOString(),
  })
  return success(context, { version, draftRevision }, 201, { currentVersionId: version.id })
})

app.get('/api/v1/trips/:tripId/versions', async (context) => {
  const user = await requireAuthenticatedUser(context)
  const tripId = validateUuid(context.req.param('tripId'), 'tripId')
  if (context.get('mode') === 'demo') {
    const state = demoTrips.get(tripId)
    if (!state) throw new AppError('FORBIDDEN', '行程不存在或无权访问', 403)
    return success(context, state.versions)
  }
  const versions = await readSupabaseRows<Record<string, unknown>>(
    context,
    'trip_versions',
    `trip_id=eq.${tripId}&select=id,trip_id,version_no,parent_version_id,source,message,snapshot,snapshot_hash,derived_snapshot,derived_hash,created_by,created_at&order=version_no.desc`,
    user.token as string,
  )
  return success(
    context,
    versions.map((row) =>
      TripVersionSchema.parse({
        id: row.id,
        tripId: row.trip_id,
        versionNo: row.version_no,
        parentVersionId: row.parent_version_id,
        source: row.source,
        message: row.message,
        snapshot: row.snapshot,
        snapshotHash: row.snapshot_hash,
        derivedSnapshot: row.derived_snapshot,
        derivedHash: row.derived_hash,
        createdBy: row.created_by,
        createdAt: row.created_at,
      }),
    ),
  )
})

app.post('/api/v1/plans/generate', async (context) => {
  await requireAuthenticatedUser(context)
  const input = await parseJson(context, PlanGenerateRequestSchema)
  const snapshot = cloneJson(DEMO_TRIP)
  snapshot.title = input.title ?? snapshot.title
  snapshot.intent.partySize = input.partySize ?? snapshot.intent.partySize
  snapshot.intent.vehicle = input.vehicle ?? snapshot.intent.vehicle
  snapshot.intent.pace = input.pace ?? snapshot.intent.pace
  snapshot.intent.maxDriveMinutesPerDay =
    input.maxDriveMinutesPerDay ?? snapshot.intent.maxDriveMinutesPerDay
  snapshot.intent.totalBudget = input.totalBudget ?? snapshot.intent.totalBudget
  if (input.startDate) {
    snapshot.intent.startDate = input.startDate
    snapshot.days.forEach((day, index) => {
      day.date = addDays(input.startDate as string, index)
    })
  }
  const validated = TripSnapshotSchema.parse(snapshot)
  const derived = recalculateTrip(validated, DEMO_ROUTE_LEGS)
  return success(context, {
    snapshot: validated,
    derived,
    template: DEMO_TEMPLATES[0],
    routeProvider: 'reference',
    warning: '模板路段是人工参考值；接入 AMap 后必须重算才能标记为道路结果',
  })
})

app.post('/api/v1/routes/dry-run', async (context) => {
  await requireAuthenticatedUser(context)
  const input = await parseJson(context, RouteDryRunRequestSchema)
  const result = await calculateRouteLegs(input, context.env)
  return success(context, { ...result, inputHash: input.inputHash })
})

app.post('/api/v1/budgets/calculate', async (context) => {
  await requireAuthenticatedUser(context)
  const input = await parseJson(context, BudgetRequestSchema)
  return success(context, calculateBudget(input.snapshot, input.routeLegs))
})

app.get('/api/v1/trips/:tripId/expenses', async (context) => {
  const user = await requireAuthenticatedUser(context)
  const tripId = validateUuid(context.req.param('tripId'), 'tripId')
  if (context.get('mode') === 'demo') {
    if (!demoTrips.has(tripId)) throw new AppError('FORBIDDEN', '行程不存在或无权访问', 403)
    return success(context, demoExpenses.get(tripId) ?? [])
  }
  const rows = await readSupabaseRows<Record<string, unknown>>(
    context,
    'expenses',
    `trip_id=eq.${tripId}&select=*&order=occurred_on.desc,created_at.desc`,
    user.token as string,
  )
  return success(context, rows)
})

app.post('/api/v1/trips/:tripId/expenses', async (context) => {
  const user = await requireAuthenticatedUser(context)
  const tripId = validateUuid(context.req.param('tripId'), 'tripId')
  const idempotencyKey = requireIdempotencyKey(context)
  const input = await parseJson(context, ExpenseMutationSchema)
  if (context.get('mode') === 'demo') {
    const result = await runDemoIdempotent(
      user.id,
      `upsert_expense:${tripId}`,
      idempotencyKey,
      input,
      () => {
        if (!demoTrips.has(tripId)) throw new AppError('FORBIDDEN', '行程不存在或无权访问', 403)
        const now = new Date().toISOString()
        const expense = ExpenseSchema.parse({
          ...input,
          id: input.id ?? crypto.randomUUID(),
          tripId,
          createdAt: now,
          updatedAt: now,
        })
        const items = demoExpenses.get(tripId) ?? []
        const index = items.findIndex((item) => item.id === expense.id)
        if (index >= 0) items[index] = { ...expense, createdAt: items[index].createdAt }
        else items.push(expense)
        demoExpenses.set(tripId, items)
        return expense
      },
    )
    return success(context, result, 201)
  }
  const result = await callSupabaseRpc<Record<string, unknown>>(
    context,
    'upsert_expense',
    { p_trip_id: tripId, p_expense: input, p_idempotency_key: idempotencyKey },
    user.token,
  )
  return success(context, result, 201)
})

app.get('/api/v1/trips/:tripId/actuals', async (context) => {
  const user = await requireAuthenticatedUser(context)
  const tripId = validateUuid(context.req.param('tripId'), 'tripId')
  if (context.get('mode') === 'demo') {
    if (!demoTrips.has(tripId)) throw new AppError('FORBIDDEN', '行程不存在或无权访问', 403)
    return success(context, demoActuals.get(tripId) ?? [])
  }
  const rows = await readSupabaseRows<Record<string, unknown>>(
    context,
    'trip_actuals',
    `trip_id=eq.${tripId}&select=*&order=created_at.desc`,
    user.token as string,
  )
  return success(context, rows)
})

app.put('/api/v1/trips/:tripId/actuals', async (context) => {
  const user = await requireAuthenticatedUser(context)
  const tripId = validateUuid(context.req.param('tripId'), 'tripId')
  const idempotencyKey = requireIdempotencyKey(context)
  const input = await parseJson(context, ActualMutationSchema)
  if (context.get('mode') === 'demo') {
    const result = await runDemoIdempotent(
      user.id,
      `upsert_actual_record:${tripId}`,
      idempotencyKey,
      input,
      () => {
        if (!demoTrips.has(tripId)) throw new AppError('FORBIDDEN', '行程不存在或无权访问', 403)
        const now = new Date().toISOString()
        const actual = ActualRecordSchema.parse({
          ...input,
          id: input.id ?? crypto.randomUUID(),
          tripId,
          createdAt: now,
          updatedAt: now,
        })
        const items = demoActuals.get(tripId) ?? []
        const index = items.findIndex((item) => item.id === actual.id)
        if (index >= 0) items[index] = { ...actual, createdAt: items[index].createdAt }
        else items.push(actual)
        demoActuals.set(tripId, items)
        return actual
      },
    )
    return success(context, result)
  }
  const result = await callSupabaseRpc<Record<string, unknown>>(
    context,
    'upsert_actual_record',
    { p_trip_id: tripId, p_actual: input, p_idempotency_key: idempotencyKey },
    user.token,
  )
  return success(context, result)
})

app.post('/api/v1/change-sets/preview', async (context) => {
  await requireAuthenticatedUser(context)
  const input = await parseJson(context, ChangeSetPreviewRequestSchema)
  const { snapshot, changeSet, ...options } = input
  return success(context, previewChangeSet(snapshot, changeSet, options))
})

app.post('/api/v1/trips/:tripId/change-sets', async (context) => {
  const user = await requireAuthenticatedUser(context)
  const tripId = validateUuid(context.req.param('tripId'), 'tripId')
  const changeSet = await parseChangeSetUpload(context)
  if (changeSet.tripId !== tripId) {
    throw new AppError('CHANGESET_INVALID', '路径 tripId 与 ChangeSet tripId 不一致', 400)
  }
  const idempotencyKey = requireIdempotencyKey(context, changeSet.idempotencyKey)
  if (context.get('mode') === 'demo') {
    const result = await runDemoIdempotent(
      user.id,
      `upload_change_set:${tripId}`,
      idempotencyKey,
      changeSet,
      () => {
        demoChangeSets.set(changeSet.changeSetId, {
          ownerId: user.id,
          snapshot: cloneJson(DEMO_TRIP),
          changeSet,
        })
        return { changeSetId: changeSet.changeSetId, status: 'uploaded' as const }
      },
    )
    return success(context, result, 201)
  }
  const result = await callSupabaseRpc<Record<string, unknown>>(
    context,
    'upload_change_set',
    {
      p_trip_id: tripId,
      p_payload: changeSet,
      p_base_version_id: changeSet.baseVersionId,
      p_idempotency_key: idempotencyKey,
    },
    user.token,
  )
  return success(context, result, 201)
})

app.post('/api/v1/trips/:tripId/sources', async (context) => {
  const user = await requireAuthenticatedUser(context)
  const tripId = validateUuid(context.req.param('tripId'), 'tripId')
  const idempotencyKey = requireIdempotencyKey(context)
  const input = await parseJson(context, PrivateSourceRequestSchema)
  if (context.get('mode') === 'demo') {
    const result = await runDemoIdempotent(
      user.id,
      `create_private_source:${tripId}`,
      idempotencyKey,
      input,
      () => {
        if (!demoTrips.has(tripId)) throw new AppError('FORBIDDEN', '行程不存在或无权访问', 403)
        return { sourceId: crypto.randomUUID(), tripId, scope: 'trip_private' as const }
      },
    )
    return success(context, result, 201)
  }
  const result = await callSupabaseRpc<Record<string, unknown>>(
    context,
    'create_private_source',
    { p_trip_id: tripId, p_source: input, p_idempotency_key: idempotencyKey },
    user.token,
  )
  return success(context, result, 201)
})

app.get('/api/v1/change-sets/:changeSetId/place-proposals/:proposalRef', async (context) => {
  const user = await requireAuthenticatedUser(context)
  const changeSetId = validateUuid(context.req.param('changeSetId'), 'changeSetId')
  const proposalRef = context.req.param('proposalRef')
  if (!proposalRef || proposalRef.length > 120) {
    throw new AppError('VALIDATION_FAILED', 'proposalRef 无效', 400)
  }
  if (context.get('mode') === 'demo') {
    const stored = demoChangeSets.get(changeSetId)
    if (!stored || stored.ownerId !== user.id) throw new AppError('FORBIDDEN', '地点提案不存在', 403)
    return success(context, {
      changeSetId,
      proposalRef,
      resolutionStatus: 'unresolved',
      candidateMatches: DEMO_CANDIDATES.slice(0, 3),
    })
  }
  const proposal = await readSupabaseRow<Record<string, unknown>>(
    context,
    'place_proposals',
    `change_set_id=eq.${changeSetId}&proposal_ref=eq.${encodeURIComponent(proposalRef)}&select=*`,
    user.token as string,
  )
  if (!proposal) throw new AppError('FORBIDDEN', '地点提案不存在', 403)
  return success(context, proposal)
})

app.post('/api/v1/change-sets/:changeSetId/place-proposals/:proposalRef/resolve', async (context) => {
  const user = await requireAuthenticatedUser(context)
  const changeSetId = validateUuid(context.req.param('changeSetId'), 'changeSetId')
  const proposalRef = context.req.param('proposalRef')
  if (!proposalRef || proposalRef.length > 120) {
    throw new AppError('VALIDATION_FAILED', 'proposalRef 无效', 400)
  }
  const idempotencyKey = requireIdempotencyKey(context)
  const input = await parseJson(context, PlaceProposalResolveRequestSchema)
  if (context.get('mode') === 'demo') {
    const result = await runDemoIdempotent(
      user.id,
      `resolve_place_proposal:${changeSetId}:${proposalRef}`,
      idempotencyKey,
      input,
      () => ({
        changeSetId,
        proposalRef,
        resolvedPlaceId: input.existingPlaceId ?? input.privatePlace?.placeId,
        resolutionStatus: input.existingPlaceId ? 'matched' : 'private_created',
      }),
    )
    return success(context, result)
  }
  const result = await callSupabaseRpc<Record<string, unknown>>(
    context,
    'resolve_place_proposal',
    {
      p_change_set_id: changeSetId,
      p_proposal_ref: proposalRef,
      p_existing_place_id: input.existingPlaceId,
      p_private_place: input.privatePlace,
      p_idempotency_key: idempotencyKey,
    },
    user.token,
  )
  return success(context, result)
})

app.post('/api/v1/change-sets/:changeSetId/dry-run', async (context) => {
  const user = await requireAuthenticatedUser(context)
  const changeSetId = validateUuid(context.req.param('changeSetId'), 'changeSetId')
  const idempotencyKey = requireIdempotencyKey(context)
  const input = await parseJson(context, StoredChangeSetDryRunRequestSchema)
  const stored = demoChangeSets.get(changeSetId)
  const changeSet = input.changeSet ?? (context.get('mode') === 'demo' ? stored?.changeSet : undefined)
  if (!changeSet || changeSet.changeSetId !== changeSetId) {
    throw new AppError('CHANGESET_INVALID', '找不到匹配的 ChangeSet 负载', 404)
  }
  const { snapshot, changeSet: _ignored, ...options } = input
  const preview = previewChangeSet(snapshot, changeSet, options)
  const routeLegs = input.routeLegsAfter ?? []
  const derived = recalculateTrip(preview.candidateSnapshot, routeLegs)
  const preparedHash = await sha256Canonical({
    changeSetId,
    baseVersionId: changeSet.baseVersionId,
    selectedGroupIds: input.selectedGroupIds ?? changeSet.proposalGroups.map((group) => group.groupId),
    candidateSnapshot: preview.candidateSnapshot,
    derived,
  })

  if (context.get('mode') === 'demo') {
    const result = await runDemoIdempotent(
      user.id,
      `prepare_change_set:${changeSetId}`,
      idempotencyKey,
      { input, preparedHash },
      () => {
        demoChangeSets.set(changeSetId, {
          ownerId: user.id,
          snapshot,
          changeSet,
          preview,
          preparedHash,
          derived,
        })
        return { preview, preparedHash, derived, status: preview.canApply ? 'ready' : 'conflict' }
      },
    )
    return success(context, result)
  }

  if (preview.canApply) {
    const blockingRoute = derived.daySchedules.some((schedule) =>
      schedule.warnings.some(
        (warning) => warning.code === 'ROUTE_MISSING' || warning.code === 'ROUTE_FAILED',
      ),
    )
    if (blockingRoute) {
      throw new AppError('ROUTE_NO_DATA', 'ChangeSet 仍有未计算的必需路段', 422, {
        userAction: '请完成受影响日期道路重算后再次预览',
      })
    }
    await callSupabaseRpc(
      context,
      'prepare_change_set',
      {
        p_change_set_id: changeSetId,
        p_base_version_id: changeSet.baseVersionId,
        p_selected_group_ids:
          input.selectedGroupIds ?? changeSet.proposalGroups.map((group) => group.groupId),
        p_candidate_snapshot: preview.candidateSnapshot,
        p_derived_snapshot: derived,
        p_draft_hash: await sha256Canonical(snapshot),
        p_prepared_hash: preparedHash,
        p_prepared_side_effects: {
          sources: changeSet.sources
            .filter((source) => !snapshot.sourceRefs[source.sourceRef])
            .map((source) => ({
              ...source,
              sourceId:
                input.sourceResolutions?.[source.sourceRef] ??
                stableUuid({ changeSetId: changeSet.changeSetId, sourceRef: source.sourceRef }),
              persist: input.sourceResolutions?.[source.sourceRef] === undefined,
            })),
          selectedGroups: changeSet.proposalGroups.filter((group) =>
            (input.selectedGroupIds ?? changeSet.proposalGroups.map((item) => item.groupId)).includes(
              group.groupId,
            ),
          ),
        },
        p_idempotency_key: idempotencyKey,
      },
      user.token,
    )
  }
  return success(context, {
    preview,
    preparedHash: preview.canApply ? preparedHash : null,
    derived: preview.canApply ? derived : null,
    status: preview.canApply ? 'ready' : 'conflict',
  })
})

app.post('/api/v1/change-sets/:changeSetId/apply', async (context) => {
  const user = await requireAuthenticatedUser(context)
  const changeSetId = validateUuid(context.req.param('changeSetId'), 'changeSetId')
  const idempotencyKey = requireIdempotencyKey(context)
  const input = await parseJson(context, ApplyChangeSetRequestSchema)
  if (context.get('mode') === 'demo') {
    const result = await runDemoIdempotent(
      user.id,
      `apply_change_set:${changeSetId}`,
      idempotencyKey,
      input,
      () => {
        const stored = demoChangeSets.get(changeSetId)
        if (!stored?.preview || !stored.preparedHash || !stored.derived) {
          throw new AppError('CHANGESET_STALE', 'ChangeSet 尚未完成有效预览', 409, {
            userAction: '请重新预览 ChangeSet',
          })
        }
        if (stored.preparedHash !== input.preparedHash) {
          throw new AppError('CHANGESET_STALE', '提交的预览 hash 已过期', 409, {
            userAction: '请重新预览 ChangeSet',
          })
        }
        if (!stored.preview.canApply) {
          throw new AppError('CHANGESET_CONFLICT', 'ChangeSet 仍存在冲突', 409, {
            userAction: '请解决冲突后重新预览',
          })
        }
        const version = TripVersionSchema.parse({
          id: crypto.randomUUID(),
          tripId: stored.snapshot.tripId,
          versionNo: Math.max(...DEMO_VERSIONS.map((item) => item.versionNo)) + 1,
          parentVersionId: stored.changeSet.baseVersionId,
          source: 'changeset',
          message: `应用 ChangeSet ${changeSetId}`,
          snapshot: stored.preview.candidateSnapshot,
          snapshotHash: stableHash(stored.preview.candidateSnapshot),
          derivedSnapshot: stored.derived,
          derivedHash: stableHash(stored.derived),
          createdBy: user.id,
          createdAt: new Date().toISOString(),
        })
        stored.appliedVersion = version
        demoChangeSets.set(changeSetId, stored)
        return { changeSetId, status: 'applied' as const, version }
      },
    )
    return success(context, result, 201, { currentVersionId: result.version.id })
  }

  // This path intentionally performs only one database RPC. No Provider call is allowed here.
  const result = await callSupabaseRpc<Record<string, unknown>>(
    context,
    'apply_change_set',
    {
      p_change_set_id: changeSetId,
      p_prepared_hash: input.preparedHash,
      p_idempotency_key: idempotencyKey,
    },
    user.token,
  )
  return success(context, result, 201)
})

app.post('/api/v1/trips/:tripId/reports', async (context) => {
  const user = await requireAuthenticatedUser(context)
  const tripId = validateUuid(context.req.param('tripId'), 'tripId')
  const idempotencyKey = requireIdempotencyKey(context)
  const input = await parseJson(context, ReportCreateRequestSchema)
  if (input.snapshot && input.snapshot.tripId !== tripId) {
    throw new AppError('VALIDATION_FAILED', '报告 snapshot 不属于路径 tripId', 400)
  }
  if (context.get('mode') === 'demo') {
    const result = await runDemoIdempotent(
      user.id,
      `create_report_generation:${tripId}`,
      idempotencyKey,
      input,
      async () => {
        const expenses = cloneJson(input.expenses ?? DEMO_EXPENSES)
        const actuals = cloneJson(input.actuals ?? DEMO_ACTUALS)
        if (input.type === 'actual' && actuals.length === 0) {
          throw new AppError('REPORT_GENERATION_FAILED', '没有实际记录，不能生成实际报告', 422, {
            userAction: '请先记录到访或跳过状态',
          })
        }
        const expenseSnapshotId = crypto.randomUUID()
        const actualSnapshotId = crypto.randomUUID()
        const generation = ReportGenerationSchema.parse({
          id: crypto.randomUUID(),
          tripId,
          versionId: input.versionId,
          expenseSnapshotId,
          actualSnapshotId,
          type: input.type,
          status: 'ready',
          config: input.config,
          configHash: await sha256Canonical(input.config),
          outputKey: `demo/reports/${tripId}/${crypto.randomUUID()}.html`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        demoReports.set(generation.id, generation)
        return {
          generation,
          expenseSnapshot: {
            id: expenseSnapshotId,
            count: expenses.length,
            total: expenses.reduce((sum, expense) => sum + expense.amount, 0),
            hash: await sha256Canonical(expenses),
          },
          actualSnapshot: {
            id: actualSnapshotId,
            count: actuals.length,
            hash: await sha256Canonical(actuals),
          },
        }
      },
    )
    return success(context, result, 201)
  }
  const result = await callSupabaseRpc<Record<string, unknown>>(
    context,
    'create_report_generation',
    {
      p_trip_id: tripId,
      p_version_id: input.versionId,
      p_report_type: input.type,
      p_config: input.config,
      p_idempotency_key: idempotencyKey,
    },
    user.token,
  )
  return success(context, result, 201)
})

app.get('/api/v1/reports/:reportId', async (context) => {
  const user = await requireAuthenticatedUser(context)
  const reportId = validateUuid(context.req.param('reportId'), 'reportId')
  if (context.get('mode') === 'demo') {
    const report = demoReports.get(reportId)
    if (!report) throw new AppError('VALIDATION_FAILED', '报告不存在', 404)
    return success(context, report)
  }
  const report = await readSupabaseRow<Record<string, unknown>>(
    context,
    'report_generations',
    `id=eq.${reportId}&select=*`,
    user.token as string,
  )
  if (!report) throw new AppError('VALIDATION_FAILED', '报告不存在', 404)
  return success(context, report)
})

app.post('/api/v1/trips/:tripId/publications', async (context) => {
  const user = await requireAuthenticatedUser(context)
  const tripId = validateUuid(context.req.param('tripId'), 'tripId')
  const idempotencyKey = requireIdempotencyKey(context)
  const input = await parseJson(context, TripPublicationRequestSchema)
  const token = randomToken()
  if (context.get('mode') === 'demo') {
    const result = await runDemoIdempotent(
      user.id,
      `create_publication:${tripId}:version`,
      idempotencyKey,
      input,
      () => {
        const publication: DemoPublication = {
          id: crypto.randomUUID(),
          ownerId: user.id,
          tripId,
          targetKind: 'version',
          versionId: input.versionId,
          reportId: null,
          token,
          disclosureConfig: input.disclosureConfig,
          revokedAt: null,
        }
        demoPublications.set(token, publication)
        return { publicationId: publication.id, token, targetKind: 'version' as const }
      },
    )
    return success(context, result, 201)
  }
  const tokenHash = await hashPublicationToken(token, requirePepper(context))
  const result = await callSupabaseRpc<Record<string, unknown>>(
    context,
    'create_publication',
    {
      p_trip_id: tripId,
      p_target_kind: 'version',
      p_version_id: input.versionId,
      p_report_id: null,
      p_token_hash: tokenHash,
      p_disclosure_config: input.disclosureConfig,
      p_idempotency_key: idempotencyKey,
    },
    user.token,
  )
  return success(context, { ...result, token }, 201)
})

app.post('/api/v1/reports/:reportId/publications', async (context) => {
  const user = await requireAuthenticatedUser(context)
  const reportId = validateUuid(context.req.param('reportId'), 'reportId')
  const idempotencyKey = requireIdempotencyKey(context)
  const input = await parseJson(context, ReportPublicationRequestSchema)
  const report =
    context.get('mode') === 'demo'
      ? demoReports.get(reportId)
      : await readSupabaseRow<Record<string, unknown>>(
          context,
          'report_generations',
          `id=eq.${reportId}&select=trip_id`,
          user.token as string,
        )
  if (!report) throw new AppError('VALIDATION_FAILED', '报告不存在', 404)
  const tripId = 'tripId' in report ? String(report.tripId) : String(report.trip_id)
  const token = randomToken()
  if (context.get('mode') === 'demo') {
    const result = await runDemoIdempotent(
      user.id,
      `create_publication:${reportId}:report`,
      idempotencyKey,
      input,
      () => {
        const publication: DemoPublication = {
          id: crypto.randomUUID(),
          ownerId: user.id,
          tripId,
          targetKind: 'report',
          versionId: null,
          reportId,
          token,
          disclosureConfig: input.disclosureConfig,
          revokedAt: null,
        }
        demoPublications.set(token, publication)
        return { publicationId: publication.id, token, targetKind: 'report' as const }
      },
    )
    return success(context, result, 201)
  }
  const tokenHash = await hashPublicationToken(token, requirePepper(context))
  const result = await callSupabaseRpc<Record<string, unknown>>(
    context,
    'create_publication',
    {
      p_trip_id: tripId,
      p_target_kind: 'report',
      p_version_id: null,
      p_report_id: reportId,
      p_token_hash: tokenHash,
      p_disclosure_config: input.disclosureConfig,
      p_idempotency_key: idempotencyKey,
    },
    user.token,
  )
  return success(context, { ...result, token }, 201)
})

app.delete('/api/v1/publications/:publicationId', async (context) => {
  const user = await requireAuthenticatedUser(context)
  const publicationId = validateUuid(context.req.param('publicationId'), 'publicationId')
  const idempotencyKey = requireIdempotencyKey(context)
  if (context.get('mode') === 'demo') {
    const result = await runDemoIdempotent(
      user.id,
      `revoke_publication:${publicationId}`,
      idempotencyKey,
      { publicationId },
      () => {
        const publication = [...demoPublications.values()].find((item) => item.id === publicationId)
        if (!publication || publication.ownerId !== user.id) {
          throw new AppError('FORBIDDEN', '分享不存在或无权撤销', 403)
        }
        publication.revokedAt = new Date().toISOString()
        return { publicationId, revokedAt: publication.revokedAt }
      },
    )
    return success(context, result)
  }
  const result = await callSupabaseRpc<Record<string, unknown>>(
    context,
    'revoke_publication',
    { p_publication_id: publicationId, p_idempotency_key: idempotencyKey },
    user.token,
  )
  return success(context, result)
})

app.post('/api/v1/trips/:tripId/restore', async (context) => {
  const user = await requireAuthenticatedUser(context)
  const tripId = validateUuid(context.req.param('tripId'), 'tripId')
  const idempotencyKey = requireIdempotencyKey(context)
  const input = await parseJson(context, RestoreRequestSchema)
  if (context.get('mode') === 'demo') {
    const result = await runDemoIdempotent(
      user.id,
      `restore_trip_version:${tripId}`,
      idempotencyKey,
      input,
      () => {
        const target = DEMO_VERSIONS.find(
          (version) => version.id === input.targetVersionId && version.tripId === tripId,
        )
        if (!target) throw new AppError('FORBIDDEN', '目标版本不存在或不属于当前行程', 403)
        const version = TripVersionSchema.parse({
          id: crypto.randomUUID(),
          tripId,
          versionNo: Math.max(...DEMO_VERSIONS.map((item) => item.versionNo)) + 1,
          parentVersionId: DEMO_VERSIONS.at(-1)?.id ?? null,
          source: 'restore',
          message: input.message,
          snapshot: target.snapshot,
          snapshotHash: target.snapshotHash,
          derivedSnapshot: input.derivedSnapshot,
          derivedHash: stableHash(input.derivedSnapshot),
          createdBy: user.id,
          createdAt: new Date().toISOString(),
        })
        return { version, restoredFromVersionId: target.id }
      },
    )
    return success(context, result, 201, { currentVersionId: result.version.id })
  }
  const result = await callSupabaseRpc<Record<string, unknown>>(
    context,
    'restore_trip_version',
    {
      p_trip_id: tripId,
      p_target_version_id: input.targetVersionId,
      p_derived_snapshot: input.derivedSnapshot,
      p_message: input.message,
      p_idempotency_key: idempotencyKey,
    },
    user.token,
  )
  return success(context, result, 201)
})

app.get('/api/v1/trips/:tripId/diff', async (context) => {
  await requireAuthenticatedUser(context)
  const tripId = validateUuid(context.req.param('tripId'), 'tripId')
  const from = validateUuid(context.req.query('from') ?? '', 'from')
  const to = validateUuid(context.req.query('to') ?? '', 'to')
  if (context.get('mode') !== 'demo') {
    throw new AppError('DEPENDENCY_UNAVAILABLE', '生产 Diff 需由版本读取适配器提供快照', 501)
  }
  const fromVersion = DEMO_VERSIONS.find((version) => version.id === from && version.tripId === tripId)
  const toVersion = DEMO_VERSIONS.find((version) => version.id === to && version.tripId === tripId)
  if (!fromVersion || !toVersion) throw new AppError('FORBIDDEN', '版本不存在或不属于当前行程', 403)
  return success(
    context,
    semanticDiff(
      fromVersion.snapshot,
      toVersion.snapshot,
      fromVersion.derivedSnapshot,
      toVersion.derivedSnapshot,
    ),
  )
})

app.get('/api/v1/public/reports/:token', async (context) => {
  context.header('cache-control', 'no-store')
  context.header('x-robots-tag', 'noindex, nofollow')
  const token = context.req.param('token')
  if (context.get('mode') === 'demo') {
    const publication = demoPublications.get(token)
    if (!publication || publication.targetKind !== 'report') {
      throw new AppError('VALIDATION_FAILED', '分享链接不存在', 404)
    }
    if (publication.revokedAt) {
      throw new AppError('PUBLICATION_REVOKED', '该分享已撤销', 410, {
        userAction: '请联系分享者获取新链接',
      })
    }
    const report = demoReports.get(publication.reportId as string)
    if (!report) throw new AppError('VALIDATION_FAILED', '报告不存在', 404)
    const version = DEMO_VERSIONS.find((item) => item.id === report.versionId)
    if (!version) {
      throw new AppError('DEPENDENCY_UNAVAILABLE', '报告绑定版本快照不可用', 503, {
        userAction: '请联系分享者重新生成报告',
      })
    }
    return success(context, {
      report,
      snapshot: publicSnapshot(version.snapshot, publication.disclosureConfig),
      derived: version.derivedSnapshot,
      expenseSummary: {
        count: DEMO_EXPENSES.length,
        total: DEMO_EXPENSES.reduce((sum, expense) => sum + expense.amount, 0),
      },
      actualSummary: {
        visited: DEMO_ACTUALS.filter((actual) => actual.status === 'visited').length,
        skipped: DEMO_ACTUALS.filter((actual) => actual.status === 'skipped').length,
      },
    })
  }
  const tokenHash = await hashPublicationToken(token, requirePepper(context))
  const result = await callSupabaseRpc<Record<string, unknown>>(context, 'read_public_report', {
    p_token_hash: tokenHash,
  })
  return success(context, result)
})

app.get('/api/v1/public/:token', async (context) => {
  context.header('cache-control', 'no-store')
  context.header('x-robots-tag', 'noindex, nofollow')
  const token = context.req.param('token')
  if (context.get('mode') === 'demo') {
    const publication = demoPublications.get(token)
    if (!publication || publication.targetKind !== 'version') {
      throw new AppError('VALIDATION_FAILED', '分享链接不存在', 404)
    }
    if (publication.revokedAt) {
      throw new AppError('PUBLICATION_REVOKED', '该分享已撤销', 410, {
        userAction: '请联系分享者获取新链接',
      })
    }
    const version = DEMO_VERSIONS.find((item) => item.id === publication.versionId)
    if (!version) throw new AppError('VALIDATION_FAILED', '分享版本不存在', 404)
    return success(context, {
      publicationId: publication.id,
      versionId: version.id,
      snapshot: publicSnapshot(version.snapshot, publication.disclosureConfig),
      derived: version.derivedSnapshot,
    })
  }
  const tokenHash = await hashPublicationToken(token, requirePepper(context))
  const result = await callSupabaseRpc<Record<string, unknown>>(context, 'read_public_trip', {
    p_token_hash: tokenHash,
  })
  return success(context, result)
})

export { app }
export default app
