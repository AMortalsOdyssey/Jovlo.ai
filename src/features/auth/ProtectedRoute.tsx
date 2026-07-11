import { LoaderCircle, LogOut } from 'lucide-react'
import { useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from './AuthProvider'
import { isSupabaseConfigured } from '@/lib/supabase'
import { useTripStore } from '@/store/useTripStore'
import './auth.css'

function SessionControl() {
  const { signOut, user } = useAuth()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function handleSignOut() {
    setBusy(true)
    setFailed(false)
    try {
      await signOut()
    } catch {
      setFailed(true)
      setBusy(false)
    }
  }

  const label = failed
    ? '退出失败，点击重试'
    : user?.email
      ? `退出 ${user.email}`
      : '退出登录'

  return (
    <button
      className={`auth-session-control${failed ? ' auth-session-control--failed' : ''}`}
      type="button"
      onClick={handleSignOut}
      disabled={busy}
      aria-label={label}
      title={label}
    >
      {busy ? <LoaderCircle aria-hidden="true" className="auth-spinner" size={18} /> : <LogOut aria-hidden="true" size={18} />}
    </button>
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
      {status === 'authenticated' ? <SessionControl /> : null}
    </>
  )
}
