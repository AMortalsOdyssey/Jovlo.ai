import { useEffect } from 'react'
import { X } from 'lucide-react'

import { IconButton } from '../../components'
import './planner.css'

export interface SnackbarProps {
  open: boolean
  message: string
  actionLabel?: string
  duration?: number
  onAction?: () => void
  onDismiss: () => void
}

export function Snackbar({
  open,
  message,
  actionLabel = '撤销',
  duration = 5000,
  onAction,
  onDismiss,
}: SnackbarProps) {
  useEffect(() => {
    if (!open || duration <= 0) return undefined

    const timeout = window.setTimeout(onDismiss, duration)
    return () => window.clearTimeout(timeout)
  }, [duration, onDismiss, open])

  if (!open) return null

  return (
    <div className="jovlo-snackbar" role="status" aria-live="polite">
      <span className="jovlo-snackbar__message">{message}</span>
      {onAction && (
        <button type="button" className="jovlo-snackbar__action" onClick={onAction}>
          {actionLabel}
        </button>
      )}
      <IconButton icon={X} label="关闭提示" onClick={onDismiss} size="compact" />
    </div>
  )
}
