import {
  Bot,
  Check,
  FileText,
  History,
  Link2,
  MessageSquareText,
  Mic2,
  PencilLine,
  Route,
  Search,
  ShieldCheck,
  Sparkles,
  Undo2,
  Wrench,
} from 'lucide-react'
import { useSearchParams } from 'react-router-dom'

import { useAuth } from '@/features/auth/AuthProvider'
import { ButtonLink, PageHeader, PageShell } from '@/features/trips/feature-ui'
import { NewTripAgentPanel } from '@/features/trips/NewTripAgentPanel'
import { useTripStore } from '@/store/useTripStore'
import { AgentConnectionPage } from './AgentConnectionPage'
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

const mcpTools = [
  { name: 'jovlo_get_trip', label: '读取整本路书', icon: FileText },
  { name: 'jovlo_get_day', label: '读取指定日期', icon: Route },
  { name: 'jovlo_search_places', label: '搜索与核对地点', icon: Search },
  { name: 'jovlo_apply_trip_changes', label: '应用结构化修改', icon: Wrench },
  { name: 'jovlo_list_versions', label: '查看历史版本', icon: History },
  { name: 'jovlo_undo_last_change', label: '撤销最近修改', icon: Undo2 },
]

const requestExamples = [
  {
    type: '从网上拿攻略',
    prompt: '“读取这个小红书、B 站或文章链接，提取可信地点和避坑信息，整理成 6 天自驾路书。”',
    icon: Link2,
  },
  {
    type: '直接口述行程',
    prompt: '“9 月 25 日从海口出发，10 月 1 日回到海口。先搭环岛骨架，每天驾驶不超过 4 小时。”',
    icon: Mic2,
  },
  {
    type: '修改指定路书',
    prompt: '“把 Day 3 上午的景点换成亲子项目，保留酒店，重新计算路线、耗时和预算。”',
    icon: Wrench,
  },
]

function isTripId(value: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
}

export function AgentGuidePage() {
  const [searchParams] = useSearchParams()
  const requestedTripId = searchParams.get('tripId')
  const tripId = isTripId(requestedTripId) ? requestedTripId : null
  const title = useTripStore((state) => state.trip.title)
  const { status } = useAuth()
  const canConnect = status === 'authenticated' || status === 'trial' || status === 'demo'
  const returnPath = tripId ? `/guide/agent?tripId=${tripId}` : '/guide/agent'
  const loginPath = `/login?returnTo=${encodeURIComponent(returnPath)}`

  return (
    <PageShell width="reading" className="agent-guide-page">
      <PageHeader
        trail={tripId ? [{ label: title, to: `/trips/${tripId}/plan` }] : []}
        backTo={tripId ? `/trips/${tripId}/plan` : undefined}
        title="AI 共创指南"
        description={tripId
          ? `当前连接将只修改「${title}」。`
          : '在这里连接 MCP，把网上攻略或口述要求直接变成可编辑路书。'}
      />

      <section className="agent-guide-intro" aria-labelledby="agent-guide-intro-title">
        <div className="agent-guide-intro__icon"><Bot aria-hidden="true" /></div>
        <div>
          <span>{tripId ? '修改已有路书' : '创建新路书'}</span>
          <h2 id="agent-guide-intro-title">{tripId ? '告诉 Agent 改哪里，关联数据一起更新。' : '攻略发给 Agent，结果直接写回 Jovlo。'}</h2>
          <p>{tripId ? '连接已在服务端绑定这本路书；其他路书不会被读取或修改。' : '无需先手填骨架，创建连接后直接发送链接、正文或一句话要求。'}</p>
        </div>
      </section>

      <section className="agent-guide-connector" aria-labelledby="agent-guide-connector-title">
        <header>
          <span>01</span>
          <div>
            <h2 id="agent-guide-connector-title">连接 MCP</h2>
            <p>{tripId ? `连接目标：${title}` : '连接目标：一份新的空白路书'}</p>
            {tripId ? <code className="agent-guide-trip-id">路书 ID · {tripId}</code> : null}
          </div>
        </header>
        {canConnect ? (
          tripId ? <AgentConnectionPage embedded tripId={tripId} /> : <NewTripAgentPanel compact />
        ) : (
          <div className="agent-guide-login">
            <ShieldCheck aria-hidden="true" />
            <div><strong>登录后建立安全连接</strong><span>教程可以直接查看；只有创建或修改路书时需要登录。</span></div>
            <ButtonLink to={loginPath} variant="primary" icon={Link2}>登录并连接 MCP</ButtonLink>
          </div>
        )}
      </section>

      <section className="agent-guide-context" aria-label="创建或修改路书">
        <article data-current={!tripId}>
          <span>创建</span>
          <strong>从这页建立新连接</strong>
          <p>Jovlo 先准备一份空白路书，Agent 再按你的攻略或口述要求补全。</p>
        </article>
        <article data-current={Boolean(tripId)}>
          <span>修改</span>
          <strong>从具体路书进入</strong>
          <p>{tripId ? `当前已指定「${title}」` : '路书内的 Agent 入口会自动带上该路书 ID'}，连接不会写错目标。</p>
        </article>
      </section>

      <section className="agent-guide-flow" aria-labelledby="agent-guide-flow-title">
        <header>
          <span>02</span>
          <div><h2 id="agent-guide-flow-title">三步完成</h2><p>连接决定写入目标；对话决定创建什么或修改哪里。</p></div>
        </header>
        <ol>
          <li><strong>1</strong><FileText aria-hidden="true" /><div><b>确定目标</b><span>{tripId ? '当前路书已绑定' : '创建一份新路书'}</span></div></li>
          <li><strong>2</strong><Link2 aria-hidden="true" /><div><b>复制连接命令</b><span>在 Agent 中运行并登录授权</span></div></li>
          <li><strong>3</strong><MessageSquareText aria-hidden="true" /><div><b>发送攻略或要求</b><span>修改立即保存，路线与预算联动</span></div></li>
        </ol>
      </section>

      <section className="agent-guide-tools" aria-labelledby="agent-guide-tools-title">
        <header><span>03</span><div><h2 id="agent-guide-tools-title">Agent 可以调用什么</h2><p>连接后通过标准 MCP 获取这些能力，不需要把接口细节粘贴进对话。</p></div></header>
        <ul aria-label="MCP 工具列表">
          {mcpTools.map(({ name, label, icon: Icon }) => (
            <li key={name}><Icon aria-hidden="true" /><div><strong>{label}</strong><code>{name}</code></div></li>
          ))}
        </ul>
      </section>

      <section className="agent-guide-requests" aria-labelledby="agent-guide-requests-title">
        <header><span>04</span><div><h2 id="agent-guide-requests-title">可以直接这样要求</h2><p>来源、自然语言和后续修改都在同一段 Agent 对话里完成。</p></div></header>
        <div>
          {requestExamples.map(({ type, prompt, icon: Icon }) => (
            <article key={type}><Icon aria-hidden="true" /><span>{type}</span><p>{prompt}</p></article>
          ))}
        </div>
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

      <section className="agent-guide-safety" aria-label="自动保存和版本保护">
        <ShieldCheck aria-hidden="true" />
        <div><strong>修改立即保存</strong><span>每次 Agent 修改都会生成版本；大改、小改都能回看和恢复。</span></div>
        <History aria-hidden="true" />
      </section>

      <footer className="agent-guide-actions">
        <ButtonLink to="/trips/new?mode=manual" icon={PencilLine}>自己创建</ButtonLink>
      </footer>
    </PageShell>
  )
}

export default AgentGuidePage
