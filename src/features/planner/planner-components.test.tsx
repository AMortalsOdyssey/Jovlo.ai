import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DayHealthBar } from './DayHealthBar'
import { DayWeatherStrip } from './DayWeatherStrip'
import { HotelAnchor } from './HotelAnchor'
import { ImpactBar } from './ImpactBar'
import { LegRow } from './LegRow'
import { PlaceInspector } from './PlaceInspector'
import { Snackbar } from './Snackbar'
import { StopCard, type StopCardActions } from './StopCard'

afterEach(cleanup)

describe('planner editing components', () => {
  it('exposes every StopCard edit path without requiring drag gestures', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const actions: StopCardActions = {
      onEdit: vi.fn(),
      onReplace: vi.fn(),
      onMoveEarlier: vi.fn(),
      onMoveLater: vi.fn(),
      onMoveToDay: vi.fn(),
      onSkip: vi.fn(),
      onDelete: vi.fn(),
    }

    render(
      <StopCard
        order={1}
        name="日月湾"
        plannedTime="10:20–12:50"
        duration="2h30"
        evidenceLabel="多源一致"
        evidenceTone="consistent"
        tags={['冲浪', '海滩']}
        selected
        actions={actions}
        onSelect={onSelect}
      />,
    )

    await user.click(screen.getByRole('button', { name: '选择第 1 站：日月湾' }))
    expect(onSelect).toHaveBeenCalledOnce()

    const quickActions = within(screen.getByLabelText('日月湾 的快捷操作'))
    await user.click(quickActions.getByRole('button', { name: '编辑' }))
    await user.click(quickActions.getByRole('button', { name: '替换' }))
    await user.click(quickActions.getByRole('button', { name: '移动' }))
    await user.click(quickActions.getByRole('button', { name: '删除' }))

    expect(actions.onEdit).toHaveBeenCalledOnce()
    expect(actions.onReplace).toHaveBeenCalledOnce()
    expect(actions.onMoveToDay).toHaveBeenCalledOnce()
    expect(actions.onDelete).toHaveBeenCalledOnce()

    const menuTrigger = screen.getByRole('button', { name: '日月湾 的更多操作' })
    await user.click(menuTrigger)
    await user.click(screen.getByRole('menuitem', { name: '提前一站' }))
    await user.click(menuTrigger)
    await user.click(screen.getByRole('menuitem', { name: '延后一站' }))
    await user.click(menuTrigger)
    await user.click(screen.getByRole('menuitem', { name: '今天跳过' }))

    expect(actions.onMoveEarlier).toHaveBeenCalledOnce()
    expect(actions.onMoveLater).toHaveBeenCalledOnce()
    expect(actions.onSkip).toHaveBeenCalledOnce()
  })

  it('keeps route calculation and health conclusion states explicit', () => {
    const { rerender } = render(<LegRow status="error" />)
    expect(screen.getByText('无法算路')).toBeInTheDocument()
    expect(screen.queryByText(/0 km/)).not.toBeInTheDocument()

    rerender(
      <DayHealthBar
        metrics={{ driving: '2h35', playing: '6h', buffer: '45m', budget: '¥980' }}
        status="tight"
        loading
      />,
    )
    expect(screen.getByText('重算中')).toBeInTheDocument()
    expect(screen.queryByText('偏紧')).not.toBeInTheDocument()
  })

  it('shows weather for the matching day and keeps long-range forecasts honest', () => {
    const { rerender } = render(
      <DayWeatherStrip
        date="2026-07-13"
        placeName="文昌龙楼住宿区"
        weather={{
          status: 'forecast',
          date: '2026-07-13',
          provider: 'amap',
          location: { name: '文昌市', adcode: '469005' },
          forecast: {
            dayWeather: '雷阵雨',
            nightWeather: '多云',
            dayTempC: 32,
            nightTempC: 26,
            dayWind: '东南',
            nightWind: '东南',
            dayPower: '3',
            nightPower: '3',
          },
          fetchedAt: '2026-07-12T03:00:00.000Z',
          nextRefreshAt: '2026-07-12T09:00:00.000Z',
        }}
      />,
    )

    expect(screen.getByLabelText('文昌龙楼住宿区 2026-07-13 天气：雷阵雨转多云')).toBeInTheDocument()
    expect(screen.getByLabelText('最低 26 度，最高 32 度')).toBeInTheDocument()
    expect(screen.getByText('带伞')).toBeInTheDocument()

    rerender(
      <DayWeatherStrip
        date="2026-08-11"
        placeName="文昌龙楼住宿区"
        weather={{
          status: 'outside-window',
          date: '2026-08-11',
          provider: 'amap',
          location: { name: '当前地点' },
          notice: '距出发 30 天，临近出发 3 天自动更新',
          fetchedAt: '2026-07-12T03:00:00.000Z',
          nextRefreshAt: '2026-07-12T09:00:00.000Z',
        }}
      />,
    )
    expect(screen.getByText('距出发 30 天，临近出发 3 天自动更新')).toBeInTheDocument()
    expect(screen.queryByText('32°')).not.toBeInTheDocument()
  })

  it('renders place and area hotel anchors as different decisions', async () => {
    const user = userEvent.setup()
    const onChooseHotel = vi.fn()
    const { rerender } = render(
      <HotelAnchor kind="area" name="万宁一带" onChooseHotel={onChooseHotel} />,
    )

    expect(screen.getByText('宿·万宁一带 未定')).toBeInTheDocument()
    expect(screen.getByText('相关路段按区域中心预估')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '选酒店' }))
    expect(onChooseHotel).toHaveBeenCalledOnce()

    rerender(<HotelAnchor kind="place" name="石梅湾酒店" onChangeHotel={vi.fn()} />)
    expect(screen.getByText('石梅湾酒店')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '换酒店' })).toBeEnabled()
  })

  it('requires an explicit choice for significant impact', async () => {
    const user = userEvent.setup()
    const onViewDetails = vi.fn()
    const onApply = vi.fn()
    const onDiscard = vi.fn()

    render(
      <ImpactBar
        delayMinutes={35}
        affectedPlaces={2}
        budgetDelta={160}
        onViewDetails={onViewDetails}
        onApply={onApply}
        onDiscard={onDiscard}
      />,
    )

    expect(screen.getByText('预计晚 35 分钟 · 2 个地点受影响 · +¥160')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '查看影响详情' }))
    await user.click(screen.getByRole('button', { name: '应用' }))
    await user.click(screen.getByRole('button', { name: '放弃本次更改' }))
    expect(onViewDetails).toHaveBeenCalledOnce()
    expect(onApply).toHaveBeenCalledOnce()
    expect(onDiscard).toHaveBeenCalledOnce()
  })

  it('keeps the undo snackbar controlled and defaults to five seconds', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()

    render(<Snackbar open message="已跳过日月湾" onDismiss={onDismiss} />)
    expect(screen.getByRole('status')).toHaveTextContent('已跳过日月湾')

    act(() => vi.advanceTimersByTime(4999))
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onDismiss).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('presents inspector actions, facts, summary, then evidence', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    const onNavigate = vi.fn()
    const onOpenEvidence = vi.fn()

    render(
      <PlaceInspector
        open
        name="兴隆咖啡园"
        openingHours="09:00–18:00"
        suggestedStay="1h30"
        price="¥68"
        parking="有停车场"
        sourceSummary="3 个来源对营业时间说法一致。"
        evidence={[{ id: 'ev-1', source: '园区官网', statement: '周二正常营业', statusLabel: '已核验' }]}
        onAdd={onAdd}
        onNavigate={onNavigate}
        onOpenEvidence={onOpenEvidence}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: '加入行程' }))
    await user.click(screen.getByRole('button', { name: '高德查看' }))
    await user.click(screen.getByRole('button', { name: /园区官网/ }))
    expect(onAdd).toHaveBeenCalledOnce()
    expect(onNavigate).toHaveBeenCalledOnce()
    expect(onOpenEvidence).toHaveBeenCalledWith('ev-1')
  })
})
