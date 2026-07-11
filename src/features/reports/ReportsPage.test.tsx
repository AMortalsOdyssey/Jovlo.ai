import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useTripStore } from '@/store/useTripStore'

import { ReportsPage } from './ReportsPage'

describe('ReportsPage', () => {
  afterEach(cleanup)
  beforeEach(() => {
    useTripStore.getState().resetDemo()
  })

  it('creates another actual report without replacing history', async () => {
    const user = userEvent.setup()
    const before = useTripStore.getState().reports.length
    render(<MemoryRouter><ReportsPage /></MemoryRouter>)

    await user.click(screen.getByRole('radio', { name: '实际报告' }))
    await user.click(screen.getByRole('button', { name: '生成实际报告' }))

    expect(useTripStore.getState().reports).toHaveLength(before + 1)
    expect(useTripStore.getState().reports.at(-1)?.type).toBe('actual')
    expect(screen.getByText(`${before + 1} 次生成`)).toBeInTheDocument()
  })

  it('keeps plan and actual report language distinct', () => {
    render(<MemoryRouter><ReportsPage /></MemoryRouter>)

    expect(screen.getByText(/计划报告只使用发布版本与估算/)).toBeInTheDocument()
    expect(screen.getAllByText(/计划报告第/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/实际报告第/).length).toBeGreaterThan(0)
  })
})
