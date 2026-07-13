import {
  ArrowRight,
  CalendarDays,
  CarFront,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Compass,
  History,
  MapPin,
  Navigation,
  Route,
  Sparkles,
  UserRound,
} from 'lucide-react'
import { Link } from 'react-router-dom'

import { HoverTooltip, ProductCopyright } from '@/components'
import { useAuth } from '@/features/auth/AuthProvider'
import './home.css'

const routeStops = [
  { day: 'D1', time: '09:20', place: '海口骑楼', note: '城市慢游开场' },
  { day: 'D2', time: '10:25', place: '铜鼓岭', note: '沿海向东' },
  { day: 'D3', time: '13:40', place: '博鳌', note: '把车程留在白天' },
  { day: 'D5', time: '16:30', place: '三亚湾', note: '在海边收尾' },
]

export function HomePage() {
  const { status, user } = useAuth()
  const hasWorkspace = status === 'authenticated' || status === 'trial' || status === 'demo'
  const workspacePath = hasWorkspace ? '/trips' : '/login?returnTo=%2Ftrips'
  const accountPath = status === 'authenticated' || status === 'trial' ? '/account' : '/login?returnTo=%2Ftrips'
  const accountLabel = user?.email ? `账号：${user.email}` : status === 'trial' ? '本地试用与账号' : '登录 Jovlo'

  return (
    <main className="home-page">
      <section className="home-hero" aria-labelledby="home-title">
        <header className="home-header">
          <a className="home-brand" href="/" aria-label="Jovlo 首页">
            <img src="/jovlo-mark.svg" alt="" />
            <span>Jovlo</span>
          </a>
          <HoverTooltip label={accountLabel} align="end">
            <Link className="home-account" to={accountPath} aria-label={accountLabel}>
              <UserRound aria-hidden="true" size={18} />
            </Link>
          </HoverTooltip>
        </header>

        <div className="home-hero__content">
          <p className="home-hero__eyebrow"><Compass aria-hidden="true" size={16} />出发前做攻略，行程中照着走</p>
          <h1 id="home-title">Jovlo</h1>
          <p className="home-hero__lead">我把想去的地方整理成能执行的路书，路上按当天调整，也能随时分享给同行人。</p>
          <div className="home-hero__actions">
            <Link className="home-action home-action--primary" to={workspacePath}>
              <Route aria-hidden="true" size={18} />
              {hasWorkspace ? '打开我的路书' : '开始我的路书'}
              <ArrowRight aria-hidden="true" size={17} />
            </Link>
            <a className="home-action home-action--quiet" href="#journey">
              看看怎么用
              <ChevronDown aria-hidden="true" size={17} />
            </a>
          </div>
        </div>

        <div className="home-hero__route" aria-label="示例路线摘要">
          <span>示例 · 海南东线</span>
          <strong>海口</strong>
          <i aria-hidden="true" />
          <strong>文昌</strong>
          <i aria-hidden="true" />
          <strong>博鳌</strong>
          <i aria-hidden="true" />
          <strong>三亚</strong>
        </div>
      </section>

      <section className="home-section home-route" id="journey" aria-labelledby="home-route-title">
        <div className="home-section__inner">
          <header className="home-section__heading home-reveal">
            <span>01 / 攻略</span>
            <h2 id="home-route-title">先把想法，做成每天能执行的路书。</h2>
            <p>路线、住宿和预算放在一起，改好就分享给同行人。</p>
          </header>

          <ol className="home-route__list">
            {routeStops.map((stop) => (
              <li key={stop.day} className="home-reveal">
                <div className="home-route__day"><span>{stop.day}</span><small>{stop.time}</small></div>
                <div className="home-route__pin"><MapPin aria-hidden="true" size={17} /></div>
                <div className="home-route__copy"><strong>{stop.place}</strong><span>{stop.note}</span></div>
                <Navigation aria-hidden="true" className="home-route__nav" size={18} />
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="home-section home-impact" aria-labelledby="home-impact-title">
        <div className="home-section__inner home-impact__inner">
          <header className="home-section__heading home-reveal">
            <span>02 / 联动</span>
            <h2 id="home-impact-title">我改一个点，整条路跟着算。</h2>
            <p>时间、里程和预算一起变化；不合适，就回到上一版。</p>
          </header>

          <div className="home-impact__change home-reveal" aria-label="增加石梅湾后的行程影响示例">
            <div className="home-impact__title">
              <Sparkles aria-hidden="true" size={18} />
              <span>加入石梅湾</span>
              <small>D4 · 万宁</small>
            </div>
            <dl>
              <div><dt><Clock3 aria-hidden="true" />用时</dt><dd>+ 1h 20m</dd></div>
              <div><dt><CarFront aria-hidden="true" />里程</dt><dd>+ 38 km</dd></div>
              <div><dt><CircleDollarSign aria-hidden="true" />预算</dt><dd>+ ¥260</dd></div>
            </dl>
            <div className="home-impact__decision"><Check aria-hidden="true" size={16} /><span>保留这次调整</span><History aria-hidden="true" size={16} /><span>随时回退</span></div>
          </div>
        </div>
      </section>

      <section className="home-section home-today" aria-labelledby="home-today-title">
        <div className="home-section__inner home-today__inner">
          <header className="home-section__heading home-reveal">
            <span>03 / 出行态</span>
            <h2 id="home-today-title">出发以后，我只看今天。</h2>
            <p>下一站、导航、花销和临时调整，够清楚就好。</p>
          </header>

          <div className="home-today__day home-reveal">
            <div className="home-today__date"><CalendarDays aria-hidden="true" size={18} /><span>Day 2 · 文昌</span><strong>今天</strong></div>
            <div className="home-today__next"><small>下一站 · 10:25</small><strong>铜鼓岭</strong><span><CarFront aria-hidden="true" size={15} />18 km · 30 min</span></div>
            <div className="home-today__actions"><span><Navigation aria-hidden="true" size={16} />导航</span><span><CircleDollarSign aria-hidden="true" size={16} />记一笔</span></div>
          </div>
        </div>
      </section>

      <section className="home-closing" aria-labelledby="home-closing-title">
        <div>
          <span>一份路书，贯穿出发前和旅途中。</span>
          <h2 id="home-closing-title">先做好攻略，再从容出发。</h2>
        </div>
        <Link className="home-action home-action--primary" to={workspacePath}>
          {hasWorkspace ? '继续规划' : '开始规划'}
          <ArrowRight aria-hidden="true" size={17} />
        </Link>
      </section>

      <ProductCopyright className="home-copyright" />
    </main>
  )
}

export default HomePage
