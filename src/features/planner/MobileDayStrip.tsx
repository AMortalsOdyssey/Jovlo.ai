import type { DaySummary } from './types'
import './planner.css'

export interface MobileDayStripProps {
  days: DaySummary[]
  selectedDayId: string
  onSelectDay: (dayId: string) => void
}

export function MobileDayStrip({ days, selectedDayId, onSelectDay }: MobileDayStripProps) {
  return (
    <nav className="jovlo-mobile-day-strip" aria-label="选择行程日期">
      <div className="jovlo-mobile-day-strip__scroller">
        {days.map((day) => {
          const selected = day.id === selectedDayId
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
              <span>{day.area}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
