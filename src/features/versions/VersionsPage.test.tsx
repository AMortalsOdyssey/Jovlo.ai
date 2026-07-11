import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useTripStore } from '@/store/useTripStore'

import { VersionsPage } from './VersionsPage'

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
})
