import type { Session } from '@supabase/supabase-js'
import {
  DEMO_TRIP,
  TripSnapshotSchema,
  TripVersionSchema,
  cloneJson,
  recalculateTrip,
  stableHash,
  type TripSnapshot,
  type TripVersion,
} from '@domain'
import { useEffect } from 'react'

import { apiRequest } from '@/lib/api'
import { getSupabaseClient } from '@/lib/supabase'
import { buildReferenceRouteLegs } from './reference-routes'
import type { ProductionPublishRequest } from './store-types'
import { useTripStore } from './useTripStore'

type UnknownRecord = Record<string, unknown>

type ProductionSyncControllerOptions = {
  accessToken: string
  userId: string
  apiBase?: string
  debounceMs?: number
}

type DraftSaveResult = {
  revision: number
}

type PublishResult = {
  version: TripVersion
  draftRevision: number
}

type RevisionResult = {
  currentVersionId: string | null
  versionNo: number
  draftRevision: number
  updatedAt: string
}

export type ProductionBridgeProps = {
  apiBase?: string
  debounceMs?: number
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? (value as UnknownRecord) : {}
}

function readString(record: UnknownRecord, ...keys: string[]) {
  for (const key of keys) {
    if (typeof record[key] === 'string') return record[key] as string
  }
  return null
}

function readNumber(record: UnknownRecord, ...keys: string[]) {
  for (const key of keys) {
    if (typeof record[key] === 'number') return record[key] as number
  }
  return null
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '生产数据同步暂时不可用'
}

function joinApiPath(base: string, path: string) {
  return `${base.replace(/\/$/, '')}${path}`
}

function recalculate(snapshot: TripSnapshot) {
  return recalculateTrip(snapshot, buildReferenceRouteLegs(snapshot))
}

function normalizeVersions(
  rawVersions: unknown[],
  snapshot: TripSnapshot,
  currentVersionId: string | null,
  userId: string,
): TripVersion[] {
  const complete = rawVersions.flatMap((value) => {
    const parsed = TripVersionSchema.safeParse(value)
    return parsed.success ? [parsed.data] : []
  })
  if (complete.length) return complete.sort((a, b) => a.versionNo - b.versionNo)
  if (!currentVersionId) return []

  const currentMetadata = rawVersions
    .map(asRecord)
    .find((value) => readString(value, 'id') === currentVersionId) ?? asRecord(rawVersions[0])
  const derived = recalculate(snapshot)
  return [
    TripVersionSchema.parse({
      id: currentVersionId,
      tripId: snapshot.tripId,
      versionNo: readNumber(currentMetadata, 'versionNo', 'version_no') ?? Math.max(1, rawVersions.length),
      parentVersionId: readString(currentMetadata, 'parentVersionId', 'parent_version_id'),
      source: readString(currentMetadata, 'source') ?? 'manual',
      message: readString(currentMetadata, 'message') ?? '从生产环境载入',
      snapshot,
      snapshotHash: stableHash(snapshot),
      derivedSnapshot: derived,
      derivedHash: stableHash(derived),
      createdBy: userId,
      createdAt: readString(currentMetadata, 'createdAt', 'created_at') ?? new Date().toISOString(),
    }),
  ]
}

export function getProductionBridgeConfig() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!supabaseUrl || !publishableKey) return null
  return { supabaseUrl, publishableKey }
}

export class ProductionSyncController {
  private readonly accessToken: string
  private readonly userId: string
  private readonly apiBase: string
  private readonly debounceMs: number
  private readonly abortController = new AbortController()
  private unsubscribe: (() => void) | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private checkpointTimer: ReturnType<typeof setTimeout> | null = null
  private revisionTimer: ReturnType<typeof setTimeout> | null = null
  private operationChain: Promise<void> = Promise.resolve()
  private latestDraft: { snapshot: TripSnapshot; localRevision: number } | null = null
  private processedPublishIds = new Set<string>()
  private draftRevision = 0
  private savedLocalRevision = 0
  private currentVersionId: string | null = null
  private disposed = false
  private refreshing = false

  constructor(options: ProductionSyncControllerOptions) {
    this.accessToken = options.accessToken
    this.userId = options.userId
    this.apiBase = options.apiBase ?? import.meta.env.VITE_API_BASE_URL ?? ''
    this.debounceMs = options.debounceMs ?? 720
  }

  private request<T>(path: string, init?: RequestInit) {
    return apiRequest<T>(joinApiPath(this.apiBase, path), {
      ...init,
      signal: this.abortController.signal,
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        ...(init?.headers as Record<string, string> | undefined),
      },
    })
  }

  private mutationHeaders() {
    return { 'idempotency-key': crypto.randomUUID() }
  }

  private async publishInitial(snapshot: TripSnapshot, draftRevision: number) {
    const derivedSnapshot = recalculate(snapshot)
    return this.request<PublishResult>(`/api/v1/trips/${snapshot.tripId}/publish`, {
      method: 'POST',
      headers: this.mutationHeaders(),
      body: JSON.stringify({
        baseVersionId: null,
        draftRevision,
        snapshot,
        derivedSnapshot,
        message: '从示例路书创建',
        source: 'template',
      }),
    })
  }

  async start() {
    useTripStore.getState().setProductionSync({ mode: 'connecting', hydrated: false, error: null })
    try {
      const trips = await this.request<unknown[]>('/api/v1/trips')
      let snapshot: TripSnapshot
      let rawVersions: unknown[] = []
      let currentVersionId: string | null = null
      let draftRevision = 0

      const firstTrip = asRecord(trips[0])
      const existingTripId = readString(firstTrip, 'id', 'tripId', 'trip_id')
      if (!existingTripId) {
        snapshot = cloneJson(DEMO_TRIP)
        snapshot.tripId = crypto.randomUUID()
        snapshot = TripSnapshotSchema.parse(snapshot)
        const created = await this.request<UnknownRecord>('/api/v1/trips', {
          method: 'POST',
          headers: this.mutationHeaders(),
          body: JSON.stringify({ title: snapshot.title, snapshot }),
        })
        draftRevision = readNumber(created, 'revision') ?? 0
        const published = await this.publishInitial(snapshot, draftRevision)
        rawVersions = [published.version]
        currentVersionId = published.version.id
        draftRevision = published.draftRevision
      } else {
        const detail = asRecord(await this.request<unknown>(`/api/v1/trips/${existingTripId}`))
        const draft = asRecord(detail.draft)
        const trip = asRecord(detail.trip)
        snapshot = TripSnapshotSchema.parse(draft.snapshot)
        draftRevision = readNumber(draft, 'revision') ?? 0
        currentVersionId =
          readString(detail, 'currentVersionId', 'current_version_id') ??
          readString(trip, 'currentVersionId', 'current_version_id')
        rawVersions = await this.request<unknown[]>(`/api/v1/trips/${existingTripId}/versions`)
        if (!currentVersionId) {
          const published = await this.publishInitial(snapshot, draftRevision)
          rawVersions = [published.version]
          currentVersionId = published.version.id
          draftRevision = published.draftRevision
        }
      }

      if (this.disposed) return
      const derived = recalculate(snapshot)
      const versions = normalizeVersions(rawVersions, snapshot, currentVersionId, this.userId)
      useTripStore.getState().hydrateProduction({
        snapshot,
        derived,
        versions,
        draftRevision,
        currentVersionId,
      })
      this.draftRevision = draftRevision
      this.currentVersionId = currentVersionId
      this.savedLocalRevision = useTripStore.getState().revision
      this.subscribe()
      this.scheduleRevisionPoll()
    } catch (error) {
      if (this.disposed || (error instanceof DOMException && error.name === 'AbortError')) return
      useTripStore.getState().setProductionSync({
        mode: 'error',
        hydrated: false,
        error: errorMessage(error),
      })
    }
  }

  private subscribe() {
    this.unsubscribe = useTripStore.subscribe((state, previous) => {
      if (state.productionSync.mode !== 'production') return
      if (!this.refreshing && state.revision !== previous.revision) {
        this.scheduleDraft(cloneJson(state.trip), state.revision)
        this.scheduleCheckpoint()
      }
      for (const request of state.productionPublishQueue) {
        if (!this.processedPublishIds.has(request.id)) this.processPublish(request)
      }
    })
  }

  private scheduleCheckpoint() {
    if (this.checkpointTimer) clearTimeout(this.checkpointTimer)
    this.checkpointTimer = setTimeout(() => {
      this.checkpointTimer = null
      const state = useTripStore.getState()
      if (this.disposed || state.productionSync.mode !== 'production' || !state.dirty) return
      if (state.productionPublishQueue.length) {
        this.scheduleCheckpoint()
        return
      }
      state.publishVersion('自动保存', 'manual_auto')
    }, 5_000)
  }

  private scheduleRevisionPoll() {
    if (this.revisionTimer) clearTimeout(this.revisionTimer)
    if (this.disposed) return
    const delay = typeof document !== 'undefined' && document.visibilityState === 'hidden' ? 15_000 : 2_000
    this.revisionTimer = setTimeout(() => {
      this.revisionTimer = null
      void this.pollRevision().finally(() => this.scheduleRevisionPoll())
    }, delay)
  }

  private async pollRevision() {
    const state = useTripStore.getState()
    if (this.disposed || state.productionSync.mode !== 'production' || !state.productionSync.hydrated) return
    try {
      const remote = await this.request<RevisionResult>(`/api/v1/trips/${state.trip.tripId}/revision`)
      if (remote.draftRevision === this.draftRevision && remote.currentVersionId === this.currentVersionId) return
      if (state.dirty || state.productionPublishQueue.length || this.latestDraft) {
        state.notify('Agent 已更新路书；完成当前编辑后会重新同步')
        return
      }

      const detail = asRecord(await this.request<unknown>(`/api/v1/trips/${state.trip.tripId}`))
      const draft = asRecord(detail.draft)
      const trip = asRecord(detail.trip)
      const snapshot = TripSnapshotSchema.parse(draft.snapshot)
      const draftRevision = readNumber(draft, 'revision') ?? remote.draftRevision
      const currentVersionId = readString(trip, 'currentVersionId', 'current_version_id') ?? remote.currentVersionId
      const rawVersions = await this.request<unknown[]>(`/api/v1/trips/${state.trip.tripId}/versions`)
      const versions = normalizeVersions(rawVersions, snapshot, currentVersionId, this.userId)

      this.refreshing = true
      useTripStore.getState().hydrateProduction({
        snapshot,
        derived: recalculate(snapshot),
        versions,
        draftRevision,
        currentVersionId,
      })
      this.draftRevision = draftRevision
      this.currentVersionId = currentVersionId
      this.savedLocalRevision = useTripStore.getState().revision
      useTripStore.getState().notify(`Agent 已更新 · v${remote.versionNo}`)
    } catch {
      // Revision polling is opportunistic. The normal save path remains authoritative.
    } finally {
      this.refreshing = false
    }
  }

  private enqueue(operation: () => Promise<void>) {
    const result = this.operationChain.then(operation, operation)
    this.operationChain = result.catch(() => undefined)
    return result
  }

  private scheduleDraft(snapshot: TripSnapshot, localRevision: number, delay = this.debounceMs) {
    this.latestDraft = { snapshot, localRevision }
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.enqueue(() => this.flushLatestDraft()).catch((error) => {
        useTripStore.getState().failProductionOperation(errorMessage(error))
      })
    }, delay)
  }

  private async saveSnapshot(snapshot: TripSnapshot, localRevision: number) {
    if (localRevision <= this.savedLocalRevision) return
    const result = await this.request<DraftSaveResult>(`/api/v1/trips/${snapshot.tripId}/draft`, {
      method: 'PUT',
      headers: this.mutationHeaders(),
      body: JSON.stringify({ revision: this.draftRevision, snapshot }),
    })
    this.draftRevision = result.revision
    this.savedLocalRevision = localRevision
    useTripStore.getState().acknowledgeProductionDraft(result.revision, localRevision)
  }

  private async flushLatestDraft() {
    const pending = this.latestDraft
    if (!pending) return
    this.latestDraft = null
    await this.saveSnapshot(pending.snapshot, pending.localRevision)
    const nextDraft = this.latestDraft as { snapshot: TripSnapshot; localRevision: number } | null
    if (nextDraft && nextDraft.localRevision > this.savedLocalRevision) {
      this.scheduleDraft(nextDraft.snapshot, nextDraft.localRevision)
    }
  }

  private processPublish(request: ProductionPublishRequest) {
    this.processedPublishIds.add(request.id)
    if (this.checkpointTimer) {
      clearTimeout(this.checkpointTimer)
      this.checkpointTimer = null
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (this.latestDraft && this.latestDraft.localRevision <= request.localRevision) {
      this.latestDraft = null
    }
    void this.enqueue(async () => {
      try {
        await this.saveSnapshot(request.snapshot, request.localRevision)
        const result = await this.request<PublishResult>(`/api/v1/trips/${request.snapshot.tripId}/publish`, {
          method: 'POST',
          headers: this.mutationHeaders(),
          body: JSON.stringify({
            baseVersionId: this.currentVersionId,
            draftRevision: this.draftRevision,
            snapshot: request.snapshot,
            derivedSnapshot: request.derivedSnapshot,
            message: request.message,
            source: request.source,
          }),
        })
        const version = TripVersionSchema.parse(result.version)
        this.currentVersionId = version.id
        this.draftRevision = result.draftRevision
        this.savedLocalRevision = Math.max(this.savedLocalRevision, request.localRevision)
        useTripStore.getState().completeProductionPublish(request.id, version, result.draftRevision)
        const latest = this.latestDraft
        if (latest && latest.localRevision > request.localRevision) {
          this.scheduleDraft(latest.snapshot, latest.localRevision, 0)
        }
      } catch (error) {
        useTripStore.getState().failProductionOperation(errorMessage(error), request.id)
      }
    })
  }

  async flushNow() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    await this.enqueue(() => this.flushLatestDraft())
    await this.operationChain
  }

  async whenIdle() {
    await this.operationChain
  }

  dispose() {
    this.disposed = true
    if (this.saveTimer) clearTimeout(this.saveTimer)
    if (this.checkpointTimer) clearTimeout(this.checkpointTimer)
    if (this.revisionTimer) clearTimeout(this.revisionTimer)
    this.unsubscribe?.()
    this.abortController.abort()
  }
}

export function createProductionSyncController(options: ProductionSyncControllerOptions) {
  return new ProductionSyncController(options)
}

export function ProductionBridge({ apiBase, debounceMs }: ProductionBridgeProps) {
  useEffect(() => {
    const config = getProductionBridgeConfig()
    if (!config) {
      useTripStore.getState().setProductionSync({ mode: 'demo', hydrated: false, error: null })
      return
    }

    const supabase = getSupabaseClient()
    if (!supabase) return
    let controller: ProductionSyncController | null = null
    let activeToken: string | null = null
    let activeUserId: string | null = null
    let disposed = false

    const activate = (session: Session | null) => {
      const recoveryRoute = window.location.pathname === '/reset-password'
        || ((window.location.pathname === '/auth/callback' || window.location.pathname === '/auth/confirm')
          && new URLSearchParams(window.location.search).get('type') === 'recovery')
      if (recoveryRoute) {
        controller?.dispose()
        controller = null
        activeToken = null
        return
      }
      if (disposed || session?.access_token === activeToken) return
      controller?.dispose()
      controller = null
      activeToken = session?.access_token ?? null
      if (!session) {
        activeUserId = null
        useTripStore.getState().setProductionSync({
          mode: 'auth-required',
          hydrated: false,
          draftRevision: null,
          currentVersionId: null,
          error: null,
        })
        return
      }
      if (activeUserId !== session.user.id) {
        useTripStore.getState().resetDemo()
        activeUserId = session.user.id
      }
      controller = createProductionSyncController({
        accessToken: session.access_token,
        userId: session.user.id,
        apiBase,
        debounceMs,
      })
      void controller.start()
    }

    void supabase.auth.getSession().then(({ data }) => activate(data.session))
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      queueMicrotask(() => activate(session))
    })

    return () => {
      disposed = true
      controller?.dispose()
      authListener.subscription.unsubscribe()
    }
  }, [apiBase, debounceMs])

  return null
}
