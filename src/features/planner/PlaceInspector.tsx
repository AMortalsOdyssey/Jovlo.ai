import { ExternalLink, ImageOff, Navigation, Plus, X } from 'lucide-react'

import { IconButton } from '../../components'
import './planner.css'

export interface PlaceInspectorEvidence {
  id: string
  source: string
  statement: string
  statusLabel?: string
}

export interface PlaceInspectorProps {
  open: boolean
  name: string
  imageUrl?: string
  imageAlt?: string
  openingHours?: string
  suggestedStay?: string
  price?: string
  parking?: string
  sourceSummary?: string
  evidence?: PlaceInspectorEvidence[]
  addLabel?: string
  onAdd?: () => void
  onNavigate?: () => void
  onOpenEvidence?: (evidenceId: string) => void
  onShowAllEvidence?: () => void
  onClose: () => void
}

export function PlaceInspector({
  open,
  name,
  imageUrl,
  imageAlt = name,
  openingHours = '营业信息待确认',
  suggestedStay = '停留时长待确认',
  price = '价格待确认',
  parking = '停车信息待确认',
  sourceSummary = '暂无可展示的来源摘要',
  evidence = [],
  addLabel = '加入行程',
  onAdd,
  onNavigate,
  onOpenEvidence,
  onShowAllEvidence,
  onClose,
}: PlaceInspectorProps) {
  if (!open) return null

  return (
    <aside
      className="jovlo-place-inspector"
      aria-label={`${name} 地点详情`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <div className="jovlo-place-inspector__media">
        {imageUrl ? (
          <img src={imageUrl} alt={imageAlt} />
        ) : (
          <div className="jovlo-place-inspector__media-fallback" aria-label="暂无地点图片">
            <ImageOff aria-hidden="true" size={32} strokeWidth={1.5} />
            <span>暂无地点图片</span>
          </div>
        )}
        <span className="jovlo-place-inspector__close">
          <IconButton icon={X} label="关闭地点详情" onClick={onClose} autoFocus />
        </span>
      </div>

      <div className="jovlo-place-inspector__body">
        <h2>{name}</h2>
        <div className="jovlo-place-inspector__primary-actions">
          <button type="button" className="jovlo-button jovlo-button--primary" onClick={onAdd} disabled={!onAdd}>
            <Plus aria-hidden="true" size={18} />
            {addLabel}
          </button>
          <button type="button" className="jovlo-button jovlo-button--secondary" onClick={onNavigate} disabled={!onNavigate}>
            <Navigation aria-hidden="true" size={18} />
            导航
          </button>
        </div>

        <dl className="jovlo-place-inspector__facts">
          <div>
            <dt>营业</dt>
            <dd>{openingHours}</dd>
          </div>
          <div>
            <dt>停留</dt>
            <dd>{suggestedStay}</dd>
          </div>
          <div>
            <dt>价格</dt>
            <dd>{price}</dd>
          </div>
          <div>
            <dt>停车</dt>
            <dd>{parking}</dd>
          </div>
        </dl>

        <section className="jovlo-place-inspector__sources" aria-labelledby="place-source-heading">
          <h3 id="place-source-heading">来源摘要</h3>
          <p>{sourceSummary}</p>
          {!!evidence.length && (
            <ul>
              {evidence.slice(0, 3).map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => onOpenEvidence?.(item.id)} disabled={!onOpenEvidence}>
                    <span>
                      <strong>{item.source}</strong>
                      <span>{item.statement}</span>
                    </span>
                    {item.statusLabel && <small>{item.statusLabel}</small>}
                    <ExternalLink aria-hidden="true" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="jovlo-place-inspector__all-evidence"
            onClick={onShowAllEvidence}
            disabled={!onShowAllEvidence}
          >
            全部证据
          </button>
        </section>
      </div>
    </aside>
  )
}
