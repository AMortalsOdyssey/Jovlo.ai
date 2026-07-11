import { BedDouble, MapPinned, RefreshCcw, Search } from 'lucide-react'

import './planner.css'

export type HotelAnchorKind = 'place' | 'area'
export type HotelAnchorRelation = 'previous-end' | 'next-start' | 'both'

export interface HotelAnchorProps {
  kind: HotelAnchorKind
  name: string
  relation?: HotelAnchorRelation
  impactPreview?: string
  onChangeHotel?: () => void
  onChooseHotel?: () => void
}

const RELATION_LABELS: Record<HotelAnchorRelation, string> = {
  'previous-end': '前日终点',
  'next-start': '次日起点',
  both: '前日终点 · 次日起点',
}

export function HotelAnchor({
  kind,
  name,
  relation = 'both',
  impactPreview,
  onChangeHotel,
  onChooseHotel,
}: HotelAnchorProps) {
  const isArea = kind === 'area'
  const displayName = isArea ? `宿·${name} 未定` : name

  return (
    <div className="jovlo-hotel-node" role="listitem">
      <span className="jovlo-hotel-node__marker" aria-hidden="true">
        <BedDouble size={18} strokeWidth={1.8} />
      </span>
      <section className="jovlo-hotel-anchor" data-kind={kind} aria-label={`${displayName}，${RELATION_LABELS[relation]}`}>
        <div className="jovlo-hotel-anchor__identity">
          <span className="jovlo-hotel-anchor__eyebrow">
            {isArea ? <MapPinned aria-hidden="true" size={15} /> : <BedDouble aria-hidden="true" size={15} />}
            {RELATION_LABELS[relation]}
          </span>
          <strong>{displayName}</strong>
          {isArea && <span className="jovlo-hotel-anchor__estimate">相关路段按区域中心预估</span>}
          {impactPreview && <span className="jovlo-hotel-anchor__impact">{impactPreview}</span>}
        </div>
        {isArea ? (
          <button type="button" className="jovlo-button jovlo-button--secondary" onClick={onChooseHotel} disabled={!onChooseHotel}>
            <Search aria-hidden="true" size={16} />
            选酒店
          </button>
        ) : (
          <button type="button" className="jovlo-button jovlo-button--secondary" onClick={onChangeHotel} disabled={!onChangeHotel}>
            <RefreshCcw aria-hidden="true" size={16} />
            换酒店
          </button>
        )}
      </section>
    </div>
  )
}
