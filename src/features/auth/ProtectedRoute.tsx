import { LoaderCircle, UserRound } from 'lucide-react'
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from './AuthProvider'
import { isSupabaseConfigured } from '@/lib/supabase'
import { useTripStore } from '@/store/useTripStore'
import './auth.css'

function SessionControl() {
  const { status, user } = useAuth()
  const label = status === 'trial' ? '本地试用与账号' : user?.email ? `账号：${user.email}` : '账号管理'

  return (
    <Link
      className="auth-session-control"
      to="/account"
      aria-label={label}
      title={label}
    >
      <UserRound aria-hidden="true" size={18} />
    </Link>
  )
}

export function ProtectedRoute() {
  const { status } = useAuth()
  const location = useLocation()
  const productionSync = useTripStore((state) => state.productionSync)

  if (status === 'loading') {
    return (
      <div className="auth-loading" role="status" aria-live="polite">
        <LoaderCircle aria-hidden="true" className="auth-spinner" size={22} />
        <span>正在恢复行程…</span>
      </div>
    )
  }

  if (status === 'anonymous') {
    const returnTo = `${location.pathname}${location.search}${location.hash}`
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />
  }

  if (status === 'authenticated' && isSupabaseConfigured && !productionSync.hydrated) {
    if (productionSync.mode === 'error') {
      return (
        <div className="auth-loading" role="alert">
          <span>{productionSync.error ?? '暂时无法载入云端路书。'}</span>
          <button type="button" onClick={() => window.location.reload()}>重新载入</button>
        </div>
      )
    }
    return (
      <div className="auth-loading" role="status" aria-live="polite">
        <LoaderCircle aria-hidden="true" className="auth-spinner" size={22} />
        <span>正在载入云端路书…</span>
      </div>
    )
  }

  return (
    <>
      <Outlet />
      {status === 'authenticated' || status === 'trial' ? <SessionControl /> : null}
    </>
  )
}
