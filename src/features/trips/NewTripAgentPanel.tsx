import { ArrowRight, Check, Copy, Link2, LoaderCircle, MessageSquareText, Route, ShieldCheck, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import {
  DEMO_TRIP,
  TripSnapshotSchema,
  cloneJson,
  type TripSnapshot,
} from '@domain'
import { buildConnectionCommand, type AgentClientKind } from '@/features/agent/agent-client-auth'
import { apiRequest } from '@/lib/api'

import { Button, SegmentedControl, StatusBadge } from './feature-ui'

type ConnectionStatus = 'pending' | 'active' | 'expired' | 'revoked'

type McpConnection = {
  id: string
  tripId: string
  status: ConnectionStatus
  expiresAt: string
  createdAt: string
}

type AgentDraft = {
  tripId: string
  title: string
}

type RevisionResult = {
  versionNo: number
}

const SESSION_KEY = 'jovlo:new-agent-draft'

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

function readStoredDraft(): AgentDraft | null {
  if (typeof window === 'undefined') return null
  try {
    const value = JSON.parse(window.sessionStorage.getItem(SESSION_KEY) ?? 'null') as Partial<AgentDraft> | null
    if (!value || typeof value.tripId !== 'string' || typeof value.title !== 'string') return null
    return { tripId: value.tripId, title: value.title }
  } catch {
    return null
  }
}

export function createEmptyAgentTripSnapshot(): TripSnapshot {
  const now = new Date().toISOString()
  const snapshot = cloneJson(DEMO_TRIP)
  const tripId = crypto.randomUUID()
  const entryPlaceId = crypto.randomUUID()
  const exitPlaceId = crypto.randomUUID()

  return TripSnapshotSchema.parse({
    schemaVersion: 1,
    tripId,
    title: 'AI 协作路书',
    timezone: 'Asia/Shanghai',
    intent: {
      days: 1,
      entryAnchor: { placeId: entryPlaceId, label: '出发地待定' },
      exitAnchor: { placeId: exitPlaceId, label: '目的地待定' },
      partySize: 2,
      vehicle: { type: 'fuel' },
      pace: 'balanced',
      maxDriveMinutesPerDay: 240,
      dayEndLimit: '22:00',
      mustPlaceIds: [],
      avoidTags: [],
    },
    placeRefs: {
      [entryPlaceId]: {
        placeId: entryPlaceId,
        name: '出发地待定',
        type: 'placeholder',
        wgs84: { lon: 0, lat: 0, crs: 'WGS84' },
        gcj02: { lon: 0, lat: 0, crs: 'GCJ02' },
        sourceIds: [],
      },
      [exitPlaceId]: {
        placeId: exitPlaceId,
        name: '目的地待定',
        type: 'placeholder',
        wgs84: { lon: 0, lat: 0, crs: 'WGS84' },
        gcj02: { lon: 0, lat: 0, crs: 'GCJ02' },
        sourceIds: [],
      },
    },
    sourceRefs: {},
    stayAreaRefs: {},
    days: [{ id: crypto.randomUUID(), dayIndex: 1, startTime: '09:00', stops: [] }],
    budgetAssumptions: {
      ...snapshot.budgetAssumptions,
      lodgingByArea: {},
      ticketByPlaceId: {},
      specialMealByStopId: {},
      verifiedAt: now,
    },
    userNotes: '由 Agent 协作创建，等待补充旅行要求。',
  })
}

export function NewTripAgentPanel({ compact = false }: { compact?: boolean }) {
  const [kind, setKind] = useState<AgentClientKind>('codex')
  const [draft, setDraft] = useState<AgentDraft | null>(() => readStoredDraft())
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
    if (!draft || !connection || connection.status === 'expired' || connection.status === 'revoked') return
    let timer = 0
    let cancelled = false

    const check = async () => {
      try {
        const [rows, revision] = await Promise.all([
          apiRequest<McpConnection[]>(`/api/v1/trips/${draft.tripId}/mcp-connections`),
          apiRequest<RevisionResult>(`/api/v1/trips/${draft.tripId}/revision`),
        ])
        const latest = rows.find((item) => item.id === connection.id)
        if (!cancelled) {
          if (latest) setConnection(latest)
          if (revision.versionNo > 0) setReadyVersionNo(revision.versionNo)
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
  }, [connection?.id, connection?.status, draft])

  const createConnection = async () => {
    setBusy('create')
    setError(null)
    try {
      let nextDraft = draft
      if (!nextDraft) {
        const snapshot = createEmptyAgentTripSnapshot()
        await apiRequest('/api/v1/trips', {
          method: 'POST',
          headers: { 'idempotency-key': crypto.randomUUID() },
          body: JSON.stringify({ title: snapshot.title, snapshot }),
        })
        nextDraft = { tripId: snapshot.tripId, title: snapshot.title }
        setDraft(nextDraft)
        window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(nextDraft))
      }

      const created = await apiRequest<McpConnection>(`/api/v1/trips/${nextDraft.tripId}/mcp-connections`, {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({}),
      })
      setConnection(created)
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
          <h3 id="new-trip-agent-connect-title">{connectionUsable ? '复制命令到你的 Agent' : '创建一条安全连接'}</h3>
          <p>{connectionUsable ? '运行命令后，浏览器会打开 Jovlo 登录授权。' : '先建立空白路书并绑定连接，再把攻略或口述要求发给 Agent。'}</p>
        </div>
        {connectionUsable ? <StatusBadge tone={connection.status === 'active' ? 'sea' : 'sun'}>{connection.status === 'active' ? '已连接' : '等待授权'}</StatusBadge> : null}
      </header>

      {!connectionUsable ? (
        <Button variant="primary" icon={busy === 'create' ? LoaderCircle : Link2} onClick={() => void createConnection()} disabled={Boolean(busy)}>
          {busy === 'create' ? '正在创建…' : draft ? '重新创建 MCP 连接' : '创建 MCP 连接'}
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
          <p className="new-trip-agent__connection-note"><ShieldCheck aria-hidden="true" />连接只允许读写这本新路书，可在路书内随时撤销。</p>
        </>
      )}

      {error ? <p className="new-trip-agent__error" role="alert">{error}</p> : null}
    </section>
  )

  const ready = draft && readyVersionNo > 0 ? (
    <section className="new-trip-agent__ready" aria-live="polite">
      <span className="new-trip-agent__ready-icon"><Check aria-hidden="true" /></span>
      <div>
        <small>Agent 已完成</small>
        <strong>新路书已生成 · v{readyVersionNo}</strong>
        <p>路线、时间和预算已经写入，可以继续查看或手动调整。</p>
      </div>
      <a href={`/trips/${draft.tripId}/plan`}>打开路书 <ArrowRight aria-hidden="true" /></a>
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
        <li><strong>1</strong><Link2 aria-hidden="true" /><div><b>建立连接</b><span>自动创建空白路书</span></div></li>
        <li><strong>2</strong><ShieldCheck aria-hidden="true" /><div><b>登录授权</b><span>只绑定当前账号与路书</span></div></li>
        <li><strong>3</strong><MessageSquareText aria-hidden="true" /><div><b>发送要求</b><span>路线、时间与预算联动</span></div></li>
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
