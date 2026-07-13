import { useEffect, useState } from 'react'
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
  const [rendered, setRendered] = useState(open)

  useEffect(() => {
    if (!open || duration <= 0) return undefined

    const timeout = window.setTimeout(onDismiss, duration)
    return () => window.clearTimeout(timeout)
  }, [duration, onDismiss, open])

  // 关闭时先播 160ms 退场动画，再真正卸载，避免瞬间蒸发
  useEffect(() => {
    if (open) {
      setRendered(true)
      return undefined
    }
    if (!rendered) return undefined
    const timeout = window.setTimeout(() => setRendered(false), 180)
    return () => window.clearTimeout(timeout)
  }, [open, rendered])

  if (!open && !rendered) return null

  return (
    <div
      className={open ? 'jovlo-snackbar' : 'jovlo-snackbar jovlo-snackbar--closing'}
      role="status"
      aria-live="polite"
    >
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
