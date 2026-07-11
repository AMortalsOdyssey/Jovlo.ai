import { AlertTriangle, BedDouble, CarFront } from 'lucide-react'

import type { DaySummary } from './types'
import './planner.css'

export interface DayRailProps {
  days: DaySummary[]
  selectedDayId: string
  onSelectDay: (dayId: string) => void
  label?: string
}

export function DayRail({ days, selectedDayId, onSelectDay, label = '行程日期' }: DayRailProps) {
  return (
    <nav className="jovlo-day-rail" aria-label={label}>
      <ol className="jovlo-day-rail__list">
        {days.map((day) => {
          const selected = day.id === selectedDayId

          return (
            <li key={day.id}>
              <button
                type="button"
                className="jovlo-day-rail__item"
                data-selected={selected || undefined}
                aria-current={selected ? 'date' : undefined}
                onClick={() => onSelectDay(day.id)}
              >
                <span className="jovlo-day-rail__heading">
                  <strong>Day {day.dayNumber}</strong>
                  <span>{day.area}</span>
                </span>
                <span className="jovlo-day-rail__meta">
                  {day.hotel && (
                    <span title={day.hotel}>
                      <BedDouble aria-hidden="true" size={14} />
                      <span>{day.hotel}</span>
                    </span>
                  )}
                  <span>
                    <CarFront aria-hidden="true" size={14} />
                    <span className="jovlo-numeric">{day.driveDuration}</span>
                  </span>
                  {!!day.riskCount && (
                    <span className="jovlo-day-rail__risk">
                      <AlertTriangle aria-hidden="true" size={14} />
                      <span>{day.riskCount} 处</span>
                    </span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
