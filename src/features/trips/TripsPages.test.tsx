import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useTripStore } from '@/store/useTripStore'

import { NewTripPage } from './NewTripPage'
import { TripsPage } from './TripsPage'

describe('trip entry pages', () => {
  afterEach(cleanup)
  beforeEach(() => {
    useTripStore.getState().resetDemo()
  })

  it('renders the current trip with usable planning links', () => {
    render(<MemoryRouter><TripsPage /></MemoryRouter>)

    expect(screen.getByRole('heading', { name: useTripStore.getState().trip.title })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '继续规划' })).toHaveAttribute(
      'href',
      `/trips/${useTripStore.getState().trip.tripId}/plan`,
    )
    expect(screen.getByRole('link', { name: /新建路书/ })).toHaveAttribute('href', '/trips/new')
  })

  it('labels the third wizard step as template reference instead of AMap output', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><NewTripPage /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: '下一步' }))
    await user.click(screen.getByRole('button', { name: '查看草案' }))

    expect(screen.getByText('模板参考')).toBeInTheDocument()
    expect(screen.getByText(/不是高德道路算路结果/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始编辑' })).toBeEnabled()
  })
})
