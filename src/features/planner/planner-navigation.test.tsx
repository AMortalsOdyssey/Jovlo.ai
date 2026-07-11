import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DayRail } from './DayRail'
import { EmptyState } from './EmptyState'
import { MobileDayStrip } from './MobileDayStrip'
import { MobileNav } from './MobileNav'
import { PlannerWorkspace } from './PlannerWorkspace'
import { TripHeader } from './TripHeader'
import type { DaySummary } from './types'

afterEach(cleanup)

const DAYS: DaySummary[] = [
  { id: 'd1', dayNumber: 1, area: '海口', hotel: '骑楼酒店', driveDuration: '1h20' },
  { id: 'd2', dayNumber: 2, area: '一个非常长的万宁城市区域名称', driveDuration: '2h35', riskCount: 2 },
]

describe('planner navigation components', () => {
  it('keeps the trip title, version, save status and commands in the header', async () => {
    const user = userEvent.setup()
    const onSaveVersion = vi.fn()
    const onRetrySave = vi.fn()
    const { rerender } = render(
      <TripHeader
        title="海南环岛自驾"
        version={12}
        saveStatus="saved"
        onSaveVersion={onSaveVersion}
      />,
    )

    expect(screen.getByText('海南环岛自驾')).toBeInTheDocument()
    expect(screen.getByText('v12')).toBeInTheDocument()
    expect(screen.getByText('已保存')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '保存版本' }))
    expect(onSaveVersion).toHaveBeenCalledOnce()

    rerender(
      <TripHeader
        title="海南环岛自驾"
        version={12}
        saveStatus="error"
        onRetrySave={onRetrySave}
      />,
    )
    await user.click(screen.getByRole('button', { name: /未保存，点击重试/ }))
    expect(onRetrySave).toHaveBeenCalledOnce()
  })

  it('offers equivalent desktop and compact day selection callbacks', async () => {
    const user = userEvent.setup()
    const onSelectDay = vi.fn()
    const { rerender } = render(
      <DayRail days={DAYS} selectedDayId="d1" onSelectDay={onSelectDay} />,
    )

    await user.click(screen.getByRole('button', { name: /Day 2/ }))
    expect(onSelectDay).toHaveBeenLastCalledWith('d2')

    rerender(<MobileDayStrip days={DAYS} selectedDayId="d2" onSelectDay={onSelectDay} />)
    expect(screen.getByRole('button', { name: 'Day 2，一个非常长的万宁城市区域名称' })).toHaveAttribute(
      'aria-current',
      'date',
    )
    await user.click(screen.getByRole('button', { name: 'Day 1，海口' }))
    expect(onSelectDay).toHaveBeenLastCalledWith('d1')
  })

  it('switches the first mobile navigation label to Today during travel', async () => {
    const user = userEvent.setup()
    const onSelectView = vi.fn()
    render(<MobileNav activeView="plan" isTravelingToday onSelectView={onSelectView} />)

    expect(screen.getByRole('button', { name: '今日' })).toHaveAttribute('aria-current', 'page')
    await user.click(screen.getByRole('button', { name: '地图' }))
    expect(onSelectView).toHaveBeenCalledWith('map')
  })

  it('exposes one controlled mobile view on the workspace shell', () => {
    const { container } = render(
      <PlannerWorkspace
        header={<div>header</div>}
        dayRail={<div>rail</div>}
        dayStrip={<div>strip</div>}
        timeline={<div>timeline</div>}
        map={<div>map</div>}
        budget={<div>budget</div>}
        more={<div>more</div>}
        mobileNav={<div>nav</div>}
        activeMobileView="budget"
      />,
    )

    expect(container.firstElementChild).toHaveAttribute('data-mobile-view', 'budget')
  })

  it('keeps empty states concise and actionable', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    render(<EmptyState message="这一天还是空的" actionLabel="从待安排添加" onAction={onAction} />)

    expect(screen.getByText('这一天还是空的')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '从待安排添加' }))
    expect(onAction).toHaveBeenCalledOnce()
  })
})
