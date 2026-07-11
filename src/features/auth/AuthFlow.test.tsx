import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Session } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  verifyOtp: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  unsubscribe: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  getSupabaseClient: () => ({ auth: authMocks }),
}))

import { AccountPage } from './AccountPage'
import { AuthCallbackPage } from './AuthCallbackPage'
import { AuthProvider } from './AuthProvider'
import { ForgotPasswordPage } from './ForgotPasswordPage'
import { LoginPage } from './LoginPage'
import { ProtectedRoute } from './ProtectedRoute'
import { RegisterPage } from './RegisterPage'
import { SetNewPasswordPage } from './SetNewPasswordPage'
import { useTripStore } from '@/store/useTripStore'

const authenticatedSession = {
  access_token: 'access-token',
  user: { id: 'user-1', email: 'traveler@example.com' },
} as Session

function LoginLocation() {
  const location = useLocation()
  return <div>登录入口 {location.search}</div>
}

function CurrentLocation() {
  const location = useLocation()
  return <div>当前位置 {location.pathname}{location.search}</div>
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

function renderAuthRoute(initialEntry: string, path: string, element: React.ReactNode, extraRoutes?: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AuthProvider>
        <Routes>
          <Route path={path} element={element} />
          {extraRoutes}
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
    authMocks.signUp.mockResolvedValue({ data: { session: null, user: null }, error: null })
    authMocks.signInWithPassword.mockResolvedValue({ data: { session: authenticatedSession }, error: null })
    authMocks.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })
    authMocks.verifyOtp.mockResolvedValue({ data: { session: authenticatedSession }, error: null })
    authMocks.updateUser.mockResolvedValue({ data: { user: authenticatedSession.user }, error: null })
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

  it('restores an authenticated session and exposes the compact account entry', async () => {
    authMocks.getSession.mockResolvedValue({ data: { session: authenticatedSession }, error: null })
    useTripStore.getState().setProductionSync({ mode: 'production', hydrated: true })
    renderProtected()

    expect(await screen.findByText('私有路书')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '账号：traveler@example.com' })).toHaveAttribute('href', '/account')
  })

  it('signs in with normalized email and returns to the private destination', async () => {
    const user = userEvent.setup()
    renderAuthRoute(
      '/login?returnTo=%2Ftrips%2Ftrip-1%2Fplan',
      '/login',
      <LoginPage />,
      <Route path="/trips/:tripId/plan" element={<div>已回到路书</div>} />,
    )

    await screen.findByRole('heading', { name: '继续规划你的旅程' })
    await user.type(screen.getByLabelText('邮箱'), 'Traveler@Example.com ')
    await user.type(screen.getByLabelText('密码'), 'Travel123')
    await user.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => {
      expect(authMocks.signInWithPassword).toHaveBeenCalledWith({
        email: 'traveler@example.com',
        password: 'Travel123',
      })
    })
    expect(await screen.findByText('已回到路书')).toBeInTheDocument()
  })

  it('validates registration passwords and prompts for email verification', async () => {
    const user = userEvent.setup()
    renderAuthRoute('/register?returnTo=%2Ftrips', '/register', <RegisterPage />)

    await screen.findByRole('heading', { name: '创建你的 Jovlo 账号' })
    await user.type(screen.getByLabelText('邮箱'), 'New@Example.com ')
    await user.type(screen.getByLabelText('密码'), 'short')
    await user.type(screen.getByLabelText('确认密码'), 'short')
    await user.click(screen.getByRole('button', { name: '创建账号' }))
    expect(screen.getByRole('alert')).toHaveTextContent('密码至少需要 8 位。')
    expect(authMocks.signUp).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText('密码'))
    await user.clear(screen.getByLabelText('确认密码'))
    await user.type(screen.getByLabelText('密码'), 'Journey8')
    await user.type(screen.getByLabelText('确认密码'), 'Journey8')
    await user.click(screen.getByRole('button', { name: '创建账号' }))

    await waitFor(() => {
      expect(authMocks.signUp).toHaveBeenCalledWith({
        email: 'new@example.com',
        password: 'Journey8',
        options: {
          emailRedirectTo: 'http://localhost:3000/auth/callback?returnTo=%2Ftrips',
        },
      })
    })
    expect(await screen.findByRole('heading', { name: '查收验证邮件' })).toBeInTheDocument()
    expect(screen.getByText('验证邮件已发送至 new@example.com')).toBeInTheDocument()
  })

  it('sends a password reset email to the normalized address', async () => {
    const user = userEvent.setup()
    renderAuthRoute('/forgot-password', '/forgot-password', <ForgotPasswordPage />)

    await screen.findByRole('heading', { name: '找回你的密码' })
    await user.type(screen.getByLabelText('邮箱'), 'Traveler@Example.com ')
    await user.click(screen.getByRole('button', { name: '发送重置邮件' }))

    await waitFor(() => {
      expect(authMocks.resetPasswordForEmail).toHaveBeenCalledWith('traveler@example.com', {
        redirectTo: 'http://localhost:3000/auth/callback?returnTo=%2Ftrips',
      })
    })
    expect(await screen.findByRole('heading', { name: '查收重置邮件' })).toBeInTheDocument()
  })

  it('verifies a signup token hash', async () => {
    renderAuthRoute(
      '/auth/callback?token_hash=signup-hash&type=signup',
      '/auth/callback',
      <AuthCallbackPage />,
    )

    await waitFor(() => {
      expect(authMocks.verifyOtp).toHaveBeenCalledWith({ token_hash: 'signup-hash', type: 'signup' })
    })
    expect(await screen.findByRole('heading', { name: '邮箱已验证' })).toBeInTheDocument()
  })

  it('enters the new password page after verifying a recovery token', async () => {
    renderAuthRoute(
      '/auth/callback?token_hash=recovery-hash&type=recovery&returnTo=%2Ftrips%2Ftrip-1%2Fplan',
      '/auth/callback',
      <AuthCallbackPage />,
      <Route path="/reset-password" element={<CurrentLocation />} />,
    )

    expect(await screen.findByText(/当前位置 \/reset-password/)).toHaveTextContent(
      '/reset-password?returnTo=%2Ftrips%2Ftrip-1%2Fplan',
    )
    expect(authMocks.verifyOtp).toHaveBeenCalledWith({ token_hash: 'recovery-hash', type: 'recovery' })
  })

  it('updates the password after a recovery session is restored', async () => {
    authMocks.getSession.mockResolvedValue({ data: { session: authenticatedSession }, error: null })
    const user = userEvent.setup()
    renderAuthRoute('/reset-password', '/reset-password', <SetNewPasswordPage />)

    await screen.findByRole('heading', { name: '设置新密码' })
    await user.type(screen.getByLabelText('新密码'), 'NewJourney9')
    await user.type(screen.getByLabelText('确认新密码'), 'NewJourney9')
    await user.click(screen.getByRole('button', { name: '保存新密码' }))

    await waitFor(() => {
      expect(authMocks.updateUser).toHaveBeenCalledWith({ password: 'NewJourney9' })
    })
    expect(await screen.findByRole('heading', { name: '新密码已设置' })).toBeInTheDocument()
  })

  it('shows the account email and signs out to the login entry', async () => {
    authMocks.getSession.mockResolvedValue({ data: { session: authenticatedSession }, error: null })
    const user = userEvent.setup()
    renderAuthRoute('/account', '/account', <AccountPage />)

    expect(await screen.findByText('traveler@example.com')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '退出登录' }))

    expect(authMocks.signOut).toHaveBeenCalledOnce()
    expect(await screen.findByRole('link', { name: /重新登录/ })).toHaveAttribute('href', '/login')
  })
})
