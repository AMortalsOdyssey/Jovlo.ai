import { z } from 'zod'
import { RouteLegSchema, type RouteLeg } from '../../packages/domain/src/index'
import { AppError } from '../lib/errors'
import type { Env } from '../types'
import type { RouteDryRunRequest } from '../schemas'

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
