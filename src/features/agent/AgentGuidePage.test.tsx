import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
const authState = vi.hoisted(() => ({ status: 'anonymous' }))

vi.mock('@/lib/api', () => ({ apiRequest: apiMock }))
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: authState.status,
    user: { email: 'owner@example.com' },
    signOut: vi.fn(),
  }),
}))

import { useTripStore } from '@/store/useTripStore'
import { AgentGuidePage } from './AgentGuidePage'

describe('Agent guide', () => {
  beforeEach(() => {
    authState.status = 'anonymous'
    apiMock.mockReset()
    window.sessionStorage.clear()
    useTripStore.getState().resetDemo()
  })

  afterEach(cleanup)

  it('keeps the tutorial on one page without redundant AI start buttons', () => {
    render(<MemoryRouter initialEntries={['/guide/agent']}><AgentGuidePage /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: 'AI 共创指南' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '连接 MCP' })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'MCP 工具列表' })).toHaveTextContent('jovlo_create_trip')
    expect(screen.getByRole('list', { name: 'MCP 工具列表' })).toHaveTextContent('jovlo_apply_trip_changes')
    expect(screen.getByText(/建立连接不会生成空路书/)).toBeInTheDocument()
    expect(screen.getByText('从网上拿攻略')).toBeInTheDocument()
    expect(screen.getByText('直接口述行程')).toBeInTheDocument()
    expect(screen.getByText('修改指定路书')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '自己创建' })).toHaveAttribute('href', '/trips/new?mode=manual')
    expect(screen.queryByRole('link', { name: 'AI 协作创建' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '开始 AI 协作' })).not.toBeInTheDocument()
    expect(screen.queryByText(/重新创建 MCP 连接/)).not.toBeInTheDocument()
  })

  it('binds the integrated connector to the trip id supplied by a trip entry', async () => {
    authState.status = 'authenticated'
    apiMock.mockResolvedValue([])
    const trip = useTripStore.getState().trip

    render(
      <MemoryRouter initialEntries={[`/guide/agent?tripId=${trip.tripId}`]}>
        <AgentGuidePage />
      </MemoryRouter>,
    )

    expect(screen.getByText(`当前连接将只修改「${trip.title}」。`)).toBeInTheDocument()
    expect(screen.getByText(/当前已指定/)).toHaveTextContent(`当前已指定「${trip.title}」，连接不会写错目标。`)
    expect(screen.getByText(`路书 ID · ${trip.tripId}`)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '创建 MCP 连接' })).toBeEnabled()
    expect(apiMock).toHaveBeenCalledWith(`/api/v1/trips/${trip.tripId}/mcp-connections`)
  })
})
