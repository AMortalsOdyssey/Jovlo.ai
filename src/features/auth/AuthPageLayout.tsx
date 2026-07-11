import type { PropsWithChildren, ReactNode } from 'react'

import './auth.css'

type AuthPageLayoutProps = PropsWithChildren<{
  eyebrow?: string
  title: string
  description: ReactNode
  footer?: ReactNode
}>

export function AuthPageLayout({
  children,
  description,
  eyebrow = 'AI 路书共创',
  footer,
  title,
}: AuthPageLayoutProps) {
  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="auth-title">
        <a className="auth-brand" href="/" aria-label="Jovlo 首页">
          <img src="/jovlo-mark.svg" alt="" />
          <span>Jovlo</span>
        </a>

        <div className="auth-copy">
          <p className="auth-eyebrow">{eyebrow}</p>
          <h1 id="auth-title">{title}</h1>
          <p>{description}</p>
        </div>

        {children}
        {footer ?? <p className="auth-privacy">账户信息仅用于登录与同步你的行程。</p>}
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
