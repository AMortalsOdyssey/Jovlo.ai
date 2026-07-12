import type { ButtonHTMLAttributes } from 'react'
import type { LucideIcon } from 'lucide-react'

import { HoverTooltip } from './HoverTooltip'
import './ui.css'

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  icon: LucideIcon
  label: string
  size?: 'default' | 'compact'
}

export function IconButton({
  icon: Icon,
  label,
  size = 'default',
  className = '',
  type = 'button',
  ...buttonProps
}: IconButtonProps) {
  return (
    <span className={`jovlo-tooltip-root ${className}`.trim()}>
      <HoverTooltip label={label}>
        <button
          {...buttonProps}
          type={type}
          className={`jovlo-icon-button jovlo-icon-button--${size}`}
          aria-label={label}
        >
          <Icon aria-hidden="true" size={20} strokeWidth={1.8} />
        </button>
      </HoverTooltip>
    </span>
  )
}
