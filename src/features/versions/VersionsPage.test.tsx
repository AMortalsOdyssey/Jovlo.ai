import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTripStore } from '@/store/useTripStore'

import { VersionsPage } from './VersionsPage'
import { VersionPreviewPage } from './VersionPreviewPage'

vi.mock('@/features/share/PublicTripPage', () => ({
  PublicTripPage: () => <div>历史路书内容</div>,
}))

describe('VersionsPage', () => {
  afterEach(cleanup)

  beforeEach(() => {
    useTripStore.getState().resetDemo()
  })

  it('restores history by creating a new restore version', async () => {
    const user = userEvent.setup()
    const before = useTripStore.getState().versions.length
    render(<MemoryRouter><VersionsPage /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: /v1/ }))
    await user.click(screen.getByRole('button', { name: '恢复此版本' }))
    await user.click(screen.getByRole('button', { name: '创建恢复版本' }))

    const latest = useTripStore.getState().versions.reduce((best, version) =>
      version.versionNo > best.versionNo ? version : best,
    )
    expect(useTripStore.getState().versions).toHaveLength(before + 1)
    expect(latest.source).toBe('restore')
    expect(latest.message).toBe('恢复自 v1')
  })

  it('links to a dedicated read-only view and labels semantic version size', () => {
    render(<MemoryRouter><VersionsPage /></MemoryRouter>)

    expect(screen.getByRole('link', { name: '只读回看' })).toHaveAttribute('href', expect.stringMatching(/\/versions\//))
    expect(screen.getAllByText(/大版本|小版本|基线版本/).length).toBeGreaterThan(0)
  })

  it('previews without mutating current state and restores as a new latest record', async () => {
    const user = userEvent.setup()
    const beforeVersions = useTripStore.getState().versions
    const target = beforeVersions.reduce((oldest, version) => version.versionNo < oldest.versionNo ? version : oldest)
    const current = beforeVersions.reduce((latest, version) => version.versionNo > latest.versionNo ? version : latest)
    const beforeSnapshot = useTripStore.getState().trip

    render(
      <MemoryRouter initialEntries={[`/trips/${target.tripId}/versions/${target.id}`]}>
        <Routes>
          <Route path="/trips/:tripId/versions/:versionId" element={<VersionPreviewPage />} />
          <Route path="/trips/:tripId/plan" element={<div>计划页</div>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText(`回看 v${target.versionNo}`)).toBeInTheDocument()
    expect(screen.getByText('历史路书内容')).toBeInTheDocument()
    expect(useTripStore.getState().trip).toEqual(beforeSnapshot)

    await user.click(screen.getByRole('button', { name: '恢复为新版本' }))
    await user.click(screen.getByRole('button', { name: '创建恢复版本' }))

    const afterVersions = useTripStore.getState().versions
    const latest = afterVersions.reduce((best, version) => version.versionNo > best.versionNo ? version : best)
    expect(afterVersions).toHaveLength(beforeVersions.length + 1)
    expect(afterVersions.some((version) => version.id === current.id)).toBe(true)
    expect(latest).toMatchObject({ source: 'restore', parentVersionId: current.id })
  })
})
