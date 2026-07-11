import { ExternalLink, FileSearch, Filter, Info, Link2, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { useTripStore } from '@/store/useTripStore'

import {
  ButtonLink,
  EmptyState,
  PageHeader,
  PageShell,
  SectionHeading,
  StatusBadge,
  type Tone,
} from '@/features/trips/feature-ui'
import {
  type EvidenceStatus,
  formatDateLabel,
  getTripId,
  getTripTitle,
  normalizeClaims,
  normalizeSources,
} from '@/features/trips/model'

const statusMeta: Record<EvidenceStatus, { label: string; short: string; tone: Tone }> = {
  official: { label: '官方确认', short: '官方', tone: 'sea' },
  corroborated: { label: '多源一致', short: '一致', tone: 'sky' },
  single_source: { label: '仅一处提及', short: '单一', tone: 'sun' },
  conflicting: { label: '有冲突', short: '冲突', tone: 'coral' },
  stale: { label: '已过期', short: '过期', tone: 'sun' },
  excluded: { label: '未纳入综合判断', short: '未纳入', tone: 'neutral' },
}

const fieldLabels: Record<string, string> = {
  opening_hours: '营业时间',
  price_range: '价格区间',
  parking: '停车',
  taste: '口味体验',
  road_condition: '道路情况',
  suitable_for: '适合人群',
  note: '补充说明',
}

type FilterValue = 'all' | EvidenceStatus

export function SourcesPage() {
  const state = useTripStore()
  const sources = useMemo(() => normalizeSources(state.trip), [state.trip])
  const claims = useMemo(() => normalizeClaims(state.trip, state.derived), [state.trip, state.derived])
  const [filter, setFilter] = useState<FilterValue>('all')
  const visibleClaims = filter === 'all' ? claims : claims.filter((claim) => claim.status === filter)

  if (!state.trip) {
    return (
      <PageShell>
        <PageHeader title="来源证据" backTo="/trips" />
        <EmptyState icon={FileSearch} title="还没有可查看的行程" />
      </PageShell>
    )
  }

  const tripId = getTripId(state.trip)

  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow={getTripTitle(state.trip)}
        title="来源证据"
        description="结论按字段对应到来源；状态只表达支持关系、时效和冲突，不判断作者真假。"
        backTo={`/trips/${tripId}/plan`}
        meta={<><StatusBadge tone="sky">{sources.length} 个来源</StatusBadge><StatusBadge>{claims.length} 条字段证据</StatusBadge></>}
      />

      {sources.length === 0 && claims.length === 0 ? (
        <EmptyState
          icon={Link2}
          title="导入 ChangeSet 后，资料来源会出现在这里"
          action={<ButtonLink to={`/trips/${tripId}/imports/new`} variant="primary">了解导入</ButtonLink>}
        />
      ) : (
        <>
          <section className="feature-section">
            <SectionHeading
              title="字段级证据"
              description="同一个地点的营业时间、价格和停车信息分别审阅，冲突不会被静默覆盖。"
              action={<span className="sources-boundary"><ShieldCheck aria-hidden="true" size={16} />不作真假裁决</span>}
            />
            <div className="sources-filter" aria-label="筛选证据状态">
              <Filter aria-hidden="true" size={17} />
              <button className={filter === 'all' ? 'is-active' : ''} type="button" onClick={() => setFilter('all')}>全部 <span>{claims.length}</span></button>
              {(Object.keys(statusMeta) as EvidenceStatus[]).map((status) => {
                const count = claims.filter((claim) => claim.status === status).length
                return <button className={filter === status ? 'is-active' : ''} type="button" onClick={() => setFilter(status)} key={status}>{statusMeta[status].short} <span>{count}</span></button>
              })}
            </div>

            {visibleClaims.length ? (
              <div className="sources-claim-list">
                {visibleClaims.map((claim) => {
                  const meta = statusMeta[claim.status]
                  return (
                    <article className="sources-claim-row" key={claim.id}>
                      <div className="sources-claim-place">
                        <span>{claim.placeName}</span>
                        <strong>{fieldLabels[claim.field] ?? claim.field}</strong>
                      </div>
                      <div className="sources-claim-value">
                        <p>{claim.value}</p>
                        {claim.reason ? <small>{claim.reason}</small> : null}
                      </div>
                      <div className="sources-claim-status">
                        <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                        <span>{claim.sourceIds.length || 1} 个来源{claim.verifiedAt ? ` · ${formatDateLabel(claim.verifiedAt)}` : ''}</span>
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : (
              <div className="sources-no-match"><Info aria-hidden="true" size={20} />当前筛选下没有字段证据</div>
            )}
          </section>

          <section className="feature-section">
            <SectionHeading title="来源" description="仅保存链接、元数据和原创摘要，不复制平台全文。" />
            <ul className="feature-card-list sources-list">
              {sources.map((source) => (
                <li className="feature-card sources-card" key={source.id}>
                  <div className="feature-card-header">
                    <div className="feature-card-title">
                      <div className="sources-platform-row"><StatusBadge>{source.platform}</StatusBadge>{source.commercialRelationship === 'yes' ? <StatusBadge tone="sun">商业合作</StatusBadge> : source.commercialRelationship === 'unknown' ? <StatusBadge>商业关系未知</StatusBadge> : null}</div>
                      <h3>{source.title}</h3>
                      <p>{source.author ?? '作者未注明'}{source.publishedAt ? ` · 发布于 ${formatDateLabel(source.publishedAt)}` : ''}</p>
                    </div>
                    {source.url ? <a className="sources-open-link" href={source.url} target="_blank" rel="noreferrer" aria-label={`打开来源：${source.title}`}><ExternalLink aria-hidden="true" size={18} /></a> : null}
                  </div>
                  {source.summary ? <p className="sources-summary">{source.summary}</p> : null}
                  <div className="feature-card-meta"><span>采集：{formatDateLabel(source.capturedAt)}</span><span>引用字段：{claims.filter((claim) => claim.sourceIds.includes(source.id)).map((claim) => fieldLabels[claim.field] ?? claim.field).filter((value, index, array) => array.indexOf(value) === index).join('、') || '待关联'}</span></div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </PageShell>
  )
}

export default SourcesPage
