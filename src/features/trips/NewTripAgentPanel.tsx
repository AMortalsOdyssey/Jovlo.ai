import { ArrowRight, Check, Copy, Link2, LoaderCircle, MessageSquareText, Route, ShieldCheck, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { buildConnectionCommand, type AgentClientKind } from '@/features/agent/agent-client-auth'
import { apiRequest } from '@/lib/api'

import { Button, SegmentedControl, StatusBadge } from './feature-ui'

type ConnectionStatus = 'pending' | 'active' | 'expired' | 'revoked'

type McpConnection = {
  id: string
  tripId: string | null
  status: ConnectionStatus
  expiresAt: string
  createdAt: string
}

type RevisionResult = {
  versionNo: number
}

const SESSION_KEY = 'jovlo:new-agent-connection'

async function copyText(value: string) {
  try {
    if (!navigator.clipboard) throw new Error('Clipboard API unavailable')
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

function readStoredConnectionId(): string | null {
  if (typeof window === 'undefined') return null
  const value = window.sessionStorage.getItem(SESSION_KEY)
  return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null
}

export function NewTripAgentPanel({ compact = false }: { compact?: boolean }) {
  const [kind, setKind] = useState<AgentClientKind>('codex')
  const [storedConnectionId, setStoredConnectionId] = useState<string | null>(() => readStoredConnectionId())
  const [connection, setConnection] = useState<McpConnection | null>(null)
  const [busy, setBusy] = useState<'create' | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [readyVersionNo, setReadyVersionNo] = useState(0)

  const origin = typeof window === 'undefined' ? 'https://jovlo.8xd.io' : window.location.origin
  const mcpUrl = connection ? `${origin}/mcp/${connection.id}` : ''
  const command = useMemo(
    () => connection ? buildConnectionCommand(kind, mcpUrl) : '',
    [connection, kind, mcpUrl],
  )

  useEffect(() => {
    if (!storedConnectionId || connection?.id === storedConnectionId) return
    let cancelled = false
    apiRequest<McpConnection>(`/api/v1/mcp-connections/${storedConnectionId}`)
      .then((value) => {
        if (!cancelled) setConnection(value)
      })
      .catch(() => {
        if (cancelled) return
        window.sessionStorage.removeItem(SESSION_KEY)
        setStoredConnectionId(null)
      })
    return () => { cancelled = true }
  }, [connection?.id, storedConnectionId])

  useEffect(() => {
    if (!connection || connection.status === 'expired' || connection.status === 'revoked') return
    let timer = 0
    let cancelled = false

    const check = async () => {
      try {
        const latest = await apiRequest<McpConnection>(`/api/v1/mcp-connections/${connection.id}`)
        if (!cancelled) {
          setConnection(latest)
          if (latest.tripId) {
            const revision = await apiRequest<RevisionResult>(`/api/v1/trips/${latest.tripId}/revision`)
            if (!cancelled && revision.versionNo > 0) setReadyVersionNo(revision.versionNo)
          }
        }
      } catch {
        // Connection polling is opportunistic; creating and copying remain usable.
      } finally {
        if (!cancelled) timer = window.setTimeout(check, document.visibilityState === 'visible' ? 2_000 : 15_000)
      }
    }

    timer = window.setTimeout(check, 2_000)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [connection?.id, connection?.status])

  const createConnection = async () => {
    setBusy('create')
    setError(null)
    try {
      const created = await apiRequest<McpConnection>('/api/v1/mcp-connections', {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({}),
      })
      setConnection(created)
      setStoredConnectionId(created.id)
      window.sessionStorage.setItem(SESSION_KEY, created.id)
      setCopied(false)
      setReadyVersionNo(0)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '暂时无法创建 MCP 连接')
    } finally {
      setBusy(null)
    }
  }

  const handleCopy = async () => {
    if (!command) return
    await copyText(command)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2_000)
  }

  const connectionUsable = connection && connection.status !== 'expired' && connection.status !== 'revoked'

  const connector = (
    <section className="new-trip-agent__connect" aria-labelledby="new-trip-agent-connect-title">
      <header>
        <div>
          <small>MCP 连接 · 创建新路书</small>
          <h3 id="new-trip-agent-connect-title">{connectionUsable ? '复制命令到你的 Agent' : '创建 MCP 连接'}</h3>
          <p>{connectionUsable ? '运行命令后，浏览器会打开 Jovlo 登录授权。' : '只建立安全通道；Agent 真正执行创建时才会生成路书。'}</p>
        </div>
        {connectionUsable ? <StatusBadge tone={connection.status === 'active' ? 'sea' : 'sun'}>{connection.status === 'active' ? '已连接' : '等待授权'}</StatusBadge> : null}
      </header>

      {!connectionUsable ? (
        <Button variant="primary" icon={busy === 'create' ? LoaderCircle : Link2} onClick={() => void createConnection()} disabled={Boolean(busy)}>
          {busy === 'create' ? '正在创建…' : '创建 MCP 连接'}
        </Button>
      ) : (
        <>
          <SegmentedControl
            label="Agent 客户端"
            value={kind}
            onChange={setKind}
            options={[{ value: 'codex', label: 'Codex' }, { value: 'claude', label: 'Claude' }, { value: 'generic', label: '通用 MCP' }]}
          />
          <div className="new-trip-agent__command">
            <pre><code>{command}</code></pre>
            <Button variant="primary" icon={copied ? Check : Copy} onClick={() => void handleCopy()}>{copied ? '已复制' : '复制连接命令'}</Button>
          </div>
          <p className="new-trip-agent__connection-note"><ShieldCheck aria-hidden="true" />连接先绑定当前账号；Agent 创建成功后再固定绑定那本路书。</p>
        </>
      )}

      {error ? <p className="new-trip-agent__error" role="alert">{error}</p> : null}
    </section>
  )

  const ready = connection?.tripId && readyVersionNo > 0 ? (
    <section className="new-trip-agent__ready" aria-live="polite">
      <span className="new-trip-agent__ready-icon"><Check aria-hidden="true" /></span>
      <div>
        <small>Agent 已完成</small>
        <strong>新路书已生成 · v{readyVersionNo}</strong>
        <p>路线、时间和预算已经写入，可以继续查看或手动调整。</p>
      </div>
      <a href={`/trips/${connection.tripId}/plan`}>打开路书 <ArrowRight aria-hidden="true" /></a>
    </section>
  ) : null

  if (compact) {
    return <div className="new-trip-agent new-trip-agent--compact">{connector}{ready}</div>
  }

  return (
    <section className="new-trip-agent" aria-labelledby="new-trip-agent-title">
      <header>
        <div className="new-trip-agent__icon"><Sparkles aria-hidden="true" /></div>
        <div>
          <span>默认创建方式</span>
          <h2 id="new-trip-agent-title">把要求交给 Agent，直接生成路书。</h2>
          <p>在这里建立 MCP 连接，然后回到 Agent 发送攻略、链接或一句话行程要求。</p>
        </div>
      </header>

      {connector}

      <ol className="new-trip-agent__flow">
        <li><strong>1</strong><Link2 aria-hidden="true" /><div><b>建立连接</b><span>此时不会创建路书</span></div></li>
        <li><strong>2</strong><ShieldCheck aria-hidden="true" /><div><b>登录授权</b><span>只绑定当前 Jovlo 账号</span></div></li>
        <li><strong>3</strong><MessageSquareText aria-hidden="true" /><div><b>对话创建</b><span>Agent 执行后才生成路书</span></div></li>
      </ol>

      {ready}

      <div className="new-trip-agent__example">
        <small>连接后，直接在 Agent 里说</small>
        <p>“9 月 25 日从海口出发，10 月 1 日回到海口。先搭环岛骨架，中间我再细化。”</p>
        <span><Route aria-hidden="true" />Agent 修改会自动保存，并生成可回看的版本。</span>
      </div>
    </section>
  )
}
