import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppErrorBoundary } from './AppErrorBoundary'

function BrokenRoute(): ReactNode {
  throw new TypeError('Failed to fetch dynamically imported module')
}

describe('AppErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows a recovery action instead of a blank page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <AppErrorBoundary>
        <BrokenRoute />
      </AppErrorBoundary>,
    )

    expect(screen.getByRole('heading', { name: '页面版本刚刚更新' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新载入' })).toBeInTheDocument()
    expect(screen.getByText('登录状态不会丢失。', { exact: false })).toBeInTheDocument()
  })
})
