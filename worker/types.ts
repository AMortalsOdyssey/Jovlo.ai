import type { Context } from 'hono'
import type { D1Database } from '@cloudflare/workers-types'

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

export type RuntimeMode = 'demo' | 'production'

export type Env = {
  ASSETS?: { fetch(request: Request): Promise<Response> }
  AGENT_GRANTS?: D1Database
  CF_VERSION_METADATA?: { id: string; tag?: string; timestamp?: string }
  JOVLO_MODE?: RuntimeMode
  BUILD_SHA?: string
  SUPABASE_URL?: string
  SUPABASE_PUBLISHABLE_KEY?: string
  TURNSTILE_SECRET_KEY?: string
  AMAP_WEB_SERVICE_KEY?: string
  AMAP_SECURITY_JSCODE?: string
  SHARE_TOKEN_PEPPER?: string
  AGENT_BRIDGE_SECRET?: string
  SUPABASE_SEND_EMAIL_HOOK_SECRET?: string
  TENCENTCLOUD_SECRET_ID?: string
  TENCENTCLOUD_SECRET_KEY?: string
  TENCENT_SES_REGION?: string
  TENCENT_SES_FROM?: string
  TENCENT_SES_REPLY_TO?: string
  TENCENT_SES_SIGNUP_TEMPLATE_ID?: string
  TENCENT_SES_RECOVERY_TEMPLATE_ID?: string
  TENCENT_SES_ALERT_TEMPLATE_ID?: string
  ALERT_EMAIL_TO?: string
}

export type AppVariables = {
  requestId: string
  mode: RuntimeMode
}

export type AppBindings = {
  Bindings: Env
  Variables: AppVariables
}

export type AppContext = Context<AppBindings>

export type ApiEnvelope<T> = {
  data: T | null
  meta: {
    requestId: string
    currentVersionId?: string
    mode: RuntimeMode
    [key: string]: unknown
  }
  error: null | {
    code: ApiErrorCode
    message: string
    retryable: boolean
    userAction?: string
    details?: unknown
  }
}

export type AuthenticatedUser = {
  id: string
  token: string | null
  mode: RuntimeMode
}
