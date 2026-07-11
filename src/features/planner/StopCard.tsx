import {
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  CalendarArrowDown,
  Clock3,
  Edit3,
  Hourglass,
  SkipForward,
  Trash2,
} from 'lucide-react'

import { ActionMenu, type ActionMenuItem } from '../../components'
import type { EvidenceTone } from './types'
import './planner.css'

const TAG_LABELS: Record<string, string> = {
  attraction: '景点',
  museum: '博物馆',
  hotel: '住宿',
  meal: '餐饮',
  food: '餐饮',
  shopping: '购物',
  transport: '交通',
  locked: '已锁定',
}

export interface StopCardActions {
  onEdit: () => void
  onReplace: () => void
  onMoveEarlier: () => void
  onMoveLater: () => void
  onMoveToDay: () => void
  onSkip: () => void
  onDelete: () => void
}

export interface StopCardProps {
  order: number
  name: string
  plannedTime: string
  duration: string
  evidenceLabel: string
  evidenceTone: EvidenceTone
  tags?: string[]
  selected?: boolean
  actions?: StopCardActions
  onSelect?: () => void
}

export function StopCard({
  order,
  name,
  plannedTime,
  duration,
  evidenceLabel,
  evidenceTone,
  tags = [],
  selected = false,
  actions,
  onSelect,
}: StopCardProps) {
  const visibleTags = [...new Set(tags.map((tag) => TAG_LABELS[tag] ?? tag))].slice(0, 2)
  const menuItems: ActionMenuItem[] = actions
    ? [
        { label: '编辑', icon: Edit3, onSelect: actions.onEdit },
        { label: '替换地点', icon: ArrowRightLeft, onSelect: actions.onReplace },
        { label: '提前一站', icon: ArrowUp, onSelect: actions.onMoveEarlier },
        { label: '延后一站', icon: ArrowDown, onSelect: actions.onMoveLater },
        { label: '移到其他日期', icon: CalendarArrowDown, onSelect: actions.onMoveToDay },
        { label: '今天跳过', icon: SkipForward, onSelect: actions.onSkip },
        { label: '删除', icon: Trash2, onSelect: actions.onDelete, tone: 'danger' },
      ]
    : []

  return (
    <div className="jovlo-stop-node" data-selected={selected || undefined} role="listitem">
      <span className="jovlo-stop-node__marker jovlo-numeric" aria-hidden="true">
        {order}
      </span>
      <article className="jovlo-stop-card" data-selected={selected || undefined}>
        <div className="jovlo-stop-card__topline">
          <button
            type="button"
            className="jovlo-stop-card__select"
            aria-label={`选择第 ${order} 站：${name}`}
            aria-pressed={selected}
            onClick={onSelect}
            disabled={!onSelect}
          >
            <strong className="jovlo-stop-card__name">{name}</strong>
            <span className="jovlo-stop-card__time jovlo-numeric">
              <span title="到达时间"><Clock3 aria-hidden="true" size={14} />{plannedTime}</span>
              <span title="停留时长"><Hourglass aria-hidden="true" size={14} />{duration}</span>
            </span>
            <span className="jovlo-stop-card__summary">
              <span className={`jovlo-evidence jovlo-evidence--${evidenceTone}`}>{evidenceLabel}</span>
              {!!visibleTags.length && <span className="jovlo-stop-card__tags">{visibleTags.join(' · ')}</span>}
            </span>
          </button>
          {actions && <ActionMenu label={`${name} 的更多操作`} items={menuItems} />}
        </div>

        {selected && actions && (
          <div className="jovlo-stop-card__actions" aria-label={`${name} 的快捷操作`}>
            <button type="button" onClick={actions.onEdit}>
              <Edit3 aria-hidden="true" size={16} />
              编辑
            </button>
            <button type="button" onClick={actions.onReplace}>
              <ArrowRightLeft aria-hidden="true" size={16} />
              替换
            </button>
            <button type="button" onClick={actions.onMoveToDay}>
              <CalendarArrowDown aria-hidden="true" size={16} />
              移动
            </button>
            <button type="button" className="jovlo-stop-card__delete" onClick={actions.onDelete}>
              <Trash2 aria-hidden="true" size={16} />
              删除
            </button>
          </div>
        )}
      </article>
    </div>
  )
}
