import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AppProviders } from '@/app/providers'
import { useTripStore } from '@/store/useTripStore'

import { PublicReportPage } from './PublicReportPage'
import { PublicTripPage } from './PublicTripPage'

describe('public pages', () => {
  afterEach(cleanup)
  beforeEach(() => {
    useTripStore.getState().resetDemo()
  })

  it('renders the shared itinerary as a read-only fixed route spine', async () => {
    const user = userEvent.setup()
    useTripStore.getState().prepareDemoChangeSet()
    useTripStore.getState().applyDemoChangeSet()
    render(<AppProviders><MemoryRouter initialEntries={['/s/jovlo-demo-trip']}><Routes><Route path="/s/:token" element={<PublicTripPage />} /></Routes></MemoryRouter></AppProviders>)

    expect(screen.getByRole('heading', { name: useTripStore.getState().trip.title })).toBeInTheDocument()
    expect(screen.getByLabelText(/路线概览/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Day 4/ }))
    expect(screen.getByText('宿 · 石梅湾舒适型酒店示例')).toBeInTheDocument()
    expect(screen.queryByText('宿 · 日月湾住宿锚点区')).not.toBeInTheDocument()
    expect(screen.getAllByText('日期已隐藏').length).toBeGreaterThan(0)
    expect(screen.getByText('用 Jovlo 制作')).toBeInTheDocument()
    expect(screen.queryByText('保存版本')).not.toBeInTheDocument()
    expect(screen.queryByText('继续规划')).not.toBeInTheDocument()
  })

  it('opens a fixed report generation without edit controls', () => {
    const report = useTripStore.getState().reports[0]
    render(<AppProviders><MemoryRouter initialEntries={[`/r/${report.id}`]}><Routes><Route path="/r/:token" element={<PublicReportPage />} /></Routes></MemoryRouter></AppProviders>)

    expect(screen.getByText(/计划旅行报告|计划路书报告/)).toBeInTheDocument()
    expect(screen.getByText(/固定快照/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /生成|保存|编辑/ })).not.toBeInTheDocument()
  })

  it('freezes expenses and actual records for every generated report', () => {
    const report = useTripStore.getState().generateReport('actual')
    const before = useTripStore.getState().reportSnapshots[report.id]
    const beforeTotal = before.expenses.reduce((sum, expense) => sum + expense.amount, 0)

    useTripStore.getState().addExpense({
      tripId: useTripStore.getState().trip.tripId,
      dayId: useTripStore.getState().trip.days[0].id,
      category: 'meals',
      amount: 999,
      currency: 'CNY',
      occurredOn: '2026-08-10',
    })

    const frozen = useTripStore.getState().reportSnapshots[report.id]
    expect(frozen.expenses.reduce((sum, expense) => sum + expense.amount, 0)).toBe(beforeTotal)
    expect(frozen.actuals).toEqual(before.actuals)
  })
})
