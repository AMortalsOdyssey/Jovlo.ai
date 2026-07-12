import { ArrowRight, Compass, LoaderCircle, LogIn } from 'lucide-react'
import { type FormEvent, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'

import { AuthPageLayout } from './AuthPageLayout'
import { EmailField, PasswordField } from './AuthFields'
import { TurnstileGate, type TurnstileGateHandle } from './TurnstileGate'
import { useAuth } from './AuthProvider'
import { AUTH_ROUTES, isValidEmail, normalizeEmail, readableAuthError, safeReturnTo } from './auth-utils'

export function LoginPage() {
  const { signInWithPassword, startLocalTrial, status } = useAuth()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const turnstileRef = useRef<TurnstileGateHandle>(null)
  const returnTo = safeReturnTo(searchParams.get('returnTo'))
  const returnToQuery = `?returnTo=${encodeURIComponent(returnTo)}`

  if (status === 'loading') {
    return (
      <div className="auth-loading" role="status" aria-live="polite">
        <LoaderCircle aria-hidden="true" className="auth-spinner" size={22} />
        <span>正在恢复行程…</span>
      </div>
    )
  }

  if (status === 'authenticated' || status === 'trial' || status === 'demo') {
    return <Navigate to={returnTo} replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedEmail = normalizeEmail(email)
    if (!isValidEmail(normalizedEmail)) {
      setMessage('请输入有效的邮箱地址。')
      return
    }
    if (!password) {
      setMessage('请输入密码。')
      return
    }
    if (!captchaToken) {
      setMessage('请先完成人机验证。')
      return
    }

    setBusy(true)
    setMessage(null)
    try {
      await signInWithPassword(normalizedEmail, password, captchaToken)
      navigate(returnTo, { replace: true })
    } catch (error) {
      setMessage(readableAuthError(error))
      turnstileRef.current?.reset()
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthPageLayout
      title="继续规划你的旅程"
      description="使用邮箱和密码，回到你的路书。"
      showCopyright
      footer={<p className="auth-privacy">还没有账号？ <Link to={`${AUTH_ROUTES.register}${returnToQuery}`}>创建账号</Link></p>}
    >
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <label htmlFor="auth-email">邮箱</label>
        <EmailField id="auth-email" value={email} onChange={setEmail} autoFocus />

        <div className="auth-label-row">
          <label htmlFor="auth-password">密码</label>
          <Link to={`${AUTH_ROUTES.forgotPassword}${returnToQuery}`}>忘记密码</Link>
        </div>
        <PasswordField
          id="auth-password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />

        <TurnstileGate ref={turnstileRef} action="login" onTokenChange={setCaptchaToken} />

        <button className="auth-primary" type="submit" disabled={busy}>
          {busy ? <LoaderCircle aria-hidden="true" className="auth-spinner" size={18} /> : <LogIn aria-hidden="true" size={18} />}
          登录
          {!busy ? <ArrowRight aria-hidden="true" size={17} /> : null}
        </button>
      </form>

      <div className="auth-trial">
        <span>或</span>
        <button type="button" className="auth-back" onClick={() => { startLocalTrial(); navigate(returnTo, { replace: true }) }}>
          <Compass aria-hidden="true" size={17} />本地试用
        </button>
        <small>仅保存在当前浏览器，不会创建云端路书。</small>
      </div>

      {message ? <p className="auth-message" role="alert">{message}</p> : null}
    </AuthPageLayout>
  )
}
