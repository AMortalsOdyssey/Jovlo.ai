import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', () => ({ apiRequest: apiMock }))

import { useTripStore } from '@/store/useTripStore'

import { NewTripPage } from './NewTripPage'
import { TripsPage } from './TripsPage'

describe('trip entry pages', () => {
  afterEach(cleanup)
  beforeEach(() => {
    useTripStore.getState().resetDemo()
    apiMock.mockReset()
    window.sessionStorage.clear()
  })

  it('renders the current trip with usable planning links', () => {
    render(<MemoryRouter><TripsPage /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: useTripStore.getState().trip.title })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '继续规划' })).toHaveAttribute(
      'href',
      `/trips/${useTripStore.getState().trip.tripId}/plan`,
    )
    expect(screen.getByRole('link', { name: '手动创建' })).toHaveAttribute('href', '/trips/new?mode=manual')
    expect(screen.getByRole('link', { name: 'AI 协作创建' })).toHaveAttribute('href', '/trips/new')
    expect(screen.getByRole('link', { name: '使用教程' })).toHaveAttribute('href', '/guide/agent')
  })

  it('labels the third wizard step as template reference instead of AMap output', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/trips/new?mode=manual']}><NewTripPage /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: '下一步' }))
    await user.click(screen.getByRole('button', { name: '查看草案' }))

    expect(screen.getByText('海南示例')).toBeInTheDocument()
    expect(screen.getByText(/不是高德道路算路结果/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始编辑' })).toBeEnabled()
  })

  it('uses Agent creation as the default left tab without sending users through the tutorial', () => {
    render(<MemoryRouter initialEntries={['/trips/new']}><NewTripPage /></MemoryRouter>)

    const switcher = screen.getByRole('navigation', { name: '创建方式' })
    const modeLinks = within(switcher).getAllByRole('link')
    expect(modeLinks[0]).toHaveAccessibleName(/AI 协作创建/)
    expect(modeLinks[0]).toHaveAttribute('aria-current', 'page')
    expect(modeLinks[1]).toHaveAccessibleName(/手动创建/)
    expect(screen.getByRole('heading', { name: '把要求交给 Agent，直接生成路书。' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '创建 MCP 连接' })).toBeEnabled()
    expect(screen.queryByRole('link', { name: '查看完整教程' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '先建立基础路书' })).not.toBeInTheDocument()
  })

  it('creates a blank trip and exposes the MCP command on the same page', async () => {
    const user = userEvent.setup()
    apiMock
      .mockResolvedValueOnce({ tripId: 'a0000000-0000-4000-8000-000000000010', revision: 0 })
      .mockResolvedValueOnce({
        id: 'a0000000-0000-4000-8000-000000000011',
        tripId: 'a0000000-0000-4000-8000-000000000010',
        status: 'pending',
        scopes: ['read', 'write'],
        expiresAt: '2026-07-19T10:10:00.000Z',
        createdAt: '2026-07-19T10:00:00.000Z',
      })

    render(<MemoryRouter initialEntries={['/trips/new']}><NewTripPage /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: '创建 MCP 连接' }))

    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2))
    expect(apiMock).toHaveBeenNthCalledWith(1, '/api/v1/trips', expect.objectContaining({ method: 'POST' }))
    expect(apiMock).toHaveBeenNthCalledWith(2, expect.stringMatching(/\/mcp-connections$/), expect.objectContaining({ method: 'POST' }))
    expect(await screen.findByText(/codex mcp add jovlo --url/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制连接命令' })).toBeEnabled()
  })
})
