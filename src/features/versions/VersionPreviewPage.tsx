import { ArrowLeft, Eye, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { classifyVersionChange } from '@domain'

import { useTripStore } from '@/store/useTripStore'
import { PublicTripPage } from '@/features/share/PublicTripPage'
import { Button, EmptyState, StatusBadge } from '@/features/trips/feature-ui'

export function VersionPreviewPage() {
  const { tripId = '', versionId = '' } = useParams()
  const navigate = useNavigate()
  const state = useTripStore()
  const [confirmRestore, setConfirmRestore] = useState(false)
  const versions = useMemo(
    () => [...state.versions].sort((left, right) => right.versionNo - left.versionNo),
    [state.versions],
  )
  const version = versions.find((item) => item.id === versionId)
  const versionIndex = version ? versions.findIndex((item) => item.id === version.id) : -1
  const older = versionIndex >= 0 ? versions[versionIndex + 1] : undefined
  const current = versions[0]
  const classification = version
    ? classifyVersionChange(older?.snapshot, version.snapshot, older?.derivedSnapshot, version.derivedSnapshot)
    : null

  if (!version) {
    return (
      <div className="version-preview-empty">
        <EmptyState
          icon={Eye}
          title="找不到这个历史版本"
          description="它可能尚未同步完成，返回版本历史重新选择。"
          action={<Link className="feature-button feature-button--primary" to={`/trips/${tripId}/versions`}>返回版本历史</Link>}
        />
      </div>
    )
  }

  const restore = () => {
    state.restoreVersion(version.id)
    setConfirmRestore(false)
    navigate(`/trips/${tripId}/plan`)
  }

  return (
    <div className="version-preview-page">
      <header className="version-preview-toolbar">
        <Link to={`/trips/${tripId}/versions`} aria-label="返回版本历史"><ArrowLeft aria-hidden="true" size={19} /></Link>
        <div>
          <strong>回看 v{version.versionNo}</strong>
          <span>只读快照 · 当前仍为 v{current?.versionNo ?? version.versionNo}</span>
        </div>
        {classification ? <StatusBadge tone={classification.level === 'major' ? 'coral' : classification.level === 'baseline' ? 'sky' : 'neutral'}>{classification.label}</StatusBadge> : null}
        {version.id !== current?.id ? <Button variant="primary" icon={RotateCcw} onClick={() => setConfirmRestore(true)}>恢复为新版本</Button> : <StatusBadge tone="sea">当前版本</StatusBadge>}
      </header>

      <aside className="version-preview-note"><Eye aria-hidden="true" size={16} /><span>你正在查看固定历史快照。切换日期、打开来源和地图不会改变当前路书。</span></aside>
      <PublicTripPage snapshot={version.snapshot} derivedSnapshot={version.derivedSnapshot} />

      {confirmRestore ? (
        <div className="versions-restore-confirm" role="dialog" aria-modal="true" aria-labelledby="preview-restore-title">
          <div>
            <h2 id="preview-restore-title">恢复 v{version.versionNo}</h2>
            <p>将复制这份快照并创建 v{(current?.versionNo ?? 0) + 1}。当前 v{current?.versionNo} 和全部历史都会保留，之后仍可再次恢复。</p>
            <div className="feature-action-row"><Button onClick={() => setConfirmRestore(false)}>取消</Button><Button variant="primary" icon={RotateCcw} onClick={restore}>创建恢复版本</Button></div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default VersionPreviewPage
