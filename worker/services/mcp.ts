import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z, ZodError } from 'zod'
import {
  BudgetAssumptionsSchema,
  DerivedSnapshotSchema,
  StayAnchorSchema,
  TripDaySchema,
  TripPlaceSnapshotSchema,
  TripSnapshotSchema,
  TripSourceSnapshotSchema,
  TripStopSchema,
  TripVersionSchema,
  UuidSchema,
  cloneJson,
  classifyVersionChange,
  semanticDiff,
  stableUuid,
  type DerivedSnapshot,
  type StayAnchor,
  type TripSnapshot,
  type TripStop,
  type TripVersion,
} from '../../packages/domain/src/index'
import { AppError } from '../lib/errors'
import type { AppContext, AuthenticatedUser } from '../types'
import { searchAmapPlaces } from './amap'
import { callSupabaseRpc, readSupabaseRow, readSupabaseRows, requireAuthenticatedUser } from './supabase'
import { recalculateTripWithRoutes } from './trip-planning'
import {
  JOVLO_MCP_INSTRUCTIONS,
  buildDaySuggestions,
  buildTripSuggestions,
  buildWriteReminders,
} from './mcp-guidance'

type ConnectionRow = {
  id: string
  trip_id: string | null
  owner_id: string
  status: 'pending' | 'active' | 'revoked' | 'expired'
  scopes: string[]
  expires_at: string
  revoked_at: string | null
}

function requireBoundTrip(connection: ConnectionRow): string {
  if (!connection.trip_id) {
    throw new AppError('VALIDATION_FAILED', '这条连接尚未创建路书', 409, {
      retryable: false,
      userAction: '如果用户要创建新路书，请整理好完整快照后调用 jovlo_create_trip',
    })
  }
  return connection.trip_id
}

type TripState = {
  snapshot: TripSnapshot
  currentVersionId: string | null
  draftRevision: number
  currentDerived: DerivedSnapshot | null
}

const TripPatchSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  entryAnchor: z.object({ placeId: UuidSchema, label: z.string().trim().min(1).max(120) }).strict().optional(),
  exitAnchor: z.object({ placeId: UuidSchema, label: z.string().trim().min(1).max(120) }).strict().optional(),
  partySize: z.number().int().min(1).max(50).optional(),
  vehicle: z.object({
    type: z.enum(['fuel', 'ev', 'hybrid']),
    consumption: z.number().finite().positive().max(100).optional(),
  }).strict().optional(),
  pace: z.enum(['relaxed', 'balanced', 'packed']).optional(),
  maxDriveMinutesPerDay: z.number().int().min(30).max(1_440).optional(),
  dayEndLimit: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  totalBudget: z.number().finite().positive().nullable().optional(),
  mustPlaceIds: z.array(UuidSchema).max(50).optional(),
  avoidTags: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  userNotes: z.string().trim().max(4_000).nullable().optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, '至少需要修改一个字段')

const McpOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('update_trip'), patch: TripPatchSchema }).strict(),
  z.object({ type: z.literal('upsert_place'), place: TripPlaceSnapshotSchema }).strict(),
  z.object({ type: z.literal('remove_place'), placeId: UuidSchema }).strict(),
  z.object({ type: z.literal('upsert_source'), source: TripSourceSnapshotSchema }).strict(),
  z.object({ type: z.literal('remove_source'), sourceId: UuidSchema }).strict(),
  z.object({ type: z.literal('upsert_day'), day: TripDaySchema }).strict(),
  z.object({ type: z.literal('remove_day'), dayId: UuidSchema }).strict(),
  z.object({
    type: z.literal('upsert_stop'),
    dayId: UuidSchema,
    stop: TripStopSchema,
    afterStopId: UuidSchema.nullable().optional(),
  }).strict(),
  z.object({ type: z.literal('remove_stop'), stopId: UuidSchema }).strict(),
  z.object({
    type: z.literal('move_stop'),
    stopId: UuidSchema,
    targetDayId: UuidSchema,
    afterStopId: UuidSchema.nullable(),
  }).strict(),
  z.object({
    type: z.literal('set_overnight_stay'),
    dayId: UuidSchema,
    anchor: StayAnchorSchema.nullable(),
  }).strict(),
  z.object({ type: z.literal('set_budget_assumptions'), assumptions: BudgetAssumptionsSchema }).strict(),
  z.object({ type: z.literal('replace_trip'), snapshot: TripSnapshotSchema }).strict(),
])

type McpOperation = z.infer<typeof McpOperationSchema>

function jsonObject(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

function toolSuccess(value: unknown) {
  const structuredContent = jsonObject(value)
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }],
    structuredContent,
  }
}

function toolFailure(error: unknown) {
  const detail = error instanceof AppError
    ? { code: error.code, message: error.message, retryable: error.retryable, userAction: error.userAction, details: error.details }
    : error instanceof ZodError
      ? { code: 'VALIDATION_FAILED', message: '修改内容未通过路书校验', retryable: false }
      : { code: 'INTERNAL_ERROR', message: '本次操作未完成', retryable: true }
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify(detail) }],
    structuredContent: detail,
  }
}

async function runTool<T>(operation: () => Promise<T>) {
  try {
    return toolSuccess(await operation())
  } catch (error) {
    return toolFailure(error)
  }
}

function decodeJwtClaims(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1]
    if (!payload) return {}
    const normalized = payload.replaceAll('-', '+').replaceAll('_', '/')
    return JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))) as Record<string, unknown>
  } catch {
    return {}
  }
}

async function requestClientInfo(request: Request, token: string) {
  const claims = decodeJwtClaims(token)
  const oauthClientId = typeof claims.client_id === 'string' ? claims.client_id : 'dynamic-mcp-client'
  const sessionId = typeof claims.session_id === 'string' && claims.session_id.trim()
    ? claims.session_id.trim()
    : null
  let name = oauthClientId === 'dynamic-mcp-client' ? 'MCP Agent' : oauthClientId
  if (request.method === 'POST') {
    try {
      const body = await request.clone().json() as { method?: string; params?: { clientInfo?: { name?: string; version?: string } } }
      const client = body.method === 'initialize' ? body.params?.clientInfo : undefined
      if (client?.name) name = `${client.name}${client.version ? ` ${client.version}` : ''}`.slice(0, 160)
    } catch {
      // Non-JSON requests are rejected by the MCP transport itself.
    }
  }
  return {
    clientId: sessionId ? `${oauthClientId}:${sessionId}` : oauthClientId,
    legacyClientId: oauthClientId,
    clientName: name,
    expiresAt: typeof claims.exp === 'number' ? claims.exp : undefined,
  }
}

async function authorizeConnection(
  context: AppContext,
  connectionId: string,
): Promise<{ user: AuthenticatedUser; connection: ConnectionRow; clientId: string; clientName: string; expiresAt?: number }> {
  const user = await requireAuthenticatedUser(context)
  if (!user.token) throw new AppError('AUTH_REQUIRED', '需要登录后继续', 401)
  const connection = await readSupabaseRow<ConnectionRow>(
    context,
    'mcp_connections',
    `id=eq.${connectionId}&select=id,trip_id,owner_id,status,scopes,expires_at,revoked_at`,
    user.token,
  )
  if (!connection || connection.owner_id !== user.id || connection.revoked_at) {
    throw new AppError('FORBIDDEN', '连接无效或已撤销', 403)
  }
  if (connection.status === 'revoked' || new Date(connection.expires_at).getTime() <= Date.now()) {
    throw new AppError('FORBIDDEN', '连接已过期，请在 Jovlo 重新创建', 403)
  }
  const client = await requestClientInfo(context.req.raw, user.token)
  await callSupabaseRpc(
    context,
    'activate_mcp_connection',
    {
      p_connection_id: connectionId,
      p_client_id: client.clientId,
      p_client_name: client.clientName,
    },
    user.token,
  )
  return { user, connection: { ...connection, status: 'active' }, ...client }
}

async function readTripState(context: AppContext, connection: ConnectionRow, token: string): Promise<TripState> {
  const tripId = requireBoundTrip(connection)
  const trip = await readSupabaseRow<{ current_version_id: string | null }>(
    context,
    'trips',
    `id=eq.${tripId}&select=current_version_id`,
    token,
  )
  const draft = await readSupabaseRow<{ snapshot: unknown; revision: number }>(
    context,
    'trip_drafts',
    `trip_id=eq.${tripId}&select=snapshot,revision`,
    token,
  )
  if (!trip || !draft) throw new AppError('FORBIDDEN', '连接无效或已撤销', 403)
  const version = trip.current_version_id
    ? await readSupabaseRow<{ derived_snapshot: unknown }>(
        context,
        'trip_versions',
        `id=eq.${trip.current_version_id}&trip_id=eq.${tripId}&select=derived_snapshot`,
        token,
      )
    : null
  return {
    snapshot: TripSnapshotSchema.parse(draft.snapshot),
    currentVersionId: trip.current_version_id,
    draftRevision: Number(draft.revision),
    currentDerived: version ? DerivedSnapshotSchema.parse(version.derived_snapshot) : null,
  }
}

function addDays(date: string, offset: number): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + offset)
  return value.toISOString().slice(0, 10)
}

function removeStop(snapshot: TripSnapshot, stopId: string): TripStop | null {
  for (const day of snapshot.days) {
    const index = day.stops.findIndex((stop) => stop.id === stopId)
    if (index >= 0) return day.stops.splice(index, 1)[0]
  }
  return null
}

function insertStop(stops: TripStop[], stop: TripStop, afterStopId?: string | null) {
  if (afterStopId === undefined) {
    stops.push(stop)
    return
  }
  if (afterStopId === null) {
    stops.unshift(stop)
    return
  }
  const index = stops.findIndex((item) => item.id === afterStopId)
  if (index < 0) throw new AppError('VALIDATION_FAILED', '指定的前置地点不存在', 400)
  stops.splice(index + 1, 0, stop)
}

function applyOperations(input: TripSnapshot, operations: McpOperation[]): TripSnapshot {
  let snapshot = cloneJson(input)
  for (const operation of operations) {
    if (operation.type === 'replace_trip') {
      if (operation.snapshot.tripId !== input.tripId) {
        throw new AppError('VALIDATION_FAILED', '不允许替换为其他路书', 400)
      }
      snapshot = cloneJson(operation.snapshot)
      continue
    }
    if (operation.type === 'update_trip') {
      const { patch } = operation
      if (patch.title !== undefined) snapshot.title = patch.title
      if (patch.startDate !== undefined) {
        if (patch.startDate === null) {
          delete snapshot.intent.startDate
          snapshot.days.forEach((day) => { delete day.date })
        } else {
          snapshot.intent.startDate = patch.startDate
          snapshot.days.forEach((day, index) => { day.date = addDays(patch.startDate as string, index) })
        }
      }
      for (const key of ['entryAnchor', 'exitAnchor', 'partySize', 'vehicle', 'pace', 'maxDriveMinutesPerDay', 'dayEndLimit', 'mustPlaceIds', 'avoidTags'] as const) {
        const value = patch[key]
        if (value !== undefined) Object.assign(snapshot.intent, { [key]: value })
      }
      if (patch.totalBudget !== undefined) {
        if (patch.totalBudget === null) delete snapshot.intent.totalBudget
        else snapshot.intent.totalBudget = patch.totalBudget
      }
      if (patch.userNotes !== undefined) {
        if (patch.userNotes === null) delete snapshot.userNotes
        else snapshot.userNotes = patch.userNotes
      }
      continue
    }
    if (operation.type === 'upsert_place') snapshot.placeRefs[operation.place.placeId] = operation.place
    if (operation.type === 'remove_place') delete snapshot.placeRefs[operation.placeId]
    if (operation.type === 'upsert_source') snapshot.sourceRefs[operation.source.sourceId] = operation.source
    if (operation.type === 'remove_source') delete snapshot.sourceRefs[operation.sourceId]
    if (operation.type === 'upsert_day') {
      const index = snapshot.days.findIndex((day) => day.id === operation.day.id)
      if (index >= 0) snapshot.days[index] = operation.day
      else snapshot.days.push(operation.day)
      snapshot.days.sort((left, right) => left.dayIndex - right.dayIndex)
    }
    if (operation.type === 'remove_day') {
      snapshot.days = snapshot.days.filter((day) => day.id !== operation.dayId)
    }
    if (operation.type === 'upsert_stop') {
      removeStop(snapshot, operation.stop.id)
      const day = snapshot.days.find((item) => item.id === operation.dayId)
      if (!day) throw new AppError('VALIDATION_FAILED', '目标日期不存在', 400)
      insertStop(day.stops, operation.stop, operation.afterStopId)
    }
    if (operation.type === 'remove_stop') {
      if (!removeStop(snapshot, operation.stopId)) {
        throw new AppError('VALIDATION_FAILED', '要删除的地点不存在', 400)
      }
    }
    if (operation.type === 'move_stop') {
      const stop = removeStop(snapshot, operation.stopId)
      const day = snapshot.days.find((item) => item.id === operation.targetDayId)
      if (!stop || !day) throw new AppError('VALIDATION_FAILED', '移动的地点或目标日期不存在', 400)
      insertStop(day.stops, stop, operation.afterStopId)
    }
    if (operation.type === 'set_overnight_stay') {
      const day = snapshot.days.find((item) => item.id === operation.dayId)
      if (!day) throw new AppError('VALIDATION_FAILED', '目标日期不存在', 400)
      if (operation.anchor) day.overnightStay = operation.anchor as StayAnchor
      else delete day.overnightStay
    }
    if (operation.type === 'set_budget_assumptions') snapshot.budgetAssumptions = operation.assumptions
  }
  snapshot.days.forEach((day, index) => {
    day.dayIndex = index + 1
    if (snapshot.intent.startDate) day.date = addDays(snapshot.intent.startDate, index)
  })
  snapshot.intent.days = snapshot.days.length
  return TripSnapshotSchema.parse(snapshot)
}

async function applyAgentSnapshot(
  context: AppContext,
  auth: { user: AuthenticatedUser; connection: ConnectionRow },
  state: TripState,
  snapshot: TripSnapshot,
  expectedRevision: number,
  message: string,
  idempotencyKey: string,
  confirmMajorChange = false,
) {
  const tripId = requireBoundTrip(auth.connection)
  if (expectedRevision !== state.draftRevision) {
    throw new AppError('DRAFT_REVISION_STALE', '路书已有新修改', 409, {
      retryable: true,
      userAction: '重新读取路书后再提交',
    })
  }
  const { derived, warnings } = await recalculateTripWithRoutes(snapshot, context)
  const impact = semanticDiff(state.snapshot, snapshot, state.currentDerived ?? undefined, derived)
  const classification = classifyVersionChange(
    state.snapshot,
    snapshot,
    state.currentDerived ?? undefined,
    derived,
  )
  if (classification.level === 'major' && !confirmMajorChange) {
    throw new AppError(
      'MAJOR_CHANGE_CONFIRMATION_REQUIRED',
      '这次修改会形成大版本，需要先向用户确认影响',
      409,
      {
        retryable: true,
        userAction: '简要说明大版本原因；用户确认后使用相同修改并设置 confirmMajorChange=true',
        details: classification,
      },
    )
  }
  const result = await callSupabaseRpc<Record<string, unknown>>(
    context,
    'apply_agent_snapshot',
    {
      p_connection_id: auth.connection.id,
      p_trip_id: tripId,
      p_expected_revision: expectedRevision,
      p_base_version_id: state.currentVersionId,
      p_snapshot: snapshot,
      p_derived_snapshot: derived,
      p_message: message,
      p_idempotency_key: idempotencyKey,
    },
    auth.user.token,
  )
  return {
    versionId: String(result.versionId ?? result.version_id),
    versionNo: Number(result.versionNo ?? result.version_no),
    revision: Number(result.draftRevision ?? result.draft_revision),
    impact: {
      counts: impact.counts,
      affectedDays: impact.affectedDays,
      ...impact.impact,
    },
    classification,
    warnings,
    reminders: buildWriteReminders(Number(result.versionNo ?? result.version_no), classification, warnings),
  }
}

function parseVersionRow(row: Record<string, unknown>): TripVersion {
  return TripVersionSchema.parse({
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
  })
}

function connectionResourceUrl(context: AppContext, connectionId: string) {
  return `${new URL(context.req.url).origin}/mcp/${connectionId}`
}

export function oauthProtectedResourceMetadata(context: AppContext, connectionId?: string) {
  const supabaseUrl = context.env.SUPABASE_URL?.replace(/\/$/, '')
  if (!supabaseUrl) throw new AppError('DEPENDENCY_UNAVAILABLE', 'OAuth 服务尚未配置', 503)
  return {
    resource: connectionId ? connectionResourceUrl(context, connectionId) : `${new URL(context.req.url).origin}/mcp`,
    authorization_servers: [`${supabaseUrl}/auth/v1`],
    bearer_methods_supported: ['header'],
    scopes_supported: ['openid', 'email'],
  }
}

export function mcpAuthenticationResponse(context: AppContext, connectionId?: string) {
  const metadataUrl = connectionId
    ? `${new URL(context.req.url).origin}/.well-known/oauth-protected-resource/mcp/${connectionId}`
    : `${new URL(context.req.url).origin}/.well-known/oauth-protected-resource/mcp`
  return new Response(JSON.stringify({
    jsonrpc: '2.0',
    error: { code: -32001, message: '需要通过 Jovlo 登录授权' },
    id: null,
  }), {
    status: 401,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'www-authenticate': `Bearer resource_metadata="${metadataUrl}"`,
    },
  })
}

type AccountConnectionRow = {
  id: string
  trip_id: string | null
  client_id: string | null
}

async function readAccountConnection(
  context: AppContext,
  token: string,
  clientId: string,
  bound: boolean,
): Promise<AccountConnectionRow | null> {
  return readSupabaseRow<AccountConnectionRow>(
    context,
    'mcp_connections',
    [
      `client_id=eq.${encodeURIComponent(clientId)}`,
      bound ? 'trip_id=not.is.null' : 'trip_id=is.null',
      'status=in.(pending,active)',
      'revoked_at=is.null',
      `expires_at=gt.${new Date().toISOString()}`,
      'select=id,trip_id,client_id',
      'order=created_at.desc',
    ].join('&'),
    token,
  )
}

async function ensureAccountConnection(context: AppContext): Promise<string> {
  const user = await requireAuthenticatedUser(context)
  if (!user.token) throw new AppError('AUTH_REQUIRED', '需要登录后继续', 401)

  const client = await requestClientInfo(context.req.raw, user.token)
  const clientIds = client.clientId === client.legacyClientId
    ? [client.clientId]
    : [client.clientId, client.legacyClientId]

  for (const clientId of clientIds) {
    const bound = await readAccountConnection(context, user.token, clientId, true)
    if (bound) return bound.id
    const unbound = await readAccountConnection(context, user.token, clientId, false)
    if (unbound) return unbound.id
  }

  const pending = await readSupabaseRow<AccountConnectionRow>(
    context,
    'mcp_connections',
    [
      'trip_id=is.null',
      'client_id=is.null',
      'status=in.(pending,active)',
      'revoked_at=is.null',
      `expires_at=gt.${new Date().toISOString()}`,
      'select=id,trip_id,client_id',
      'order=created_at.desc',
    ].join('&'),
    user.token,
  )
  if (pending) return pending.id

  const created = await callSupabaseRpc<Record<string, unknown>>(
    context,
    'create_unbound_mcp_connection',
    { p_idempotency_key: `mcp-account-${crypto.randomUUID()}` },
    user.token,
  )
  return UuidSchema.parse(created.id)
}

export async function handleAccountMcpRequest(context: AppContext): Promise<Response> {
  let connectionId: string
  try {
    connectionId = await ensureAccountConnection(context)
  } catch (error) {
    if (error instanceof AppError && error.code === 'AUTH_REQUIRED') {
      return mcpAuthenticationResponse(context)
    }
    if (error instanceof AppError) {
      return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32003, message: error.message }, id: null }), {
        status: error.status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      })
    }
    throw error
  }
  return handleMcpRequest(context, connectionId)
}

export async function handleMcpRequest(context: AppContext, connectionId: string): Promise<Response> {
  let auth: Awaited<ReturnType<typeof authorizeConnection>>
  try {
    auth = await authorizeConnection(context, connectionId)
  } catch (error) {
    if (error instanceof AppError && error.code === 'AUTH_REQUIRED') {
      return mcpAuthenticationResponse(context, connectionId)
    }
    if (error instanceof AppError) {
      return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32003, message: error.message }, id: null }), {
        status: error.status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      })
    }
    throw error
  }

  const server = new McpServer(
    { name: 'Jovlo', version: '1.1.0', websiteUrl: 'https://jovlo.8xd.io' },
    { instructions: JOVLO_MCP_INSTRUCTIONS },
  )
  const readState = () => readTripState(context, auth.connection, auth.user.token as string)

  server.registerTool('jovlo_create_trip', {
    title: '创建新路书',
    description: '仅用于尚未绑定路书的新建连接。根据用户明确要求一次性创建完整路书，系统重算路线、耗时、预算和天气后生成 v1；建立 MCP 连接本身不会创建空路书。',
    inputSchema: {
      snapshot: TripSnapshotSchema,
      idempotencyKey: z.string().trim().min(8).max(200),
      message: z.string().trim().min(1).max(500).default('Agent 创建路书'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ snapshot, idempotencyKey, message }) => runTool(async () => {
    if (auth.connection.trip_id) {
      throw new AppError('VALIDATION_FAILED', '这条连接已绑定路书，不能再创建新路书', 409, {
        userAction: '修改当前路书请先调用 jovlo_get_trip，再调用 jovlo_apply_trip_changes',
      })
    }
    const parsedSnapshot = TripSnapshotSchema.parse(snapshot)
    const { derived, warnings } = await recalculateTripWithRoutes(parsedSnapshot, context)
    const result = await callSupabaseRpc<Record<string, unknown>>(
      context,
      'create_trip_from_mcp',
      {
        p_connection_id: auth.connection.id,
        p_snapshot: parsedSnapshot,
        p_derived_snapshot: derived,
        p_message: message,
        p_idempotency_key: idempotencyKey,
      },
      auth.user.token,
    )
    auth.connection.trip_id = parsedSnapshot.tripId
    return {
      ...result,
      trip: parsedSnapshot,
      derived,
      warnings,
      openUrl: `${new URL(context.req.url).origin}/trips/${parsedSnapshot.tripId}/plan`,
      reminders: ['路书已创建并自动绑定当前 MCP 连接；后续修改请先重新读取 revision。'],
    }
  }))

  server.registerTool('jovlo_get_trip', {
    title: '读取完整路书',
    description: '读取当前路书的可编辑快照、revision 和最新派生数据。写入前必须先读取。',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => runTool(async () => {
    const state = await readState()
    return {
      trip: state.snapshot,
      revision: state.draftRevision,
      currentVersionId: state.currentVersionId,
      derived: state.currentDerived,
      suggestions: buildTripSuggestions(state.snapshot, state.currentDerived),
    }
  }))

  server.registerTool('jovlo_get_day', {
    title: '读取单日行程',
    description: '按 dayId 或 dayIndex 读取单日安排、地点和对应派生数据。',
    inputSchema: {
      dayId: UuidSchema.optional(),
      dayIndex: z.number().int().min(1).max(30).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ dayId, dayIndex }) => runTool(async () => {
    const state = await readState()
    const day = state.snapshot.days.find((item) => dayId ? item.id === dayId : item.dayIndex === dayIndex)
    if (!day) throw new AppError('VALIDATION_FAILED', '指定日期不存在', 404)
    return {
      day,
      places: Object.fromEntries(day.stops.map((stop) => [stop.placeId, state.snapshot.placeRefs[stop.placeId]])),
      routeLegs: state.currentDerived?.routeLegs.filter((leg) => leg.dayId === day.id) ?? [],
      schedule: state.currentDerived?.daySchedules.find((schedule) => schedule.dayId === day.id) ?? null,
      revision: state.draftRevision,
      suggestions: buildDaySuggestions(state.snapshot, state.currentDerived, day.id),
    }
  }))

  server.registerTool('jovlo_search_places', {
    title: '搜索旅行地点',
    description: '使用高德搜索可用于路书的景点、餐厅、住宿或交通点。',
    inputSchema: {
      query: z.string().trim().min(1).max(100),
      city: z.string().trim().min(1).max(80).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ query, city }) => runTool(async () => {
    const places = await searchAmapPlaces(query, city, context.env)
    return {
      places: places.map((place) => ({
        ...place,
        suggestedPlaceId: stableUuid(`amap:${place.providerId}`),
      })),
      coordinateNote: '高德返回 GCJ02 坐标；写入路书时同时提供 WGS84 坐标。',
    }
  }))

  server.registerTool('jovlo_apply_trip_changes', {
    title: '修改路书',
    description: '使用类型化操作原子修改路书。系统会重算路线、耗时、预算和天气并立即生成 Agent 版本；大版本必须先向用户说明影响并确认。',
    inputSchema: {
      expectedRevision: z.number().int().nonnegative(),
      idempotencyKey: z.string().trim().min(8).max(200),
      message: z.string().trim().min(1).max(500),
      operations: z.array(McpOperationSchema).min(1).max(100),
      confirmMajorChange: z.boolean().default(false),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, async ({ expectedRevision, idempotencyKey, message, operations, confirmMajorChange }) => runTool(async () => {
    const state = await readState()
    const snapshot = applyOperations(state.snapshot, operations)
    return applyAgentSnapshot(context, auth, state, snapshot, expectedRevision, message, idempotencyKey, confirmMajorChange)
  }))

  server.registerTool('jovlo_list_versions', {
    title: '查看版本历史',
    description: '列出路书版本及大/小版本原因。回看只读；恢复会创建新版本并保留当前和全部历史。',
    inputSchema: { limit: z.number().int().min(1).max(50).default(20) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ limit }) => runTool(async () => {
    const tripId = requireBoundTrip(auth.connection)
    const rows = await readSupabaseRows<Record<string, unknown>>(
      context,
      'trip_versions',
      `trip_id=eq.${tripId}&select=id,trip_id,version_no,parent_version_id,source,message,snapshot,snapshot_hash,derived_snapshot,derived_hash,created_by,created_at&order=version_no.desc&limit=${limit + 1}`,
      auth.user.token as string,
    )
    const parsed = rows.map(parseVersionRow)
    return {
      versions: parsed.slice(0, limit).map((version, index) => {
        const older = parsed[index + 1]
        return {
          id: version.id,
          versionNo: version.versionNo,
          parentVersionId: version.parentVersionId,
          source: version.source,
          message: version.message,
          createdAt: version.createdAt,
          classification: classifyVersionChange(
            older?.snapshot,
            version.snapshot,
            older?.derivedSnapshot,
            version.derivedSnapshot,
          ),
        }
      }),
      policy: {
        browse: '只读回看不会修改当前路书',
        restore: '恢复或撤销会复制目标快照成为新版本，现有最新版和全部历史仍会保留',
      },
    }
  }))

  server.registerTool('jovlo_undo_last_change', {
    title: '撤销上一次修改',
    description: '将上一个版本的固定快照恢复为新的 Agent 版本，不删除任何历史。',
    inputSchema: {
      expectedRevision: z.number().int().nonnegative(),
      idempotencyKey: z.string().trim().min(8).max(200),
      message: z.string().trim().min(1).max(500).default('Agent 撤销上一次修改'),
      confirmMajorChange: z.boolean().default(false),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ expectedRevision, idempotencyKey, message, confirmMajorChange }) => runTool(async () => {
    const state = await readState()
    const tripId = requireBoundTrip(auth.connection)
    const rows = await readSupabaseRows<Record<string, unknown>>(
      context,
      'trip_versions',
      `trip_id=eq.${tripId}&select=id,trip_id,version_no,parent_version_id,source,message,snapshot,snapshot_hash,derived_snapshot,derived_hash,created_by,created_at&order=version_no.desc&limit=2`,
      auth.user.token as string,
    )
    if (rows.length < 2) throw new AppError('VALIDATION_FAILED', '暂无可撤销的上一版本', 409)
    const target = parseVersionRow(rows[1])
    return applyAgentSnapshot(context, auth, state, target.snapshot, expectedRevision, message, idempotencyKey, confirmMajorChange)
  }))

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  try {
    return await transport.handleRequest(context.req.raw, {
      authInfo: {
        token: auth.user.token as string,
        clientId: auth.clientId,
        scopes: auth.connection.scopes,
        expiresAt: auth.expiresAt,
        resource: new URL(connectionResourceUrl(context, connectionId)),
      },
    })
  } finally {
    await server.close()
  }
}
