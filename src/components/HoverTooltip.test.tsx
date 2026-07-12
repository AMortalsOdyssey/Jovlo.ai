import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ArrowLeft } from 'lucide-react'
import { afterEach, describe, expect, it } from 'vitest'

import { IconButton } from './IconButton'

afterEach(cleanup)

describe('IconButton tooltip', () => {
  it('uses the collision-aware custom tooltip without a native title', async () => {
    const user = userEvent.setup()
    render(<IconButton icon={ArrowLeft} label="返回路书列表" />)

    const button = screen.getByRole('button', { name: '返回路书列表' })
    expect(button).not.toHaveAttribute('title')

    await user.hover(button)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('返回路书列表')
  })

  it('shows the same custom tooltip for keyboard focus', async () => {
    const user = userEvent.setup()
    render(<IconButton icon={ArrowLeft} label="返回路书列表" />)

    await user.tab()
    expect(screen.getByRole('button', { name: '返回路书列表' })).toHaveFocus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('返回路书列表')
  })
})
