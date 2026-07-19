import {
  ArrowRight,
  Bot,
  Check,
  FileText,
  History,
  Link2,
  MessageSquareText,
  PencilLine,
  Route,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'

import { useAuth } from '@/features/auth/AuthProvider'
import { ButtonLink, PageHeader, PageShell } from '@/features/trips/feature-ui'
import './agent-guide.css'

const agentTasks = [
  '整理文章、视频和笔记里的地点',
  '跨天调整路线、住宿与驾驶节奏',
  '按一句话修改预算、时间和偏好',
]

const manualTasks = [
  '微调到达时间、停留时长和顺序',
  '查看地图、预算与每日安排',
  '在路上快速改当天行程',
]

export function AgentGuidePage() {
  const { status } = useAuth()
  const canOpenWorkspace = status === 'authenticated' || status === 'trial' || status === 'demo'
  const agentStartPath = canOpenWorkspace
    ? '/trips/new?mode=agent'
    : '/login?returnTo=%2Ftrips%2Fnew%3Fmode%3Dagent'

  return (
    <PageShell width="reading" className="agent-guide-page">
      <PageHeader
        trail={[]}
        title="AI 共创指南"
        description="先建立路书骨架，再让 Agent 通过 MCP 继续整理和修改。"
        actions={<ButtonLink to={agentStartPath} variant="primary" icon={Sparkles}>AI 协作创建</ButtonLink>}
      />

      <section className="agent-guide-intro" aria-labelledby="agent-guide-intro-title">
        <div className="agent-guide-intro__icon"><Bot aria-hidden="true" /></div>
        <div>
          <span>真实工作流</span>
          <h2 id="agent-guide-intro-title">攻略发给 Agent，结果写回 Jovlo。</h2>
          <p>H5 负责查看和微调；Agent 负责整理资料、重排路线和批量修改。</p>
        </div>
      </section>

      <section className="agent-guide-flow" aria-labelledby="agent-guide-flow-title">
        <header>
          <span>01</span>
          <div><h2 id="agent-guide-flow-title">三步开始</h2><p>连接只授权当前路书，随时可以撤销。</p></div>
        </header>
        <ol>
          <li><strong>1</strong><FileText aria-hidden="true" /><div><b>建立基础路书</b><span>先定日期、起终点和天数</span></div></li>
          <li><strong>2</strong><Link2 aria-hidden="true" /><div><b>连接 Agent</b><span>复制 MCP 命令并登录授权</span></div></li>
          <li><strong>3</strong><MessageSquareText aria-hidden="true" /><div><b>直接说修改要求</b><span>路线、时间和预算自动联动</span></div></li>
        </ol>
      </section>

      <section className="agent-guide-split" aria-label="两种编辑方式">
        <article>
          <header><Sparkles aria-hidden="true" /><div><span>交给 Agent</span><h2>资料多、改动大</h2></div></header>
          <ul>{agentTasks.map((task) => <li key={task}><Check aria-hidden="true" />{task}</li>)}</ul>
        </article>
        <article>
          <header><PencilLine aria-hidden="true" /><div><span>直接在 H5</span><h2>变化小、马上改</h2></div></header>
          <ul>{manualTasks.map((task) => <li key={task}><Check aria-hidden="true" />{task}</li>)}</ul>
        </article>
      </section>

      <section className="agent-guide-example" aria-labelledby="agent-guide-example-title">
        <div>
          <span>可以这样说</span>
          <h2 id="agent-guide-example-title">“9 月 25 日从海口出发，10 月 1 日回到海口。先搭环岛骨架，每天驾驶不超过 4 小时。”</h2>
        </div>
        <Route aria-hidden="true" />
      </section>

      <section className="agent-guide-safety" aria-label="自动保存和版本保护">
        <ShieldCheck aria-hidden="true" />
        <div><strong>修改立即保存</strong><span>每次 Agent 修改都会生成版本；大改、小改都能回看和恢复。</span></div>
        <History aria-hidden="true" />
      </section>

      <footer className="agent-guide-actions">
        <ButtonLink to="/trips/new?mode=manual" icon={PencilLine}>自己创建</ButtonLink>
        <ButtonLink to={agentStartPath} variant="primary" icon={Sparkles}>开始 AI 协作<ArrowRight aria-hidden="true" size={17} /></ButtonLink>
      </footer>
    </PageShell>
  )
}

export default AgentGuidePage
