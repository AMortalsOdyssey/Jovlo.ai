import { describe, expect, it, vi } from 'vitest'
import { DEMO_CHANGESET, DEMO_IDS, DEMO_TRIP, DEMO_VERSIONS } from '../../packages/domain/src/index'
import { app } from '../../worker/index'

type Envelope = {
  data: unknown
  meta: { requestId: string; mode: string }
  error: null | { code: string; message?: string }
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
    expect(response.headers.get('content-security-policy')).toContain("script-src 'self' 'unsafe-eval'")
    expect(response.headers.get('content-security-policy')).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(response.headers.get('content-security-policy')).toContain("worker-src 'self' blob:")
    expect(response.headers.get('content-security-policy')).toContain("font-src 'self' data:")
    expect(response.headers.get('content-security-policy')).toContain("object-src 'none'")

    const demoResponse = await app.request('/', undefined, {
      JOVLO_MODE: 'demo',
      ASSETS: {
        fetch: async () => new Response('<!doctype html><title>Jovlo</title>', {
          headers: { 'content-type': 'text/html' },
        }),
      },
    })
    expect(demoResponse.headers.get('content-security-policy')).toContain("script-src 'self' 'unsafe-eval'")
    expect(demoResponse.headers.get('content-security-policy')).toContain("'unsafe-inline'")
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

  it('retries a temporary AMap rate limit and keeps the road result', async () => {
    const from = DEMO_TRIP.placeRefs[DEMO_IDS.places.meilan]
    const to = DEMO_TRIP.placeRefs[DEMO_IDS.places.qilou]
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: '0',
        info: 'ACCESS_TOO_FREQUENT',
        infocode: '10004',
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: '1',
        infocode: '10000',
        route: { paths: [{ distance: '18500', cost: { duration: '2100' } }] },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
    try {
      const response = await app.request('/api/v1/routes/dry-run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          dayId: DEMO_IDS.days[0],
          points: [
            { endpoint: { kind: 'place', placeId: from.placeId }, coordinate: from.gcj02 },
            { endpoint: { kind: 'place', placeId: to.placeId }, coordinate: to.gcj02 },
          ],
          strategy: '32',
          inputHash: 'test-amap-retry-route',
        }),
      }, { JOVLO_MODE: 'demo', AMAP_WEB_SERVICE_KEY: 'test-secret' })
      const body = (await response.json()) as Envelope & {
        data: { providerMode: string; providerNotice: null; legs: Array<{ provider: string }> }
      }
      expect(response.status).toBe(200)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(body.data.providerMode).toBe('amap')
      expect(body.data.providerNotice).toBeNull()
      expect(body.data.legs[0].provider).toBe('amap')
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('falls back with a concise notice when the AMap daily quota is exhausted', async () => {
    const from = DEMO_TRIP.placeRefs[DEMO_IDS.places.meilan]
    const to = DEMO_TRIP.placeRefs[DEMO_IDS.places.qilou]
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      status: '0',
      info: 'DAILY_QUERY_OVER_LIMIT',
      infocode: '10003',
      debug: 'raw provider details must stay private',
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    try {
      const response = await app.request('/api/v1/routes/dry-run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          dayId: DEMO_IDS.days[0],
          points: [
            { endpoint: { kind: 'place', placeId: from.placeId }, coordinate: from.gcj02 },
            { endpoint: { kind: 'place', placeId: to.placeId }, coordinate: to.gcj02 },
          ],
          strategy: '32',
          inputHash: 'test-amap-quota-fallback',
        }),
      }, { JOVLO_MODE: 'demo', AMAP_WEB_SERVICE_KEY: 'test-secret' })
      const body = (await response.json()) as Envelope & {
        data: {
          providerMode: string
          providerNotice: { code: string; message: string; retryable: boolean; failedLegs: number }
          legs: Array<{ provider: string }>
        }
      }
      expect(response.status).toBe(200)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(body.data.providerMode).toBe('reference')
      expect(body.data.providerNotice).toEqual({
        code: 'quota_exceeded',
        message: '高德今日额度已用完，已切换参考路线',
        retryable: false,
        failedLegs: 1,
      })
      expect(body.data.legs[0].provider).toBe('reference')
      expect(JSON.stringify(body)).not.toContain('DAILY_QUERY_OVER_LIMIT')
      expect(JSON.stringify(body)).not.toContain('raw provider details')
    } finally {
      fetchMock.mockRestore()
    }
  })

  it('delivers an agent ChangeSet through an opaque one-time grant without applying it', async () => {
    const bridgeSecret = 'test-agent-bridge-secret-at-least-32-characters'
    const ticketResponse = await app.request(
      `/api/v1/trips/${DEMO_TRIP.tripId}/agent-tickets`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      },
      { JOVLO_MODE: 'demo', AGENT_BRIDGE_SECRET: bridgeSecret },
    )
    const ticketBody = (await ticketResponse.json()) as Envelope & {
      data: { ticket: string; deliveryEndpoint: string; expiresAt: string }
    }
    expect(ticketResponse.status).toBe(201)
    expect(ticketBody.data.ticket).toMatch(/^[0-9a-f]{64}$/)
    expect(ticketBody.data.ticket).not.toContain(DEMO_TRIP.tripId)

    const changeSet = structuredClone(DEMO_CHANGESET)
    changeSet.changeSetId = 'c0000000-0000-4000-8000-000000000099'
    changeSet.idempotencyKey = 'agent-bridge-test-import-v1'
    const deliveryResponse = await app.request(
      '/api/v1/agent-imports',
      {
        method: 'POST',
        headers: {
          authorization: `Jovlo-Agent ${ticketBody.data.ticket}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(changeSet),
      },
      { JOVLO_MODE: 'demo', AGENT_BRIDGE_SECRET: bridgeSecret },
    )
    const deliveryBody = (await deliveryResponse.json()) as Envelope & {
      data: { changeSetId: string; status: string; reviewUrl: string }
    }
    expect(deliveryResponse.status).toBe(201)
    expect(deliveryBody.data).toMatchObject({
      changeSetId: changeSet.changeSetId,
      status: 'uploaded',
    })
    expect(deliveryBody.data.reviewUrl).toContain(`/imports/${changeSet.changeSetId}`)

    const retryResponse = await app.request(
      '/api/v1/agent-imports',
      {
        method: 'POST',
        headers: {
          authorization: `Jovlo-Agent ${ticketBody.data.ticket}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(changeSet),
      },
      { JOVLO_MODE: 'demo', AGENT_BRIDGE_SECRET: bridgeSecret },
    )
    expect(retryResponse.status).toBe(200)

    const differentChangeSet = structuredClone(changeSet)
    differentChangeSet.changeSetId = 'c0000000-0000-4000-8000-000000000098'
    differentChangeSet.idempotencyKey = 'agent-bridge-different-import-v1'
    const replayResponse = await app.request(
      '/api/v1/agent-imports',
      {
        method: 'POST',
        headers: {
          authorization: `Jovlo-Agent ${ticketBody.data.ticket}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(differentChangeSet),
      },
      { JOVLO_MODE: 'demo', AGENT_BRIDGE_SECRET: bridgeSecret },
    )
    const replayBody = (await replayResponse.json()) as Envelope
    expect(replayResponse.status).toBe(409)
    expect(replayBody.error?.code).toBe('IDEMPOTENCY_KEY_REUSED')

    const storedResponse = await app.request(
      `/api/v1/change-sets/${changeSet.changeSetId}`,
      undefined,
      { JOVLO_MODE: 'demo', AGENT_BRIDGE_SECRET: bridgeSecret },
    )
    const storedBody = (await storedResponse.json()) as Envelope & {
      data: { changeSet: { changeSetId: string }; status: string }
    }
    expect(storedResponse.status).toBe(200)
    expect(storedBody.data.changeSet.changeSetId).toBe(changeSet.changeSetId)
    expect(storedBody.data.status).toBe('uploaded')
  })

  it('rejects a damaged agent ticket without exposing token details', async () => {
    const response = await app.request(
      '/api/v1/agent-imports',
      {
        method: 'POST',
        headers: {
          authorization: `Jovlo-Agent ${'0'.repeat(64)}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(DEMO_CHANGESET),
      },
      { JOVLO_MODE: 'demo', AGENT_BRIDGE_SECRET: 'test-agent-bridge-secret-at-least-32-characters' },
    )
    const body = (await response.json()) as Envelope & { error: { code: string; message: string } }
    expect(response.status).toBe(401)
    expect(body.error.code).toBe('AUTH_REQUIRED')
    expect(body.error.message).toBe('Agent 投递口令无效或已过期')
    expect(JSON.stringify(body)).not.toContain('0'.repeat(64))
  })

  it('rejects an agent payload that exceeds the actual 256KB body limit', async () => {
    const bridgeSecret = 'test-agent-bridge-secret-at-least-32-characters'
    const ticketResponse = await app.request(
      `/api/v1/trips/${DEMO_TRIP.tripId}/agent-tickets`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      { JOVLO_MODE: 'demo', AGENT_BRIDGE_SECRET: bridgeSecret },
    )
    const ticketBody = (await ticketResponse.json()) as Envelope & { data: { ticket: string } }
    const response = await app.request(
      '/api/v1/agent-imports',
      {
        method: 'POST',
        headers: {
          authorization: `Jovlo-Agent ${ticketBody.data.ticket}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ padding: 'x'.repeat(256 * 1_024) }),
      },
      { JOVLO_MODE: 'demo', AGENT_BRIDGE_SECRET: bridgeSecret },
    )
    const body = (await response.json()) as Envelope
    expect(response.status).toBe(413)
    expect(body.error?.message).toBe('ChangeSet 超过 256KB 限制')
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

  it('creates a day-only fixed share and never returns other days', async () => {
    const overviewResponse = await app.request(
      `/api/v1/trips/${DEMO_TRIP.tripId}/publications`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({
          versionId: DEMO_VERSIONS[1].id,
          disclosureConfig: {
            showExactDates: false,
            showSources: true,
            showBudget: true,
            viewScope: 'overview',
          },
        }),
      },
      { JOVLO_MODE: 'demo' },
    )
    const overview = (await overviewResponse.json()) as Envelope & { data: { token: string } }
    expect(overviewResponse.status).toBe(201)

    const selectedDay = DEMO_TRIP.days[2]
    const dayResponse = await app.request(
      `/api/v1/trips/${DEMO_TRIP.tripId}/publications`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({
          versionId: DEMO_VERSIONS[1].id,
          disclosureConfig: {
            showExactDates: false,
            showSources: true,
            showBudget: true,
            viewScope: 'day',
            dayId: selectedDay.id,
            overviewToken: overview.data.token,
          },
        }),
      },
      { JOVLO_MODE: 'demo' },
    )
    const dayPublication = (await dayResponse.json()) as Envelope & { data: { token: string } }
    const publicResponse = await app.request(`/api/v1/public/${dayPublication.data.token}`, undefined, {
      JOVLO_MODE: 'demo',
    })
    const publicBody = (await publicResponse.json()) as Envelope & {
      data: {
        snapshot: typeof DEMO_TRIP
        derived: { routeLegs: Array<{ dayId: string }>; daySchedules: Array<{ dayId: string }> }
        view: { scope: string; overviewToken: string }
      }
    }
    expect(publicResponse.status).toBe(200)
    expect(publicBody.data.snapshot.days).toHaveLength(1)
    expect(publicBody.data.snapshot.days[0].id).toBe(selectedDay.id)
    expect(publicBody.data.snapshot.intent.days).toBe(1)
    expect(publicBody.data.snapshot.days[0].date).toBeUndefined()
    expect(publicBody.data.derived.routeLegs.every((leg) => leg.dayId === selectedDay.id)).toBe(true)
    expect(publicBody.data.derived.daySchedules.map((day) => day.dayId)).toEqual([selectedDay.id])
    expect(publicBody.data.view).toMatchObject({ scope: 'day', overviewToken: overview.data.token })
  })

  it('redacts source and budget data in the response body, not only in the UI', async () => {
    const createResponse = await app.request(
      `/api/v1/trips/${DEMO_TRIP.tripId}/publications`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({
          versionId: DEMO_VERSIONS[1].id,
          disclosureConfig: {
            showExactDates: false,
            showSources: false,
            showBudget: false,
            viewScope: 'overview',
          },
        }),
      },
      { JOVLO_MODE: 'demo' },
    )
    const publication = (await createResponse.json()) as Envelope & { data: { token: string } }
    const response = await app.request(`/api/v1/public/${publication.data.token}`, undefined, { JOVLO_MODE: 'demo' })
    const body = (await response.json()) as Envelope & {
      data: {
        snapshot: typeof DEMO_TRIP
        derived: { budget: { total: { expected: number }; categories: unknown[] }; routeLegs: Array<{ tollsCny?: number }> }
      }
    }
    expect(body.data.snapshot.sourceRefs).toEqual({})
    expect(body.data.snapshot.days.flatMap((day) => day.stops).every((stop) => stop.sourceIds.length === 0)).toBe(true)
    expect(body.data.derived.budget.total.expected).toBe(0)
    expect(body.data.derived.budget.categories).toEqual([])
    expect(body.data.derived.routeLegs.every((leg) => leg.tollsCny === undefined)).toBe(true)
  })

  it('proxies only the fixed Supabase Auth surface through the Jovlo origin', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ access_token: 'token' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    try {
      const response = await app.request('/supabase/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'traveler@example.com', password: 'password123' }),
      }, {
        JOVLO_MODE: 'production',
        SUPABASE_URL: 'https://fixed-project.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'public-key',
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(fetchMock).toHaveBeenCalledWith(
        'https://fixed-project.supabase.co/auth/v1/token?grant_type=password',
        expect.objectContaining({ method: 'POST', redirect: 'manual' }),
      )
      const init = fetchMock.mock.calls[0][1]
      expect(new Headers(init?.headers).get('apikey')).toBe('public-key')

      const rejected = await app.request('/supabase/auth/v1/admin/users', { method: 'GET' }, {
        JOVLO_MODE: 'production',
        SUPABASE_URL: 'https://fixed-project.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'public-key',
      })
      expect(rejected.status).toBe(404)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      fetchMock.mockRestore()
    }
  })
})
