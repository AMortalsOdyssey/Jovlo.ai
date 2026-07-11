import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { load as loadAmap } from '@amap/amap-jsapi-loader'
import { MapCanvas } from './MapCanvas'

vi.mock('@amap/amap-jsapi-loader', () => ({ load: vi.fn() }))

afterEach(cleanup)

describe('MapCanvas fallback', () => {
  beforeEach(() => {
    vi.mocked(loadAmap).mockReset()
    delete window._AMapSecurityConfig
  })

  it('renders a non-empty local reference route without an AMap key', async () => {
    const onReady = vi.fn()
    const { container } = render(<MapCanvas amapKey="" onReady={onReady} />)

    expect(screen.getByText('本地参考路线 · 非高德实时数据')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /海南当日自驾本地参考路线/ })).toBeInTheDocument()
    expect(container.querySelectorAll('.jovlo-reference-map__route').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('[data-map-marker-kind="formal"]')).toHaveLength(4)
    expect(loadAmap).not.toHaveBeenCalled()
    await waitFor(() => expect(onReady).toHaveBeenCalledWith('local-reference'))
  })

  it('never clusters formal stops and clusters nearby candidates separately', async () => {
    const user = userEvent.setup()
    const onSelectFormalPoint = vi.fn()
    const onSelectCandidateCluster = vi.fn()
    const { container } = render(
      <MapCanvas
        amapKey=""
        routePoints={[
          { id: 's1', order: 1, name: '日月湾', lng: 110.195, lat: 18.645 },
          { id: 's2', order: 2, name: '兴隆咖啡园', lng: 110.213, lat: 18.727 },
        ]}
        candidatePoints={[
          { id: 'c1', name: '候选海滩 A', type: 'beach', lng: 110.2, lat: 18.67 },
          { id: 'c2', name: '候选海滩 B', type: 'beach', lng: 110.2, lat: 18.67 },
        ]}
        onSelectFormalPoint={onSelectFormalPoint}
        onSelectCandidateCluster={onSelectCandidateCluster}
      />,
    )

    expect(container.querySelectorAll('[data-map-marker-kind="formal"]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-map-marker-kind="candidate-cluster"]')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: '第 1 站：日月湾，海滨' }))
    const amapLink = screen.getByRole('link', { name: '高德查看' })
    expect(amapLink).toHaveAttribute('href', expect.stringContaining('https://uri.amap.com/marker?'))
    expect(amapLink).not.toHaveAttribute('href', expect.stringContaining('/navigation'))
    await user.click(screen.getByRole('button', { name: '2 个候选地点，主类型 海滨' }))
    expect(onSelectFormalPoint).toHaveBeenCalledWith('s1')
    expect(onSelectCandidateCluster).toHaveBeenCalledWith(['c1', 'c2'])
  })

  it('gives every icon-only map control an accessible name', () => {
    render(<MapCanvas amapKey="" />)
    expect(screen.getByRole('button', { name: '放大地图' })).toHaveAttribute('title', '放大地图')
    expect(screen.getByRole('button', { name: '缩小地图' })).toHaveAttribute('title', '缩小地图')
    expect(screen.getByRole('button', { name: '适应路线' })).toHaveAttribute('title', '适应路线')
  })

  it('loads AMap when a key exists while keeping formal markers outside candidate clustering', async () => {
    const mapAdd = vi.fn()
    const mapDestroy = vi.fn()
    const markerOptions: Array<{ content: HTMLElement }> = []
    const polylineOptions: Array<Record<string, unknown>> = []

    function FakeMap(this: Record<string, unknown>) {
      this.add = mapAdd
      this.setFitView = vi.fn()
      this.destroy = mapDestroy
      this.zoomIn = vi.fn()
      this.zoomOut = vi.fn()
    }

    function FakePolyline(this: Record<string, unknown>, options: Record<string, unknown>) {
      polylineOptions.push(options)
      this.options = options
    }

    function FakeMarker(this: Record<string, unknown>, options: { content: HTMLElement }) {
      markerOptions.push(options)
      this.options = options
    }

    function FakePixel(this: Record<string, unknown>, x: number, y: number) {
      this.x = x
      this.y = y
    }

    vi.mocked(loadAmap).mockResolvedValue({
      Map: FakeMap,
      Polyline: FakePolyline,
      Marker: FakeMarker,
      Pixel: FakePixel,
    })

    const onReady = vi.fn()
    const { container } = render(
      <MapCanvas
        amapKey="amap-test-key"
        routePoints={[
          { id: 's1', order: 1, name: '日月湾', lng: 110.195, lat: 18.645 },
          { id: 's2', order: 2, name: '文昌龙楼住宿区', sourceType: 'area', lng: 110.213, lat: 18.727 },
        ]}
        candidatePoints={[
          { id: 'c1', name: '候选海滩 A', type: 'beach', lng: 110.2, lat: 18.67 },
          { id: 'c2', name: '候选咖啡 B', type: 'coffee', lng: 110.2, lat: 18.67 },
        ]}
        onReady={onReady}
      />,
    )

    await waitFor(() => expect(container.firstElementChild).toHaveAttribute('data-provider', 'amap'))
    expect(loadAmap).toHaveBeenCalledWith({
      key: 'amap-test-key',
      version: '2.0',
      plugins: ['AMap.MoveAnimation'],
    })
    expect(window._AMapSecurityConfig).toEqual({
      serviceHost: `${window.location.origin}/_AMapService`,
    })
    const formalMarkerOptions = markerOptions.filter(({ content }) => content.dataset.mapMarkerKind === 'formal')
    const candidateMarkerOptions = markerOptions.filter(({ content }) => content.dataset.mapMarkerKind === 'candidate-cluster')
    const routeArrowOptions = markerOptions.filter(({ content }) => content.dataset.mapMarkerKind === 'route-arrow')
    expect(formalMarkerOptions).toHaveLength(2)
    expect(candidateMarkerOptions).toHaveLength(1)
    expect(routeArrowOptions).toHaveLength(1)
    expect(formalMarkerOptions[0].content).toHaveTextContent('日月湾海滨')
    expect(formalMarkerOptions[1].content).toHaveTextContent('文昌龙楼住宿区住宿')
    expect(candidateMarkerOptions[0].content).toHaveAttribute('aria-label', '2 个候选地点，主类型 海滨')
    expect(polylineOptions).toEqual([
      expect.objectContaining({ strokeStyle: 'dashed', showDir: true }),
    ])
    expect(onReady).toHaveBeenCalledWith('amap')
  })
})
