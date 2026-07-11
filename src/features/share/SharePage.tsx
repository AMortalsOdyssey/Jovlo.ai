import { CalendarDays, Copy, ExternalLink, Link2, LoaderCircle, LockKeyhole, Map as MapIcon, RefreshCw, Share2, Unlink } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Snackbar } from '@/features/planner'
import { Button, PageHeader, PageShell, SectionHeading, StatusBadge } from '@/features/trips/feature-ui'
import { apiRequest } from '@/lib/api'
import { currentVersion, useTripStore } from '@/store/useTripStore'
import type { DisclosureConfig, LocalPublication } from '@/store/store-types'
import './share.css'

const DEFAULT_DISCLOSURE: DisclosureConfig = {
  showExactDates: false,
  showSources: true,
  showBudget: true,
  viewScope: 'overview',
}

type PublicationResult = {
  publicationId: string
  token: string
  targetKind: 'version' | 'report'
  createdAt?: string
}

function publicationPath(publication: LocalPublication) {
  return publication.targetKind === 'version' ? `/s/${publication.token}` : `/r/${publication.token}`
}

function sameDisclosure(left: DisclosureConfig, right: DisclosureConfig) {
  return left.showExactDates === right.showExactDates
    && left.showSources === right.showSources
    && left.showBudget === right.showBudget
    && (left.viewScope ?? 'overview') === right.viewScope
    && left.dayId === right.dayId
}

async function writeClipboard(value: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value)
  const input = document.createElement('textarea')
  input.value = value
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.append(input)
  input.select()
  document.execCommand('copy')
  input.remove()
}

export function SharePage() {
  const state = useTripStore()
  const head = currentVersion(state)
  const [config, setConfig] = useState(DEFAULT_DISCLOSURE)
  const [selectedDayId, setSelectedDayId] = useState(state.trip.days[0]?.id ?? '')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const production = state.productionSync.mode === 'production'
  const readyReports = useMemo(
    () => [...state.reports.filter((report) => report.status === 'ready')].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [state.reports],
  )
  const [reportId, setReportId] = useState(readyReports[0]?.id ?? '')
  const versionById = new Map(state.versions.map((version) => [version.id, version]))
  const reportById = new Map(state.reports.map((report) => [report.id, report]))

  const copy = async (publication: LocalPublication) => {
    const url = new URL(publicationPath(publication), window.location.origin).toString()
    await writeClipboard(url)
    setCopiedId(publication.id)
    window.setTimeout(() => setCopiedId((current) => current === publication.id ? null : current), 1600)
  }

  async function createRemoteTripPublication(disclosureConfig: DisclosureConfig) {
    const result = await apiRequest<PublicationResult>(`/api/v1/trips/${state.trip.tripId}/publications`, {
      method: 'POST',
      headers: { 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ versionId: head.id, disclosureConfig }),
    })
    const publication: LocalPublication = {
      id: result.publicationId,
      token: result.token,
      targetKind: 'version',
      versionId: head.id,
      reportId: null,
      disclosureConfig,
      createdAt: result.createdAt ?? new Date().toISOString(),
      revokedAt: null,
    }
    state.recordPublication(publication)
    return publication
  }

  async function ensureTripPublication(disclosureConfig: DisclosureConfig) {
    const existing = state.publications.find((item) => item.targetKind === 'version'
      && item.versionId === head.id
      && !item.revokedAt
      && sameDisclosure(item.disclosureConfig, disclosureConfig))
    if (existing) return existing
    return production
      ? createRemoteTripPublication(disclosureConfig)
      : state.createTripPublication(disclosureConfig)
  }

  async function createTripShare() {
    const action = config.viewScope === 'day' ? `day:${selectedDayId}` : 'overview'
    setBusyAction(action)
    setError(null)
    try {
      let nextConfig: DisclosureConfig = config.viewScope === 'day'
        ? { ...config, dayId: selectedDayId }
        : { ...config, dayId: undefined, overviewToken: undefined }

      if (nextConfig.viewScope === 'day') {
        const overviewConfig: DisclosureConfig = {
          showExactDates: nextConfig.showExactDates,
          showSources: nextConfig.showSources,
          showBudget: nextConfig.showBudget,
          viewScope: 'overview',
        }
        const overview = await ensureTripPublication(overviewConfig)
        nextConfig = { ...nextConfig, overviewToken: overview.token }
      }

      const publication = await ensureTripPublication(nextConfig)
      await copy(publication)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '暂时无法创建分享链接')
    } finally {
      setBusyAction(null)
    }
  }

  async function createReportShare() {
    setBusyAction('report')
    setError(null)
    try {
      const reportConfig = { ...config, viewScope: 'overview' as const, dayId: undefined, overviewToken: undefined }
      let publication: LocalPublication | null
      if (production) {
        const result = await apiRequest<PublicationResult>(`/api/v1/reports/${reportId}/publications`, {
          method: 'POST',
          headers: { 'idempotency-key': crypto.randomUUID() },
          body: JSON.stringify({ disclosureConfig: reportConfig }),
        })
        publication = {
          id: result.publicationId,
          token: result.token,
          targetKind: 'report',
          versionId: null,
          reportId,
          disclosureConfig: reportConfig,
          createdAt: result.createdAt ?? new Date().toISOString(),
          revokedAt: null,
        }
        state.recordPublication(publication)
      } else {
        publication = state.createReportPublication(reportId, reportConfig)
      }
      if (publication) await copy(publication)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '暂时无法创建报告分享')
    } finally {
      setBusyAction(null)
    }
  }

  async function revoke(publication: LocalPublication) {
    setBusyAction(`revoke:${publication.id}`)
    setError(null)
    try {
      if (production) {
        await apiRequest(`/api/v1/publications/${publication.id}`, {
          method: 'DELETE',
          headers: { 'idempotency-key': crypto.randomUUID() },
        })
      }
      state.revokePublication(publication.id)
      setConfirmRevokeId(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '暂时无法撤销分享')
    } finally {
      setBusyAction(null)
    }
  }

  const rows = (items: LocalPublication[]) => items.map((publication) => {
    const version = publication.versionId ? versionById.get(publication.versionId) : undefined
    const report = publication.reportId ? reportById.get(publication.reportId) : undefined
    const path = publicationPath(publication)
    const revoked = Boolean(publication.revokedAt)
    const scope = publication.disclosureConfig.viewScope ?? 'overview'
    const day = scope === 'day' ? state.trip.days.find((item) => item.id === publication.disclosureConfig.dayId) : undefined
    return (
      <article className="share-row" key={publication.id} data-revoked={revoked || undefined}>
        <div className="share-row__identity">
          <span>{publication.targetKind === 'report' ? '报告分享' : scope === 'day' ? '单天分享' : '总览分享'}</span>
          <strong>{day ? `Day ${day.dayIndex} · ${day.overnightStay?.label ?? state.trip.placeRefs[day.stops.at(-1)?.placeId ?? '']?.name ?? '当日行程'}` : version ? `行程 v${version.versionNo}` : report ? `${report.type === 'actual' ? '实际' : '计划'}报告` : '固定快照'}</strong>
          <small>{revoked ? '链接已失效' : `${publication.disclosureConfig.showExactDates ? '含日期' : '隐藏日期'} · ${publication.disclosureConfig.showSources ? '含来源' : '隐藏来源'} · ${publication.disclosureConfig.showBudget ? '含预算' : '隐藏预算'}`}</small>
        </div>
        <code>{path}</code>
        <div className="share-row__actions">
          {revoked ? <StatusBadge tone="neutral">已撤销</StatusBadge> : (
            <>
              <Button icon={Copy} onClick={() => void copy(publication)}>{copiedId === publication.id ? '已复制' : '复制'}</Button>
              <Link className="feature-button" to={path} target="_blank"><ExternalLink aria-hidden="true" size={17} />打开</Link>
              {confirmRevokeId === publication.id ? (
                <Button variant="danger" icon={busyAction === `revoke:${publication.id}` ? LoaderCircle : Unlink} disabled={Boolean(busyAction)} onClick={() => void revoke(publication)}>确认撤销</Button>
              ) : (
                <Button variant="quiet" icon={Unlink} onClick={() => setConfirmRevokeId(publication.id)}>撤销</Button>
              )}
            </>
          )}
        </div>
      </article>
    )
  })

  const tripPublications = state.publications.filter((item) => item.targetKind === 'version')
  const reportPublications = state.publications.filter((item) => item.targetKind === 'report')

  return (
    <PageShell width="wide" className="share-page">
      <PageHeader
        eyebrow={state.trip.title}
        title="分享"
        description="公开链接是只读固定快照。登录其他账号，也不能修改这份路书。"
        backTo={`/trips/${state.trip.tripId}/plan`}
        meta={<><StatusBadge tone="brand">当前 v{head.versionNo}</StatusBadge><StatusBadge tone="sea"><LockKeyhole aria-hidden="true" size={13} /> 只读快照</StatusBadge></>}
      />

      <section className="feature-section share-controls">
        <div className="share-config">
          <SectionHeading title="分享范围" description="单天链接仅返回所选日期的数据，并保留回到总览的入口。" />
          <div className="share-scope-switch" aria-label="分享类型">
            <button type="button" className={config.viewScope === 'overview' ? 'is-active' : ''} onClick={() => setConfig((current) => ({ ...current, viewScope: 'overview', dayId: undefined, overviewToken: undefined }))}><MapIcon aria-hidden="true" size={17} />总览</button>
            <button type="button" className={config.viewScope === 'day' ? 'is-active' : ''} onClick={() => setConfig((current) => ({ ...current, viewScope: 'day' }))}><CalendarDays aria-hidden="true" size={17} />单天</button>
          </div>
          {config.viewScope === 'day' ? (
            <label className="feature-field share-day-select">
              <span className="feature-field-label">选择一天</span>
              <select value={selectedDayId} onChange={(event) => setSelectedDayId(event.target.value)}>
                {state.trip.days.map((day) => <option value={day.id} key={day.id}>Day {day.dayIndex} · {day.overnightStay?.label ?? state.trip.placeRefs[day.stops.at(-1)?.placeId ?? '']?.name ?? '当日行程'}</option>)}
              </select>
            </label>
          ) : null}
          <div className="share-options">
            <label><input type="checkbox" checked={config.showExactDates} onChange={(event) => setConfig((current) => ({ ...current, showExactDates: event.target.checked }))} /><span>精确日期</span></label>
            <label><input type="checkbox" checked={config.showSources} onChange={(event) => setConfig((current) => ({ ...current, showSources: event.target.checked }))} /><span>来源链接</span></label>
            <label><input type="checkbox" checked={config.showBudget} onChange={(event) => setConfig((current) => ({ ...current, showBudget: event.target.checked }))} /><span>预算</span></label>
          </div>
        </div>
        <Button variant="primary" icon={busyAction ? LoaderCircle : Share2} disabled={Boolean(busyAction) || (config.viewScope === 'day' && !selectedDayId)} onClick={() => void createTripShare()}>
          {busyAction ? '正在创建…' : config.viewScope === 'day' ? '创建单天链接' : `分享当前 v${head.versionNo}`}
        </Button>
      </section>

      {error ? <p className="share-error" role="alert">{error}</p> : null}

      <section className="feature-section">
        <SectionHeading title="路书链接" description="撤销后原链接立即失效；重新分享会生成新链接。" />
        <div className="share-list">{rows(tripPublications)}</div>
      </section>

      <section className="feature-section share-report-create">
        <div>
          <SectionHeading title="报告分享" description="报告绑定费用和实际记录快照，可独立撤销。" />
          {readyReports.length ? (
            <label className="feature-field">
              <span className="feature-field-label">选择报告</span>
              <select value={reportId} onChange={(event) => setReportId(event.target.value)}>
                {readyReports.map((report, index) => <option value={report.id} key={report.id}>{report.type === 'actual' ? '实际' : '计划'}报告 · 第 {readyReports.length - index} 份</option>)}
              </select>
            </label>
          ) : <p>先生成一份报告，再创建报告分享。</p>}
        </div>
        <Button variant="primary" icon={busyAction === 'report' ? LoaderCircle : Link2} onClick={() => void createReportShare()} disabled={!reportId || Boolean(busyAction)}>创建报告链接</Button>
      </section>
      {reportPublications.length ? <div className="share-list">{rows(reportPublications)}</div> : null}

      <aside className="share-security-note"><RefreshCw aria-hidden="true" /><div><strong>编辑不会改写旧链接</strong><span>恢复版本、应用 Agent 变更或继续调整，只影响之后创建的分享。</span></div></aside>
      <Snackbar open={Boolean(state.snackbar)} message={state.snackbar?.message ?? ''} onDismiss={state.dismissSnackbar} />
    </PageShell>
  )
}

export default SharePage
