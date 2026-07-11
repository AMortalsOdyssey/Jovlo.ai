import {
  getDayRouteEndpoints,
  type RouteEndpoint,
  type RouteLeg,
  type TripSnapshot,
} from '@domain'

type Point = { lon: number; lat: number }

function resolvePoint(snapshot: TripSnapshot, endpoint: RouteEndpoint): Point {
  if (endpoint.kind === 'place') {
    const point = snapshot.placeRefs[endpoint.placeId]?.gcj02
    if (!point) throw new Error(`地点 ${endpoint.placeId} 缺少 GCJ-02 坐标`)
    return point
  }
  const point = snapshot.stayAreaRefs[endpoint.areaId]?.gcj02
  if (!point) throw new Error(`住宿区域 ${endpoint.areaId} 缺少 GCJ-02 坐标`)
  return point
}

function haversineMeters(a: Point, b: Point): number {
  const radius = 6_371_000
  const toRadians = (value: number) => (value * Math.PI) / 180
  const dLat = toRadians(b.lat - a.lat)
  const dLon = toRadians(b.lon - a.lon)
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)
  const value =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * radius * Math.asin(Math.sqrt(value))
}

export function buildReferenceRouteLegs(snapshot: TripSnapshot): RouteLeg[] {
  const calculatedAt = new Date().toISOString()
  return snapshot.days.flatMap((day, dayPosition) => {
    const endpoints = getDayRouteEndpoints(snapshot, dayPosition)
    return endpoints.slice(0, -1).map((from, index) => {
      const to = endpoints[index + 1]
      const fromPoint = resolvePoint(snapshot, from)
      const toPoint = resolvePoint(snapshot, to)
      const estimatedRoadMeters = Math.max(900, Math.round(haversineMeters(fromPoint, toPoint) * 1.24))
      const averageKph = estimatedRoadMeters < 15_000 ? 34 : 58
      const durationSeconds = Math.round((estimatedRoadMeters / 1000 / averageKph) * 3600 + 240)
      const areaReference = from.kind === 'area' || to.kind === 'area'

      return {
        id: crypto.randomUUID(),
        dayId: day.id,
        provider: 'reference' as const,
        from,
        to,
        distanceMeters: estimatedRoadMeters,
        durationSeconds,
        strategy: 'local-reference-v1',
        calculatedAt,
        status: 'stale' as const,
        estimateKind: areaReference ? ('area-reference' as const) : ('reference' as const),
      }
    })
  })
}
