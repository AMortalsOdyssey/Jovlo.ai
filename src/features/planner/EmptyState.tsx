import { MapPinned, type LucideIcon } from 'lucide-react'

import './planner.css'

export interface EmptyStateProps {
  message: string
  actionLabel: string
  onAction: () => void
  icon?: LucideIcon
  secondaryActionLabel?: string
  onSecondaryAction?: () => void
}

export function EmptyState({
  message,
  actionLabel,
  onAction,
  icon: Icon = MapPinned,
  secondaryActionLabel,
  onSecondaryAction,
}: EmptyStateProps) {
  return (
    <section className="jovlo-empty-state" aria-label={message}>
      <Icon className="jovlo-empty-state__icon" aria-hidden="true" size={64} strokeWidth={1.4} />
      <p>{message}</p>
      <div className="jovlo-empty-state__actions">
        <button type="button" className="jovlo-button jovlo-button--primary" onClick={onAction}>
          {actionLabel}
        </button>
        {secondaryActionLabel && onSecondaryAction && (
          <button type="button" className="jovlo-button jovlo-button--secondary" onClick={onSecondaryAction}>
            {secondaryActionLabel}
          </button>
        )}
      </div>
    </section>
  )
}
