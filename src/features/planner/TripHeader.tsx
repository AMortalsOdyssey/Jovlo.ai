import {
  ArrowLeft,
  Check,
  CircleAlert,
  Clock3,
  Download,
  History,
  LoaderCircle,
  MoreHorizontal,
  RefreshCcw,
  Save,
  Share2,
} from 'lucide-react'

import { ActionMenu, HoverTooltip, IconButton, type ActionMenuItem } from '../../components'
import type { SaveStatus } from './types'
import './planner.css'

export interface TripHeaderProps {
  title: string
  version: number | string
  saveStatus: SaveStatus
  logoSrc?: string
  onBack?: () => void
  onImport?: () => void
  onHistory?: () => void
  onShare?: () => void
  onSaveVersion?: () => void
  onRetrySave?: () => void
}

const SAVE_STATUS = {
  saving: { label: '保存中…', icon: LoaderCircle },
  saved: { label: '已保存', icon: Check },
  error: { label: '未保存，点击重试', icon: CircleAlert },
  'pending-review': { label: '有待审变更', icon: Clock3 },
  stale: { label: '版本已过期', icon: RefreshCcw },
} satisfies Record<SaveStatus, { label: string; icon: typeof Check }>

export function TripHeader({
  title,
  version,
  saveStatus,
  logoSrc = '/jovlo-mark.svg',
  onBack,
  onImport,
  onHistory,
  onShare,
  onSaveVersion,
  onRetrySave,
}: TripHeaderProps) {
  const status = SAVE_STATUS[saveStatus]
  const StatusIcon = status.icon
  const mobileItems: ActionMenuItem[] = [
    { label: '导入', icon: Download, onSelect: () => onImport?.(), disabled: !onImport },
    { label: '版本历史', icon: History, onSelect: () => onHistory?.(), disabled: !onHistory },
    { label: '分享', icon: Share2, onSelect: () => onShare?.(), disabled: !onShare },
  ]

  const statusContent = (
    <>
      <StatusIcon
        aria-hidden="true"
        className={saveStatus === 'saving' ? 'jovlo-trip-header__status-spinner' : undefined}
        size={16}
        strokeWidth={2}
      />
      <span>{status.label}</span>
    </>
  )

  return (
    <header className="jovlo-trip-header">
      <div className="jovlo-trip-header__identity">
        <IconButton icon={ArrowLeft} label="返回路书列表" onClick={onBack} disabled={!onBack} />
        <span className="jovlo-trip-header__brand" aria-label="Jovlo">
          <img src={logoSrc} alt="" />
        </span>
        <span className="jovlo-trip-header__trip">
          <strong>{title}</strong>
          <span className="jovlo-trip-header__version jovlo-numeric">v{version}</span>
        </span>
      </div>

      <div className="jovlo-trip-header__commands">
        <HoverTooltip label={status.label}>
          {saveStatus === 'error' && onRetrySave ? (
            <button
              type="button"
              className={`jovlo-trip-header__status jovlo-trip-header__status--${saveStatus}`}
              onClick={onRetrySave}
              aria-label={status.label}
              aria-live="polite"
            >
              {statusContent}
            </button>
          ) : (
            <span
              className={`jovlo-trip-header__status jovlo-trip-header__status--${saveStatus}`}
              aria-label={status.label}
              aria-live={saveStatus === 'error' || saveStatus === 'stale' ? 'assertive' : 'polite'}
            >
              {statusContent}
            </span>
          )}
        </HoverTooltip>

        <span className="jovlo-trip-header__desktop-actions">
          <IconButton icon={Download} label="导入变更" onClick={onImport} disabled={!onImport} />
          <IconButton icon={History} label="版本历史" onClick={onHistory} disabled={!onHistory} />
          <IconButton icon={Share2} label="分享路书" onClick={onShare} disabled={!onShare} />
        </span>

        <button
          type="button"
          className="jovlo-button jovlo-button--primary jovlo-trip-header__save"
          onClick={onSaveVersion}
          disabled={!onSaveVersion}
        >
          <Save aria-hidden="true" size={18} strokeWidth={1.8} />
          <span>保存版本</span>
        </button>

        <span className="jovlo-trip-header__mobile-more">
          <ActionMenu label="更多命令" icon={MoreHorizontal} items={mobileItems} />
        </span>
      </div>
    </header>
  )
}
