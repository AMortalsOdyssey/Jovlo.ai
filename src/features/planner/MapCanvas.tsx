import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { load as loadAmap } from '@amap/amap-jsapi-loader'
import {
  BedDouble,
  Coffee,
  ExternalLink,
  Flame,
  Landmark,
  LocateFixed,
  Map as MapIcon,
  MapPin,
  Minus,
  Mountain,
  Navigation2,
  Plane,
  Plus,
  Satellite,
  ShoppingBag,
  TrafficCone,
  Utensils,
  Waves,
  X,
  type LucideIcon,
} from 'lucide-react'

import { IconButton } from '../../components'
import { JOVLO_COLORS } from '../../design-system'
import { buildAmapMarkerUrl, configureAmapServiceHost } from '../../lib/amap'
import { inferMapPlaceType, MAP_PLACE_TYPE_LABEL } from './map-place'
import type { CandidateMapPoint, FormalMapPoint, MapPlaceType } from './types'
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
type MapBaseLayer = 'standard' | 'satellite'

interface DensityPoint {
  lng: number
  lat: number
  count: number
}

interface MapLayerAvailability {
  satellite: boolean
  traffic: boolean
  density: boolean
}

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
  { id: 'reference-hotel', order: 1, name: '石梅湾', type: 'beach', lng: 110.274, lat: 18.659 },
  { id: 'reference-riyue-bay', order: 2, name: '日月湾', type: 'beach', lng: 110.195, lat: 18.645 },
  { id: 'reference-xinglong', order: 3, name: '兴隆咖啡园', type: 'coffee', lng: 110.213, lat: 18.727 },
  { id: 'reference-shenzhou', order: 4, name: '神州半岛', type: 'beach', lng: 110.327, lat: 18.679 },
]

const EMPTY_FORMAL_POINTS: FormalMapPoint[] = []
const EMPTY_CANDIDATE_POINTS: CandidateMapPoint[] = []

const MAP_PLACE_ICON: Record<MapPlaceType, LucideIcon> = {
  scenic: Mountain,
  food: Utensils,
  coffee: Coffee,
  hotel: BedDouble,
  beach: Waves,
  culture: Landmark,
  transport: Plane,
  shopping: ShoppingBag,
  other: MapPin,
}

function renderMapPlaceIcon(container: HTMLElement, type: MapPlaceType, roots: Root[], size = 15) {
  const Icon = MAP_PLACE_ICON[type]
  const root = createRoot(container)
  root.render(<Icon aria-hidden="true" size={size} strokeWidth={2.1} />)
  roots.push(root)
}

function createAmapPlaceMarker({
  ariaLabel,
  kind,
  name,
  order,
  selected,
  type,
  roots,
}: {
  ariaLabel: string
  kind: 'formal' | 'candidate' | 'candidate-cluster'
  name: string
  order?: number
  selected: boolean
  type: MapPlaceType
  roots: Root[]
}) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'jovlo-amap-place-marker'
  button.dataset.mapMarkerKind = kind
  button.dataset.type = type
  button.dataset.selected = String(selected)
  button.setAttribute('aria-label', ariaLabel)

  const pin = document.createElement('span')
  pin.className = 'jovlo-amap-place-marker__pin'
  const icon = document.createElement('span')
  icon.className = 'jovlo-amap-place-marker__icon'
  renderMapPlaceIcon(icon, type, roots)
  pin.append(icon)
  if (order !== undefined) {
    const badge = document.createElement('span')
    badge.className = 'jovlo-amap-place-marker__order'
    badge.textContent = String(order)
    pin.append(badge)
  }

  const label = document.createElement('span')
  label.className = 'jovlo-amap-place-marker__label'
  const title = document.createElement('strong')
  title.textContent = name
  const typeLabel = document.createElement('small')
  typeLabel.textContent = MAP_PLACE_TYPE_LABEL[type]
  label.append(title, typeLabel)
  button.append(pin, label)
  return button
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

function buildDensityData(
  routePoints: FormalMapPoint[],
  candidatePoints: CandidateMapPoint[],
): DensityPoint[] {
  const densityByCoordinate = new Map<string, DensityPoint>()
  const addPoint = (lng: number, lat: number, count: number) => {
    const key = `${lng.toFixed(4)}:${lat.toFixed(4)}`
    const existing = densityByCoordinate.get(key)
    if (existing) existing.count += count
    else densityByCoordinate.set(key, { lng, lat, count })
  }

  routePoints.forEach((point) => addPoint(point.lng, point.lat, 4))
  candidatePoints.forEach((point) => addPoint(point.lng, point.lat, 1))
  return Array.from(densityByCoordinate.values())
}

function setHeatmapVisibility(heatmap: any, visible: boolean) {
  if (!heatmap) return
  if (visible) heatmap.show?.()
  else heatmap.hide?.()
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
  const visibleRoute = useMemo(
    () => (usesBuiltInReference ? DEFAULT_REFERENCE_ROUTE : routePoints).map((point) => ({
      ...point,
      type: point.type ?? inferMapPlaceType(point.name, point.sourceType),
    })),
    [routePoints, usesBuiltInReference],
  )
  const hostRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const standardLayerRef = useRef<any>(null)
  const satelliteLayersRef = useRef<any[]>([])
  const trafficLayerRef = useRef<any>(null)
  const heatmapRef = useRef<any>(null)
  const [loadState, setLoadState] = useState<MapLoadState>(apiKey ? 'loading' : 'fallback')
  const [fallbackScale, setFallbackScale] = useState(1)
  const [focusedFormalPointId, setFocusedFormalPointId] = useState<string | null>(null)
  const [baseLayer, setBaseLayer] = useState<MapBaseLayer>('standard')
  const [trafficEnabled, setTrafficEnabled] = useState(false)
  const [densityEnabled, setDensityEnabled] = useState(false)
  const [layerNotice, setLayerNotice] = useState<string | null>(null)
  const [layerAvailability, setLayerAvailability] = useState<MapLayerAvailability>({
    satellite: true,
    traffic: true,
    density: true,
  })
  const callbacksRef = useRef({
    onSelectFormalPoint,
    onSelectCandidateCluster,
    onReady,
    onLoadError,
  })
  callbacksRef.current = { onSelectFormalPoint, onSelectCandidateCluster, onReady, onLoadError }
  const routeSignature = visibleRoute
    .map(({ id, order, name, type, lng, lat }) => `${id}:${order}:${name}:${type}:${lng}:${lat}`)
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
  const densityData = useMemo(
    () => buildDensityData(visibleRoute, candidatePoints),
    [candidatePoints, visibleRoute],
  )
  const canShowDensity = densityData.length >= 3

  useEffect(() => {
    const markerIconRoots: Root[] = []
    if (!apiKey || !hostRef.current) {
      setLoadState('fallback')
      callbacksRef.current.onReady?.('local-reference')
      return undefined
    }

    let cancelled = false
    setLoadState('loading')
    setLayerAvailability({ satellite: true, traffic: true, density: true })
    configureAmapServiceHost()

    loadAmap({ key: apiKey, version: '2.0', plugins: ['AMap.MoveAnimation', 'AMap.HeatMap'] })
      .then((AMap: any) => {
        if (cancelled || !hostRef.current) return

        let standardLayer: any = null
        let satelliteLayers: any[] = []
        let trafficLayer: any = null
        try {
          standardLayer = AMap.createDefaultLayer?.({ zooms: [3, 20] }) ?? null
        } catch {
          standardLayer = null
        }
        try {
          satelliteLayers = [
            new AMap.TileLayer.Satellite({ zooms: [3, 20], zIndex: 1 }),
            new AMap.TileLayer.RoadNet({ zooms: [3, 20], zIndex: 2 }),
          ]
        } catch {
          setLayerAvailability((value) => ({ ...value, satellite: false }))
          setLayerNotice('卫星图暂时不可用')
        }
        try {
          trafficLayer = new AMap.TileLayer.Traffic({
            autoRefresh: true,
            interval: 180,
            opacity: 0.78,
            zIndex: 8,
          })
        } catch {
          setLayerAvailability((value) => ({ ...value, traffic: false }))
          setLayerNotice('实时路况暂时不可用，路线浏览不受影响')
        }
        const map = new AMap.Map(hostRef.current, {
          zoom: 10,
          center: [visibleRoute[0].lng, visibleRoute[0].lat],
          resizeEnable: true,
          viewMode: '2D',
          ...(standardLayer ? { layers: [standardLayer] } : {}),
        })
        mapRef.current = map
        standardLayerRef.current = standardLayer
        satelliteLayersRef.current = satelliteLayers
        trafficLayerRef.current = trafficLayer

        trafficLayer?.on?.('error', () => {
          if (!cancelled) setLayerNotice('实时路况暂时不可用，路线浏览不受影响')
        })

        try {
          const heatmap = new AMap.HeatMap(map, {
            radius: 28,
            opacity: [0, 0.72],
            zooms: [3, 18],
            gradient: {
              0.25: '#65b8c5',
              0.5: '#f0c45b',
              0.76: '#de7449',
              1: '#a63422',
            },
          })
          heatmap.setDataSet({
            data: densityData,
            max: Math.max(4, ...densityData.map((point) => point.count)),
          })
          heatmap.hide?.()
          heatmapRef.current = heatmap
        } catch {
          heatmapRef.current = null
          setLayerAvailability((value) => ({ ...value, density: false }))
          setLayerNotice('点位密度图层暂时不可用')
        }

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
            strokeStyle: 'dashed',
            strokeDasharray: selectedLegIndex === index ? [14, 10] : [10, 9],
            showDir: true,
            dirColor: selectedLegIndex === index ? JOVLO_COLORS.brand : JOVLO_COLORS.sea,
            lineJoin: 'round',
          })
        })

        const formalMarkers = visibleRoute.map((point) => {
          const pointType = point.type ?? 'other'
          const markerButton = createAmapPlaceMarker({
            ariaLabel: `第 ${point.order} 站：${point.name}，${MAP_PLACE_TYPE_LABEL[pointType]}`,
            kind: 'formal',
            name: point.name,
            order: point.order,
            selected: point.id === selectedPointId,
            type: pointType,
            roots: markerIconRoots,
          })
          markerButton.addEventListener('click', () => {
            hostRef.current?.querySelectorAll<HTMLElement>('[data-map-marker-kind="formal"]').forEach((marker) => {
              marker.dataset.selected = String(marker === markerButton)
            })
            setFocusedFormalPointId(point.id)
            callbacksRef.current.onSelectFormalPoint?.(point.id)
          })

          return new AMap.Marker({
            position: [point.lng, point.lat],
            content: markerButton,
            offset: new AMap.Pixel(-18, -42),
            zIndex: 20,
          })
        })

        const candidateMarkers = clusters.map((cluster) => {
          const pointIds = cluster.points.map((point) => point.id)
          const isCluster = cluster.points.length > 1
          const lng = cluster.points.reduce((sum, point) => sum + point.lng, 0) / cluster.points.length
          const lat = cluster.points.reduce((sum, point) => sum + point.lat, 0) / cluster.points.length
          const markerButton = createAmapPlaceMarker({
            ariaLabel: isCluster
              ? `${cluster.points.length} 个候选地点，主类型 ${MAP_PLACE_TYPE_LABEL[cluster.type]}`
              : `候选地点：${cluster.points[0].name}，${MAP_PLACE_TYPE_LABEL[cluster.type]}`,
            kind: isCluster ? 'candidate-cluster' : 'candidate',
            name: isCluster ? `${cluster.points.length} 个候选` : cluster.points[0].name,
            order: isCluster ? cluster.points.length : undefined,
            selected: pointIds.includes(selectedPointId ?? ''),
            type: cluster.type,
            roots: markerIconRoots,
          })
          markerButton.addEventListener('click', () => {
            setFocusedFormalPointId(null)
            callbacksRef.current.onSelectCandidateCluster?.(pointIds)
          })

          return new AMap.Marker({
            position: [lng, lat],
            content: markerButton,
            offset: new AMap.Pixel(-18, -42),
            zIndex: 16,
          })
        })

        const routePath = visibleRoute.map((point) => [point.lng, point.lat])
        let routeDirectionMarker: any = null
        if (routePath.length > 1) {
          const routeArrow = document.createElement('span')
          routeArrow.className = 'jovlo-amap-route-arrow'
          routeArrow.dataset.mapMarkerKind = 'route-arrow'
          const routeArrowRoot = createRoot(routeArrow)
          routeArrowRoot.render(<Navigation2 aria-hidden="true" size={15} strokeWidth={2.6} />)
          markerIconRoots.push(routeArrowRoot)
          routeDirectionMarker = new AMap.Marker({
            position: routePath[0],
            content: routeArrow,
            offset: new AMap.Pixel(-11, -11),
            zIndex: 18,
          })
        }

        map.add([...routeOverlays, ...(routeDirectionMarker ? [routeDirectionMarker] : []), ...formalMarkers, ...candidateMarkers])

        if (
          routeDirectionMarker?.moveAlong &&
          !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        ) {
          const playRouteDirection = () => {
            if (cancelled) return
            routeDirectionMarker.setPosition?.(routePath[0])
            routeDirectionMarker.moveAlong(routePath, {
              duration: Math.max(7_000, routePath.length * 2_000),
              autoRotation: true,
            })
          }
          routeDirectionMarker.on?.('movealong', playRouteDirection)
          playRouteDirection()
        }

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
      standardLayerRef.current = null
      satelliteLayersRef.current = []
      trafficLayerRef.current = null
      heatmapRef.current = null
      queueMicrotask(() => markerIconRoots.forEach((root) => root.unmount()))
    }
  }, [apiKey, candidateSignature, densityData, routeSignature, selectedLegIndex, selectedPointId])

  useEffect(() => {
    if (loadState !== 'ready' || !mapRef.current) return
    const baseLayers = baseLayer === 'satellite' && satelliteLayersRef.current.length > 0
      ? satelliteLayersRef.current
      : standardLayerRef.current
        ? [standardLayerRef.current]
        : []
    const layers = trafficEnabled && trafficLayerRef.current
      ? [...baseLayers, trafficLayerRef.current]
      : baseLayers

    try {
      mapRef.current.setLayers?.(layers)
    } catch {
      setLayerNotice(baseLayer === 'satellite' ? '卫星图暂时不可用，已保留当前地图' : '地图图层切换失败')
    }
  }, [baseLayer, loadState, trafficEnabled])

  useEffect(() => {
    if (loadState !== 'ready') return
    if (densityEnabled && !heatmapRef.current) {
      setLayerNotice('点位密度图层暂时不可用')
      return
    }
    setHeatmapVisibility(heatmapRef.current, densityEnabled)
  }, [densityEnabled, loadState])

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
  const focusedFormalPoint = visibleRoute.find((point) => point.id === focusedFormalPointId)
  const focusedFormalPointType = focusedFormalPoint?.type ?? 'other'
  const FocusedPointIcon = MAP_PLACE_ICON[focusedFormalPointType]

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

      {loadState === 'ready' && (
        <div className="jovlo-map-layer-panel" aria-label="地图图层">
          <div className="jovlo-map-layer-panel__base" role="group" aria-label="底图类型">
            <button
              type="button"
              aria-pressed={baseLayer === 'standard'}
              onClick={() => {
                setLayerNotice(null)
                setBaseLayer('standard')
              }}
            >
              <MapIcon aria-hidden="true" size={15} />
              普通
            </button>
            <button
              type="button"
              aria-pressed={baseLayer === 'satellite'}
              disabled={!layerAvailability.satellite}
              aria-label={layerAvailability.satellite ? '卫星' : '卫星，暂时不可用'}
              onClick={() => {
                setLayerNotice(null)
                setBaseLayer('satellite')
              }}
            >
              <Satellite aria-hidden="true" size={15} />
              卫星
            </button>
          </div>
          <button
            type="button"
            aria-label={layerAvailability.traffic ? '路况' : '路况，暂时不可用'}
            aria-pressed={trafficEnabled}
            disabled={!layerAvailability.traffic}
            onClick={() => {
              setLayerNotice(null)
              setTrafficEnabled((value) => !value)
            }}
          >
            <TrafficCone aria-hidden="true" size={15} />
            路况
          </button>
          <button
            type="button"
            aria-label={
              !layerAvailability.density
                ? '密度，暂时不可用'
                : canShowDensity
                  ? '密度'
                  : '密度，至少需要 3 个不同点位'
            }
            aria-pressed={densityEnabled}
            disabled={!canShowDensity || !layerAvailability.density}
            onClick={() => {
              setLayerNotice(null)
              setDensityEnabled((value) => !value)
            }}
          >
            <Flame aria-hidden="true" size={15} />
            密度
          </button>
        </div>
      )}

      {loadState === 'ready' && (trafficEnabled || densityEnabled || layerNotice) && (
        <div className="jovlo-map-layer-status" role={layerNotice ? 'status' : undefined}>
          {layerNotice ? <span>{layerNotice}</span> : null}
          {!layerNotice && trafficEnabled ? (
            <span className="jovlo-map-traffic-legend" aria-label="实时路况图例">
              <i data-level="clear" />畅通
              <i data-level="slow" />缓行
              <i data-level="jam" />拥堵
            </span>
          ) : null}
          {!layerNotice && densityEnabled ? <span>点位密度 · 非实时客流</span> : null}
        </div>
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
            <title id="jovlo-reference-map-title">当日行车本地参考路线</title>
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
                ? `${cluster.points.length} 个候选地点，主类型 ${MAP_PLACE_TYPE_LABEL[cluster.type]}`
                : `候选地点：${cluster.points[0].name}`
              const activate = () => {
                setFocusedFormalPointId(null)
                onSelectCandidateCluster?.(cluster.points.map((point) => point.id))
              }
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
                    {isCluster ? cluster.points.length : MAP_PLACE_TYPE_LABEL[cluster.type].slice(0, 1)}
                  </text>
                </g>
              )
            })}

            {visibleRoute.map((point) => {
              const position = projected.get(point.id)
              if (!position) return null
              const selected = point.id === selectedPointId || point.id === focusedFormalPointId
              const pointType = point.type ?? 'other'
              const activate = () => {
                setFocusedFormalPointId(point.id)
                onSelectFormalPoint?.(point.id)
              }
              return (
                <g
                  key={point.id}
                  className="jovlo-reference-map__formal"
                  data-map-marker-kind="formal"
                  data-type={pointType}
                  data-selected={selected || undefined}
                  role="button"
                  tabIndex={0}
                  aria-label={`第 ${point.order} 站：${point.name}，${MAP_PLACE_TYPE_LABEL[pointType]}`}
                  onClick={activate}
                  onKeyDown={(event) => activateOnEnter(event, activate)}
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
                  <text className="jovlo-reference-map__formal-label" x="24" y="2">
                    {point.name}
                  </text>
                  <text className="jovlo-reference-map__formal-type" x="24" y="17">
                    {MAP_PLACE_TYPE_LABEL[pointType]}
                  </text>
                </g>
              )
            })}
          </svg>
          {usesBuiltInReference && <p className="jovlo-reference-map__caption">示意：石梅湾—日月湾—兴隆—神州半岛</p>}
        </div>
      )}

      {focusedFormalPoint ? (
        <aside className="jovlo-map-point-action" aria-label={`${focusedFormalPoint.name} 地图操作`}>
          <span className="jovlo-map-point-action__icon" data-type={focusedFormalPointType}>
            <FocusedPointIcon aria-hidden="true" size={17} />
          </span>
          <span className="jovlo-map-point-action__copy">
            <strong>{focusedFormalPoint.name}</strong>
            <small>{MAP_PLACE_TYPE_LABEL[focusedFormalPointType]} · 第 {focusedFormalPoint.order} 站</small>
          </span>
          <a
            href={buildAmapMarkerUrl({
              name: focusedFormalPoint.name,
              lon: focusedFormalPoint.lng,
              lat: focusedFormalPoint.lat,
            })}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink aria-hidden="true" size={16} />
            高德查看
          </a>
          <IconButton icon={X} label="关闭地点操作" size="compact" onClick={() => setFocusedFormalPointId(null)} />
        </aside>
      ) : null}

      <div className="jovlo-map-canvas__controls" aria-label="地图控制">
        <IconButton icon={Plus} label="放大地图" onClick={zoomIn} />
        <IconButton icon={Minus} label="缩小地图" onClick={zoomOut} />
        <IconButton icon={LocateFixed} label="适应路线" onClick={fitRoute} />
      </div>
    </section>
  )
}
