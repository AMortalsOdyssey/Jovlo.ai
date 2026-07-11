import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useTripStore } from '@/store/useTripStore'

import { BudgetPage } from './BudgetPage'

describe('BudgetPage', () => {
  afterEach(cleanup)
  beforeEach(() => {
    useTripStore.getState().resetDemo()
  })

  it('records a quick expense with a domain category', async () => {
    const user = userEvent.setup()
    const before = useTripStore.getState().expenses.length
    render(<MemoryRouter><BudgetPage /></MemoryRouter>)

    await user.type(screen.getByRole('spinbutton', { name: '金额' }), '88')
    await user.click(screen.getByRole('button', { name: '记入' }))

    const latest = useTripStore.getState().expenses.at(-1)
    expect(useTripStore.getState().expenses).toHaveLength(before + 1)
    expect(latest).toMatchObject({ amount: 88, category: 'meals', currency: 'CNY' })
    expect(screen.getByText('已记入草稿')).toBeInTheDocument()
  })

  it('always exposes the numeric daily table below the visual charts', () => {
    render(<MemoryRouter><BudgetPage /></MemoryRouter>)

    expect(screen.getByRole('table', { name: '每日预算与实际数值' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '计划' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '实际' })).toBeInTheDocument()
  })
})
