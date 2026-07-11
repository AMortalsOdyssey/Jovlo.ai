import type { ReactNode } from 'react'

import type { MobilePlannerView } from './types'
import './planner.css'

export interface PlannerWorkspaceProps {
  header: ReactNode
  dayRail: ReactNode
  dayStrip: ReactNode
  timeline: ReactNode
  map: ReactNode
  budget?: ReactNode
  more?: ReactNode
  inspector?: ReactNode
  mobileNav: ReactNode
  activeMobileView: MobilePlannerView
  className?: string
}

export function PlannerWorkspace({
  header,
  dayRail,
  dayStrip,
  timeline,
  map,
  budget,
  more,
  inspector,
  mobileNav,
  activeMobileView,
  className = '',
}: PlannerWorkspaceProps) {
  return (
    <div
      className={`jovlo-planner-workspace ${className}`.trim()}
      data-mobile-view={activeMobileView}
    >
      <div className="jovlo-planner-workspace__header">{header}</div>
      <div className="jovlo-planner-workspace__day-strip">{dayStrip}</div>
      <div className="jovlo-planner-workspace__body">
        <div className="jovlo-planner-workspace__rail">{dayRail}</div>
        <main className="jovlo-planner-workspace__timeline">{timeline}</main>
        <section className="jovlo-planner-workspace__map" aria-label="地图视图">
          {map}
        </section>
        {budget && <section className="jovlo-planner-workspace__budget">{budget}</section>}
        {more && <section className="jovlo-planner-workspace__more">{more}</section>}
        {inspector && <div className="jovlo-planner-workspace__inspector">{inspector}</div>}
      </div>
      <div className="jovlo-planner-workspace__mobile-nav">{mobileNav}</div>
    </div>
  )
}
