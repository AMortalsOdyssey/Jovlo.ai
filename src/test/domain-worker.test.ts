import { describe, expect, it, vi } from 'vitest'
import { DEMO_IDS, DEMO_TRIP } from '../../packages/domain/src/index'
import { app } from '../../worker/index'

type Envelope = {
  data: unknown
  meta: { requestId: string; mode: string }
  error: null | { code: string }
}

describe('Worker API contract', () => {
  it('returns the standard envelope, request ID, and security headers', async () => {
    const response = await app.request('/api/health', undefined, { JOVLO_MODE: 'demo' })
    const body = (await response.json()) as Envelope
    expect(response.status).toBe(200)
    expect(body.error).toBeNull()
    expect(body.meta.requestId).toBe(response.headers.get('x-request-id'))
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
  })

  it('keeps security headers on static asset responses', async () => {
    const response = await app.request('/', undefined, {
      JOVLO_MODE: 'production',
      ASSETS: {
        fetch: async () => new Response('<!doctype html><title>Jovlo</title>', {
          headers: { 'content-type': 'text/html' },
        }),
      },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(response.headers.get('content-security-policy')).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(response.headers.get('content-security-policy')).toContain("worker-src 'self' blob:")
    expect(response.headers.get('content-security-policy')).toContain("font-src 'self' data:")

    const demoResponse = await app.request('/', undefined, {
      JOVLO_MODE: 'demo',
      ASSETS: {
        fetch: async () => new Response('<!doctype html><title>Jovlo</title>', {
          headers: { 'content-type': 'text/html' },
        }),
      },
    })
    expect(demoResponse.headers.get('content-security-policy')).toContain("script-src 'self' 'unsafe-inline'")
  })

  it('fails closed when production authentication cannot be verified', async () => {
    const noToken = await app.request(
      '/api/v1/budgets/calculate',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ snapshot: DEMO_TRIP, routeLegs: [] }),
      },
      { JOVLO_MODE: 'production' },
    )
    expect(noToken.status).toBe(401)
    expect(((await noToken.json()) as Envelope).error?.code).toBe('AUTH_REQUIRED')

    const unverifiable = await app.request(
      '/api/v1/budgets/calculate',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer not-a-verifiable-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ snapshot: DEMO_TRIP, routeLegs: [] }),
      },
      { JOVLO_MODE: 'production' },
    )
    expect(unverifiable.status).toBe(503)
    expect(((await unverifiable.json()) as Envelope).error?.code).toBe('DEPENDENCY_UNAVAILABLE')
  })

  it('does not expose the demo bootstrap in production', async () => {
    const response = await app.request('/api/v1/demo/bootstrap', undefined, {
      JOVLO_MODE: 'production',
    })
    const body = (await response.json()) as Envelope
    expect(response.status).toBe(404)
    expect(body.error?.code).toBe('VALIDATION_FAILED')
  })

  it('returns an explicit reference provider when AMap secret is absent', async () => {
    const from = DEMO_TRIP.placeRefs[DEMO_IDS.places.meilan]
    const to = DEMO_TRIP.placeRefs[DEMO_IDS.places.qilou]
    const response = await app.request(
      '/api/v1/routes/dry-run',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          dayId: DEMO_IDS.days[0],
          points: [
            {
              endpoint: { kind: 'place', placeId: from.placeId },
              coordinate: from.gcj02,
            },
            {
              endpoint: { kind: 'place', placeId: to.placeId },
              coordinate: to.gcj02,
            },
          ],
          strategy: '32',
          inputHash: 'test-reference-route',
        }),
      },
      { JOVLO_MODE: 'demo' },
    )
    const body = (await response.json()) as Envelope & {
      data: { providerMode: string; authoritative: boolean; legs: Array<{ provider: string }> }
    }
    expect(response.status).toBe(200)
    expect(body.data.providerMode).toBe('reference')
    expect(body.data.authoritative).toBe(false)
    expect(body.data.legs[0].provider).toBe('reference')
  })

  it('normalizes the AMap v5 cost object when a secret is configured', async () => {
    const from = DEMO_TRIP.placeRefs[DEMO_IDS.places.meilan]
    const to = DEMO_TRIP.placeRefs[DEMO_IDS.places.qilou]
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          status: '1',
          infocode: '10000',
          route: {
            paths: [
              {
                distance: '26000',
                cost: { duration: '2400', tolls: '12', traffic_lights: '8' },
              },
            ],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    try {
      const response = await app.request(
        '/api/v1/routes/dry-run',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            dayId: DEMO_IDS.days[0],
            points: [
              { endpoint: { kind: 'place', placeId: from.placeId }, coordinate: from.gcj02 },
              { endpoint: { kind: 'place', placeId: to.placeId }, coordinate: to.gcj02 },
            ],
            strategy: '32',
            inputHash: 'test-amap-v5-route',
          }),
        },
        { JOVLO_MODE: 'demo', AMAP_WEB_SERVICE_KEY: 'test-secret' },
      )
      const body = (await response.json()) as Envelope & {
        data: {
          providerMode: string
          legs: Array<{
            provider: string
            distanceMeters: number
            durationSeconds: number
            tollsCny: number
          }>
        }
      }
      expect(response.status).toBe(200)
      expect(body.data.providerMode).toBe('amap')
      expect(body.data.legs[0]).toMatchObject({
        provider: 'amap',
        distanceMeters: 26_000,
        durationSeconds: 2_400,
        tollsCny: 12,
      })
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('returns PUBLICATION_REVOKED for a revoked fixed snapshot', async () => {
    const response = await app.request('/api/v1/public/jovlo-revoked', undefined, {
      JOVLO_MODE: 'demo',
    })
    const body = (await response.json()) as Envelope
    expect(response.status).toBe(410)
    expect(body.error?.code).toBe('PUBLICATION_REVOKED')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('returns snapshot and derived from the report-bound version', async () => {
    const response = await app.request('/api/v1/public/reports/jovlo-demo-report', undefined, {
      JOVLO_MODE: 'demo',
    })
    const body = (await response.json()) as Envelope & {
      data: {
        report: { versionId: string }
        snapshot: { tripId: string }
        derived: { inputHash: string }
      }
    }
    expect(response.status).toBe(200)
    expect(body.data.report.versionId).toBe('80000000-0000-4000-8000-000000000002')
    expect(body.data.snapshot.tripId).toBe(DEMO_TRIP.tripId)
    expect(body.data.derived.inputHash).toBeTruthy()
  })
})
