import { DEMO_IDS, DEMO_TRIP, DEMO_VERSIONS, TripVersionSchema, cloneJson } from '@domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createProductionSyncController, getProductionBridgeConfig } from './ProductionBridge'
import { useTripStore } from './useTripStore'

const USER_ID = DEMO_IDS.owner
const SERVER_VERSION_ID = '90000000-0000-4000-8000-000000000003'

function response(data: unknown, status = 200) {
  return new Response(
    JSON.stringify({ data, meta: { requestId: crypto.randomUUID(), mode: 'production' }, error: null }),
    { status, headers: { 'content-type': 'application/json' } },
  )
}

function requestDetails(input: RequestInfo | URL, init?: RequestInit) {
  return {
    url: String(input),
    method: init?.method ?? 'GET',
    body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null,
    headers: Object.fromEntries(new Headers(init?.headers).entries()),
  }
}

describe('ProductionBridge', () => {
  beforeEach(() => {
    localStorage.clear()
    useTripStore.getState().resetDemo()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('keeps Demo mode when production configuration is absent', () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')

    expect(getProductionBridgeConfig()).toBeNull()
    expect(useTripStore.getState().productionSync.mode).toBe('demo')
  })

  it('creates the current template and publishes a real initial version when the account has no trips', async () => {
    const calls: ReturnType<typeof requestDetails>[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = requestDetails(input, init)
      calls.push(request)
      if (request.url.endsWith('/api/v1/trips') && request.method === 'GET') return response([])
      if (request.url.endsWith('/api/v1/trips') && request.method === 'POST') {
        const snapshot = request.body?.snapshot as typeof DEMO_TRIP
        return response({ tripId: snapshot.tripId, draftId: crypto.randomUUID(), revision: 0, currentVersionId: null }, 201)
      }
      if (request.url.endsWith('/publish') && request.method === 'POST') {
        const body = request.body as Record<string, unknown>
        const version = TripVersionSchema.parse({
          id: SERVER_VERSION_ID,
          tripId: (body.snapshot as typeof DEMO_TRIP).tripId,
          versionNo: 1,
          parentVersionId: null,
          source: 'template',
          message: body.message,
          snapshot: body.snapshot,
          snapshotHash: 'server-snapshot-hash',
          derivedSnapshot: body.derivedSnapshot,
          derivedHash: 'server-derived-hash',
          createdBy: USER_ID,
          createdAt: '2026-07-11T08:00:00.000Z',
        })
        return response({ version, draftRevision: 1 }, 201)
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const controller = createProductionSyncController({ accessToken: 'session-token', userId: USER_ID })
    await controller.start()

    const state = useTripStore.getState()
    expect(calls.map((call) => call.method)).toEqual(['GET', 'POST', 'POST'])
    expect(state.productionSync).toMatchObject({
      mode: 'production',
      hydrated: true,
      draftRevision: 1,
      currentVersionId: SERVER_VERSION_ID,
    })
    expect(state.trip.tripId).not.toBe(DEMO_TRIP.tripId)
    expect(state.versions).toHaveLength(1)
    expect(state.versions[0].id).toBe(SERVER_VERSION_ID)
    expect(calls[1].headers?.authorization).toBe('Bearer session-token')
    expect(calls[1].headers?.['idempotency-key']).toBeTruthy()
    controller.dispose()
  })

  it('hydrates an existing draft, debounces edits, and saves before publishing', async () => {
    const calls: ReturnType<typeof requestDetails>[] = []
    let serverDraftRevision = 4
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = requestDetails(input, init)
      calls.push(request)
      if (request.url.endsWith('/api/v1/trips') && request.method === 'GET') {
        return response([{ id: DEMO_TRIP.tripId, current_version_id: DEMO_VERSIONS[1].id }])
      }
      if (request.url.endsWith(`/api/v1/trips/${DEMO_TRIP.tripId}`) && request.method === 'GET') {
        return response({
          trip: { id: DEMO_TRIP.tripId, current_version_id: DEMO_VERSIONS[1].id },
          draft: { snapshot: cloneJson(DEMO_TRIP), revision: serverDraftRevision },
        })
      }
      if (request.url.endsWith('/versions') && request.method === 'GET') {
        return response([cloneJson(DEMO_VERSIONS[1])])
      }
      if (request.url.endsWith('/draft') && request.method === 'PUT') {
        expect(request.body?.revision).toBe(serverDraftRevision)
        serverDraftRevision += 1
        return response({ tripId: DEMO_TRIP.tripId, revision: serverDraftRevision, snapshotHash: 'saved' })
      }
      if (request.url.endsWith('/publish') && request.method === 'POST') {
        const body = request.body as Record<string, unknown>
        expect(body.draftRevision).toBe(serverDraftRevision)
        expect(body.baseVersionId).toBe(DEMO_VERSIONS[1].id)
        serverDraftRevision += 1
        const version = TripVersionSchema.parse({
          id: SERVER_VERSION_ID,
          tripId: DEMO_TRIP.tripId,
          versionNo: 3,
          parentVersionId: DEMO_VERSIONS[1].id,
          source: 'manual',
          message: body.message,
          snapshot: body.snapshot,
          snapshotHash: 'published-snapshot-hash',
          derivedSnapshot: body.derivedSnapshot,
          derivedHash: 'published-derived-hash',
          createdBy: USER_ID,
          createdAt: '2026-07-11T09:00:00.000Z',
        })
        return response({ version, draftRevision: serverDraftRevision }, 201)
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const controller = createProductionSyncController({
      accessToken: 'session-token',
      userId: USER_ID,
      debounceMs: 60_000,
    })
    await controller.start()

    const stopId = useTripStore.getState().trip.days[0].stops[0].id
    useTripStore.getState().updateStop(stopId, { stayMinutes: 105 })
    useTripStore.getState().updateStop(stopId, { stayMinutes: 135 })
    useTripStore.getState().publishVersion('确认首日节奏')
    await controller.whenIdle()

    const mutationCalls = calls.filter((call) => call.method !== 'GET')
    expect(mutationCalls.map((call) => call.url.split('/').at(-1))).toEqual(['draft', 'publish'])
    expect(((mutationCalls[0].body?.snapshot as typeof DEMO_TRIP).days[0].stops[0]).stayMinutes).toBe(135)
    expect(((mutationCalls[1].body?.snapshot as typeof DEMO_TRIP).days[0].stops[0]).stayMinutes).toBe(135)
    const state = useTripStore.getState()
    expect(state.productionPublishQueue).toHaveLength(0)
    expect(state.productionSync.draftRevision).toBe(6)
    expect(state.productionSync.currentVersionId).toBe(SERVER_VERSION_ID)
    expect(state.versions.at(-1)?.id).toBe(SERVER_VERSION_ID)
    expect(state.saveStatus).toBe('saved')
    expect(state.dirty).toBe(false)
    controller.dispose()
  })
})
