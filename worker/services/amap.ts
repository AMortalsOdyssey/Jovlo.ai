import { z } from 'zod'
import { RouteLegSchema, type RouteLeg } from '../../packages/domain/src/index'
import { AppError } from '../lib/errors'
import type { Env } from '../types'
import type { RouteDryRunRequest } from '../schemas'

const AMAP_SERVICE_PREFIX = '/_AMapService'
const AMAP_PROXY_TIMEOUT_MS = 8_000
const AMAP_PROXY_MAX_RESPONSE_BYTES = 1_000_000
const AMAP_PROXY_MAX_QUERY_BYTES = 2_048
const AMAP_ROUTE_CONCURRENCY = 2
const AMAP_ROUTE_START_INTERVAL_MS = 420
const AMAP_ROUTE_MAX_ATTEMPTS = 3
const AMAP_ROUTE_RETRY_BASE_MS = 350

type AmapFailureKind = 'rate-limit' | 'quota' | 'configuration' | 'no-route' | 'unavailable'

export type RouteProviderNotice = {
  code: 'rate_limited' | 'quota_exceeded' | 'configuration' | 'no_route' | 'unavailable' | 'not_configured'
  message: string
  retryable: boolean
  retryAfterSeconds?: number
  failedLegs: number
}

class AmapRouteError extends Error {
  constructor(
    readonly kind: AmapFailureKind,
    readonly retryable: boolean,
    readonly retryAfterSeconds?: number,
  ) {
    super(kind)
    this.name = 'AmapRouteError'
  }
}

const AMAP_RATE_LIMIT_CODES = new Set([
  '10004',
  '10014',
  '10015',
  '10019',
  '10020',
  '10021',
  '10029',
])
const AMAP_QUOTA_CODES = new Set(['10003', '10044', '40000', '40002', '40003'])
const AMAP_CONFIGURATION_CODES = new Set([
  '10001',
  '10002',
  '10005',
  '10006',
  '10007',
  '10009',
  '10012',
  '10013',
  '10026',
  '10041',
])
const AMAP_NO_ROUTE_CODES = new Set(['20800', '20801', '20802', '20803'])
const AMAP_TRANSIENT_CODES = new Set(['10016', '10017', '20003'])

type AmapProxyRule = {
  upstreamOrigin: 'https://restapi.amap.com' | 'https://webapi.amap.com'
  queryParameters: ReadonlySet<string>
}

const COMMON_QUERY_PARAMETERS = [
  'key',
  'output',
  's',
  'platform',
  'sdkversion',
  'logversion',
  'appname',
  'csid',
  'callback',
]

function queryParameters(...parameters: string[]): ReadonlySet<string> {
  return new Set([...COMMON_QUERY_PARAMETERS, ...parameters])
}

const AMAP_PROXY_RULES: ReadonlyMap<string, AmapProxyRule> = new Map([
  [
    '/v4/map/styles',
    {
      upstreamOrigin: 'https://webapi.amap.com',
      queryParameters: queryParameters('styleid'),
    },
  ],
  [
    '/v3/config/district',
    {
      upstreamOrigin: 'https://restapi.amap.com',
      queryParameters: queryParameters('keywords', 'subdistrict', 'showbiz', 'extensions', 'filter'),
    },
  ],
  [
    '/v3/log/init',
    {
      upstreamOrigin: 'https://restapi.amap.com',
      queryParameters: queryParameters(
        'eventId',
        'product',
        't',
        'resolution',
        'mob',
        'vt',
        'dpr',
        'scale',
        'label',
        'value',
      ),
    },
  ],
  [
    '/v3/geocode/geo',
    {
      upstreamOrigin: 'https://restapi.amap.com',
      queryParameters: queryParameters('address', 'city', 'batch'),
    },
  ],
  [
    '/v3/geocode/regeo',
    {
      upstreamOrigin: 'https://restapi.amap.com',
      queryParameters: queryParameters(
        'location',
        'poitype',
        'radius',
        'extensions',
        'batch',
        'roadlevel',
        'homeorcorp',
      ),
    },
  ],
  [
    '/v3/assistant/inputtips',
    {
      upstreamOrigin: 'https://restapi.amap.com',
      queryParameters: queryParameters('keywords', 'type', 'location', 'city', 'citylimit', 'datatype'),
    },
  ],
  [
    '/v3/place/text',
    {
      upstreamOrigin: 'https://restapi.amap.com',
      queryParameters: queryParameters(
        'keywords',
        'types',
        'city',
        'citylimit',
        'children',
        'offset',
        'page',
        'building',
        'floor',
        'extensions',
      ),
    },
  ],
  [
    '/v3/place/around',
    {
      upstreamOrigin: 'https://restapi.amap.com',
      queryParameters: queryParameters(
        'location',
        'keywords',
        'types',
        'city',
        'radius',
        'sortrule',
        'offset',
        'page',
        'extensions',
      ),
    },
  ],
])

function isSameOriginBrowserRequest(request: Request, requestUrl: URL): boolean {
  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')
  const fetchSite = request.headers.get('sec-fetch-site')
  if (fetchSite && fetchSite !== 'same-origin') return false
  if (origin) return origin === requestUrl.origin
  if (referer) {
    try {
      return new URL(referer).origin === requestUrl.origin
    } catch {
      return false
    }
  }
  return fetchSite === 'same-origin'
}

function validateProxyQuery(requestUrl: URL, rule: AmapProxyRule): void {
  if (requestUrl.search.length > AMAP_PROXY_MAX_QUERY_BYTES) {
    throw new AppError('VALIDATION_FAILED', '高德代理查询参数过长', 400)
  }
  if (requestUrl.searchParams.has('jscode')) {
    throw new AppError('FORBIDDEN', '安全密钥只能由服务端追加', 403)
  }
  for (const [name, value] of requestUrl.searchParams) {
    if (!rule.queryParameters.has(name)) {
      throw new AppError('FORBIDDEN', '高德代理包含未授权参数', 403, { details: { parameter: name } })
    }
    if (requestUrl.searchParams.getAll(name).length !== 1 || value.length > 512) {
      throw new AppError('VALIDATION_FAILED', '高德代理参数格式无效', 400, {
        details: { parameter: name },
      })
    }
  }
  const key = requestUrl.searchParams.get('key')
  if (!key || !/^[A-Za-z0-9]{16,64}$/.test(key)) {
    throw new AppError('VALIDATION_FAILED', '高德 JS Key 格式无效', 400)
  }
  const callback = requestUrl.searchParams.get('callback')
  if (callback && !/^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/.test(callback)) {
    throw new AppError('VALIDATION_FAILED', '高德 JSONP 回调格式无效', 400)
  }
}

function proxyRequestHeaders(request: Request): Headers {
  const headers = new Headers({ accept: 'application/json,text/plain,*/*' })
  for (const name of ['accept-language', 'referer', 'user-agent']) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  return headers
}

export async function proxyAmapJsApiRequest(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') {
    throw new AppError('FORBIDDEN', '高德安全代理只允许 GET 请求', 405)
  }
  if (!env.AMAP_SECURITY_JSCODE) {
    throw new AppError('DEPENDENCY_UNAVAILABLE', '高德 JS API 安全代理未配置', 503, {
      retryable: false,
      userAction: '请联系管理员检查 AMAP_SECURITY_JSCODE',
    })
  }

  const requestUrl = new URL(request.url)
  if (!isSameOriginBrowserRequest(request, requestUrl)) {
    throw new AppError('FORBIDDEN', '高德安全代理只接受同域浏览器请求', 403)
  }

  const upstreamPath = requestUrl.pathname.slice(AMAP_SERVICE_PREFIX.length)
  const rule = AMAP_PROXY_RULES.get(upstreamPath)
  if (!rule) {
    throw new AppError('FORBIDDEN', '高德代理路径不在固定白名单中', 403)
  }
  validateProxyQuery(requestUrl, rule)

  const upstreamUrl = new URL(upstreamPath, rule.upstreamOrigin)
  for (const [name, value] of requestUrl.searchParams) upstreamUrl.searchParams.set(name, value)
  upstreamUrl.searchParams.set('jscode', env.AMAP_SECURITY_JSCODE)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AMAP_PROXY_TIMEOUT_MS)
  try {
    const response = await fetch(upstreamUrl, {
      method: 'GET',
      headers: proxyRequestHeaders(request),
      redirect: 'manual',
      signal: controller.signal,
    })
    if (response.status >= 300 && response.status < 400) {
      throw new AppError('ROUTE_PROVIDER_UNAVAILABLE', '高德代理拒绝了上游重定向', 502, {
        retryable: true,
      })
    }
    const declaredSize = Number(response.headers.get('content-length') ?? '0')
    if (Number.isFinite(declaredSize) && declaredSize > AMAP_PROXY_MAX_RESPONSE_BYTES) {
      throw new AppError('ROUTE_PROVIDER_UNAVAILABLE', '高德代理响应超过大小限制', 502)
    }
    const body = await response.arrayBuffer()
    if (body.byteLength > AMAP_PROXY_MAX_RESPONSE_BYTES) {
      throw new AppError('ROUTE_PROVIDER_UNAVAILABLE', '高德代理响应超过大小限制', 502)
    }
    const contentType = requestUrl.searchParams.has('callback')
      ? 'application/javascript; charset=utf-8'
      : response.headers.get('content-type') ?? 'application/json; charset=utf-8'
    return new Response(body, {
      status: response.status,
      headers: {
        'content-type': contentType,
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('ROUTE_PROVIDER_UNAVAILABLE', '高德安全代理暂时不可用', 503, {
      retryable: true,
    })
  } finally {
    clearTimeout(timer)
  }
}

const AMapResponseSchema = z
  .object({
    status: z.string(),
    info: z.string().optional(),
    infocode: z.string().optional(),
    route: z
      .object({
        paths: z
          .array(
            z
              .object({
                distance: z.coerce.number().int().nonnegative(),
                duration: z.coerce.number().int().nonnegative().optional(),
                polyline: z.string().optional(),
                tolls: z.coerce.number().nonnegative().optional(),
                traffic_lights: z.coerce.number().int().nonnegative().optional(),
                cost: z
                  .object({
                    duration: z.coerce.number().int().nonnegative().optional(),
                    tolls: z.coerce.number().nonnegative().optional(),
                    traffic_lights: z.coerce.number().int().nonnegative().optional(),
                  })
                  .passthrough()
                  .optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

function haversineMeters(
  from: RouteDryRunRequest['points'][number]['coordinate'],
  to: RouteDryRunRequest['points'][number]['coordinate'],
): number {
  const radius = 6_371_000
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  const deltaLat = radians(to.lat - from.lat)
  const deltaLon = radians(to.lon - from.lon)
  const fromLat = radians(from.lat)
  const toLat = radians(to.lat)
  const value =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLon / 2) ** 2
  return 2 * radius * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

function referenceLegs(input: RouteDryRunRequest): RouteLeg[] {
  return input.points.slice(0, -1).map((point, index) => {
    const next = input.points[index + 1]
    const distanceMeters = Math.round(haversineMeters(point.coordinate, next.coordinate) * 1.22)
    const durationSeconds = Math.round((distanceMeters / 1_000 / 50) * 3_600)
    return RouteLegSchema.parse({
      id: crypto.randomUUID(),
      dayId: input.dayId,
      provider: 'reference',
      from: point.endpoint,
      to: next.endpoint,
      distanceMeters,
      durationSeconds,
      strategy: `reference:${input.strategy}`,
      calculatedAt: new Date().toISOString(),
      status: 'stale',
      estimateKind:
        point.endpoint.kind === 'area' || next.endpoint.kind === 'area'
          ? 'area-reference'
          : 'reference',
    })
  })
}

function classifyAmapFailure(infocode?: string): AmapRouteError {
  const code = infocode ?? ''
  if (AMAP_RATE_LIMIT_CODES.has(code)) return new AmapRouteError('rate-limit', true, 2)
  if (AMAP_QUOTA_CODES.has(code)) return new AmapRouteError('quota', false)
  if (AMAP_CONFIGURATION_CODES.has(code)) return new AmapRouteError('configuration', false)
  if (AMAP_NO_ROUTE_CODES.has(code)) return new AmapRouteError('no-route', false)
  if (AMAP_TRANSIENT_CODES.has(code) || /^3\d{4}$/.test(code)) {
    return new AmapRouteError('unavailable', true, 2)
  }
  return new AmapRouteError('no-route', false)
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function createAmapRequestGate() {
  let queue = Promise.resolve()
  let nextStartAt = 0
  return async () => {
    const slot = queue.then(async () => {
      const waitMs = Math.max(0, nextStartAt - Date.now())
      if (waitMs) await sleep(waitMs)
      nextStartAt = Date.now() + AMAP_ROUTE_START_INTERVAL_MS
    })
    queue = slot.catch(() => undefined)
    await slot
  }
}

const waitForAmapRequestStart = createAmapRequestGate()

async function fetchAmapLegOnce(
  input: RouteDryRunRequest,
  index: number,
  key: string,
): Promise<RouteLeg> {
  const point = input.points[index]
  const next = input.points[index + 1]
  const url = new URL('https://restapi.amap.com/v5/direction/driving')
  url.searchParams.set('key', key)
  url.searchParams.set('origin', `${point.coordinate.lon},${point.coordinate.lat}`)
  url.searchParams.set('destination', `${next.coordinate.lon},${next.coordinate.lat}`)
  url.searchParams.set('strategy', input.strategy)
  url.searchParams.set('show_fields', 'cost,polyline')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  let response: Response
  try {
    response = await fetch(url, { signal: controller.signal })
  } catch {
    throw new AmapRouteError('unavailable', true, 2)
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) {
    if (response.status === 429) throw new AmapRouteError('rate-limit', true, 2)
    throw new AmapRouteError('unavailable', response.status >= 500, 2)
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new AmapRouteError('unavailable', true, 2)
  }
  const parsed = AMapResponseSchema.safeParse(body)
  if (!parsed.success) {
    throw new AmapRouteError('unavailable', true, 2)
  }
  const result = parsed.data
  const path = result.route?.paths?.[0]
  const durationSeconds = path?.duration ?? path?.cost?.duration
  if (result.status !== '1' || !path || durationSeconds === undefined) {
    throw classifyAmapFailure(result.infocode)
  }
  const polyline = path.polyline?.split(';').flatMap((coordinate) => {
    const [lon, lat] = coordinate.split(',').map(Number)
    return Number.isFinite(lon) && Number.isFinite(lat)
      ? [{ lon, lat, crs: 'GCJ02' as const }]
      : []
  })
  return RouteLegSchema.parse({
    id: crypto.randomUUID(),
    dayId: input.dayId,
    provider: 'amap',
    from: point.endpoint,
    to: next.endpoint,
    distanceMeters: path.distance,
    durationSeconds,
    tollsCny: path.tolls ?? path.cost?.tolls,
    trafficLights: path.traffic_lights ?? path.cost?.traffic_lights,
    polyline: polyline?.length ? polyline : undefined,
    strategy: input.strategy,
    calculatedAt: new Date().toISOString(),
    status: 'fresh',
    estimateKind:
      point.endpoint.kind === 'area' || next.endpoint.kind === 'area'
        ? 'area-reference'
        : 'road',
  })
}

async function fetchAmapLeg(
  input: RouteDryRunRequest,
  index: number,
  key: string,
  waitForStart: () => Promise<void>,
): Promise<RouteLeg> {
  let lastError = new AmapRouteError('unavailable', true, 2)
  for (let attempt = 0; attempt < AMAP_ROUTE_MAX_ATTEMPTS; attempt += 1) {
    await waitForStart()
    try {
      return await fetchAmapLegOnce(input, index, key)
    } catch (error) {
      lastError = error instanceof AmapRouteError
        ? error
        : new AmapRouteError('unavailable', true, 2)
      if (!lastError.retryable || attempt === AMAP_ROUTE_MAX_ATTEMPTS - 1) break
      const backoff = AMAP_ROUTE_RETRY_BASE_MS * 2 ** attempt
      const jitter = Math.floor(Math.random() * 120)
      await sleep(backoff + jitter)
    }
  }
  throw lastError
}

function providerNotice(kind: AmapFailureKind, failedLegs: number): RouteProviderNotice {
  switch (kind) {
    case 'rate-limit':
      return {
        code: 'rate_limited',
        message: '高德请求过于频繁，已切换参考路线',
        retryable: true,
        retryAfterSeconds: 2,
        failedLegs,
      }
    case 'quota':
      return {
        code: 'quota_exceeded',
        message: '高德今日额度已用完，已切换参考路线',
        retryable: false,
        failedLegs,
      }
    case 'configuration':
      return {
        code: 'configuration',
        message: '高德路线权限暂不可用，已切换参考路线',
        retryable: false,
        failedLegs,
      }
    case 'no-route':
      return {
        code: 'no_route',
        message: '部分路段暂无道路结果，已使用参考估算',
        retryable: false,
        failedLegs,
      }
    default:
      return {
        code: 'unavailable',
        message: '高德路线服务暂时不可用，已切换参考路线',
        retryable: true,
        retryAfterSeconds: 2,
        failedLegs,
      }
  }
}

const NOTICE_PRIORITY: Record<AmapFailureKind, number> = {
  quota: 5,
  configuration: 4,
  'rate-limit': 3,
  unavailable: 2,
  'no-route': 1,
}

export async function calculateRouteLegs(input: RouteDryRunRequest, env: Env) {
  const fallbackLegs = referenceLegs(input)
  if (!env.AMAP_WEB_SERVICE_KEY) {
    const notice: RouteProviderNotice = {
      code: 'not_configured',
      message: '高德路线暂未启用，当前显示参考路线',
      retryable: false,
      failedLegs: fallbackLegs.length,
    }
    return {
      providerMode: 'reference' as const,
      authoritative: false,
      legs: fallbackLegs,
      warning: notice.message,
      providerNotice: notice,
    }
  }

  const legs = [...fallbackLegs]
  const failures: AmapFailureKind[] = []
  let nextIndex = 0
  let terminalFailure: AmapFailureKind | null = null
  const worker = async () => {
    while (nextIndex < legs.length) {
      const index = nextIndex
      nextIndex += 1
      if (terminalFailure) {
        failures.push(terminalFailure)
        continue
      }
      try {
        legs[index] = await fetchAmapLeg(
          input,
          index,
          env.AMAP_WEB_SERVICE_KEY as string,
          waitForAmapRequestStart,
        )
      } catch (error) {
        const failure = error instanceof AmapRouteError ? error : new AmapRouteError('unavailable', true, 2)
        failures.push(failure.kind)
        if (failure.kind === 'quota' || failure.kind === 'configuration') terminalFailure = failure.kind
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(AMAP_ROUTE_CONCURRENCY, legs.length) }, () => worker()),
  )

  const amapLegCount = legs.filter((leg) => leg.provider === 'amap').length
  const primaryFailure = failures.sort((left, right) => NOTICE_PRIORITY[right] - NOTICE_PRIORITY[left])[0]
  const notice = primaryFailure ? providerNotice(primaryFailure, legs.length - amapLegCount) : null
  return {
    providerMode: amapLegCount === legs.length ? 'amap' as const : amapLegCount > 0 ? 'mixed' as const : 'reference' as const,
    authoritative: amapLegCount === legs.length,
    legs,
    warning: notice?.message ?? null,
    providerNotice: notice,
  }
}

const AmapPlaceSearchResponseSchema = z.object({
  status: z.string(),
  info: z.string().optional(),
  infocode: z.string().optional(),
  pois: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.string().optional(),
    typecode: z.string().optional(),
    address: z.union([z.string(), z.array(z.string())]).optional(),
    location: z.string().regex(/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/),
    pname: z.string().optional(),
    cityname: z.string().optional(),
    adname: z.string().optional(),
  }).passthrough()).optional(),
}).passthrough()

export type AmapPlaceSearchResult = {
  providerId: string
  name: string
  type: string
  typeCode?: string
  address?: string
  region: string
  gcj02: { lon: number; lat: number; crs: 'GCJ02' }
}

export async function searchAmapPlaces(
  query: string,
  city: string | undefined,
  env: Env,
): Promise<AmapPlaceSearchResult[]> {
  if (!env.AMAP_WEB_SERVICE_KEY) {
    throw new AppError('DEPENDENCY_UNAVAILABLE', '高德地点搜索尚未配置', 503)
  }
  const url = new URL('https://restapi.amap.com/v3/place/text')
  url.searchParams.set('key', env.AMAP_WEB_SERVICE_KEY)
  url.searchParams.set('keywords', query)
  url.searchParams.set('offset', '12')
  url.searchParams.set('page', '1')
  url.searchParams.set('extensions', 'base')
  if (city) {
    url.searchParams.set('city', city)
    url.searchParams.set('citylimit', 'false')
  }

  let lastFailure: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8_000)
    try {
      const response = await fetch(url, { signal: controller.signal })
      if (response.status === 429) {
        throw new AppError('RATE_LIMITED', '高德地点搜索请求过于频繁', 429, { retryable: true })
      }
      if (!response.ok) throw new Error(`AMAP_HTTP_${response.status}`)
      const parsed = AmapPlaceSearchResponseSchema.safeParse(await response.json())
      if (!parsed.success) throw new Error('AMAP_INVALID_RESPONSE')
      if (parsed.data.status !== '1') {
        const code = parsed.data.infocode ?? ''
        if (AMAP_QUOTA_CODES.has(code)) {
          throw new AppError('ROUTE_QUOTA_EXCEEDED', '高德今日额度已用完', 429)
        }
        if (AMAP_RATE_LIMIT_CODES.has(code)) {
          throw new AppError('RATE_LIMITED', '高德地点搜索请求过于频繁', 429, { retryable: true })
        }
        throw new AppError('ROUTE_PROVIDER_UNAVAILABLE', parsed.data.info ?? '高德地点搜索暂不可用', 502, {
          retryable: AMAP_TRANSIENT_CODES.has(code),
        })
      }
      return (parsed.data.pois ?? []).map((poi) => {
        const [lon, lat] = poi.location.split(',').map(Number)
        const address = Array.isArray(poi.address) ? poi.address.join('') : poi.address
        return {
          providerId: poi.id,
          name: poi.name,
          type: poi.type?.split(';').at(-1) ?? '地点',
          typeCode: poi.typecode,
          address: address || undefined,
          region: [poi.pname, poi.cityname, poi.adname].filter(Boolean).join(' '),
          gcj02: { lon, lat, crs: 'GCJ02' as const },
        }
      })
    } catch (error) {
      lastFailure = error
      if (error instanceof AppError && !error.retryable) throw error
      if (attempt === 0) await sleep(420)
    } finally {
      clearTimeout(timer)
    }
  }
  if (lastFailure instanceof AppError) throw lastFailure
  throw new AppError('ROUTE_PROVIDER_UNAVAILABLE', '高德地点搜索暂不可用', 503, { retryable: true })
}
