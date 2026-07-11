import { ArrowLeft, ArrowRight, LoaderCircle, Mail, MailCheck } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { AuthPageLayout } from './AuthPageLayout'
import { EmailField } from './AuthFields'
import { useAuth } from './AuthProvider'
import { AUTH_ROUTES, isValidEmail, normalizeEmail, readableAuthError, safeReturnTo } from './auth-utils'

export function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth()
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const returnTo = safeReturnTo(searchParams.get('returnTo'))
  const loginHref = `${AUTH_ROUTES.login}?returnTo=${encodeURIComponent(returnTo)}`

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedEmail = normalizeEmail(email)
    if (!isValidEmail(normalizedEmail)) {
      setMessage('请输入有效的邮箱地址。')
      return
    }

    setBusy(true)
    setMessage(null)
    try {
      const callbackUrl = new URL(AUTH_ROUTES.callback, window.location.origin)
      callbackUrl.searchParams.set('returnTo', returnTo)
      await requestPasswordReset(normalizedEmail, callbackUrl.toString())
      setEmail(normalizedEmail)
      setSentTo(normalizedEmail)
    } catch (error) {
      setMessage(readableAuthError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthPageLayout
      title={sentTo ? '查收重置邮件' : '找回你的密码'}
      description={sentTo ? `重置链接已发送至 ${sentTo}` : '输入注册邮箱，我们会发送一封密码重置邮件。'}
      footer={<p className="auth-privacy"><Link to={loginHref}>返回登录</Link></p>}
    >
      {sentTo ? (
        <div className="auth-result" role="status" aria-live="polite">
          <MailCheck aria-hidden="true" size={30} />
          <p>点击邮件中的链接设置新密码。链接失效后，可以回到这里重新发送。</p>
          <button className="auth-back" type="button" onClick={() => setSentTo(null)}>
            <ArrowLeft aria-hidden="true" size={17} />
            更换邮箱
          </button>
        </div>
      ) : (
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <label htmlFor="reset-email">邮箱</label>
          <EmailField id="reset-email" value={email} onChange={setEmail} autoFocus />
          <button className="auth-primary" type="submit" disabled={busy}>
            {busy ? <LoaderCircle aria-hidden="true" className="auth-spinner" size={18} /> : <Mail aria-hidden="true" size={18} />}
            发送重置邮件
            {!busy ? <ArrowRight aria-hidden="true" size={17} /> : null}
          </button>
        </form>
      )}
      {message ? <p className="auth-message" role="alert">{message}</p> : null}
    </AuthPageLayout>
  )
}

