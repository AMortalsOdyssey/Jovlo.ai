import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const turnstileMock = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}))

vi.mock('@marsidev/react-turnstile', () => ({
  Turnstile: (props: Record<string, unknown>) => {
    turnstileMock.props = props
    return <div data-testid="turnstile-widget" />
  },
}))

import { TurnstileGate } from './TurnstileGate'

describe('TurnstileGate', () => {
  afterEach(() => {
    cleanup()
    turnstileMock.props = null
  })

  it('uses an action-bound widget and reports token lifecycle changes', () => {
    const onTokenChange = vi.fn()
    render(<TurnstileGate action="signup" onTokenChange={onTokenChange} />)

    expect(screen.getByLabelText('Cloudflare 人机验证')).toBeInTheDocument()
    expect(screen.getByTestId('turnstile-widget')).toBeInTheDocument()
    expect(turnstileMock.props?.siteKey).toBe('1x00000000000000000000AA')
    expect(turnstileMock.props?.options).toMatchObject({
      action: 'signup',
      appearance: 'always',
      language: 'zh-CN',
      size: 'flexible',
    })

    act(() => {
      ;(turnstileMock.props?.onSuccess as (token: string) => void)('verified-token')
    })
    expect(onTokenChange).toHaveBeenLastCalledWith('verified-token')
    expect(screen.getByLabelText('验证通过')).toBeInTheDocument()

    act(() => {
      ;(turnstileMock.props?.onExpire as () => void)()
    })
    expect(onTokenChange).toHaveBeenLastCalledWith(null)
  })
})
