import { ArrowRight, LoaderCircle, LogIn, LogOut, Mail, Route } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { AuthPageLayout } from './AuthPageLayout'
import { useAuth } from './AuthProvider'
import { AUTH_ROUTES, readableAuthError } from './auth-utils'

export function AccountPage() {
  const { signOut, status, user } = useAuth()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function handleSignOut() {
    setBusy(true)
    setMessage(null)
    try {
      await signOut()
    } catch (error) {
      setMessage(readableAuthError(error))
      setBusy(false)
    }
  }

  if (status === 'loading') {
    return <div className="auth-loading" role="status">正在载入账号…</div>
  }

  if (status !== 'authenticated') {
    return (
      <AuthPageLayout title="登录你的账号" description="登录后可查看账号并同步你的路书。">
        <div className="auth-result">
          <Link className="auth-primary" to={AUTH_ROUTES.login}>
            <LogIn aria-hidden="true" size={18} />
            重新登录
            <ArrowRight aria-hidden="true" size={17} />
          </Link>
        </div>
      </AuthPageLayout>
    )
  }

  return (
    <AuthPageLayout
      title="账号管理"
      description="管理当前登录账号。"
      footer={
        <Link className="auth-return-link" to="/trips">
          <Route aria-hidden="true" size={16} />
          返回我的路书
        </Link>
      }
    >
      <div className="auth-account">
        <div className="auth-account__row">
          <Mail aria-hidden="true" size={18} />
          <div>
            <span>登录邮箱</span>
            <strong>{user?.email ?? '未提供邮箱'}</strong>
          </div>
        </div>
        <button className="auth-primary auth-primary--danger" type="button" disabled={busy} onClick={() => void handleSignOut()}>
          {busy ? <LoaderCircle aria-hidden="true" className="auth-spinner" size={18} /> : <LogOut aria-hidden="true" size={18} />}
          退出登录
        </button>
      </div>
      {message ? <p className="auth-message" role="alert">{message}</p> : null}
    </AuthPageLayout>
  )
}
