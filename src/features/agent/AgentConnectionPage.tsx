import {
  ArrowRight,
  Bot,
  Check,
  CircleOff,
  Clock3,
  Copy,
  Link2,
  LoaderCircle,
  LogIn,
  LogOut,
  Laptop,
  PlugZap,
  RefreshCcw,
  Repeat2,
  Route,
  ShieldCheck,
  UserRoundCog,
  WalletCards,
  History,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { useAuth } from '@/features/auth/AuthProvider'
import { apiRequest } from '@/lib/api'
import { useTripStore } from '@/store/useTripStore'
import {
  Button,
  ButtonLink,
  PageHeader,
  PageShell,
  SegmentedControl,
  StatusBadge,
} from '@/features/trips/feature-ui'
import {
  buildAgentClientAuthGuide,
  buildConnectionCommand,
  type AgentClientKind,
} from './agent-client-auth'
import './agent-connection.css'

type ConnectionStatus = 'pending' | 'active' | 'expired' | 'revoked'

type McpConnection = {
  id: string
  tripId: string
  status: ConnectionStatus
  clientName?: string | null
  clientId?: string | null
  scopes: string[]
  authorizedAt?: string | null
  lastSeenAt?: string | null
  expiresAt: string
  revokedAt?: string | null
  createdAt: string
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.append(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }
}

function formatDateTime(value?: string | null) {
  if (!value) return '尚未使用'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}

const STATUS_COPY: Record<ConnectionStatus, { label: string; note: string; tone: 'sun' | 'sea' | 'neutral' | 'coral' }> = {
  pending: { label: '等待授权', note: '10 分钟内在 Agent 执行连接命令', tone: 'sun' },
  active: { label: '已连接', note: '可直接在 Agent 对话中修改路书', tone: 'sea' },
  expired: { label: '已过期', note: '创建新连接后继续', tone: 'neutral' },
  revoked: { label: '已撤销', note: '这条连接已不能读写路书', tone: 'coral' },
}

type AgentConnectionPageProps = {
  embedded?: boolean
  tripId?: string
}

export function AgentConnectionPage({ embedded = false, tripId: providedTripId }: AgentConnectionPageProps = {}) {
  const { tripId: routeTripId = '' } = useParams()
  const tripId = providedTripId ?? routeTripId
  const navigate = useNavigate()
  const { signOut, user } = useAuth()
  const title = useTripStore((state) => state.trip.title)
  const [kind, setKind] = useState<AgentClientKind>('codex')
  const [connections, setConnections] = useState<McpConnection[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState<'load' | 'create' | 'revoke' | 'switch-account' | null>('load')
  const [copied, setCopied] = useState(false)
  const [sessionDialog, setSessionDialog] = useState<'logout' | 'switch' | null>(null)
  const [sessionCopied, setSessionCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadConnections = useCallback(async (quiet = false) => {
    if (!tripId) return
    if (!quiet) setBusy('load')
    try {
      const rows = await apiRequest<McpConnection[]>(`/api/v1/trips/${tripId}/mcp-connections`)
      setConnections(rows)
      setSelectedId((current) => {
        if (current && rows.some((row) => row.id === current)) return current
        return rows.find((row) => row.status === 'active' || row.status === 'pending')?.id ?? null
      })
      setError(null)
    } catch (cause) {
      if (!quiet) setError(cause instanceof Error ? cause.message : '无法读取 Agent 连接')
    } finally {
      if (!quiet) setBusy(null)
    }
  }, [tripId])

  useEffect(() => { void loadConnections() }, [loadConnections])
  useEffect(() => {
    let timer = 0
    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(async () => {
        await loadConnections(true)
        schedule()
      }, document.visibilityState === 'visible' ? 2_000 : 15_000)
    }
    const visibility = () => schedule()
    document.addEventListener('visibilitychange', visibility)
    schedule()
    return () => {
      document.removeEventListener('visibilitychange', visibility)
      window.clearTimeout(timer)
    }
  }, [loadConnections])

  const selected = connections.find((connection) => connection.id === selectedId) ?? null
  const origin = typeof window === 'undefined' ? 'https://jovlo.8xd.io' : window.location.origin
  const mcpUrl = selected ? `${origin}/mcp/${selected.id}` : ''
  const command = useMemo(() => selected ? buildConnectionCommand(kind, mcpUrl) : '', [kind, mcpUrl, selected])
  const authGuide = useMemo(() => buildAgentClientAuthGuide(kind, mcpUrl), [kind, mcpUrl])

  const createConnection = async () => {
    setBusy('create')
    setError(null)
    try {
      const connection = await apiRequest<McpConnection>(`/api/v1/trips/${tripId}/mcp-connections`, {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({}),
      })
      setConnections((current) => [connection, ...current])
      setSelectedId(connection.id)
      setCopied(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法创建连接')
    } finally {
      setBusy(null)
    }
  }

  const revokeConnection = async () => {
    if (!selected) return
    setBusy('revoke')
    setError(null)
    try {
      await apiRequest(`/api/v1/mcp-connections/${selected.id}`, {
        method: 'DELETE',
        headers: { 'idempotency-key': crypto.randomUUID() },
      })
      await loadConnections(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '撤销连接失败')
    } finally {
      setBusy(null)
    }
  }

  const copyCommand = async () => {
    if (!command) return
    await copyText(command)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2_000)
  }

  const copySessionInstruction = async () => {
    const value = sessionDialog === 'switch' ? authGuide.replace : authGuide.logout
    await copyText(value)
    setSessionCopied(true)
    window.setTimeout(() => setSessionCopied(false), 2_000)
  }

  const switchWebAccount = async () => {
    setBusy('switch-account')
    setError(null)
    try {
      if (selected && (selected.status === 'active' || selected.status === 'pending')) {
        await apiRequest(`/api/v1/mcp-connections/${selected.id}`, {
          method: 'DELETE',
          headers: { 'idempotency-key': crypto.randomUUID() },
        })
      }
      await signOut({ scope: 'local' })
      navigate('/login?returnTo=%2Ftrips', { replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '暂时无法切换账号')
      setBusy(null)
    }
  }

  const status = selected ? STATUS_COPY[selected.status] : null
  const content = (
    <>
      {!embedded ? <section className="agent-flow" aria-label="Agent 连接流程">
        <ol>
          <li data-active="true"><span>1</span><div><strong>建立 MCP 连接</strong><small>复制一次性连接命令</small></div></li>
          <li data-active={selected?.status === 'active'}><span>2</span><div><strong>登录 Jovlo 授权</strong><small>只允许修改当前路书</small></div></li>
          <li data-active={selected?.status === 'active'}><span>3</span><div><strong>直接对话修改</strong><small>更改立即生效，随时可回退</small></div></li>
        </ol>
      </section> : null}

      <section className="agent-connect-section">
        <header>
          <div><small>开始连接</small><h2>{selected && selected.status !== 'expired' && selected.status !== 'revoked' ? '把 Jovlo 加到你的 Agent' : '创建一次安全连接'}</h2></div>
          {selected && status ? <span className={`agent-connection-state agent-connection-state--${selected.status}`}><i />{status.label}</span> : null}
        </header>

        {busy === 'load' ? (
          <div className="agent-connect-loading" role="status"><LoaderCircle className="feature-spin" />正在读取连接…</div>
        ) : !selected || selected.status === 'expired' || selected.status === 'revoked' ? (
          <div className="agent-connect-empty">
            <PlugZap aria-hidden="true" />
            <p>连接会绑定「{title}」，待授权连接 10 分钟失效。</p>
            <Button variant="primary" icon={Link2} onClick={() => void createConnection()} disabled={Boolean(busy)}>{busy === 'create' ? '正在创建…' : '创建 MCP 连接'}</Button>
          </div>
        ) : (
          <>
            <SegmentedControl
              label="Agent 客户端"
              value={kind}
              onChange={setKind}
              options={[{ value: 'codex', label: 'Codex' }, { value: 'claude', label: 'Claude' }, { value: 'generic', label: '通用 MCP' }]}
            />
            <div className="agent-command">
              <pre><code>{command}</code></pre>
              <Button variant="primary" icon={copied ? Check : Copy} onClick={() => void copyCommand()}>{copied ? '已复制' : '复制连接命令'}</Button>
            </div>
            <p className="agent-command-note"><ShieldCheck aria-hidden="true" />Agent 会自动打开 Jovlo 登录授权。页面不会显示密钥或底层协议内容。</p>
            <ul className="agent-capability-list" aria-label="连接后可用能力">
              <li><Route aria-hidden="true" /><span><strong>规划与编辑</strong><small>日期、地点、顺序、住宿与停留</small></span></li>
              <li><WalletCards aria-hidden="true" /><span><strong>关联重算</strong><small>路线、耗时、预算、天气与地图</small></span></li>
              <li><History aria-hidden="true" /><span><strong>版本留痕</strong><small>大改先确认，任何版本都能回看与恢复</small></span></li>
            </ul>
          </>
        )}
        {error ? <p className="agent-error" role="alert">{error}</p> : null}
      </section>

      {selected && status ? (
        <section className="agent-connection-detail">
          <header><div><small>当前连接</small><h2>{status.note}</h2></div><Button variant="quiet" icon={RefreshCcw} onClick={() => void loadConnections()}>刷新</Button></header>
          <dl>
            <div><dt><Bot />客户端</dt><dd>{selected.clientName ?? '等待 Agent 登录'}</dd></div>
            <div><dt><LogIn />授权时间</dt><dd>{formatDateTime(selected.authorizedAt)}</dd></div>
            <div><dt><Clock3 />最后使用</dt><dd>{formatDateTime(selected.lastSeenAt)}</dd></div>
            <div><dt><ShieldCheck />过期时间</dt><dd>{formatDateTime(selected.expiresAt)}</dd></div>
          </dl>
          <footer>
            <p><CircleOff />撤销后 Agent 会立即失去这本路书的读写权限。</p>
            <Button variant="danger" icon={CircleOff} onClick={() => void revokeConnection()} disabled={Boolean(busy)}>{busy === 'revoke' ? '正在撤销…' : '撤销连接'}</Button>
          </footer>
        </section>
      ) : null}

      <section className="agent-local-session" aria-labelledby="agent-local-session-title">
        <div className="agent-local-session__icon"><Laptop aria-hidden="true" /></div>
        <div className="agent-local-session__copy">
          <small>本机 Agent 账号</small>
          <h2 id="agent-local-session-title">退出或切换账号</h2>
          <p>MCP 连接只属于当前 Jovlo 账号和这本路书；本机 Agent 的 OAuth 登录由客户端单独保存。</p>
          <span><UserRoundCog aria-hidden="true" />当前网页登录：<strong>{user?.email ?? '正在确认'}</strong></span>
        </div>
        <div className="agent-local-session__actions">
          <Button variant="quiet" icon={LogOut} onClick={() => { setSessionCopied(false); setSessionDialog('logout') }}>退出本机 Agent</Button>
          <Button icon={Repeat2} onClick={() => { setSessionCopied(false); setSessionDialog('switch') }}>切换账号或路书</Button>
        </div>
      </section>

      <section className="agent-manual-edit">
        <div><strong>只想微调某个时间或预算？</strong><span>在行程页手动修改更快，也会自动保存并重新计算。</span></div>
        <ButtonLink to={`/trips/${tripId}/plan`} icon={ArrowRight}>回到行程编辑</ButtonLink>
      </section>

      {sessionDialog ? (
        <div className="agent-session-backdrop" role="presentation" onMouseDown={() => setSessionDialog(null)}>
          <section className="agent-session-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-session-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><small>{sessionDialog === 'switch' ? '账号与路书重新绑定' : '只清除本机凭据'}</small><h2 id="agent-session-dialog-title">{sessionDialog === 'switch' ? '切换 Agent 账号或路书' : '退出本机 Agent 登录'}</h2></div>
              <button type="button" aria-label="关闭" onClick={() => setSessionDialog(null)}><X aria-hidden="true" /></button>
            </header>
            {sessionDialog === 'switch' ? (
              <ol className="agent-session-steps">
                <li><span>1</span><div><strong>清除旧连接</strong><small>移除本机旧 OAuth 和旧 MCP 地址，防止继续连到原账号。</small></div></li>
                <li><span>2</span><div><strong>确认目标账号</strong><small>当前网页为 {user?.email ?? '正在确认'}；若不是目标账号，请先安全切换。</small></div></li>
                <li><span>3</span><div><strong>重新授权</strong><small>在目标账号的目标路书创建新连接，再由 Agent 完成浏览器授权。</small></div></li>
              </ol>
            ) : (
              <div className="agent-session-dialog__notice"><LogOut aria-hidden="true" /><p>退出只清除这台设备上的 Agent 登录，不会退出 Jovlo 网页，也不会自动撤销服务端连接。</p></div>
            )}
            <SegmentedControl
              label="Agent 客户端"
              value={kind}
              onChange={setKind}
              options={[{ value: 'codex', label: 'Codex' }, { value: 'claude', label: 'Claude' }, { value: 'generic', label: '通用 MCP' }]}
            />
            <div className="agent-session-command">
              <pre><code>{sessionDialog === 'switch' ? authGuide.replace : authGuide.logout}</code></pre>
              <p>{sessionDialog === 'switch' ? authGuide.replaceNote : authGuide.logoutNote}</p>
            </div>
            {!mcpUrl && sessionDialog === 'switch' ? <p className="agent-error" role="alert">请先在目标路书创建 MCP 连接，再复制替换指令。</p> : null}
            <footer>
              {sessionDialog === 'switch' ? <Button variant="danger" icon={Repeat2} onClick={() => void switchWebAccount()} disabled={Boolean(busy)}>{busy === 'switch-account' ? '正在切换…' : '撤销连接并切换网页登录'}</Button> : <span>需要立即阻止读写时，请同时撤销服务端连接。</span>}
              <Button variant="primary" icon={sessionCopied ? Check : Copy} onClick={() => void copySessionInstruction()} disabled={sessionDialog === 'switch' && !mcpUrl}>{sessionCopied ? '已复制' : sessionDialog === 'switch' ? '复制替换指令' : '复制退出指令'}</Button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  )

  if (embedded) return <div className="agent-page agent-page--embedded">{content}</div>

  return (
    <PageShell width="reading" className="agent-page">
      <PageHeader
        trail={[{ label: title, to: `/trips/${tripId}/plan` }]}
        title="Agent 协作"
        description="在 Agent 里发攻略或直接说出修改要求，Jovlo 会自动重算路线、耗时与预算。"
        backTo={`/trips/${tripId}/plan`}
        meta={status ? <StatusBadge tone={status.tone}>{status.label}</StatusBadge> : null}
      />
      {content}
    </PageShell>
  )
}

export default AgentConnectionPage
