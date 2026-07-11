import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'
import { CircleCheck, ShieldCheck } from 'lucide-react'
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'

const LOCAL_TEST_SITE_KEY = '1x00000000000000000000AA'
const configuredSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim()
const siteKey = configuredSiteKey || (import.meta.env.DEV ? LOCAL_TEST_SITE_KEY : '')

export type TurnstileGateHandle = {
  reset: () => void
}

type TurnstileGateProps = {
  action: 'login' | 'signup' | 'password_reset'
  onTokenChange: (token: string | null) => void
}

export const TurnstileGate = forwardRef<TurnstileGateHandle, TurnstileGateProps>(
  function TurnstileGate({ action, onTokenChange }, forwardedRef) {
    const instanceRef = useRef<TurnstileInstance | undefined>(undefined)
    const [state, setState] = useState<'waiting' | 'verified' | 'error'>(siteKey ? 'waiting' : 'error')

    function clear(nextState: 'waiting' | 'error') {
      setState(nextState)
      onTokenChange(null)
    }

    useImperativeHandle(forwardedRef, () => ({
      reset() {
        instanceRef.current?.reset()
        clear('waiting')
      },
    }))

    return (
      <div className="auth-turnstile" aria-label="Cloudflare 人机验证">
        <div className="auth-turnstile__heading">
          <ShieldCheck aria-hidden="true" size={16} />
          <span>人机验证</span>
          {state === 'verified' ? <CircleCheck aria-label="验证通过" size={16} /> : null}
        </div>
        {siteKey ? (
          <Turnstile
            ref={instanceRef}
            className="auth-turnstile__widget"
            siteKey={siteKey}
            onSuccess={(token) => {
              setState('verified')
              onTokenChange(token)
            }}
            onExpire={() => clear('waiting')}
            onTimeout={() => clear('waiting')}
            onError={() => clear('error')}
            onUnsupported={() => clear('error')}
            options={{
              action,
              appearance: 'always',
              language: 'zh-CN',
              refreshExpired: 'auto',
              refreshTimeout: 'auto',
              responseField: true,
              responseFieldName: `cf-turnstile-response-${action}`,
              retry: 'auto',
              retryInterval: 4_000,
              size: 'flexible',
              theme: 'light',
            }}
          />
        ) : null}
        {state === 'error' ? <p role="alert">安全验证暂时不可用，请刷新后重试。</p> : null}
      </div>
    )
  },
)
