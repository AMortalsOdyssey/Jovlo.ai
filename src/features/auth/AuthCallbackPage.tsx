import { CircleCheck, LoaderCircle, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { AuthPageLayout } from './AuthPageLayout'
import { useAuth } from './AuthProvider'
import { AUTH_ROUTES, parseEmailTokenType, readableAuthError, safeReturnTo } from './auth-utils'

type CallbackState = 'verifying' | 'verified' | 'failed'

export function AuthCallbackPage() {
  const { verifyOtp } = useAuth()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const started = useRef(false)
  const [state, setState] = useState<CallbackState>('verifying')
  const [message, setMessage] = useState('正在确认邮件链接…')
  const tokenHash = searchParams.get('token_hash')
  const type = parseEmailTokenType(searchParams.get('type'))
  const returnTo = safeReturnTo(searchParams.get('returnTo'))
  const loginHref = `${AUTH_ROUTES.login}?returnTo=${encodeURIComponent(returnTo)}`

  useEffect(() => {
    if (started.current) return
    started.current = true

    if (!tokenHash || !type) {
      setState('failed')
      setMessage('邮件链接缺少必要信息，请重新获取。')
      return
    }

    let active = true
    void verifyOtp(tokenHash, type)
      .then(() => {
        if (!active) return
        if (type === 'recovery') {
          navigate(`${AUTH_ROUTES.resetPassword}?returnTo=${encodeURIComponent(returnTo)}`, { replace: true })
          return
        }
        setState('verified')
        setMessage('邮箱验证成功，现在可以登录。')
      })
      .catch((error) => {
        if (!active) return
        setState('failed')
        setMessage(readableAuthError(error))
      })

    return () => {
      active = false
    }
    // verifyOtp is intentionally captured once for this one-time callback URL.
  }, [navigate, returnTo, tokenHash, type])

  return (
    <AuthPageLayout
      title={state === 'verifying' ? '正在确认邮箱' : state === 'verified' ? '邮箱已验证' : '无法确认链接'}
      description={message}
    >
      <div className={`auth-result auth-result--${state}`} role="status" aria-live="polite">
        {state === 'verifying' ? <LoaderCircle aria-hidden="true" className="auth-spinner" size={30} /> : null}
        {state === 'verified' ? <CircleCheck aria-hidden="true" size={30} /> : null}
        {state === 'failed' ? <RotateCcw aria-hidden="true" size={30} /> : null}
        {state !== 'verifying' ? (
          <Link className="auth-primary" to={loginHref}>
            {state === 'verified' ? '前往登录' : '重新登录'}
          </Link>
        ) : null}
      </div>
    </AuthPageLayout>
  )
}

