import { z } from 'zod'
import { RouteLegSchema, type RouteLeg } from '../../packages/domain/src/index'
import { AppError } from '../lib/errors'
import type { Env } from '../types'
import type { RouteDryRunRequest } from '../schemas'

const AMAP_SERVICE_PREFIX = '/_AMapService'
const AMAP_PROXY_TIMEOUT_MS = 8_000
const AMAP_PROXY_MAX_RESPONSE_BYTES = 1_000_000
const AMAP_PROXY_MAX_QUERY_BYTES = 2_048

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

async function fetchAmapLeg(
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
  url.searchParams.set('show_fields', 'cost')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  let response: Response
  try {
    response = await fetch(url, { signal: controller.signal })
  } catch {
    throw new AppError('ROUTE_PROVIDER_UNAVAILABLE', '道路算路服务暂时不可用', 503, {
      retryable: true,
      userAction: '可先保存草稿，稍后重算',
    })
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) {
    throw new AppError('ROUTE_PROVIDER_UNAVAILABLE', '道路算路服务暂时不可用', 503, {
      retryable: response.status >= 500,
      userAction: '可先保存草稿，稍后重算',
    })
  }
  const parsed = AMapResponseSchema.safeParse(await response.json())
  if (!parsed.success) {
    throw new AppError('ROUTE_PROVIDER_UNAVAILABLE', '道路 Provider 返回了未知格式', 502, {
      retryable: true,
    })
  }
  const result = parsed.data
  if (['10003', '10004', '10020', '10021'].includes(result.infocode ?? '')) {
    throw new AppError('ROUTE_QUOTA_EXCEEDED', '道路算路配额暂不可用', 429, {
      retryable: true,
      userAction: '请稍后重试',
    })
  }
  const path = result.route?.paths?.[0]
  const durationSeconds = path?.duration ?? path?.cost?.duration
  if (result.status !== '1' || !path || durationSeconds === undefined) {
    throw new AppError('ROUTE_NO_DATA', '该路段没有可用道路结果', 422, {
      userAction: '请检查地点坐标或调整路线',
      details: { infocode: result.infocode, info: result.info },
    })
  }
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
    strategy: input.strategy,
    calculatedAt: new Date().toISOString(),
    status: 'fresh',
    estimateKind:
      point.endpoint.kind === 'area' || next.endpoint.kind === 'area'
        ? 'area-reference'
        : 'road',
  })
}

export async function calculateRouteLegs(input: RouteDryRunRequest, env: Env) {
  if (!env.AMAP_WEB_SERVICE_KEY) {
    return {
      providerMode: 'reference' as const,
      authoritative: false,
      legs: referenceLegs(input),
      warning: 'AMAP_WEB_SERVICE_KEY 未配置，返回人工参考/直线走廊估算，不可标记为已验证道路结果',
    }
  }
  const legs = await Promise.all(
    input.points.slice(0, -1).map((_, index) =>
      fetchAmapLeg(input, index, env.AMAP_WEB_SERVICE_KEY as string),
    ),
  )
  return {
    providerMode: 'amap' as const,
    authoritative: true,
    legs,
    warning: null,
  }
}
