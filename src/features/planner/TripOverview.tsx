import { AlertTriangle, BedDouble, CalendarDays, CarFront, ChevronRight, MapPinned, Route, WalletCards } from 'lucide-react'

import type { DaySummary } from './types'
import { ProductCopyright } from '@/components'
import './plan-page.css'

export interface TripOverviewDay extends DaySummary {
  date?: string
  stopCount: number
}

export interface TripOverviewProps {
  days: TripOverviewDay[]
  totalDistance: string
  totalDriving: string
  totalBudget: string
  totalStops: number
  onSelectDay: (dayId: string) => void
}

export function TripOverview({
  days,
  totalDistance,
  totalDriving,
  totalBudget,
  totalStops,
  onSelectDay,
}: TripOverviewProps) {
  return (
    <section className="trip-overview" aria-labelledby="trip-overview-title">
      <header className="trip-overview__header">
        <div>
          <span>完整路线</span>
          <h1 id="trip-overview-title">全程总览</h1>
        </div>
        <span className="trip-overview__duration"><CalendarDays aria-hidden="true" size={15} />{days.length} 天</span>
      </header>

      <div className="trip-overview__metrics" aria-label="全程核心数据">
        <div><Route aria-hidden="true" /><span>总里程</span><strong>{totalDistance}</strong></div>
        <div><CarFront aria-hidden="true" /><span>驾驶</span><strong>{totalDriving}</strong></div>
        <div><MapPinned aria-hidden="true" /><span>停靠点</span><strong>{totalStops} 个</strong></div>
        <div><WalletCards aria-hidden="true" /><span>预算</span><strong>{totalBudget}</strong></div>
      </div>

      <div className="trip-overview__days" aria-label="每日路线摘要">
        {days.map((day) => (
          <button
            key={day.id}
            type="button"
            className="trip-overview__day"
            onClick={() => onSelectDay(day.id)}
            aria-label={`打开 Day ${day.dayNumber}，${day.area}`}
          >
            <span className="trip-overview__day-index">D{day.dayNumber}</span>
            <span className="trip-overview__day-body">
              <span className="trip-overview__day-heading">
                <strong>{day.area}</strong>
                <small>{day.date ?? '日期待定'}</small>
              </span>
              <span className="trip-overview__day-meta">
                <span><MapPinned aria-hidden="true" size={14} />{day.stopCount} 站</span>
                <span><CarFront aria-hidden="true" size={14} />{day.driveDuration}</span>
                {day.hotel ? <span title={day.hotel}><BedDouble aria-hidden="true" size={14} />{day.hotel}</span> : null}
                {day.riskCount ? <span className="trip-overview__risk"><AlertTriangle aria-hidden="true" size={14} />{day.riskCount} 处提示</span> : null}
              </span>
            </span>
            <ChevronRight aria-hidden="true" size={18} />
          </button>
        ))}
      </div>
      <ProductCopyright className="plan-product-copyright" />
    </section>
  )
}
