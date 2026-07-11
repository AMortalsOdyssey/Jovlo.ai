import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Session } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
  unsubscribe: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  getSupabaseClient: () => ({ auth: authMocks }),
}))

import { AuthProvider } from './AuthProvider'
import { LoginPage } from './LoginPage'
import { ProtectedRoute } from './ProtectedRoute'
import { useTripStore } from '@/store/useTripStore'

function LoginLocation() {
  const location = useLocation()
  return <div>登录入口 {location.search}</div>
}

function renderProtected(initialEntry = '/trips/trip-1/plan') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginLocation />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/trips/:tripId/plan" element={<div>私有路书</div>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('Supabase authentication flow', () => {
  beforeEach(() => {
    useTripStore.getState().resetDemo()
    authMocks.getSession.mockResolvedValue({ data: { session: null }, error: null })
    authMocks.onAuthStateChange.mockImplementation(() => ({
      data: { subscription: { unsubscribe: authMocks.unsubscribe } },
    }))
    authMocks.signInWithOtp.mockResolvedValue({ data: {}, error: null })
    authMocks.verifyOtp.mockResolvedValue({ data: { session: null }, error: null })
    authMocks.signOut.mockResolvedValue({ error: null })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('restores an anonymous session and keeps the private destination', async () => {
    renderProtected('/trips/trip-1/plan?day=2')

    expect(await screen.findByText(/登录入口/)).toHaveTextContent(
      '?returnTo=%2Ftrips%2Ftrip-1%2Fplan%3Fday%3D2',
    )
  })

  it('restores an authenticated session and exposes sign out', async () => {
    const session = {
      access_token: 'access-token',
      user: { id: 'user-1', email: 'traveler@example.com' },
    } as Session
    authMocks.getSession.mockResolvedValue({ data: { session }, error: null })
    useTripStore.getState().setProductionSync({ mode: 'production', hydrated: true })
    const user = userEvent.setup()

    renderProtected()

    expect(await screen.findByText('私有路书')).toBeInTheDocument()
    const signOutButton = screen.getByRole('button', { name: '退出 traveler@example.com' })
    await user.click(signOutButton)
    expect(authMocks.signOut).toHaveBeenCalledOnce()
  })

  it('sends a magic link that returns to the private destination', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/login?returnTo=%2Ftrips%2Ftrip-1%2Fplan']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )

    await screen.findByRole('heading', { name: '继续规划你的旅程' })
    await user.type(screen.getByLabelText('邮箱'), 'Traveler@Example.com ')
    await user.click(screen.getByRole('button', { name: /获取登录链接/ }))

    await waitFor(() => {
      expect(authMocks.signInWithOtp).toHaveBeenCalledWith({
        email: 'traveler@example.com',
        options: {
          shouldCreateUser: true,
          emailRedirectTo: 'http://localhost:3000/trips/trip-1/plan',
        },
      })
    })
    expect(screen.getByText('登录链接已发送至 traveler@example.com')).toBeInTheDocument()
    expect(screen.getByText('点击邮件里的登录链接，将自动回到这次行程。')).toBeInTheDocument()
  })
})
