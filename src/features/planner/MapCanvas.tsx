import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { load as loadAmap } from '@amap/amap-jsapi-loader'
import { LocateFixed, Minus, Plus } from 'lucide-react'

import { IconButton } from '../../components'
import { JOVLO_COLORS } from '../../design-system'
import { configureAmapServiceHost } from '../../lib/amap'
import type { CandidateMapPoint, FormalMapPoint } from './types'
import './planner.css'

export interface MapCanvasProps {
  routePoints?: FormalMapPoint[]
  candidatePoints?: CandidateMapPoint[]
  selectedPointId?: string
  selectedLegIndex?: number
  amapKey?: string
  className?: string
  onSelectFormalPoint?: (pointId: string) => void
  onSelectCandidateCluster?: (pointIds: string[]) => void
  onReady?: (provider: 'amap' | 'local-reference') => void
  onLoadError?: (error: Error) => void
}

type MapLoadState = 'fallback' | 'loading' | 'ready' | 'error'

interface ProjectedPoint {
  id: string
  x: number
  y: number
}

interface CandidateCluster {
  key: string
  x: number
  y: number
  type: CandidateMapPoint['type']
  points: CandidateMapPoint[]
}

const DEFAULT_REFERENCE_ROUTE: FormalMapPoint[] = [
  { id: 'reference-hotel', order: 1, name: '石梅湾', lng: 110.274, lat: 18.659 },
  { id: 'reference-riyue-bay', order: 2, name: '日月湾', lng: 110.195, lat: 18.645 },
  { id: 'reference-xinglong', order: 3, name: '兴隆咖啡园', lng: 110.213, lat: 18.727 },
  { id: 'reference-shenzhou', order: 4, name: '神州半岛', lng: 110.327, lat: 18.679 },
]

const EMPTY_FORMAL_POINTS: FormalMapPoint[] = []
const EMPTY_CANDIDATE_POINTS: CandidateMapPoint[] = []

const CANDIDATE_TYPE_LABEL: Record<CandidateMapPoint['type'], string> = {
  beach: '海滩',
  food: '美食',
  coffee: '咖啡',
  culture: '人文',
  hotel: '住宿',
  other: '候选',
}

function projectCoordinates(points: Array<{ id: string; lng: number; lat: number }>): ProjectedPoint[] {
  const lngValues = points.map((point) => point.lng)
  const latValues = points.map((point) => point.lat)
  const minLng = Math.min(...lngValues)
  const maxLng = Math.max(...lngValues)
  const minLat = Math.min(...latValues)
  const maxLat = Math.max(...latValues)
  const lngSpan = Math.max(maxLng - minLng, 0.01)
  const latSpan = Math.max(maxLat - minLat, 0.01)

  return points.map((point) => ({
    id: point.id,
    x: 72 + ((point.lng - minLng) / lngSpan) * 656,
    y: 488 - ((point.lat - minLat) / latSpan) * 416,
  }))
}

function clusterCandidates(
  candidates: CandidateMapPoint[],
  projected: Map<string, ProjectedPoint>,
): CandidateCluster[] {
  const groups = new Map<string, CandidateCluster>()

  candidates.forEach((candidate) => {
    const point = projected.get(candidate.id)
    if (!point) return
    const key = `${Math.round(point.x / 80)}:${Math.round(point.y / 80)}`
    const existing = groups.get(key)

    if (existing) {
      const count = existing.points.length
      existing.x = (existing.x * count + point.x) / (count + 1)
      existing.y = (existing.y * count + point.y) / (count + 1)
      existing.points.push(candidate)
    } else {
      groups.set(key, {
        key,
        x: point.x,
        y: point.y,
        type: candidate.type,
        points: [candidate],
      })
    }
  })

  return Array.from(groups.values())
}

function activateOnEnter(event: KeyboardEvent<SVGGElement>, action: () => void) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    action()
  }
}

export function MapCanvas({
  routePoints = EMPTY_FORMAL_POINTS,
  candidatePoints = EMPTY_CANDIDATE_POINTS,
  selectedPointId,
  selectedLegIndex,
  amapKey,
  className = '',
  onSelectFormalPoint,
  onSelectCandidateCluster,
  onReady,
  onLoadError,
}: MapCanvasProps) {
  const envKey = import.meta.env.VITE_AMAP_JS_KEY?.trim() ?? ''
  const apiKey = (amapKey ?? envKey).trim()
  const usesBuiltInReference = routePoints.length === 0
  const visibleRoute = usesBuiltInReference ? DEFAULT_REFERENCE_ROUTE : routePoints
  const hostRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const [loadState, setLoadState] = useState<MapLoadState>(apiKey ? 'loading' : 'fallback')
  const [fallbackScale, setFallbackScale] = useState(1)
  const callbacksRef = useRef({
    onSelectFormalPoint,
    onSelectCandidateCluster,
    onReady,
    onLoadError,
  })
  callbacksRef.current = { onSelectFormalPoint, onSelectCandidateCluster, onReady, onLoadError }
  const routeSignature = visibleRoute
    .map(({ id, order, name, lng, lat }) => `${id}:${order}:${name}:${lng}:${lat}`)
    .join('|')
  const candidateSignature = candidatePoints
    .map(({ id, name, type, lng, lat }) => `${id}:${name}:${type}:${lng}:${lat}`)
    .join('|')

  const projected = useMemo(() => {
    const allPoints = [...visibleRoute, ...candidatePoints]
    return new Map(projectCoordinates(allPoints).map((point) => [point.id, point]))
  }, [candidatePoints, visibleRoute])

  const clusters = useMemo(
    () => clusterCandidates(candidatePoints, projected),
    [candidatePoints, projected],
  )

  useEffect(() => {
    if (!apiKey || !hostRef.current) {
      setLoadState('fallback')
      callbacksRef.current.onReady?.('local-reference')
      return undefined
    }

    let cancelled = false
    setLoadState('loading')
    configureAmapServiceHost()

    loadAmap({ key: apiKey, version: '2.0' })
      .then((AMap: any) => {
        if (cancelled || !hostRef.current) return

        const map = new AMap.Map(hostRef.current, {
          zoom: 10,
          center: [visibleRoute[0].lng, visibleRoute[0].lat],
          resizeEnable: true,
          viewMode: '2D',
        })
        mapRef.current = map

        const routeOverlays = visibleRoute.slice(0, -1).map((point, index) => {
          const next = visibleRoute[index + 1]
          return new AMap.Polyline({
            path: [
              [point.lng, point.lat],
              [next.lng, next.lat],
            ],
            strokeColor: selectedLegIndex === index ? JOVLO_COLORS.brand : JOVLO_COLORS.sea,
            strokeWeight: selectedLegIndex === index ? 6 : 4,
            strokeOpacity: 0.94,
            lineJoin: 'round',
          })
        })

        const formalMarkers = visibleRoute.map((point) => {
          const markerButton = document.createElement('button')
          markerButton.type = 'button'
          markerButton.className = 'jovlo-amap-formal-marker'
          markerButton.dataset.mapMarkerKind = 'formal'
          markerButton.dataset.digits = String(point.order).length > 1 ? 'multiple' : 'single'
          markerButton.dataset.selected = String(point.id === selectedPointId)
          markerButton.setAttribute('aria-label', `第 ${point.order} 站：${point.name}`)
          markerButton.title = `第 ${point.order} 站：${point.name}`
          markerButton.textContent = String(point.order)
          markerButton.addEventListener('click', () => callbacksRef.current.onSelectFormalPoint?.(point.id))

          return new AMap.Marker({
            position: [point.lng, point.lat],
            content: markerButton,
            offset: new AMap.Pixel(-16, -16),
            title: point.name,
            zIndex: 20,
          })
        })

        const candidateMarkers = clusters.map((cluster) => {
          const pointIds = cluster.points.map((point) => point.id)
          const isCluster = cluster.points.length > 1
          const lng = cluster.points.reduce((sum, point) => sum + point.lng, 0) / cluster.points.length
          const lat = cluster.points.reduce((sum, point) => sum + point.lat, 0) / cluster.points.length
          const markerButton = document.createElement('button')
          markerButton.type = 'button'
          markerButton.className = isCluster ? 'jovlo-amap-candidate-cluster' : 'jovlo-amap-candidate-marker'
          markerButton.dataset.mapMarkerKind = isCluster ? 'candidate-cluster' : 'candidate'
          markerButton.dataset.type = cluster.type
          markerButton.dataset.selected = String(pointIds.includes(selectedPointId ?? ''))
          markerButton.setAttribute(
            'aria-label',
            isCluster ? `${cluster.points.length} 个候选地点` : `候选地点：${cluster.points[0].name}`,
          )
          markerButton.title = markerButton.getAttribute('aria-label') ?? ''
          markerButton.textContent = isCluster
            ? String(cluster.points.length)
            : CANDIDATE_TYPE_LABEL[cluster.type].slice(0, 1)
          markerButton.addEventListener('click', () => callbacksRef.current.onSelectCandidateCluster?.(pointIds))

          return new AMap.Marker({
            position: [lng, lat],
            content: markerButton,
            offset: new AMap.Pixel(isCluster ? -18 : -14, isCluster ? -18 : -14),
            zIndex: 16,
          })
        })

        map.add([...routeOverlays, ...formalMarkers, ...candidateMarkers])

        if (routeOverlays.length > 0) map.setFitView(routeOverlays, false, [48, 48, 48, 48], 14)
        setLoadState('ready')
        callbacksRef.current.onReady?.('amap')
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        const error = reason instanceof Error ? reason : new Error('高德地图加载失败')
        console.error('[Jovlo Map] AMap initialization failed', {
          name: error.name,
          message: error.message,
        })
        setLoadState('error')
        callbacksRef.current.onLoadError?.(error)
        callbacksRef.current.onReady?.('local-reference')
      })

    return () => {
      cancelled = true
      mapRef.current?.destroy?.()
      mapRef.current = null
    }
  }, [apiKey, candidateSignature, routeSignature, selectedLegIndex, selectedPointId])

  const zoomIn = () => {
    if (loadState === 'ready') mapRef.current?.zoomIn?.()
    else setFallbackScale((value) => Math.min(1.32, value + 0.16))
  }

  const zoomOut = () => {
    if (loadState === 'ready') mapRef.current?.zoomOut?.()
    else setFallbackScale((value) => Math.max(0.84, value - 0.16))
  }

  const fitRoute = () => {
    if (loadState === 'ready') mapRef.current?.setFitView?.()
    else setFallbackScale(1)
  }

  const fallbackLabel =
    loadState === 'error'
      ? '高德地图暂不可用 · 显示本地参考路线'
      : loadState === 'loading'
        ? '高德地图加载中 · 显示本地参考路线'
        : '本地参考路线 · 非高德实时数据'

  return (
    <section
      className={`jovlo-map-canvas ${className}`.trim()}
      data-provider={loadState === 'ready' ? 'amap' : 'local-reference'}
      aria-label="路线地图"
    >
      <div
        ref={hostRef}
        className="jovlo-map-canvas__amap"
        data-visible={loadState === 'ready' || undefined}
        aria-hidden={loadState !== 'ready'}
      />

      {loadState === 'ready' && (
        <p className="jovlo-map-canvas__provider-notice">
          {usesBuiltInReference ? '高德地图底图 · 路线为本地参考' : '高德地图'}
        </p>
      )}

      {loadState !== 'ready' && (
        <div className="jovlo-reference-map">
          <p className="jovlo-reference-map__notice">{fallbackLabel}</p>
          <svg
            viewBox="0 0 800 560"
            role="img"
            aria-labelledby="jovlo-reference-map-title jovlo-reference-map-description"
            style={{ transform: `scale(${fallbackScale})` }}
          >
            <title id="jovlo-reference-map-title">海南当日自驾本地参考路线</title>
            <desc id="jovlo-reference-map-description">
              非高德实时数据。正式地点以独立编号显示，候选地点按邻近位置聚合。
            </desc>
            <rect className="jovlo-reference-map__land" x="0" y="0" width="800" height="560" />
            <path className="jovlo-reference-map__coast" d="M40 496 C184 448 160 328 280 288 C392 248 400 112 544 72 C640 44 720 72 776 32" />
            <path className="jovlo-reference-map__road" d="M32 408 C176 368 248 416 360 360 S584 216 768 232" />

            {visibleRoute.slice(0, -1).map((point, index) => {
              const next = visibleRoute[index + 1]
              const start = projected.get(point.id)
              const end = projected.get(next.id)
              if (!start || !end) return null
              return (
                <line
                  key={`${point.id}-${next.id}`}
                  className="jovlo-reference-map__route"
                  data-selected={selectedLegIndex === index || undefined}
                  x1={start.x}
                  y1={start.y}
                  x2={end.x}
                  y2={end.y}
                />
              )
            })}

            {clusters.map((cluster) => {
              const isCluster = cluster.points.length > 1
              const label = isCluster
                ? `${cluster.points.length} 个候选地点，主类型 ${CANDIDATE_TYPE_LABEL[cluster.type]}`
                : `候选地点：${cluster.points[0].name}`
              const activate = () => onSelectCandidateCluster?.(cluster.points.map((point) => point.id))
              return (
                <g
                  key={cluster.key}
                  className="jovlo-reference-map__candidate"
                  data-map-marker-kind={isCluster ? 'candidate-cluster' : 'candidate'}
                  data-type={cluster.type}
                  role={onSelectCandidateCluster ? 'button' : undefined}
                  tabIndex={onSelectCandidateCluster ? 0 : undefined}
                  aria-label={label}
                  onClick={activate}
                  onKeyDown={(event) => activateOnEnter(event, activate)}
                  transform={`translate(${cluster.x} ${cluster.y})`}
                >
                  <circle r={isCluster ? 18 : 14} />
                  <text textAnchor="middle" dominantBaseline="central">
                    {isCluster ? cluster.points.length : CANDIDATE_TYPE_LABEL[cluster.type].slice(0, 1)}
                  </text>
                </g>
              )
            })}

            {visibleRoute.map((point) => {
              const position = projected.get(point.id)
              if (!position) return null
              const selected = point.id === selectedPointId
              return (
                <g
                  key={point.id}
                  className="jovlo-reference-map__formal"
                  data-map-marker-kind="formal"
                  data-selected={selected || undefined}
                  role={onSelectFormalPoint ? 'button' : undefined}
                  tabIndex={onSelectFormalPoint ? 0 : undefined}
                  aria-label={`第 ${point.order} 站：${point.name}`}
                  onClick={() => onSelectFormalPoint?.(point.id)}
                  onKeyDown={(event) => activateOnEnter(event, () => onSelectFormalPoint?.(point.id))}
                  transform={`translate(${position.x} ${position.y})`}
                >
                  <circle r="16" />
                  <text
                    className="jovlo-reference-map__formal-number"
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={point.order > 9 ? 12 : 14}
                  >
                    {point.order}
                  </text>
                  <text className="jovlo-reference-map__formal-label" x="24" y="5">
                    {point.name}
                  </text>
                </g>
              )
            })}
          </svg>
          {usesBuiltInReference && <p className="jovlo-reference-map__caption">示意：石梅湾—日月湾—兴隆—神州半岛</p>}
        </div>
      )}

      <div className="jovlo-map-canvas__controls" aria-label="地图控制">
        <IconButton icon={Plus} label="放大地图" onClick={zoomIn} />
        <IconButton icon={Minus} label="缩小地图" onClick={zoomOut} />
        <IconButton icon={LocateFixed} label="适应路线" onClick={fitRoute} />
      </div>
    </section>
  )
}
