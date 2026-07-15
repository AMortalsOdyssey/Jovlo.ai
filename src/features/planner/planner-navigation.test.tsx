import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DayRail } from './DayRail'
import { EmptyState } from './EmptyState'
import { MobileDayStrip } from './MobileDayStrip'
import { MobileNav } from './MobileNav'
import { PlannerWorkspace } from './PlannerWorkspace'
import { TripHeader } from './TripHeader'
import { TripOverview } from './TripOverview'
import type { DaySummary } from './types'

afterEach(cleanup)

const DAYS: DaySummary[] = [
  { id: 'd1', dayNumber: 1, area: '海口', hotel: '骑楼酒店', driveDuration: '1h20' },
  { id: 'd2', dayNumber: 2, area: '一个非常长的万宁城市区域名称', driveDuration: '2h35', riskCount: 2 },
]

describe('planner navigation components', () => {
  it('keeps the trip title, version, save status and commands in the header', async () => {
    const user = userEvent.setup()
    const onDownload = vi.fn()
    const onAgent = vi.fn()
    const onRetrySave = vi.fn()
    const { rerender } = render(
      <TripHeader
        title="海南环岛自驾"
        version={12}
        saveStatus="saved"
        onDownload={onDownload}
        onAgent={onAgent}
      />,
    )

    expect(screen.getByText('海南环岛自驾')).toBeInTheDocument()
    expect(screen.getByText('v12')).toBeInTheDocument()
    expect(screen.getByText('已保存')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存版本' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '下载 PDF' }))
    expect(onDownload).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Agent 协作' }))
    expect(onAgent).toHaveBeenCalledOnce()

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
    const onSelectOverview = vi.fn()
    const { rerender } = render(
      <DayRail days={DAYS} selectedDayId="d1" onSelectDay={onSelectDay} />,
    )

    await user.click(screen.getByRole('button', { name: /Day 2/ }))
    expect(onSelectDay).toHaveBeenLastCalledWith('d2')

    rerender(
      <MobileDayStrip
        days={DAYS}
        selectedDayId="d2"
        onSelectDay={onSelectDay}
        onSelectOverview={onSelectOverview}
      />,
    )
    expect(screen.getByRole('navigation', { name: '选择行程日期' })).toHaveAttribute('data-layout', 'full')
    await user.click(screen.getByRole('button', { name: '全程总览' }))
    expect(onSelectOverview).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Day 2，一个非常长的万宁城市区域名称' })).toHaveAttribute(
      'aria-current',
      'date',
    )
    await user.click(screen.getByRole('button', { name: 'Day 1，海口' }))
    expect(onSelectDay).toHaveBeenLastCalledWith('d1')
  })

  it('uses focus expansion for long itineraries without removing full accessible labels', () => {
    const manyDays = Array.from({ length: 12 }, (_, index) => ({
      id: `d${index + 1}`,
      dayNumber: index + 1,
      area: index === 8 ? '一个非常长但必须完整展示的住宿区域名称' : `第 ${index + 1} 站`,
      driveDuration: '1h',
    }))
    render(<MobileDayStrip days={manyDays} selectedDayId="d9" onSelectDay={vi.fn()} onSelectOverview={vi.fn()} />)

    const navigation = screen.getByRole('navigation', { name: '选择行程日期' })
    expect(navigation).toHaveAttribute('data-layout', 'focus')
    expect(screen.getByRole('button', { name: 'Day 9，一个非常长但必须完整展示的住宿区域名称' })).toHaveAttribute(
      'data-expanded',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Day 1，第 1 站' })).not.toHaveAttribute('data-expanded')
  })

  it('keeps a short three-day itinerary in the complete-label layout', () => {
    const threeDays = [
      { id: 'd1', dayNumber: 1, area: '海口', driveDuration: '1h' },
      { id: 'd2', dayNumber: 2, area: '文昌', driveDuration: '1h' },
      { id: 'd3', dayNumber: 3, area: '博鳌', driveDuration: '1h' },
    ]
    render(<MobileDayStrip days={threeDays} selectedDayId="d2" onSelectDay={vi.fn()} onSelectOverview={vi.fn()} />)

    expect(screen.getByRole('navigation', { name: '选择行程日期' })).toHaveAttribute('data-layout', 'full')
    expect(screen.getByRole('button', { name: 'Day 1，海口' })).toHaveTextContent('D1海口')
    expect(screen.getByRole('button', { name: 'Day 2，文昌' })).toHaveTextContent('D2文昌')
    expect(screen.getByRole('button', { name: 'Day 3，博鳌' })).toHaveTextContent('D3博鳌')
  })

  it('shows complete trip metrics and opens a selected day from overview', async () => {
    const user = userEvent.setup()
    const onSelectDay = vi.fn()
    render(
      <TripOverview
        days={DAYS.map((day) => ({ ...day, date: '2026-08-10', stopCount: 3 }))}
        totalDistance="487 km"
        totalDriving="10h 12m"
        totalBudget="¥6,432"
        totalStops={6}
        onSelectDay={onSelectDay}
      />,
    )

    expect(screen.getByRole('heading', { name: '全程总览' })).toBeInTheDocument()
    expect(screen.getByText('487 km')).toBeInTheDocument()
    expect(screen.getByText('10h 12m')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '打开 Day 2，一个非常长的万宁城市区域名称' }))
    expect(onSelectDay).toHaveBeenCalledWith('d2')
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
        mobileMapCollapsed
      />,
    )

    expect(container.firstElementChild).toHaveAttribute('data-mobile-view', 'budget')
    expect(container.firstElementChild).toHaveAttribute('data-mobile-map', 'collapsed')
    expect(container.querySelector('.jovlo-planner-workspace__map')).toBeInTheDocument()
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
