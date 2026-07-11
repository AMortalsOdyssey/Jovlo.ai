import { Copy, ExternalLink, Link2, LockKeyhole, RefreshCw, Share2, Unlink } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Snackbar } from '@/features/planner'
import { Button, PageHeader, PageShell, SectionHeading, StatusBadge } from '@/features/trips/feature-ui'
import { currentVersion, useTripStore } from '@/store/useTripStore'
import type { DisclosureConfig, LocalPublication } from '@/store/store-types'
import './share.css'

const DEFAULT_DISCLOSURE: DisclosureConfig = {
  showExactDates: false,
  showSources: true,
  showBudget: true,
}

function publicationPath(publication: LocalPublication) {
  return publication.targetKind === 'version' ? `/s/${publication.token}` : `/r/${publication.token}`
}

export function SharePage() {
  const state = useTripStore()
  const head = currentVersion(state)
  const [config, setConfig] = useState(DEFAULT_DISCLOSURE)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null)
  const readyReports = useMemo(
    () => [...state.reports.filter((report) => report.status === 'ready')].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [state.reports],
  )
  const [reportId, setReportId] = useState(readyReports[0]?.id ?? '')
  const versionById = new Map(state.versions.map((version) => [version.id, version]))
  const reportById = new Map(state.reports.map((report) => [report.id, report]))

  const copy = async (publication: LocalPublication) => {
    const url = new URL(publicationPath(publication), window.location.origin).toString()
    await navigator.clipboard.writeText(url)
    setCopiedId(publication.id)
    window.setTimeout(() => setCopiedId((current) => current === publication.id ? null : current), 1600)
  }

  const createTripShare = () => {
    const publication = state.createTripPublication(config)
    void copy(publication)
  }

  const createReportShare = () => {
    const publication = state.createReportPublication(reportId, config)
    if (publication) void copy(publication)
  }

  const rows = (items: LocalPublication[]) => items.map((publication) => {
    const version = publication.versionId ? versionById.get(publication.versionId) : undefined
    const report = publication.reportId ? reportById.get(publication.reportId) : undefined
    const path = publicationPath(publication)
    const revoked = Boolean(publication.revokedAt)
    return (
      <article className="share-row" key={publication.id} data-revoked={revoked || undefined}>
        <div className="share-row__identity">
          <span>{publication.targetKind === 'version' ? '路书分享' : '报告分享'}</span>
          <strong>{version ? `行程 v${version.versionNo}` : report ? `${report.type === 'actual' ? '实际' : '计划'}报告` : '固定快照'}</strong>
          <small>{revoked ? '链接已失效' : `${publication.disclosureConfig.showExactDates ? '显示日期' : '隐藏精确日期'} · ${publication.disclosureConfig.showSources ? '显示来源' : '隐藏来源'}`}</small>
        </div>
        <code>{path}</code>
        <div className="share-row__actions">
          {revoked ? <StatusBadge tone="neutral">已撤销</StatusBadge> : (
            <>
              <Button icon={Copy} onClick={() => void copy(publication)}>{copiedId === publication.id ? '已复制' : '复制'}</Button>
              <Link className="feature-button" to={path} target="_blank"><ExternalLink aria-hidden="true" size={17} />打开</Link>
              {confirmRevokeId === publication.id ? (
                <Button variant="danger" icon={Unlink} onClick={() => { state.revokePublication(publication.id); setConfirmRevokeId(null) }}>确认撤销</Button>
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
  const headAlreadyShared = tripPublications.some((item) => item.versionId === head.id && !item.revokedAt)

  return (
    <PageShell width="wide" className="share-page">
      <PageHeader
        eyebrow={state.trip.title}
        title="分享"
        description="链接只读取创建时的固定版本；后续草稿、回退和目录更新都不会改写旧内容。"
        backTo={`/trips/${state.trip.tripId}/plan`}
        meta={<><StatusBadge tone="brand">当前 v{head.versionNo}</StatusBadge><StatusBadge tone="sea"><LockKeyhole aria-hidden="true" size={13} /> 固定快照</StatusBadge></>}
      />

      <section className="feature-section share-controls">
        <div>
          <SectionHeading title="公开范围" description="这些选项只影响新链接，已经创建的链接保持原样。" />
          <div className="share-options">
            <label><input type="checkbox" checked={config.showExactDates} onChange={(event) => setConfig((current) => ({ ...current, showExactDates: event.target.checked }))} /><span>显示精确日期</span></label>
            <label><input type="checkbox" checked={config.showSources} onChange={(event) => setConfig((current) => ({ ...current, showSources: event.target.checked }))} /><span>显示来源</span></label>
            <label><input type="checkbox" checked={config.showBudget} onChange={(event) => setConfig((current) => ({ ...current, showBudget: event.target.checked }))} /><span>显示预算区间</span></label>
          </div>
        </div>
        <Button variant="primary" icon={headAlreadyShared ? Copy : Share2} onClick={createTripShare}>
          {headAlreadyShared ? `复制 v${head.versionNo} 分享` : `分享当前 v${head.versionNo}`}
        </Button>
      </section>

      <section className="feature-section">
        <SectionHeading title="路书链接" description="撤销后原 token 立即失效；重新分享会生成新 token。" />
        <div className="share-list">{rows(tripPublications)}</div>
      </section>

      <section className="feature-section share-report-create">
        <div>
          <SectionHeading title="报告分享" description="报告本身绑定行程、费用和实际记录快照，可独立撤销。" />
          {readyReports.length ? (
            <label className="feature-field">
              <span className="feature-field-label">选择报告</span>
              <select value={reportId} onChange={(event) => setReportId(event.target.value)}>
                {readyReports.map((report, index) => <option value={report.id} key={report.id}>{report.type === 'actual' ? '实际' : '计划'}报告 · 第 {readyReports.length - index} 份</option>)}
              </select>
            </label>
          ) : <p>先生成一份报告，再创建报告分享。</p>}
        </div>
        <Button variant="primary" icon={Link2} onClick={createReportShare} disabled={!reportId}>创建报告分享</Button>
      </section>
      {reportPublications.length ? <div className="share-list">{rows(reportPublications)}</div> : null}

      <aside className="share-security-note"><RefreshCw aria-hidden="true" /><div><strong>旧链接不会随 HEAD 漂移</strong><span>恢复历史版本、应用 Agent 变更或继续编辑，只会影响新的分享。</span></div></aside>
      <Snackbar open={Boolean(state.snackbar)} message={state.snackbar?.message ?? ''} onDismiss={state.dismissSnackbar} />
    </PageShell>
  )
}

export default SharePage
