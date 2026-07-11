import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getSupabaseAccessToken = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase', () => ({ getSupabaseAccessToken }))

import { apiRequest } from '@/lib/api'

function successfulResponse() {
  return new Response(
    JSON.stringify({
      data: { ok: true },
      meta: { requestId: 'request-1' },
      error: null,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

describe('authenticated API client', () => {
  beforeEach(() => {
    getSupabaseAccessToken.mockResolvedValue(null)
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(successfulResponse())))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('attaches the restored Supabase access token', async () => {
    getSupabaseAccessToken.mockResolvedValue('session-token')

    await apiRequest<{ ok: boolean }>('/api/v1/trips')

    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer session-token')
  })

  it('keeps demo requests unauthenticated when Supabase has no session', async () => {
    await apiRequest<{ ok: boolean }>('/api/v1/public/demo')

    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(new Headers(init?.headers).has('authorization')).toBe(false)
  })

  it('does not overwrite an explicit authorization header', async () => {
    getSupabaseAccessToken.mockResolvedValue('session-token')

    await apiRequest<{ ok: boolean }>('/api/v1/trips', {
      headers: { authorization: 'Bearer explicit-token' },
    })

    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer explicit-token')
  })
})
