import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const authState = vi.hoisted(() => ({
  status: 'anonymous' as 'anonymous' | 'authenticated',
  user: null as { email?: string } | null,
}))

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => authState,
}))

import { AuthPageLayout } from '@/features/auth/AuthPageLayout'
import { PageShell } from '@/features/trips/feature-ui'
import { HomePage } from './HomePage'

describe('Jovlo homepage', () => {
  afterEach(() => {
    cleanup()
    authState.status = 'anonymous'
    authState.user = null
  })

  it('keeps the homepage concise and sends anonymous users through login', () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: 'Jovlo' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '开始我的路书' })).toHaveAttribute(
      'href',
      '/login?returnTo=%2Ftrips',
    )
    expect(screen.getByRole('link', { name: '登录 Jovlo' })).toHaveAttribute(
      'href',
      '/login?returnTo=%2Ftrips',
    )
    expect(screen.getAllByText('© 2026 jovlo.8xd.io')).toHaveLength(1)
  })

  it('opens the workspace and account directly for authenticated users', () => {
    authState.status = 'authenticated'
    authState.user = { email: 'traveler@example.com' }
    render(<MemoryRouter><HomePage /></MemoryRouter>)

    expect(screen.getByRole('link', { name: '打开我的路书' })).toHaveAttribute('href', '/trips')
    expect(screen.getByRole('link', { name: '账号：traveler@example.com' })).toHaveAttribute('href', '/account')
  })

  it('keeps copyright out of shared shells and optional on authentication layouts', () => {
    const { rerender } = render(<PageShell><p>路书内容</p></PageShell>)
    expect(screen.queryByText('© 2026 jovlo.8xd.io')).not.toBeInTheDocument()

    rerender(
      <AuthPageLayout title="登录" description="回到路书">
        <p>账号表单</p>
      </AuthPageLayout>,
    )
    expect(screen.queryByText('© 2026 jovlo.8xd.io')).not.toBeInTheDocument()

    rerender(
      <AuthPageLayout title="登录" description="回到路书" showCopyright>
        <p>账号表单</p>
      </AuthPageLayout>,
    )
    expect(screen.getByText('© 2026 jovlo.8xd.io')).toBeInTheDocument()
  })
})
