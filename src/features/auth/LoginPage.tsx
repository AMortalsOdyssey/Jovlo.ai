import { ArrowLeft, ArrowRight, LoaderCircle, Mail, MailCheck } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'

import { useAuth } from './AuthProvider'
import './auth.css'

type LoginStep = 'email' | 'sent'

function safeReturnTo(value: string | null) {
  return value?.startsWith('/trips') && !value.startsWith('//') ? value : '/trips'
}

function readableAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (/expired|invalid|token/i.test(message)) return '登录链接无效或已过期，请重新获取。'
  if (/rate|limit|seconds/i.test(message)) return '请求有些频繁，请稍后再试。'
  return '暂时无法完成登录，请稍后重试。'
}

export function LoginPage() {
  const { status, sendOtp } = useAuth()
  const [searchParams] = useSearchParams()
  const [step, setStep] = useState<LoginStep>('email')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const returnTo = safeReturnTo(searchParams.get('returnTo'))

  if (status === 'loading') {
    return (
      <div className="auth-loading" role="status" aria-live="polite">
        <LoaderCircle aria-hidden="true" className="auth-spinner" size={22} />
        <span>正在恢复行程…</span>
      </div>
    )
  }

  if (status === 'authenticated' || status === 'demo') {
    return <Navigate to={returnTo} replace />
  }

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) return

    setBusy(true)
    setMessage(null)
    try {
      const redirectTo = new URL(returnTo, window.location.origin).toString()
      await sendOtp(normalizedEmail, redirectTo)
      setEmail(normalizedEmail)
      setStep('sent')
    } catch (error) {
      setMessage(readableAuthError(error))
    } finally {
      setBusy(false)
    }
  }

  async function handleResend() {
    setBusy(true)
    setMessage(null)
    try {
      const redirectTo = new URL(returnTo, window.location.origin).toString()
      await sendOtp(email, redirectTo)
    } catch (error) {
      setMessage(readableAuthError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="auth-title">
        <a className="auth-brand" href="/" aria-label="Jovlo 首页">
          <img src="/jovlo-mark.svg" alt="" />
          <span>Jovlo</span>
        </a>

        <div className="auth-copy">
          <p className="auth-eyebrow">AI 路书共创</p>
          <h1 id="auth-title">{step === 'email' ? '继续规划你的旅程' : '去邮箱完成登录'}</h1>
          <p>{step === 'email' ? '无需密码，一个登录链接即可回来。' : `登录链接已发送至 ${email}`}</p>
        </div>

        {step === 'email' ? (
          <form className="auth-form" onSubmit={handleEmailSubmit}>
            <label htmlFor="auth-email">邮箱</label>
            <div className="auth-input-wrap">
              <Mail aria-hidden="true" size={18} />
              <input
                id="auth-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="name@example.com"
                required
                autoFocus
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <button className="auth-primary" type="submit" disabled={busy}>
              {busy ? <LoaderCircle aria-hidden="true" className="auth-spinner" size={18} /> : <Mail aria-hidden="true" size={18} />}
              获取登录链接
              {!busy ? <ArrowRight aria-hidden="true" size={17} /> : null}
            </button>
          </form>
        ) : (
          <div className="auth-form auth-sent">
            <MailCheck aria-hidden="true" size={28} />
            <p>点击邮件里的登录链接，将自动回到这次行程。</p>
            <button className="auth-primary" type="button" disabled={busy} onClick={() => void handleResend()}>
              {busy ? <LoaderCircle aria-hidden="true" className="auth-spinner" size={18} /> : <Mail aria-hidden="true" size={18} />}
              重新发送
            </button>
            <button
              className="auth-back"
              type="button"
              onClick={() => {
                setStep('email')
                setMessage(null)
              }}
            >
              <ArrowLeft aria-hidden="true" size={17} />
              更换邮箱
            </button>
          </div>
        )}

        {message ? <p className="auth-message" role="alert">{message}</p> : null}
        <p className="auth-privacy">登录即表示你同意仅将邮箱用于账户与行程访问。</p>
      </section>

      <aside className="auth-journey" aria-hidden="true">
        <div className="auth-journey__heading">
          <span>海南环岛 · 7 日</span>
          <strong>下一站，万宁</strong>
        </div>
        <div className="auth-route-line">
          <span className="auth-route-stop auth-route-stop--done">海口</span>
          <span className="auth-route-stop auth-route-stop--current">万宁</span>
          <span className="auth-route-stop">三亚</span>
        </div>
        <div className="auth-journey__stats">
          <span><b>168</b> km</span>
          <span><b>2h 20m</b> 驾驶</span>
          <span><b>4</b> 个停靠点</span>
        </div>
      </aside>
    </main>
  )
}
