import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const apiMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', () => ({ apiRequest: apiMock }))

import { AgentConnectionPage } from './AgentConnectionPage'
import { useTripStore } from '@/store/useTripStore'

describe('AgentConnectionPage', () => {
  beforeEach(() => {
    useTripStore.getState().resetDemo()
    apiMock.mockReset()
  })

  afterEach(cleanup)

  it('presents the three-step MCP flow without exposing the legacy JSON importer', async () => {
    const user = userEvent.setup()
    apiMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({
        id: 'a0000000-0000-4000-8000-000000000001',
        tripId: useTripStore.getState().trip.tripId,
        status: 'pending',
        scopes: ['read', 'write'],
        expiresAt: '2026-07-15T20:10:00.000Z',
        createdAt: '2026-07-15T20:00:00.000Z',
      })

    render(
      <MemoryRouter initialEntries={[`/trips/${useTripStore.getState().trip.tripId}/agent`]}>
        <Routes><Route path="/trips/:tripId/agent" element={<AgentConnectionPage />} /></Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Agent 协作' })).toBeInTheDocument()
    expect(screen.getByText('建立 MCP 连接')).toBeInTheDocument()
    expect(screen.getByText('登录 Jovlo 授权')).toBeInTheDocument()
    expect(screen.getByText('直接对话修改')).toBeInTheDocument()
    expect(screen.queryByText(/手动导入变更文件/)).not.toBeInTheDocument()
    expect(screen.queryByText(/JSON/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '创建 MCP 连接' }))
    expect(await screen.findByText(/codex mcp add jovlo --url/)).toBeInTheDocument()
    expect(screen.getByText(/\/mcp\/a0000000-0000-4000-8000-000000000001/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制连接命令' })).toBeInTheDocument()
  })
})
