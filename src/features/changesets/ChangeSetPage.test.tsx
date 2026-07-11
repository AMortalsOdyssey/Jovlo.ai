import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEMO_CHANGESET } from '@domain'

import { useTripStore } from '@/store/useTripStore'

import { ChangeSetPage } from './ChangeSetPage'

describe('ChangeSetPage', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })
  beforeEach(() => {
    useTripStore.getState().resetDemo()
  })

  it('shows the four-part dry-run overview and keeps raw JSON collapsed', () => {
    render(<MemoryRouter><ChangeSetPage /></MemoryRouter>)

    expect(screen.getByText('改了什么')).toBeInTheDocument()
    expect(screen.getByText('代价')).toBeInTheDocument()
    expect(screen.getByText('影响哪几天')).toBeInTheDocument()
    expect(screen.getByText('阻断冲突')).toBeInTheDocument()
    expect(screen.getByText('阻断冲突').closest('.feature-metric')).toHaveTextContent('0可应用当前选择')
    expect(screen.getByRole('button', { name: '应用并创建新版本' })).toBeEnabled()
    expect(screen.getByText(/项日程风险需确认/)).toBeInTheDocument()
    expect(screen.getByText(/技术详情 · 原始 JSON/).closest('details')).not.toHaveAttribute('open')
  })

  it('gates review when the active draft is dirty', () => {
    useTripStore.setState({ dirty: true })
    render(<MemoryRouter><ChangeSetPage /></MemoryRouter>)

    expect(screen.getByText('先处理当前未发布草稿')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'TripChangeSet v1' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '保存草稿为版本' })).toBeEnabled()
  })

  it('loads the ChangeSet referenced by a real review URL', async () => {
    const stored = structuredClone(DEMO_CHANGESET)
    stored.changeSetId = 'c0000000-0000-4000-8000-000000000099'
    stored.producer.name = 'Codex 导入'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: { changeSet: stored, status: 'uploaded' },
      meta: { requestId: 'request-1', mode: 'production' },
      error: null,
    }), { status: 200, headers: { 'content-type': 'application/json' } })))

    render(
      <MemoryRouter initialEntries={[`/trips/${stored.tripId}/imports/${stored.changeSetId}`]}>
        <Routes><Route path="/trips/:tripId/imports/:changeSetId" element={<ChangeSetPage />} /></Routes>
      </MemoryRouter>,
    )

    await waitFor(() => expect((screen.getByRole('textbox', { name: 'TripChangeSet v1' }) as HTMLTextAreaElement).value).toContain(stored.changeSetId))
    expect(screen.getByText('由 Codex 导入 生成 · 2 个提案组')).toBeInTheDocument()
    expect(screen.getByText(stored.proposalGroups[0].title)).toBeInTheDocument()
  })

  it('copies a scoped Codex task package without applying any change', async () => {
    useTripStore.setState((current) => ({
      productionSync: {
        ...current.productionSync,
        mode: 'production',
        hydrated: true,
        currentVersionId: DEMO_CHANGESET.baseVersionId,
      },
    }))
    const writeText = vi.fn(async (_value: string) => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: {
        ticket: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        deliveryEndpoint: 'https://jovlo.8xd.io/api/v1/agent-imports',
      },
      meta: { requestId: 'request-2', mode: 'production' },
      error: null,
    }), { status: 201, headers: { 'content-type': 'application/json' } })))

    render(<MemoryRouter><ChangeSetPage /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: '复制 Codex 任务包' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
    const prompt = String(writeText.mock.calls[0][0])
    expect(prompt).toContain('Jovlo-Agent')
    expect(prompt).toContain('/api/v1/agent-imports')
    expect(prompt).toContain('不能直接应用')
    expect(screen.getByText(/任务包已复制/)).toBeInTheDocument()
  })
})
