import { CarFront, Clock3, Footprints, Navigation, Route, Ruler, Timer } from 'lucide-react'

import type { TravelMode } from './types'
import './planner.css'

export type LegStatus = 'ready' | 'calculating' | 'error'

export interface LegRowProps {
  distance?: string
  duration?: string
  eta?: string
  status?: LegStatus
  travelMode?: TravelMode
  selected?: boolean
  estimated?: boolean
  onSelect?: () => void
  onNavigate?: () => void
}

const MODE_ICON = {
  driving: CarFront,
  walking: Footprints,
  pending: Route,
} satisfies Record<TravelMode, typeof Route>

export function LegRow({
  distance,
  duration,
  eta,
  status = 'ready',
  travelMode = 'driving',
  selected = false,
  estimated = false,
  onSelect,
  onNavigate,
}: LegRowProps) {
  const ModeIcon = MODE_ICON[travelMode]
  const description =
    status === 'error'
      ? '无法算路'
      : `${distance ?? '距离待确认'} · ${duration ?? '时间待确认'}${eta ? ` · 预计 ${eta}` : ''}${estimated ? ' · 预估' : ''}`

  return (
    <div
      className={`jovlo-leg-row jovlo-leg-row--${travelMode}`}
      data-selected={selected || undefined}
      role="listitem"
      aria-busy={status === 'calculating'}
    >
      <span className="jovlo-leg-row__marker" aria-hidden="true">
        <ModeIcon size={16} strokeWidth={1.8} />
      </span>
      <div className="jovlo-leg-row__content">
        <button
          type="button"
          className="jovlo-leg-row__details"
          onClick={onSelect}
          disabled={!onSelect}
          aria-label={`查看路段详情：${description}`}
        >
          {status === 'calculating' ? (
            <span className="jovlo-leg-row__loading" aria-label="正在计算路段">
              <span className="jovlo-skeleton" aria-hidden="true" />
              <span className="jovlo-skeleton" aria-hidden="true" />
            </span>
          ) : (
            status === 'error' ? (
              <span className="jovlo-leg-row__error">{description}</span>
            ) : (
              <span className="jovlo-leg-row__metrics jovlo-numeric" aria-hidden="true">
                <span title="路段距离"><Ruler size={14} />{distance ?? '待确认'}</span>
                <span title="驾驶耗时"><Timer size={14} />{duration ?? '待确认'}</span>
                {eta ? <span title="预计到达"><Clock3 size={14} />{eta}</span> : null}
                {estimated ? <span className="jovlo-leg-row__estimate" title="参考估算">估</span> : null}
              </span>
            )
          )}
        </button>
        <button
          type="button"
          className="jovlo-leg-row__navigate"
          onClick={onNavigate}
          disabled={!onNavigate || status !== 'ready'}
        >
          <Navigation aria-hidden="true" size={16} strokeWidth={1.8} />
          <span>导航</span>
        </button>
      </div>
    </div>
  )
}
