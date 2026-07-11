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

    await user.click(screen.getByRole('button', { name: '第 1 站：日月湾' }))
    await user.click(screen.getByRole('button', { name: '2 个候选地点，主类型 海滩' }))
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
    const formalMarkerOptions: Array<{ content: HTMLElement }> = []
    let clusteredCandidates: Array<{ id: string }> = []

    function FakeMap(this: Record<string, unknown>) {
      this.add = mapAdd
      this.setFitView = vi.fn()
      this.destroy = mapDestroy
      this.zoomIn = vi.fn()
      this.zoomOut = vi.fn()
    }

    function FakePolyline(this: Record<string, unknown>, options: unknown) {
      this.options = options
    }

    function FakeMarker(this: Record<string, unknown>, options: { content: HTMLElement }) {
      formalMarkerOptions.push(options)
      this.options = options
    }

    function FakeMarkerCluster(
      this: Record<string, unknown>,
      _map: unknown,
      data: Array<{ id: string }>,
    ) {
      clusteredCandidates = data
      this.setMap = vi.fn()
    }

    function FakePixel(this: Record<string, unknown>, x: number, y: number) {
      this.x = x
      this.y = y
    }

    vi.mocked(loadAmap).mockResolvedValue({
      Map: FakeMap,
      Polyline: FakePolyline,
      Marker: FakeMarker,
      MarkerCluster: FakeMarkerCluster,
      Pixel: FakePixel,
    })

    const onReady = vi.fn()
    const { container } = render(
      <MapCanvas
        amapKey="amap-test-key"
        routePoints={[
          { id: 's1', order: 1, name: '日月湾', lng: 110.195, lat: 18.645 },
          { id: 's2', order: 2, name: '兴隆咖啡园', lng: 110.213, lat: 18.727 },
        ]}
        candidatePoints={[
          { id: 'c1', name: '候选海滩 A', type: 'beach', lng: 110.2, lat: 18.67 },
          { id: 'c2', name: '候选咖啡 B', type: 'coffee', lng: 110.21, lat: 18.68 },
        ]}
        onReady={onReady}
      />,
    )

    await waitFor(() => expect(container.firstElementChild).toHaveAttribute('data-provider', 'amap'))
    expect(loadAmap).toHaveBeenCalledWith({
      key: 'amap-test-key',
      version: '2.0',
      plugins: ['AMap.MarkerCluster'],
    })
    expect(formalMarkerOptions).toHaveLength(2)
    expect(formalMarkerOptions.every(({ content }) => content.dataset.mapMarkerKind === 'formal')).toBe(true)
    expect(clusteredCandidates.map(({ id }) => id)).toEqual(['c1', 'c2'])
    expect(onReady).toHaveBeenCalledWith('amap')
  })
})
