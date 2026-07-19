import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ status: 'anonymous', user: null }),
}))

import { AgentGuidePage } from './AgentGuidePage'

describe('Agent guide', () => {
  afterEach(cleanup)

  it('explains the real MCP workflow and keeps both creation paths available', () => {
    render(<MemoryRouter><AgentGuidePage /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: 'AI 共创指南' })).toBeInTheDocument()
    expect(screen.getByText('连接 Agent')).toBeInTheDocument()
    expect(screen.getByText(/每次 Agent 修改都会生成版本/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '自己创建' })).toHaveAttribute('href', '/trips/new?mode=manual')
    expect(screen.getAllByRole('link', { name: /AI 协作创建|开始 AI 协作/ })[0]).toHaveAttribute(
      'href',
      '/login?returnTo=%2Ftrips%2Fnew',
    )
  })
})
