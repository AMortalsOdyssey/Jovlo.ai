import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useTripStore } from '@/store/useTripStore'

import { SettingsPage } from './SettingsPage'

describe('SettingsPage', () => {
  afterEach(cleanup)
  beforeEach(() => {
    useTripStore.getState().resetDemo()
  })

  it('previews high-impact day changes before applying them', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><SettingsPage /></MemoryRouter>)

    const dayInput = screen.getByRole('spinbutton', { name: '天数' })
    await user.clear(dayInput)
    await user.type(dayInput, '4')
    await user.click(screen.getByRole('button', { name: '预览影响' }))

    expect(screen.getByText(/行程段受影响/)).toBeInTheDocument()
    expect(useTripStore.getState().trip.intent.days).not.toBe(4)

    await user.click(screen.getByRole('button', { name: '确认应用' }))
    expect(useTripStore.getState().trip.intent.days).toBe(4)
  })
})
