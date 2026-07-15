import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { TripPdfDialog } from './TripPdfDialog'
import { useTripStore } from '@/store/useTripStore'

describe('TripPdfDialog', () => {
  beforeEach(() => useTripStore.getState().resetDemo())
  afterEach(cleanup)

  it('explains the immutable public snapshot before creating the PDF', () => {
    render(<TripPdfDialog open onClose={() => undefined} />)

    expect(screen.getByRole('dialog', { name: '下载 PDF 到本地' })).toBeInTheDocument()
    expect(screen.getByText('完整行程、地图、耗时与预算')).toBeInTheDocument()
    expect(screen.getByText(/之后的修改不会改变它/)).toBeInTheDocument()
    expect(screen.getByText('访问者无需登录且不能编辑')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '生成并下载' })).toBeInTheDocument()
  })
})
