import type { ReactNode } from 'react'

import './planner.css'

export interface RouteTimelineProps {
  children: ReactNode
  label?: string
  className?: string
}

export function RouteTimeline({
  children,
  label = '当日路线时间轴',
  className = '',
}: RouteTimelineProps) {
  return (
    <section className={`jovlo-route-timeline ${className}`.trim()} aria-label={label}>
      <div className="jovlo-route-timeline__items" role="list">
        {children}
      </div>
    </section>
  )
}
