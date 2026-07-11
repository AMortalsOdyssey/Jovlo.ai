export type ApiErrorCode =
  | 'AUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'VALIDATION_FAILED'
  | 'DRAFT_REVISION_STALE'
  | 'BASE_VERSION_STALE'
  | 'DIRTY_DRAFT_REQUIRES_CHECKPOINT'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'CHANGESET_INVALID'
  | 'CHANGESET_CONFLICT'
  | 'CHANGESET_STALE'
  | 'PLACE_PROPOSAL_UNRESOLVED'
  | 'ROUTE_NO_DATA'
  | 'ROUTE_PROVIDER_UNAVAILABLE'
  | 'ROUTE_QUOTA_EXCEEDED'
  | 'PUBLICATION_REVOKED'
  | 'REPORT_GENERATION_FAILED'
  | 'RATE_LIMITED'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'INTERNAL_ERROR'

export type ApiEnvelope<T> = {
  data: T | null
  meta: {
    requestId: string
    currentVersionId?: string
    mode?: 'demo' | 'production'
  }
  error: null | {
    code: ApiErrorCode
    message: string
    retryable: boolean
    userAction?: string
    details?: unknown
  }
}

export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly retryable: boolean
  readonly requestId?: string

  constructor(message: string, code: ApiErrorCode, retryable = false, requestId?: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.retryable = retryable
    this.requestId = requestId
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  })

  const envelope = (await response.json()) as ApiEnvelope<T>
  if (!response.ok || envelope.error || envelope.data === null) {
    const error = envelope.error
    throw new ApiError(
      error?.message ?? '请求暂时没有完成',
      error?.code ?? 'INTERNAL_ERROR',
      error?.retryable ?? response.status >= 500,
      envelope.meta?.requestId,
    )
  }
  return envelope.data
}

export function postJson<T>(path: string, value: unknown, idempotencyKey?: string): Promise<T> {
  return apiRequest<T>(path, {
    method: 'POST',
    headers: idempotencyKey ? { 'idempotency-key': idempotencyKey } : undefined,
    body: JSON.stringify(value),
  })
}
