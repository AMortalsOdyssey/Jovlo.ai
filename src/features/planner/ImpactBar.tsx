import { Check, Info, X } from 'lucide-react'

import './planner.css'

export interface ImpactBarProps {
  delayMinutes: number
  affectedPlaces: number
  budgetDelta?: number
  visible?: boolean
  onViewDetails: () => void
  onApply: () => void
  onDiscard: () => void
}

function formatBudgetDelta(value: number) {
  const absolute = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(Math.abs(value))
  return `${value >= 0 ? '+' : '-'}¥${absolute}`
}

export function ImpactBar({
  delayMinutes,
  affectedPlaces,
  budgetDelta,
  visible = true,
  onViewDetails,
  onApply,
  onDiscard,
}: ImpactBarProps) {
  if (!visible) return null

  const timing = delayMinutes >= 0 ? `预计晚 ${delayMinutes} 分钟` : `预计早 ${Math.abs(delayMinutes)} 分钟`
  const budget = budgetDelta === undefined ? '' : ` · ${formatBudgetDelta(budgetDelta)}`
  const summary = `${timing} · ${affectedPlaces} 个地点受影响${budget}`
  const compactSummary = `${delayMinutes >= 0 ? '晚' : '早'} ${Math.abs(delayMinutes)} 分 · ${affectedPlaces} 处${budget}`

  return (
    <section className="jovlo-impact-bar" aria-label={`操作影响：${summary}`}>
      <p className="jovlo-impact-bar__summary jovlo-numeric">
        <span className="jovlo-impact-bar__summary-full">{summary}</span>
        <span className="jovlo-impact-bar__summary-compact" aria-hidden="true">
          {compactSummary}
        </span>
      </p>
      <div className="jovlo-impact-bar__actions">
        <button type="button" className="jovlo-impact-bar__action" onClick={onViewDetails} aria-label="查看影响详情">
          <Info aria-hidden="true" size={18} />
          <span>查看详情</span>
        </button>
        <button type="button" className="jovlo-impact-bar__action jovlo-impact-bar__action--apply" onClick={onApply}>
          <Check aria-hidden="true" size={18} />
          <span>应用</span>
        </button>
        <button type="button" className="jovlo-impact-bar__action" onClick={onDiscard} aria-label="放弃本次更改">
          <X aria-hidden="true" size={18} />
          <span>放弃</span>
        </button>
      </div>
    </section>
  )
}
