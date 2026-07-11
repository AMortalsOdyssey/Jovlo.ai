import { CalendarDays, Map, MoreHorizontal, ReceiptText } from 'lucide-react'

import type { MobilePlannerView } from './types'
import './planner.css'

export interface MobileNavProps {
  activeView: MobilePlannerView
  isTravelingToday?: boolean
  onSelectView: (view: MobilePlannerView) => void
}

export function MobileNav({ activeView, isTravelingToday = false, onSelectView }: MobileNavProps) {
  const items = [
    { id: 'plan' as const, label: isTravelingToday ? '今日' : '行程', icon: CalendarDays },
    { id: 'map' as const, label: '地图', icon: Map },
    { id: 'budget' as const, label: '预算', icon: ReceiptText },
    { id: 'more' as const, label: '更多', icon: MoreHorizontal },
  ]

  return (
    <nav className="jovlo-mobile-nav" aria-label="路书主导航">
      {items.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className="jovlo-mobile-nav__item"
          data-selected={activeView === id || undefined}
          aria-current={activeView === id ? 'page' : undefined}
          onClick={() => onSelectView(id)}
        >
          <Icon aria-hidden="true" size={21} strokeWidth={1.8} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}
