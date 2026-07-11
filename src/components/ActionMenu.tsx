import { useRef, type FocusEvent } from 'react'
import { MoreHorizontal, type LucideIcon } from 'lucide-react'

import './ui.css'

export interface ActionMenuItem {
  label: string
  icon: LucideIcon
  onSelect: () => void
  disabled?: boolean
  tone?: 'default' | 'danger'
}

export interface ActionMenuProps {
  label: string
  items: ActionMenuItem[]
  icon?: LucideIcon
  align?: 'start' | 'end'
  className?: string
}

export function ActionMenu({
  label,
  items,
  icon: TriggerIcon = MoreHorizontal,
  align = 'end',
  className = '',
}: ActionMenuProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const triggerRef = useRef<HTMLElement>(null)

  const closeMenu = (restoreFocus = false) => {
    detailsRef.current?.removeAttribute('open')
    if (restoreFocus) triggerRef.current?.focus()
  }

  const handleBlur = (event: FocusEvent<HTMLDetailsElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      closeMenu()
    }
  }

  return (
    <details
      ref={detailsRef}
      className={`jovlo-action-menu jovlo-action-menu--${align} ${className}`.trim()}
      onBlur={handleBlur}
    >
      <summary
        ref={triggerRef}
        className="jovlo-action-menu__trigger"
        role="button"
        aria-label={label}
        aria-haspopup="menu"
        title={label}
      >
        <TriggerIcon aria-hidden="true" size={20} strokeWidth={1.8} />
        <span className="jovlo-action-menu__tooltip" role="tooltip">
          {label}
        </span>
      </summary>
      <div className="jovlo-action-menu__content" role="menu" aria-label={label}>
        {items.map(({ label: itemLabel, icon: ItemIcon, onSelect, disabled, tone = 'default' }) => (
          <button
            key={itemLabel}
            type="button"
            className={`jovlo-action-menu__item jovlo-action-menu__item--${tone}`}
            role="menuitem"
            disabled={disabled}
            onClick={() => {
              onSelect()
              closeMenu(true)
            }}
          >
            <ItemIcon aria-hidden="true" size={18} strokeWidth={1.8} />
            <span>{itemLabel}</span>
          </button>
        ))}
      </div>
    </details>
  )
}
