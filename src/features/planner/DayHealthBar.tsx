import type { ReactNode } from 'react'
import { CarFront, Hourglass, MapPinned, WalletCards } from 'lucide-react'

import type { DayHealthStatus } from './types'
import './planner.css'

export interface DayHealthMetrics {
  driving: string
  playing: string
  buffer: string
  budget: string
}

export interface DayHealthBarProps {
  metrics: DayHealthMetrics
  status: DayHealthStatus
  compact?: boolean
  loading?: boolean
  onOpenDetails?: () => void
}

const STATUS_LABELS: Record<DayHealthStatus, string> = {
  comfortable: '舒适',
  tight: '偏紧',
  overloaded: '超载',
  unconfirmed: '数据待确认',
}

const METRIC_LABELS: Array<[keyof DayHealthMetrics, string, typeof CarFront]> = [
  ['driving', '驾驶', CarFront],
  ['playing', '游玩', MapPinned],
  ['buffer', '余量', Hourglass],
  ['budget', '预算', WalletCards],
]

export function DayHealthBar({
  metrics,
  status,
  compact = false,
  loading = false,
  onOpenDetails,
}: DayHealthBarProps) {
  const content: ReactNode = (
    <>
      <span className="jovlo-day-health__metrics">
        {METRIC_LABELS.map(([key, label, Icon]) => (
          <span key={key} className="jovlo-day-health__metric" aria-label={`${label} ${metrics[key]}`} title={label}>
            <Icon className="jovlo-day-health__metric-icon" aria-hidden="true" size={15} strokeWidth={1.8} />
            {!compact && <span className="jovlo-day-health__metric-label">{label}</span>}
            {loading ? (
              <span className="jovlo-skeleton jovlo-day-health__skeleton" aria-hidden="true" />
            ) : (
              <strong className="jovlo-numeric">{metrics[key]}</strong>
            )}
          </span>
        ))}
      </span>
      <span className={`jovlo-day-health__status jovlo-day-health__status--${status}`}>
        {loading ? '重算中' : STATUS_LABELS[status]}
      </span>
    </>
  )

  if (onOpenDetails) {
    return (
      <button
        type="button"
        className={`jovlo-day-health ${compact ? 'jovlo-day-health--compact' : ''}`.trim()}
        aria-label={`查看日程健康详情：${loading ? '重算中' : STATUS_LABELS[status]}`}
        aria-busy={loading}
        onClick={onOpenDetails}
      >
        {content}
      </button>
    )
  }

  return (
    <div
      className={`jovlo-day-health ${compact ? 'jovlo-day-health--compact' : ''}`.trim()}
      aria-label={`日程健康：${loading ? '重算中' : STATUS_LABELS[status]}`}
      aria-busy={loading}
    >
      {content}
    </div>
  )
}
