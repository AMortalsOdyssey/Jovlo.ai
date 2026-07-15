import {
  getDayRouteEndpoints,
  recalculateTrip,
  stableHash,
  type DerivedSnapshot,
  type RouteEndpoint,
  type RouteLeg,
  type TripSnapshot,
} from '../../packages/domain/src/index'
import { AppError } from '../lib/errors'
import type { AppContext } from '../types'
import { calculateRouteLegs, type RouteProviderNotice } from './amap'
import { reportProviderIssue } from './provider-alerts'

function endpointCoordinate(snapshot: TripSnapshot, endpoint: RouteEndpoint) {
  const coordinate = endpoint.kind === 'place'
    ? snapshot.placeRefs[endpoint.placeId]?.gcj02
    : snapshot.stayAreaRefs[endpoint.areaId]?.gcj02
  if (!coordinate) {
    throw new AppError('ROUTE_NO_DATA', '地点缺少路线坐标', 422, {
      userAction: '请先为新增地点补全坐标',
    })
  }
  return coordinate
}

function reportNotice(context: AppContext, notice: RouteProviderNotice | null) {
  if (!notice || !['quota_exceeded', 'rate_limited', 'configuration'].includes(notice.code)) return
  reportProviderIssue(context, {
    provider: 'amap',
    code: notice.code,
    message: notice.message,
    impact: `${notice.failedLegs} 个路段已自动降级为参考估算`,
  })
}

export async function calculateTripRouteLegs(
  snapshot: TripSnapshot,
  context: AppContext,
): Promise<{ routeLegs: RouteLeg[]; warnings: string[] }> {
  const routeLegs: RouteLeg[] = []
  const warnings = new Set<string>()
  for (let dayPosition = 0; dayPosition < snapshot.days.length; dayPosition += 1) {
    const day = snapshot.days[dayPosition]
    const endpoints = getDayRouteEndpoints(snapshot, dayPosition)
    if (endpoints.length < 2) continue
    const result = await calculateRouteLegs(
      {
        dayId: day.id,
        points: endpoints.map((endpoint) => ({
          endpoint,
          coordinate: endpointCoordinate(snapshot, endpoint),
        })),
        strategy: '32',
        inputHash: stableHash({ dayId: day.id, endpoints }),
      },
      context.env,
    )
    reportNotice(context, result.providerNotice)
    if (result.warning) warnings.add(result.warning)
    routeLegs.push(...result.legs)
  }
  return { routeLegs, warnings: [...warnings] }
}

export async function recalculateTripWithRoutes(
  snapshot: TripSnapshot,
  context: AppContext,
): Promise<{ derived: DerivedSnapshot; warnings: string[] }> {
  const { routeLegs, warnings } = await calculateTripRouteLegs(snapshot, context)
  return { derived: recalculateTrip(snapshot, routeLegs), warnings }
}
