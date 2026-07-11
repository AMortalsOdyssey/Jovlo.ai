import { useId, type ButtonHTMLAttributes } from 'react'
import type { LucideIcon } from 'lucide-react'

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
  const tooltipId = useId()

  return (
    <span className={`jovlo-tooltip-root ${className}`.trim()}>
      <button
        {...buttonProps}
        type={type}
        className={`jovlo-icon-button jovlo-icon-button--${size}`}
        aria-label={label}
        aria-describedby={tooltipId}
        title={label}
      >
        <Icon aria-hidden="true" size={20} strokeWidth={1.8} />
      </button>
      <span id={tooltipId} className="jovlo-tooltip" role="tooltip">
        {label}
      </span>
    </span>
  )
}
