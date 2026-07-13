import { z } from 'zod'

import { AppError } from '../lib/errors'
import type { AppContext } from '../types'
import { reportProviderIssue } from './provider-alerts'
import { sendTencentTemplateEmail, TencentEmailError } from './tencent-email'

const PUBLIC_ORIGIN = 'https://jovlo.8xd.io'
const RATE_WINDOW_MS = 60 * 60 * 1_000
const EMAIL_RATE_LIMIT = 5
const IP_RATE_LIMIT = 20
const encoder = new TextEncoder()

const BaseAuthEmailSchema = z.object({
  email: z.string().email().max(320).transform((value) => value.trim().toLowerCase()),
  gotrue_meta_security: z.object({ captcha_token: z.string().max(2_048).optional() }).optional(),
  code_challenge: z.string().max(512).nullable().optional(),
  code_challenge_method: z.string().max(32).nullable().optional(),
})

const SignupSchema = BaseAuthEmailSchema.extend({
  password: z.string().min(8).max(128),
  data: z.record(z.string(), z.unknown()).default({}),
})

const RecoverySchema = BaseAuthEmailSchema

const GeneratedLinkSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  hashed_token: z.string().min(1),
  verification_type: z.enum(['signup', 'recovery']),
}).passthrough()

type AuthEmailAction = 'signup' | 'recovery'
type GeneratedLink = z.infer<typeof GeneratedLinkSchema>

function requireManagedAuthConfig(context: AppContext) {
  const url = context.env.SUPABASE_URL?.replace(/\/$/, '')
  const serviceRoleKey = context.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceRoleKey) {
    throw new AppError('DEPENDENCY_UNAVAILABLE', '账号邮件服务尚未完成配置', 503, {
      retryable: true,
    })
  }
  return { url, serviceRoleKey }
}

function safeCallbackUrl(redirectTo: string | null): URL {
  try {
    const candidate = new URL(redirectTo ?? '')
    if (candidate.origin === PUBLIC_ORIGIN && candidate.pathname === '/auth/callback') {
      const returnTo = candidate.searchParams.get('returnTo')
      const safeReturnTo = returnTo?.startsWith('/trips') && !returnTo.startsWith('//')
        ? returnTo
        : '/trips'
      const callback = new URL('/auth/callback', PUBLIC_ORIGIN)
      callback.searchParams.set('returnTo', safeReturnTo)
      return callback
    }
  } catch {
    // Use the product callback below.
  }
  const callback = new URL('/auth/callback', PUBLIC_ORIGIN)
  callback.searchParams.set('returnTo', '/trips')
  return callback
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function incrementRateLimit(
  context: AppContext,
  rawKey: string,
  limit: number,
): Promise<void> {
  const database = context.env.AGENT_GRANTS
  if (!database) return
  const now = Date.now()
  const cutoff = now - RATE_WINDOW_MS
  const throttleKey = await sha256(rawKey)
  const result = await database.prepare(`INSERT INTO auth_email_rate_limits (
      throttle_key, window_started_at, request_count
    ) VALUES (?, ?, 1)
    ON CONFLICT(throttle_key) DO UPDATE SET
      window_started_at = CASE
        WHEN auth_email_rate_limits.window_started_at <= ? THEN excluded.window_started_at
        ELSE auth_email_rate_limits.window_started_at
      END,
      request_count = CASE
        WHEN auth_email_rate_limits.window_started_at <= ? THEN 1
        ELSE auth_email_rate_limits.request_count + 1
      END
    RETURNING request_count`)
    .bind(throttleKey, now, cutoff, cutoff)
    .first<{ request_count: number }>()
  if ((result?.request_count ?? 1) > limit) {
    throw new AppError('RATE_LIMITED', '验证邮件请求过于频繁，请稍后再试', 429, {
      retryable: true,
    })
  }
}

async function enforceRateLimits(
  context: AppContext,
  action: AuthEmailAction,
  email: string,
): Promise<void> {
  const remoteIp = context.req.header('cf-connecting-ip')?.trim().slice(0, 64) || 'unknown'
  await Promise.all([
    incrementRateLimit(context, `email:${action}:${email}`, EMAIL_RATE_LIMIT),
    incrementRateLimit(context, `ip:${action}:${remoteIp}`, IP_RATE_LIMIT),
  ])
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const body = await response.json()
    return body && typeof body === 'object' && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function upstreamMessage(body: Record<string, unknown>): string {
  for (const key of ['message', 'msg', 'error_description', 'error']) {
    const value = body[key]
    if (typeof value === 'string') return value
  }
  return ''
}

function isExistingUser(body: Record<string, unknown>): boolean {
  const code = typeof body.code === 'string' ? body.code : ''
  const message = upstreamMessage(body)
  return code === 'user_already_exists' || /already.*(registered|exists)/i.test(message)
}

function isMissingUser(status: number, body: Record<string, unknown>): boolean {
  const code = typeof body.code === 'string' ? body.code : ''
  return status === 404 || code === 'user_not_found' || /user.*not.*found/i.test(upstreamMessage(body))
}

async function generateLink(
  context: AppContext,
  action: AuthEmailAction,
  input: { email: string; password?: string; data?: Record<string, unknown> },
  callback: URL,
): Promise<GeneratedLink | null> {
  const { url, serviceRoleKey } = requireManagedAuthConfig(context)
  const endpoint = new URL(`${url}/auth/v1/admin/generate_link`)
  endpoint.searchParams.set('redirect_to', callback.toString())
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ type: action, ...input }),
    })
  } catch {
    throw new AppError('DEPENDENCY_UNAVAILABLE', '账号服务暂时不可用', 503, {
      retryable: true,
    })
  }
  const body = await readJson(response)
  if (!response.ok) {
    if (action === 'signup' && isExistingUser(body)) {
      throw new AppError('VALIDATION_FAILED', '该邮箱已注册，请直接登录', 409)
    }
    if (action === 'recovery' && isMissingUser(response.status, body)) return null
    reportProviderIssue(context, {
      provider: 'supabase',
      code: typeof body.code === 'string' ? body.code : `HTTP_${response.status}`,
      message: 'Supabase 未能生成账号验证令牌',
      impact: `${action === 'signup' ? '注册' : '找回密码'}邮件暂未发出`,
    })
    throw new AppError('DEPENDENCY_UNAVAILABLE', '账号服务暂时不可用', 503, {
      retryable: true,
    })
  }
  const parsed = GeneratedLinkSchema.safeParse(body)
  if (!parsed.success || parsed.data.verification_type !== action) {
    reportProviderIssue(context, {
      provider: 'supabase',
      code: 'INVALID_GENERATE_LINK_RESPONSE',
      message: 'Supabase 返回了无效的账号验证令牌',
      impact: `${action === 'signup' ? '注册' : '找回密码'}邮件暂未发出`,
    })
    throw new AppError('DEPENDENCY_UNAVAILABLE', '账号服务暂时不可用', 503, {
      retryable: true,
    })
  }
  return parsed.data
}

async function deleteUnverifiedUser(context: AppContext, userId: string): Promise<void> {
  const { url, serviceRoleKey } = requireManagedAuthConfig(context)
  try {
    const response = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
      },
    })
    if (!response.ok) throw new Error('delete failed')
  } catch {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      requestId: context.get('requestId'),
      event: 'auth_signup_rollback_failed',
      userId,
    }))
  }
}

function templateId(context: AppContext, action: AuthEmailAction): number {
  const value = action === 'signup'
    ? context.env.TENCENT_SES_SIGNUP_TEMPLATE_ID
    : context.env.TENCENT_SES_RECOVERY_TEMPLATE_ID
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError('DEPENDENCY_UNAVAILABLE', '账号邮件模板尚未完成配置', 503, {
      retryable: true,
    })
  }
  return parsed
}

function actionQuery(link: GeneratedLink, action: AuthEmailAction, callback: URL): string {
  const query = new URLSearchParams({
    token_hash: link.hashed_token,
    type: action,
    returnTo: callback.searchParams.get('returnTo') || '/trips',
  })
  return query.toString()
}

function publicUser(link: GeneratedLink): Record<string, unknown> {
  const {
    action_link: _actionLink,
    email_otp: _emailOtp,
    hashed_token: _hashedToken,
    redirect_to: _redirectTo,
    verification_type: _verificationType,
    ...user
  } = link
  return user
}

async function deliverEmail(
  context: AppContext,
  action: AuthEmailAction,
  link: GeneratedLink,
  callback: URL,
): Promise<void> {
  try {
    await sendTencentTemplateEmail(context.env, {
      to: link.email,
      subject: action === 'signup' ? '验证你的 Jovlo 邮箱' : '重置你的 Jovlo 密码',
      templateId: templateId(context, action),
      templateData: { action_query: actionQuery(link, action, callback) },
    })
  } catch (error) {
    const failure = error instanceof TencentEmailError
      ? error
      : new TencentEmailError('UNAVAILABLE', '邮件服务暂时不可用', { retryable: true })
    reportProviderIssue(context, {
      provider: 'tencent-ses',
      code: failure.code,
      message: failure.message,
      impact: `${action === 'signup' ? '注册' : '找回密码'}邮件暂未发出`,
      notifyByEmail: false,
    })
    if (action === 'signup') await deleteUnverifiedUser(context, link.id)
    const quotaError = failure.code === 'LimitExceeded' || failure.code === 'ResourceInsufficient'
    throw new AppError('DEPENDENCY_UNAVAILABLE', failure.message, quotaError ? 429 : 424, {
      retryable: failure.retryable,
    })
  }
}

export async function handleManagedAuthEmail(
  context: AppContext,
  action: AuthEmailAction,
  rawBody: string,
  redirectTo: string | null,
): Promise<Response> {
  const callback = safeCallbackUrl(redirectTo)
  let link: GeneratedLink | null
  if (action === 'signup') {
    const parsed = SignupSchema.safeParse(JSON.parse(rawBody))
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', '账号信息格式不正确', 400)
    }
    await enforceRateLimits(context, action, parsed.data.email)
    link = await generateLink(context, action, {
      email: parsed.data.email,
      password: parsed.data.password,
      data: parsed.data.data,
    }, callback)
  } else {
    const parsed = RecoverySchema.safeParse(JSON.parse(rawBody))
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', '账号信息格式不正确', 400)
    }
    await enforceRateLimits(context, action, parsed.data.email)
    link = await generateLink(context, action, { email: parsed.data.email }, callback)
  }
  if (!link) {
    return Response.json({}, { headers: { 'cache-control': 'no-store' } })
  }
  await deliverEmail(context, action, link, callback)
  return Response.json(action === 'signup' ? publicUser(link) : {}, {
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}
