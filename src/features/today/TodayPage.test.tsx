import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useTripStore } from '@/store/useTripStore'

import { TodayPage } from './TodayPage'

describe('TodayPage', () => {
  afterEach(cleanup)

  beforeEach(() => {
    useTripStore.getState().resetDemo()
  })

  it('delays the current day in the draft without publishing a version', async () => {
    const user = userEvent.setup()
    const beforeStart = useTripStore.getState().trip.days[0].startTime
    const beforeVersions = useTripStore.getState().versions.length
    render(<MemoryRouter><TodayPage /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: '延后' }))
    await user.click(screen.getByRole('button', { name: '15 分钟' }))

    expect(useTripStore.getState().trip.days[0].startTime).not.toBe(beforeStart)
    expect(useTripStore.getState().versions).toHaveLength(beforeVersions)
    expect(useTripStore.getState().dirty).toBe(true)
  })

  it('offers an AMap URI for the next stop when coordinates exist', () => {
    render(<MemoryRouter><TodayPage /></MemoryRouter>)

    expect(screen.getByRole('link', { name: '高德导航' })).toHaveAttribute(
      'href',
      expect.stringContaining('https://uri.amap.com/navigation'),
    )
  })
})
