import type { ReactNode } from 'react'

import { useFlipChildren } from '@/lib/use-flip-list'

import './planner.css'

export interface RouteTimelineProps {
  children: ReactNode
  label?: string
  className?: string
  /** 条目顺序指纹（如 stop id 拼接）；变化时对 data-flip-id 条目做 FLIP 位置过渡 */
  flipKey?: string
}

export function RouteTimeline({
  children,
  label = '当日路线时间轴',
  className = '',
  flipKey = '',
}: RouteTimelineProps) {
  const itemsRef = useFlipChildren<HTMLDivElement>(flipKey)

  return (
    <section className={`jovlo-route-timeline ${className}`.trim()} aria-label={label}>
      <div className="jovlo-route-timeline__items" role="list" ref={itemsRef}>
        {children}
      </div>
    </section>
  )
}
