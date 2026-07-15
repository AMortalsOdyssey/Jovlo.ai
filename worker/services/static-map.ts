import { getDayRouteEndpoints, type DerivedSnapshot, type RouteEndpoint, type TripSnapshot } from '../../packages/domain/src/index'
import type { Env } from '../types'

const MAP_WIDTH = 1024
const MAP_HEIGHT = 720

type MapScope = { kind: 'overview' } | { kind: 'day'; dayId: string }

type MapPoint = {
  name: string
  lon: number
  lat: number
}

function endpointPoint(snapshot: TripSnapshot, endpoint: RouteEndpoint): MapPoint | null {
  if (endpoint.kind === 'place') {
    const place = snapshot.placeRefs[endpoint.placeId]
    return place ? { name: place.name, lon: place.gcj02.lon, lat: place.gcj02.lat } : null
  }
  const area = snapshot.stayAreaRefs[endpoint.areaId]
  return area ? { name: area.name, lon: area.gcj02.lon, lat: area.gcj02.lat } : null
}

function mapPoints(snapshot: TripSnapshot, scope: MapScope): MapPoint[] {
  const dayIndexes = scope.kind === 'overview'
    ? snapshot.days.map((_, index) => index)
    : [snapshot.days.findIndex((day) => day.id === scope.dayId)].filter((index) => index >= 0)
  const points = dayIndexes.flatMap((dayIndex) =>
    getDayRouteEndpoints(snapshot, dayIndex)
      .map((endpoint) => endpointPoint(snapshot, endpoint))
      .filter((point): point is MapPoint => Boolean(point)),
  )
  return points.filter((point, index) => {
    const previous = points[index - 1]
    return !previous || previous.lon !== point.lon || previous.lat !== point.lat
  })
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[character] as string)
}

function fallbackSvg(points: MapPoint[], label: string) {
  const lons = points.map((point) => point.lon)
  const lats = points.map((point) => point.lat)
  const minLon = lons.length ? Math.min(...lons) : 0
  const maxLon = lons.length ? Math.max(...lons) : 1
  const minLat = lats.length ? Math.min(...lats) : 0
  const maxLat = lats.length ? Math.max(...lats) : 1
  const lonSpan = Math.max(0.01, maxLon - minLon)
  const latSpan = Math.max(0.01, maxLat - minLat)
  const projected = points.map((point) => ({
    ...point,
    x: 90 + ((point.lon - minLon) / lonSpan) * (MAP_WIDTH - 180),
    y: MAP_HEIGHT - 90 - ((point.lat - minLat) / latSpan) * (MAP_HEIGHT - 180),
  }))
  const route = projected.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')
  const markers = projected.map((point, index) => `
    <g>
      <circle cx="${point.x}" cy="${point.y}" r="20" fill="#0f8274" stroke="#fffdf8" stroke-width="6" />
      <text x="${point.x}" y="${point.y + 6}" text-anchor="middle" fill="white" font-size="16" font-weight="700">${index + 1}</text>
      <rect x="${Math.min(MAP_WIDTH - 250, point.x + 24)}" y="${Math.max(18, point.y - 19)}" width="210" height="38" rx="6" fill="#fffdf8" stroke="#dcc9ae" />
      <text x="${Math.min(MAP_WIDTH - 238, point.x + 36)}" y="${Math.max(43, point.y + 6)}" fill="#2d251d" font-size="15" font-weight="600">${escapeXml(point.name.slice(0, 13))}</text>
    </g>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${MAP_WIDTH}" height="${MAP_HEIGHT}" viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}">
    <rect width="100%" height="100%" fill="#f4ecdb" />
    <path d="M0 570 C250 470 320 670 610 540 S870 420 1024 490" fill="none" stroke="#b8dce8" stroke-width="54" opacity=".75" />
    <polyline points="${route}" fill="none" stroke="#0f8274" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="18 13" />
    ${markers}
    <rect x="24" y="22" width="310" height="48" rx="7" fill="#fffdf8" stroke="#dcc9ae" />
    <text x="42" y="53" fill="#2d251d" font-size="19" font-weight="700">${escapeXml(label)} · 参考路线图</text>
    <text x="24" y="694" fill="#736657" font-size="14">地图服务暂不可用，路线按地点坐标连接</text>
  </svg>`
}

function routeCoordinates(points: MapPoint[], scope: MapScope, derived?: DerivedSnapshot) {
  const dayId = scope.kind === 'day' ? scope.dayId : null
  const polyline = derived?.routeLegs
    .filter((leg) => !dayId || leg.dayId === dayId)
    .flatMap((leg) => leg.polyline ?? [])
  return polyline?.length
    ? polyline.map((coordinate) => ({ lon: coordinate.lon, lat: coordinate.lat }))
    : points.map((point) => ({ lon: point.lon, lat: point.lat }))
}

function staticMapUrl(points: MapPoint[], route: Array<{ lon: number; lat: number }>, key: string) {
  const url = new URL('https://restapi.amap.com/v3/staticmap')
  url.searchParams.set('key', key)
  url.searchParams.set('size', `${MAP_WIDTH}*${MAP_HEIGHT}`)
  url.searchParams.set('scale', '1')
  url.searchParams.set('traffic', '0')
  const markerPoints = points.slice(0, 10)
  markerPoints.forEach((point, index) => {
    url.searchParams.append('markers', `mid,0x0f8274,${index + 1}:${point.lon},${point.lat}`)
  })
  if (route.length > 1) {
    const sampled = route.length > 420
      ? route.filter((_, index) => index % Math.ceil(route.length / 420) === 0)
      : route
    url.searchParams.set('paths', `8,0x0f8274,0.85,,0:${sampled.map((point) => `${point.lon},${point.lat}`).join(';')}`)
  }
  return url
}

export async function getTripStaticMap(
  snapshot: TripSnapshot,
  scope: MapScope,
  env: Env,
  derived?: DerivedSnapshot,
): Promise<Response> {
  const points = mapPoints(snapshot, scope)
  const route = routeCoordinates(points, scope, derived)
  const label = scope.kind === 'overview'
    ? '全程总览'
    : `Day ${snapshot.days.find((day) => day.id === scope.dayId)?.dayIndex ?? ''}`
  if (env.AMAP_WEB_SERVICE_KEY && points.length) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8_000)
    try {
      const response = await fetch(staticMapUrl(points, route, env.AMAP_WEB_SERVICE_KEY), { signal: controller.signal })
      const contentType = response.headers.get('content-type') ?? ''
      if (response.ok && contentType.startsWith('image/')) {
        return new Response(response.body, {
          headers: {
            'content-type': contentType,
            'cache-control': 'private, max-age=21600',
            'x-jovlo-map-provider': 'amap',
          },
        })
      }
    } catch {
      // The caller receives a readable local route map below.
    } finally {
      clearTimeout(timer)
    }
  }
  return new Response(fallbackSvg(points, label), {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'private, max-age=600',
      'x-jovlo-map-provider': 'reference',
    },
  })
}
