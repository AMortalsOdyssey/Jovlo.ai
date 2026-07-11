import { afterEach, describe, expect, it, vi } from 'vitest'

import { app } from '../../worker/index'

type ErrorEnvelope = {
  error: null | { code: string }
}

const ENV = {
  JOVLO_MODE: 'demo' as const,
  AMAP_SECURITY_JSCODE: 'server-only-jscode',
}

type TestEnv = {
  JOVLO_MODE: 'demo'
  AMAP_SECURITY_JSCODE?: string
}

function proxyRequest(path: string, init?: RequestInit, env: TestEnv = ENV) {
  return app.request(`https://jovlo.test${path}`, {
    headers: {
      origin: 'https://jovlo.test',
      'sec-fetch-site': 'same-origin',
      ...init?.headers,
    },
    ...init,
  }, env)
}

afterEach(() => vi.restoreAllMocks())

describe('AMap JS API security proxy', () => {
  it('forwards an allowlisted request to a fixed upstream and appends the server jscode', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ status: '1', regeocode: { formatted_address: '海南省万宁市日月湾' } }),
    )

    const response = await proxyRequest(
      '/_AMapService/v3/geocode/regeo?key=1234567890abcdef1234567890abcdef&location=110.195,18.645&extensions=base',
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: '1' })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const upstream = new URL(String(fetchMock.mock.calls[0][0]))
    expect(upstream.origin).toBe('https://restapi.amap.com')
    expect(upstream.pathname).toBe('/v3/geocode/regeo')
    expect(upstream.searchParams.get('jscode')).toBe('server-only-jscode')
    expect(upstream.searchParams.get('location')).toBe('110.195,18.645')
  })

  it('does not become an open proxy for arbitrary paths or query parameters', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const arbitraryPath = await proxyRequest(
      '/_AMapService/https://example.com/?key=1234567890abcdef1234567890abcdef',
    )
    const arbitraryQuery = await proxyRequest(
      '/_AMapService/v3/geocode/regeo?key=1234567890abcdef1234567890abcdef&url=https://example.com',
    )
    const suppliedSecret = await proxyRequest(
      '/_AMapService/v3/geocode/regeo?key=1234567890abcdef1234567890abcdef&jscode=stolen',
    )

    expect(arbitraryPath.status).toBe(403)
    expect(arbitraryQuery.status).toBe(403)
    expect(suppliedSecret.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects cross-origin and non-GET requests before contacting AMap', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const crossOrigin = await proxyRequest(
      '/_AMapService/v3/geocode/regeo?key=1234567890abcdef1234567890abcdef',
      { headers: { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' } },
    )
    const post = await proxyRequest(
      '/_AMapService/v3/geocode/regeo?key=1234567890abcdef1234567890abcdef',
      { method: 'POST' },
    )

    expect(crossOrigin.status).toBe(403)
    expect(post.status).toBe(405)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed when the Worker secret is absent', async () => {
    const response = await proxyRequest(
      '/_AMapService/v3/geocode/regeo?key=1234567890abcdef1234567890abcdef',
      undefined,
      { JOVLO_MODE: 'demo' as const },
    )
    const body = (await response.json()) as ErrorEnvelope

    expect(response.status).toBe(503)
    expect(body.error?.code).toBe('DEPENDENCY_UNAVAILABLE')
  })
})
