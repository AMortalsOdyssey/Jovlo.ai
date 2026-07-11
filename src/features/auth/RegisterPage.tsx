import { ArrowRight, LoaderCircle, MailCheck, UserPlus } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'

import { AuthPageLayout } from './AuthPageLayout'
import { EmailField, PasswordField } from './AuthFields'
import { useAuth } from './AuthProvider'
import {
  AUTH_ROUTES,
  hasRecommendedPasswordMix,
  isValidEmail,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  readableAuthError,
  safeReturnTo,
} from './auth-utils'

export function RegisterPage() {
  const { signUp, status } = useAuth()
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const returnTo = safeReturnTo(searchParams.get('returnTo'))
  const loginHref = `${AUTH_ROUTES.login}?returnTo=${encodeURIComponent(returnTo)}`
  const passwordLongEnough = password.length >= MIN_PASSWORD_LENGTH
  const passwordHasMix = hasRecommendedPasswordMix(password)

  if (status === 'loading') {
    return <div className="auth-loading" role="status">正在恢复账户…</div>
  }

  if ((status === 'authenticated' || status === 'demo') && !busy && !registeredEmail) {
    return <Navigate to={returnTo} replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedEmail = normalizeEmail(email)

    if (!isValidEmail(normalizedEmail)) {
      setMessage('请输入有效的邮箱地址。')
      return
    }
    if (!passwordLongEnough) {
      setMessage(`密码至少需要 ${MIN_PASSWORD_LENGTH} 位。`)
      return
    }
    if (password !== confirmation) {
      setMessage('两次输入的密码不一致。')
      return
    }

    setBusy(true)
    setMessage(null)
    try {
      const callbackUrl = new URL(AUTH_ROUTES.callback, window.location.origin)
      callbackUrl.searchParams.set('returnTo', returnTo)
      await signUp(normalizedEmail, password, callbackUrl.toString())
      setEmail(normalizedEmail)
      setRegisteredEmail(normalizedEmail)
    } catch (error) {
      setMessage(readableAuthError(error))
    } finally {
      setBusy(false)
    }
  }

  if (registeredEmail) {
    return (
      <AuthPageLayout title="查收验证邮件" description={`验证邮件已发送至 ${registeredEmail}`}>
        <div className="auth-result" role="status" aria-live="polite">
          <MailCheck aria-hidden="true" size={30} />
          <p>点击邮件中的链接完成验证，然后使用邮箱和密码登录。</p>
          <Link className="auth-primary" to={loginHref}>
            返回登录
            <ArrowRight aria-hidden="true" size={17} />
          </Link>
        </div>
      </AuthPageLayout>
    )
  }

  return (
    <AuthPageLayout
      title="创建你的 Jovlo 账号"
      description="保存路书草稿，并在不同设备继续共创。"
      footer={<p className="auth-privacy">已有账号？ <Link to={loginHref}>返回登录</Link></p>}
    >
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <label htmlFor="register-email">邮箱</label>
        <EmailField id="register-email" value={email} onChange={setEmail} autoFocus />

        <label htmlFor="register-password">密码</label>
        <PasswordField
          id="register-password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
        />
        <div className="auth-password-hints" aria-live="polite">
          <span className={passwordLongEnough ? 'is-valid' : ''}>至少 8 位</span>
          <span className={passwordHasMix ? 'is-valid' : ''}>建议同时包含字母和数字</span>
        </div>

        <label htmlFor="register-confirmation">确认密码</label>
        <PasswordField
          id="register-confirmation"
          name="password-confirmation"
          value={confirmation}
          onChange={setConfirmation}
          autoComplete="new-password"
        />

        <button className="auth-primary" type="submit" disabled={busy}>
          {busy ? <LoaderCircle aria-hidden="true" className="auth-spinner" size={18} /> : <UserPlus aria-hidden="true" size={18} />}
          创建账号
          {!busy ? <ArrowRight aria-hidden="true" size={17} /> : null}
        </button>
      </form>
      {message ? <p className="auth-message" role="alert">{message}</p> : null}
    </AuthPageLayout>
  )
}
