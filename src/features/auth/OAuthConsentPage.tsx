import { ArrowRight, Bot, Check, LoaderCircle, Repeat2, ShieldCheck, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { getSupabaseClient } from '@/lib/supabase'
import { AuthPageLayout } from './AuthPageLayout'
import { useAuth } from './AuthProvider'

type AuthorizationDetails = {
  authorization_id: string
  redirect_uri: string
  scope: string
  client: { id: string; name: string; uri?: string; logo_uri?: string }
  user: { id: string; email: string }
}

export function OAuthConsentPage() {
  const { signOut, status } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const authorizationId = searchParams.get('authorization_id')
  const [details, setDetails] = useState<AuthorizationDetails | null>(null)
  const [busy, setBusy] = useState<'approve' | 'deny' | 'switch' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (status !== 'authenticated' || !authorizationId) return
    const supabase = getSupabaseClient()
    if (!supabase) {
      setError('OAuth 服务尚未配置。')
      return
    }
    let active = true
    void supabase.auth.oauth.getAuthorizationDetails(authorizationId).then(({ data, error: requestError }) => {
      if (!active) return
      if (requestError || !data) {
        setError('这次授权请求已失效，请回到 Agent 重试。')
        return
      }
      if ('redirect_url' in data) {
        window.location.assign(data.redirect_url)
        return
      }
      setDetails(data as AuthorizationDetails)
    }).catch(() => {
      if (active) setError('暂时无法读取授权请求。')
    })
    return () => { active = false }
  }, [authorizationId, status])

  if (status === 'loading') {
    return <div className="auth-loading" role="status"><LoaderCircle className="auth-spinner" /><span>正在读取授权请求…</span></div>
  }
  if (status !== 'authenticated') {
    const returnTo = `${location.pathname}${location.search}`
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />
  }

  const decide = async (action: 'approve' | 'deny') => {
    if (!authorizationId) return
    const supabase = getSupabaseClient()
    if (!supabase) return
    setBusy(action)
    setError(null)
    try {
      const response = action === 'approve'
        ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
        : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true })
      if (response.error || !response.data?.redirect_url) throw response.error ?? new Error('missing redirect')
      window.location.assign(response.data.redirect_url)
    } catch {
      setError('授权未完成，请稍后重试。')
      setBusy(null)
    }
  }

  const switchAccount = async () => {
    setBusy('switch')
    setError(null)
    try {
      await signOut({ scope: 'local' })
      const returnTo = `${location.pathname}${location.search}`
      navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`, { replace: true })
    } catch {
      setError('暂时无法切换账号，请稍后重试。')
      setBusy(null)
    }
  }

  return (
    <AuthPageLayout
      eyebrow="Agent 协作授权"
      title="允许 Agent 修改这本路书？"
      description="授权只对你创建的临时连接生效，可随时在 Jovlo 撤销。"
      footer={<p className="auth-privacy">连接只属于创建它的同一账号和当前路书，不能跨账号复用。</p>}
    >
      <section className="oauth-consent" aria-live="polite">
        {details ? (
          <>
            <div className="oauth-consent__client">
              <span><Bot aria-hidden="true" /></span>
              <div><small>请求方</small><strong>{details.client.name || 'MCP Agent'}</strong></div>
            </div>
            <ul>
              <li><Check aria-hidden="true" />读取路书、单日安排和版本历史</li>
              <li><Check aria-hidden="true" />修改行程、时间、住宿、预算和来源</li>
              <li><ShieldCheck aria-hidden="true" />每次修改立即生成可回退版本</li>
            </ul>
            <div className="oauth-consent__account">
              <div><small>本次授权账号</small><strong>{details.user.email}</strong></div>
              <button type="button" disabled={Boolean(busy)} onClick={() => void switchAccount()}>
                {busy === 'switch' ? <LoaderCircle className="auth-spinner" /> : <Repeat2 />} 换一个账号
              </button>
            </div>
            <div className="oauth-consent__actions">
              <button className="auth-back" type="button" disabled={Boolean(busy)} onClick={() => void decide('deny')}>
                {busy === 'deny' ? <LoaderCircle className="auth-spinner" /> : <X />} 拒绝
              </button>
              <button className="auth-primary" type="button" disabled={Boolean(busy)} onClick={() => void decide('approve')}>
                {busy === 'approve' ? <LoaderCircle className="auth-spinner" /> : <ShieldCheck />} 允许连接 <ArrowRight />
              </button>
            </div>
          </>
        ) : error ? null : <div className="oauth-consent__loading"><LoaderCircle className="auth-spinner" /><span>正在核对 Agent 连接…</span></div>}
        {error ? <p className="auth-message" role="alert">{error}</p> : null}
      </section>
    </AuthPageLayout>
  )
}

export default OAuthConsentPage
