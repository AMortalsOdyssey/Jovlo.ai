import { useLayoutEffect, useMemo, useRef, useState } from 'react'
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
  const scrollerRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const activeItemRef = useRef<HTMLButtonElement>(null)
  const initialCompact = days.length > 3
  const [compact, setCompact] = useState(initialCompact)
  const daySignature = useMemo(
    () => days.map(({ id, dayNumber, area }) => `${id}:${dayNumber}:${area}`).join('|'),
    [days],
  )

  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    const measure = measureRef.current
    if (!scroller || !measure) return undefined

    const updateLayout = () => {
      const availableWidth = scroller.clientWidth
      const requiredWidth = measure.getBoundingClientRect().width
      if (availableWidth <= 0 || requiredWidth <= 0) return
      setCompact(requiredWidth > availableWidth + 1)
    }

    updateLayout()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(updateLayout)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [daySignature, onSelectOverview])

  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    const activeItem = activeItemRef.current
    if (!scroller || !activeItem || typeof scroller.scrollTo !== 'function') return

    const stickyWidth = onSelectOverview ? 72 : 0
    const visibleWidth = Math.max(0, scroller.clientWidth - stickyWidth)
    const itemStart = activeItem.offsetLeft
    const itemEnd = itemStart + activeItem.offsetWidth
    const visibleStart = scroller.scrollLeft + stickyWidth
    const visibleEnd = scroller.scrollLeft + scroller.clientWidth
    if (itemStart >= visibleStart && itemEnd <= visibleEnd) return

    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const targetLeft = Math.max(0, itemStart - stickyWidth - (visibleWidth - activeItem.offsetWidth) / 2)
    scroller.scrollTo({ left: targetLeft, behavior: prefersReducedMotion ? 'auto' : 'smooth' })
  }, [compact, onSelectOverview, overviewSelected, selectedDayId])

  return (
    <nav
      className="jovlo-mobile-day-strip"
      data-layout={compact ? 'focus' : 'full'}
      aria-label="选择行程日期"
    >
      <div ref={scrollerRef} className="jovlo-mobile-day-strip__scroller">
        {onSelectOverview ? (
          <button
            ref={overviewSelected ? activeItemRef : undefined}
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
              ref={selected ? activeItemRef : undefined}
              key={day.id}
              type="button"
              className="jovlo-mobile-day-strip__day"
              data-selected={selected || undefined}
              data-expanded={selected && compact ? true : undefined}
              aria-current={selected ? 'date' : undefined}
              aria-label={`Day ${day.dayNumber}，${day.area}`}
              onClick={() => onSelectDay(day.id)}
            >
              <strong>D{day.dayNumber}</strong>
              <span>{compactAreaLabel(day.area)}</span>
            </button>
          )
        })}
      </div>
      <div ref={measureRef} className="jovlo-mobile-day-strip__measure" aria-hidden="true">
        {onSelectOverview ? (
          <span className="jovlo-mobile-day-strip__day jovlo-mobile-day-strip__overview">
            <Route aria-hidden="true" size={16} />
            <strong>总览</strong>
          </span>
        ) : null}
        {days.map((day) => (
          <span key={day.id} className="jovlo-mobile-day-strip__day">
            <strong>D{day.dayNumber}</strong>
            <span>{compactAreaLabel(day.area)}</span>
          </span>
        ))}
      </div>
    </nav>
  )
}
