import { Route } from 'lucide-react'

import type { DaySummary } from './types'
import './planner.css'

function compactAreaLabel(area: string) {
  return area
    .replace(/(?:周边)?住宿区$/u, '')
    .replace(/(?:舒适型|豪华型|经济型)?酒店(?:示例)?$/u, '')
    .replace(/镇$/u, '')
    .trim() || area
}

export interface MobileDayStripProps {
  days: DaySummary[]
  selectedDayId: string
  onSelectDay: (dayId: string) => void
  overviewSelected?: boolean
  onSelectOverview?: () => void
}

export function MobileDayStrip({
  days,
  selectedDayId,
  onSelectDay,
  overviewSelected = false,
  onSelectOverview,
}: MobileDayStripProps) {
  return (
    <nav className="jovlo-mobile-day-strip" aria-label="选择行程日期">
      <div className="jovlo-mobile-day-strip__scroller">
        {onSelectOverview ? (
          <button
            type="button"
            className="jovlo-mobile-day-strip__day jovlo-mobile-day-strip__overview"
            data-selected={overviewSelected || undefined}
            aria-current={overviewSelected ? 'page' : undefined}
            aria-label="全程总览"
            onClick={onSelectOverview}
          >
            <Route aria-hidden="true" size={16} />
            <strong>总览</strong>
          </button>
        ) : null}
        {days.map((day) => {
          const selected = !overviewSelected && day.id === selectedDayId
          return (
            <button
              key={day.id}
              type="button"
              className="jovlo-mobile-day-strip__day"
              data-selected={selected || undefined}
              aria-current={selected ? 'date' : undefined}
              aria-label={`Day ${day.dayNumber}，${day.area}`}
              title={`Day ${day.dayNumber} · ${day.area}`}
              onClick={() => onSelectDay(day.id)}
            >
              <strong>D{day.dayNumber}</strong>
              <span>{compactAreaLabel(day.area)}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
