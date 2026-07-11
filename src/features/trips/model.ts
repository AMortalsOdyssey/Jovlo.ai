import type { TripSnapshotV1 } from '@domain'

export type AnyRecord = Record<string, unknown>

export type EvidenceStatus =
  | 'official'
  | 'corroborated'
  | 'single_source'
  | 'conflicting'
  | 'stale'
  | 'excluded'

export type TripDayView = {
  id: string
  dayIndex: number
  date?: string
  startTime?: string
  overnightLabel?: string
  stops: TripStopView[]
  raw: AnyRecord
}

export type TripStopView = {
  id: string
  placeId: string
  name: string
  kind: string
  plannedStart?: string
  stayMinutes: number
  sourceIds: string[]
  note?: string
  raw: AnyRecord
}

export type ExpenseView = {
  id: string
  amount: number
  category: string
  dayId?: string
  stopId?: string
  occurredOn?: string
  note?: string
}

export type ActualView = {
  id: string
  dayId?: string
  stopId?: string
  status: 'visited' | 'skipped' | 'unrecorded'
  rating?: number
  note?: string
  raw: AnyRecord
}

export type VersionView = {
  id: string
  versionNo: number
  source: string
  message: string
  createdAt?: string
  snapshot?: AnyRecord
  derivedSnapshot?: AnyRecord
  raw: AnyRecord
}

export type ReportView = {
  id: string
  generationNo: number
  type: 'plan' | 'actual'
  status: 'queued' | 'generating' | 'ready' | 'stale' | 'failed'
  versionId?: string
  versionNo?: number
  createdAt?: string
  token?: string
  failureReason?: string
  content?: AnyRecord
  raw: AnyRecord
}

export type SourceView = {
  id: string
  title: string
  platform: string
  url?: string
  author?: string
  publishedAt?: string
  capturedAt?: string
  summary?: string
  commercialRelationship?: 'yes' | 'no' | 'unknown'
  raw: AnyRecord
}

export type ClaimView = {
  id: string
  placeId?: string
  placeName: string
  field: string
  value: string
  status: EvidenceStatus
  sourceIds: string[]
  reason?: string
  verifiedAt?: string
  raw: AnyRecord
}

export function asRecord(value: unknown): AnyRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as AnyRecord)
    : {}
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function readString(value: unknown, ...keys: string[]): string | undefined {
  const record = asRecord(value)
  for (const key of keys) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate
  }
  return undefined
}

export function readNumber(value: unknown, ...keys: string[]): number | undefined {
  const record = asRecord(value)
  for (const key of keys) {
    const candidate = record[key]
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate
    if (typeof candidate === 'string' && candidate.trim() && Number.isFinite(Number(candidate))) {
      return Number(candidate)
    }
  }
  return undefined
}

export function readBoolean(value: unknown, ...keys: string[]): boolean | undefined {
  const record = asRecord(value)
  for (const key of keys) {
    if (typeof record[key] === 'boolean') return record[key] as boolean
  }
  return undefined
}

export function readStringArray(value: unknown, ...keys: string[]): string[] {
  const record = asRecord(value)
  for (const key of keys) {
    const candidate = record[key]
    if (Array.isArray(candidate)) {
      return candidate.filter((item): item is string => typeof item === 'string')
    }
  }
  return []
}

export function formatMoney(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0)
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(
    Number.isFinite(value) ? value : 0,
  )
}

export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes)) return '待计算'
  const hours = Math.floor(minutes / 60)
  const rest = Math.round(minutes % 60)
  if (hours === 0) return `${rest} 分钟`
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分钟`
}

export function formatDateLabel(value?: string): string {
  if (!value) return '日期待定'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date)
}

export function getTripRecord(trip: TripSnapshotV1 | unknown): AnyRecord {
  return asRecord(trip)
}

export function getTripId(trip: TripSnapshotV1 | unknown): string {
  return readString(trip, 'tripId', 'id') ?? 'demo-trip'
}

export function getTripTitle(trip: TripSnapshotV1 | unknown): string {
  return readString(trip, 'title', 'name') ?? '未命名路书'
}

export function getTripIntent(trip: TripSnapshotV1 | unknown): AnyRecord {
  return asRecord(getTripRecord(trip).intent)
}

export function getPlaceRefs(trip: TripSnapshotV1 | unknown): Record<string, AnyRecord> {
  const refs = asRecord(getTripRecord(trip).placeRefs)
  return Object.fromEntries(Object.entries(refs).map(([id, value]) => [id, asRecord(value)]))
}

export function getSourceRefs(trip: TripSnapshotV1 | unknown): Record<string, AnyRecord> {
  const refs = asRecord(getTripRecord(trip).sourceRefs)
  return Object.fromEntries(Object.entries(refs).map(([id, value]) => [id, asRecord(value)]))
}

export function getTripDays(trip: TripSnapshotV1 | unknown): TripDayView[] {
  const tripRecord = getTripRecord(trip)
  const places = getPlaceRefs(trip)

  return asArray(tripRecord.days)
    .map((value, index) => {
      const day = asRecord(value)
      const stay = asRecord(day.overnightStay)
      const stayPlace = places[readString(stay, 'placeId') ?? '']
      const stops = asArray(day.stops).map((stopValue, stopIndex) => {
        const stop = asRecord(stopValue)
        const placeId = readString(stop, 'placeId') ?? `unknown-place-${stopIndex}`
        const place = places[placeId] ?? {}
        return {
          id: readString(stop, 'id', 'stopId') ?? `stop-${index + 1}-${stopIndex + 1}`,
          placeId,
          name: readString(place, 'name', 'label') ?? readString(stop, 'name', 'label') ?? '待定地点',
          kind: readString(stop, 'kind', 'type') ?? readString(place, 'type') ?? 'custom',
          plannedStart: readString(stop, 'plannedStart', 'startTime'),
          stayMinutes: readNumber(stop, 'stayMinutes', 'durationMinutes') ?? 60,
          sourceIds: readStringArray(stop, 'sourceIds', 'sources'),
          note: readString(stop, 'publicNote', 'note'),
          raw: stop,
        }
      })

      return {
        id: readString(day, 'id', 'dayId') ?? `day-${index + 1}`,
        dayIndex: readNumber(day, 'dayIndex', 'index') ?? index + 1,
        date: readString(day, 'date'),
        startTime: readString(day, 'startTime'),
        overnightLabel:
          readString(stay, 'label', 'name') ?? readString(stayPlace, 'name', 'label') ?? undefined,
        stops,
        raw: day,
      }
    })
    .sort((a, b) => a.dayIndex - b.dayIndex)
}

export function getDerivedDay(derived: unknown, dayId: string, dayIndex?: number): AnyRecord {
  const root = asRecord(derived)
  const candidates = [root.daySchedules, root.days, root.daySummaries, root.daily, root.dayHealth]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const found = candidate.find((value) => {
        const record = asRecord(value)
        return (
          readString(record, 'dayId', 'id') === dayId ||
          (dayIndex !== undefined && readNumber(record, 'dayIndex', 'index') === dayIndex)
        )
      })
      if (found) return asRecord(found)
    }
    const record = asRecord(candidate)
    if (record[dayId]) return asRecord(record[dayId])
  }
  return {}
}

export function getTripDistanceMeters(derived: unknown): number {
  const root = asRecord(derived)
  const totals = asRecord(root.totals ?? root.summary)
  const direct =
    readNumber(root, 'totalDistanceMeters', 'distanceMeters') ??
    readNumber(totals, 'distanceMeters', 'totalDistanceMeters') ??
    readNumber(root.budget, 'totalDistanceMeters')
  if (direct !== undefined) return direct

  return asArray(root.routeLegs ?? root.segments ?? root.routeSegments).reduce<number>(
    (sum, segment) => sum + (readNumber(segment, 'distanceMeters', 'distance') ?? 0),
    0,
  )
}

export function getTripDriveMinutes(derived: unknown): number {
  const root = asRecord(derived)
  const totals = asRecord(root.totals ?? root.summary)
  const direct =
    readNumber(root, 'totalDurationMinutes', 'driveMinutes') ??
    readNumber(totals, 'durationMinutes', 'driveMinutes')
  if (direct !== undefined) return direct

  return asArray(root.routeLegs ?? root.segments ?? root.routeSegments).reduce<number>((sum, segment) => {
    const seconds = readNumber(segment, 'durationSeconds')
    return sum + (seconds !== undefined ? seconds / 60 : (readNumber(segment, 'durationMinutes') ?? 0))
  }, 0)
}

export function getPlannedBudget(trip: TripSnapshotV1 | unknown, derived: unknown): number {
  const derivedRecord = asRecord(derived)
  const budget = asRecord(derivedRecord.budget ?? derivedRecord.budgetSummary)
  const total = asRecord(budget.total)
  return (
    readNumber(total, 'expected', 'planned', 'amount') ??
    readNumber(budget, 'expected', 'planned', 'totalExpected') ??
    readNumber(getTripIntent(trip), 'totalBudget') ??
    0
  )
}

export function normalizeExpenses(expenses: unknown): ExpenseView[] {
  return asArray(expenses).map((value, index) => {
    const expense = asRecord(value)
    return {
      id: readString(expense, 'id', 'expenseId') ?? `expense-${index + 1}`,
      amount: readNumber(expense, 'amount', 'amountCny', 'value') ?? 0,
      category: readString(expense, 'category', 'type') ?? 'other',
      dayId: readString(expense, 'dayId'),
      stopId: readString(expense, 'stopId'),
      occurredOn: readString(expense, 'occurredOn', 'date', 'createdAt'),
      note: readString(expense, 'note', 'description'),
    }
  })
}

export function normalizeActuals(actuals: unknown): ActualView[] {
  return asArray(actuals).map((value, index) => {
    const actual = asRecord(value)
    const explicit = readString(actual, 'status')
    const status =
      explicit === 'visited' || readBoolean(actual, 'visited') === true
        ? 'visited'
        : explicit === 'skipped' || readBoolean(actual, 'skipped') === true
          ? 'skipped'
          : 'unrecorded'
    return {
      id: readString(actual, 'id', 'actualId') ?? `actual-${index + 1}`,
      dayId: readString(actual, 'dayId'),
      stopId: readString(actual, 'stopId'),
      status,
      rating: readNumber(actual, 'rating'),
      note: readString(actual, 'note', 'comment'),
      raw: actual,
    }
  })
}

export function normalizeVersions(versions: unknown): VersionView[] {
  return asArray(versions)
    .map<VersionView>((value, index) => {
      const version = asRecord(value)
      return {
        id: readString(version, 'id', 'versionId') ?? `version-${index + 1}`,
        versionNo: readNumber(version, 'versionNo', 'number') ?? index + 1,
        source: readString(version, 'source') ?? 'manual',
        message: readString(version, 'message', 'title') ?? '手动保存',
        createdAt: readString(version, 'createdAt', 'created_at'),
        snapshot: Object.keys(asRecord(version.snapshot)).length ? asRecord(version.snapshot) : undefined,
        derivedSnapshot: Object.keys(asRecord(version.derivedSnapshot ?? version.derived_snapshot)).length
          ? asRecord(version.derivedSnapshot ?? version.derived_snapshot)
          : undefined,
        raw: version,
      }
    })
    .sort((a, b) => b.versionNo - a.versionNo)
}

export function normalizeReports(reports: unknown): ReportView[] {
  const allowedStatus = new Set(['queued', 'generating', 'ready', 'stale', 'failed'])
  return asArray(reports)
    .map<ReportView>((value, index) => {
      const report = asRecord(value)
      const config = asRecord(report.config)
      const statusValue = readString(report, 'status') ?? 'ready'
      const typeValue = readString(report, 'type', 'reportType')
      return {
        id: readString(report, 'id', 'reportId') ?? `report-${index + 1}`,
        generationNo:
          readNumber(report, 'generationNo', 'generation') ??
          readNumber(config, 'generationNo') ??
          index + 1,
        type: typeValue === 'actual' ? 'actual' : 'plan',
        status:
          statusValue === 'pending'
            ? 'generating'
            : statusValue === 'revoked'
              ? 'stale'
              : allowedStatus.has(statusValue)
                ? (statusValue as ReportView['status'])
                : 'failed',
        versionId: readString(report, 'versionId', 'tripVersionId'),
        versionNo: readNumber(report, 'tripVersionNo', 'versionNo'),
        createdAt: readString(report, 'createdAt', 'created_at'),
        token: readString(report, 'token', 'shareToken'),
        failureReason: readString(report, 'failureReason', 'errorCode', 'error', 'message'),
        content: Object.keys(asRecord(report.content ?? report.snapshot)).length
          ? asRecord(report.content ?? report.snapshot)
          : undefined,
        raw: report,
      }
    })
    .sort((a, b) => b.generationNo - a.generationNo)
}

export function normalizeSources(trip: TripSnapshotV1 | unknown): SourceView[] {
  return Object.entries(getSourceRefs(trip)).map(([id, source]) => ({
    id: readString(source, 'sourceId', 'id') ?? id,
    title: readString(source, 'title') ?? '未命名来源',
    platform: readString(source, 'platform') ?? 'web',
    url: readString(source, 'url', 'canonicalUrl'),
    author: readString(source, 'author'),
    publishedAt: readString(source, 'publishedAt'),
    capturedAt: readString(source, 'capturedAt'),
    summary: readString(source, 'summary'),
    commercialRelationship:
      readString(source, 'commercialRelationship') === 'yes'
        ? 'yes'
        : readString(source, 'commercialRelationship') === 'no'
          ? 'no'
          : 'unknown',
    raw: source,
  }))
}

function normalizeEvidenceStatus(value?: string): EvidenceStatus {
  if (value === 'official') return 'official'
  if (value === 'corroborated') return 'corroborated'
  if (value === 'conflicting' || value === 'conflict') return 'conflicting'
  if (value === 'stale') return 'stale'
  if (value === 'excluded') return 'excluded'
  return 'single_source'
}

export function normalizeClaims(trip: TripSnapshotV1 | unknown, derived?: unknown): ClaimView[] {
  const tripRecord = getTripRecord(trip)
  const places = getPlaceRefs(trip)
  const derivedRecord = asRecord(derived)
  const explicit = [
    ...asArray(tripRecord.placeClaims ?? tripRecord.claims),
    ...asArray(derivedRecord.placeClaims ?? derivedRecord.claims ?? derivedRecord.evidence),
  ]

  if (explicit.length) {
    return explicit.map((value, index) => {
      const claim = asRecord(value)
      const placeId = readString(claim, 'placeId')
      const place = placeId ? places[placeId] : undefined
      const rawValue = claim.value ?? claim.valueJson ?? claim.value_json
      return {
        id: readString(claim, 'id', 'claimId') ?? `claim-${index + 1}`,
        placeId,
        placeName: readString(place, 'name') ?? readString(claim, 'placeName') ?? '行程信息',
        field: readString(claim, 'field') ?? 'note',
        value:
          typeof rawValue === 'string'
            ? rawValue
            : rawValue !== undefined
              ? JSON.stringify(rawValue)
              : '待确认',
        status: normalizeEvidenceStatus(readString(claim, 'evidenceStatus', 'status')),
        sourceIds: readStringArray(claim, 'sourceIds', 'sources'),
        reason: readString(claim, 'reason'),
        verifiedAt: readString(claim, 'verifiedAt'),
        raw: claim,
      }
    })
  }

  const claims: ClaimView[] = []
  for (const day of getTripDays(trip)) {
    for (const stop of day.stops) {
      if (!stop.sourceIds.length) continue
      const place = places[stop.placeId] ?? {}
      const variant = asRecord(place.selectedVariant)
      const fields: Array<[string, unknown]> = [
        ['opening_hours', variant.openingHours],
        ['price_range', variant.priceRange],
        ['parking', variant.parkingNote],
      ]
      for (const [field, rawValue] of fields) {
        if (rawValue === undefined || rawValue === null || rawValue === '') continue
        claims.push({
          id: `${stop.id}-${field}`,
          placeId: stop.placeId,
          placeName: stop.name,
          field,
          value: typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue),
          status: stop.sourceIds.length >= 2 ? 'corroborated' : 'single_source',
          sourceIds: stop.sourceIds,
          raw: {},
        })
      }
    }
  }
  return claims
}

export function getOptionalTripList(state: unknown): unknown[] {
  const record = asRecord(state)
  if (Array.isArray(record.trips)) return record.trips
  return record.trip ? [record.trip] : []
}
