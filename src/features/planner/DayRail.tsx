import { AlertTriangle, BedDouble, CarFront, Route } from 'lucide-react'

import type { DaySummary } from './types'
import './planner.css'

export interface DayRailProps {
  days: DaySummary[]
  selectedDayId: string
  onSelectDay: (dayId: string) => void
  label?: string
  overviewSelected?: boolean
  onSelectOverview?: () => void
}

export function DayRail({
  days,
  selectedDayId,
  onSelectDay,
  label = '行程日期',
  overviewSelected = false,
  onSelectOverview,
}: DayRailProps) {
  return (
    <nav className="jovlo-day-rail" aria-label={label}>
      <ol className="jovlo-day-rail__list">
        {onSelectOverview ? (
          <li>
            <button
              type="button"
              className="jovlo-day-rail__item jovlo-day-rail__overview"
              data-selected={overviewSelected || undefined}
              aria-current={overviewSelected ? 'page' : undefined}
              onClick={onSelectOverview}
            >
              <span className="jovlo-day-rail__heading">
                <Route aria-hidden="true" size={17} />
                <strong>全程总览</strong>
              </span>
              <span className="jovlo-day-rail__meta">{days.length} 天完整路线</span>
            </button>
          </li>
        ) : null}
        {days.map((day) => {
          const selected = !overviewSelected && day.id === selectedDayId

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
