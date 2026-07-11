import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useTripStore } from '@/store/useTripStore'

import { ChangeSetPage } from './ChangeSetPage'

describe('ChangeSetPage', () => {
  afterEach(cleanup)
  beforeEach(() => {
    useTripStore.getState().resetDemo()
  })

  it('shows the four-part dry-run overview and keeps raw JSON collapsed', () => {
    render(<MemoryRouter><ChangeSetPage /></MemoryRouter>)

    expect(screen.getByText('改了什么')).toBeInTheDocument()
    expect(screen.getByText('代价')).toBeInTheDocument()
    expect(screen.getByText('影响哪几天')).toBeInTheDocument()
    expect(screen.getByText('阻断冲突')).toBeInTheDocument()
    expect(screen.getByText('阻断冲突').closest('.feature-metric')).toHaveTextContent('0可应用当前选择')
    expect(screen.getByRole('button', { name: '应用并创建新版本' })).toBeEnabled()
    expect(screen.getByText(/项日程风险需确认/)).toBeInTheDocument()
    expect(screen.getByText(/技术详情 · 原始 JSON/).closest('details')).not.toHaveAttribute('open')
  })

  it('gates review when the active draft is dirty', () => {
    useTripStore.setState({ dirty: true })
    render(<MemoryRouter><ChangeSetPage /></MemoryRouter>)

    expect(screen.getByText('先处理当前未发布草稿')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'TripChangeSet v1' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '保存草稿为版本' })).toBeEnabled()
  })
})
