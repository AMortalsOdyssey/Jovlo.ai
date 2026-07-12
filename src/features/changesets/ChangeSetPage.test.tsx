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

  it('keeps the Agent handoff simple and moves manual JSON into developer tools', () => {
    render(<MemoryRouter><ChangeSetPage /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: '让 Agent 帮你改路书' })).toBeInTheDocument()
    expect(screen.getByText('建立安全连接')).toBeInTheDocument()
    expect(screen.getByText('发送攻略资料')).toBeInTheDocument()
    expect(screen.getByText('确认修改建议')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制 Agent 连接指令' })).toBeEnabled()
    expect(screen.queryByText('连接指令详情')).not.toBeInTheDocument()
    expect(screen.getByText('开发者工具 · 手动导入变更文件').closest('details')).not.toHaveAttribute('open')
    expect(screen.queryByText('建议内容')).not.toBeInTheDocument()
  })

  it('gates review when the active draft is dirty', () => {
    useTripStore.setState({ dirty: true })
    render(<MemoryRouter><ChangeSetPage /></MemoryRouter>)

    expect(screen.getByText('先保存当前手工修改')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存为检查点' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '复制 Agent 连接指令' })).toBeDisabled()
  })

  it('loads the ChangeSet referenced by a real review URL', async () => {
    const stored = structuredClone(DEMO_CHANGESET)
    stored.changeSetId = 'c0000000-0000-4000-8000-000000000099'
    stored.producer.name = 'Agent 导入'
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

    await waitFor(() => expect(screen.getByText('Agent 导入 提交了 2 组建议')).toBeInTheDocument())
    expect(screen.getByText('建议内容')).toBeInTheDocument()
    expect(screen.getByText('路线影响')).toBeInTheDocument()
    expect(screen.getByText('涉及日期')).toBeInTheDocument()
    expect(screen.getByText('需要处理')).toBeInTheDocument()
    expect(screen.getByText(stored.proposalGroups[0].title)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认应用 2 组建议' })).toBeEnabled()
    expect(screen.getByText('开发者信息 · 原始 ChangeSet').closest('details')).not.toHaveAttribute('open')
  })

  it('copies a scoped Agent task package without applying any change', async () => {
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
    await userEvent.click(screen.getByRole('button', { name: '复制 Agent 连接指令' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
    const prompt = String(writeText.mock.calls[0][0])
    expect(prompt).toContain('Jovlo-Agent')
    expect(prompt).toContain('/api/v1/agent-imports')
    expect(prompt).toContain('不能直接应用')
    expect(screen.getByText(/连接指令已复制/)).toBeInTheDocument()
  })
})
