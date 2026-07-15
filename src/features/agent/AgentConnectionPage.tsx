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
  PlugZap,
  RefreshCcw,
  Route,
  ShieldCheck,
  WalletCards,
  History,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

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
import './agent-connection.css'

type ClientKind = 'codex' | 'claude' | 'generic'
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

function connectionCommand(kind: ClientKind, url: string) {
  if (kind === 'codex') return `codex mcp add jovlo --url ${url}\ncodex mcp login jovlo`
  if (kind === 'claude') return `claude mcp add --transport http --scope user jovlo ${url}`
  return JSON.stringify({
    mcpServers: {
      jovlo: { type: 'streamable-http', url },
    },
  }, null, 2)
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

export function AgentConnectionPage() {
  const { tripId = '' } = useParams()
  const title = useTripStore((state) => state.trip.title)
  const [kind, setKind] = useState<ClientKind>('codex')
  const [connections, setConnections] = useState<McpConnection[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState<'load' | 'create' | 'revoke' | null>('load')
  const [copied, setCopied] = useState(false)
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
  const command = useMemo(() => selected ? connectionCommand(kind, mcpUrl) : '', [kind, mcpUrl, selected])

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

  const status = selected ? STATUS_COPY[selected.status] : null
  return (
    <PageShell width="reading" className="agent-page">
      <PageHeader
        trail={[{ label: title, to: `/trips/${tripId}/plan` }]}
        title="Agent 协作"
        description="在 Agent 里发攻略或直接说出修改要求，Jovlo 会自动重算路线、耗时与预算。"
        backTo={`/trips/${tripId}/plan`}
        meta={status ? <StatusBadge tone={status.tone}>{status.label}</StatusBadge> : null}
      />

      <section className="agent-flow" aria-label="Agent 连接流程">
        <ol>
          <li data-active="true"><span>1</span><div><strong>建立 MCP 连接</strong><small>复制一次性连接命令</small></div></li>
          <li data-active={selected?.status === 'active'}><span>2</span><div><strong>登录 Jovlo 授权</strong><small>只允许修改当前路书</small></div></li>
          <li data-active={selected?.status === 'active'}><span>3</span><div><strong>直接对话修改</strong><small>更改立即生效，随时可回退</small></div></li>
        </ol>
      </section>

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

      <section className="agent-manual-edit">
        <div><strong>只想微调某个时间或预算？</strong><span>在行程页手动修改更快，也会自动保存并重新计算。</span></div>
        <ButtonLink to={`/trips/${tripId}/plan`} icon={ArrowRight}>回到行程编辑</ButtonLink>
      </section>
    </PageShell>
  )
}

export default AgentConnectionPage
