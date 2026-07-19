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
    expect(screen.getByRole('link', { name: '手动创建' })).toHaveAttribute('href', '/trips/new?mode=manual')
    expect(screen.getByRole('link', { name: 'AI 协作创建' })).toHaveAttribute('href', '/trips/new?mode=agent')
    expect(screen.getByRole('link', { name: '使用教程' })).toHaveAttribute('href', '/guide/agent')
  })

  it('labels the third wizard step as template reference instead of AMap output', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><NewTripPage /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: '下一步' }))
    await user.click(screen.getByRole('button', { name: '查看草案' }))

    expect(screen.getByText('海南示例')).toBeInTheDocument()
    expect(screen.getByText(/不是高德道路算路结果/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始编辑' })).toBeEnabled()
  })

  it('keeps manual and Agent creation modes visible at the top', () => {
    render(<MemoryRouter initialEntries={['/trips/new?mode=agent']}><NewTripPage /></MemoryRouter>)

    expect(screen.getByRole('link', { name: /手动创建/ })).toHaveAttribute('href', '/trips/new?mode=manual')
    expect(screen.getByRole('link', { name: /AI 协作创建/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: '先定边界，再让 Agent 补全。' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看完整教程' })).toHaveAttribute('href', '/guide/agent')
  })
})
