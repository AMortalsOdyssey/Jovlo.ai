import { format, parseISO } from 'date-fns'

const currency = new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY',
  maximumFractionDigits: 0,
})

const integer = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 })

export function formatCurrency(value: number): string {
  return currency.format(value)
}

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return '待计算'
  if (meters < 1000) return `${integer.format(meters)} m`
  const km = meters / 1000
  return `${km >= 100 ? integer.format(km) : km.toFixed(1)} km`
}

export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes)) return '待计算'
  const hours = Math.floor(minutes / 60)
  const rest = Math.round(minutes % 60)
  if (!hours) return `${rest} min`
  if (!rest) return `${hours}h`
  return `${hours}h ${rest}m`
}

export function formatDayDate(date?: string): string {
  if (!date) return '日期待定'
  try {
    return format(parseISO(date), 'M月d日')
  } catch {
    return date
  }
}

export function formatTime(value?: string): string {
  if (!value) return '--:--'
  if (/^\d{2}:\d{2}$/.test(value)) return value
  try {
    return format(parseISO(value), 'HH:mm')
  } catch {
    return value.slice(0, 5)
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
