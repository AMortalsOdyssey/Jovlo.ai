import { ArrowRight, CircleCheck, KeyRound, LoaderCircle } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { AuthPageLayout } from './AuthPageLayout'
import { PasswordField } from './AuthFields'
import { useAuth } from './AuthProvider'
import {
  AUTH_ROUTES,
  hasRecommendedPasswordMix,
  MIN_PASSWORD_LENGTH,
  readableAuthError,
  safeReturnTo,
} from './auth-utils'

export function SetNewPasswordPage() {
  const { status, updatePassword } = useAuth()
  const [searchParams] = useSearchParams()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [updated, setUpdated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const returnTo = safeReturnTo(searchParams.get('returnTo'))
  const passwordLongEnough = password.length >= MIN_PASSWORD_LENGTH
  const passwordHasMix = hasRecommendedPasswordMix(password)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
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
      await updatePassword(password)
      setUpdated(true)
    } catch (error) {
      setMessage(readableAuthError(error))
    } finally {
      setBusy(false)
    }
  }

  if (status === 'loading') {
    return <div className="auth-loading" role="status">正在确认重置会话…</div>
  }

  if (status !== 'authenticated' && status !== 'recovering') {
    return (
      <AuthPageLayout title="重置链接已失效" description="请重新获取密码重置邮件。">
        <div className="auth-result auth-result--failed">
          <Link className="auth-primary" to={`${AUTH_ROUTES.forgotPassword}?returnTo=${encodeURIComponent(returnTo)}`}>
            重新获取链接
          </Link>
        </div>
      </AuthPageLayout>
    )
  }

  if (updated) {
    return (
      <AuthPageLayout title="新密码已设置" description="之后请使用新密码登录 Jovlo。">
        <div className="auth-result auth-result--verified" role="status">
          <CircleCheck aria-hidden="true" size={30} />
          <a className="auth-primary" href={returnTo}>
            继续规划
            <ArrowRight aria-hidden="true" size={17} />
          </a>
        </div>
      </AuthPageLayout>
    )
  }

  return (
    <AuthPageLayout title="设置新密码" description="新密码至少 8 位，建议同时包含字母和数字。">
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <label htmlFor="new-password">新密码</label>
        <PasswordField
          id="new-password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          placeholder="至少 8 位"
        />
        <div className="auth-password-hints" aria-live="polite">
          <span className={passwordLongEnough ? 'is-valid' : ''}>至少 8 位</span>
          <span className={passwordHasMix ? 'is-valid' : ''}>建议同时包含字母和数字</span>
        </div>

        <label htmlFor="new-password-confirmation">确认新密码</label>
        <PasswordField
          id="new-password-confirmation"
          name="password-confirmation"
          value={confirmation}
          onChange={setConfirmation}
          autoComplete="new-password"
        />

        <button className="auth-primary" type="submit" disabled={busy}>
          {busy ? <LoaderCircle aria-hidden="true" className="auth-spinner" size={18} /> : <KeyRound aria-hidden="true" size={18} />}
          保存新密码
          {!busy ? <ArrowRight aria-hidden="true" size={17} /> : null}
        </button>
      </form>
      {message ? <p className="auth-message" role="alert">{message}</p> : null}
    </AuthPageLayout>
  )
}
