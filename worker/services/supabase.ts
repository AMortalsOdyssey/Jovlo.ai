import { z } from 'zod'
import { AppError, mapDatabaseError } from '../lib/errors'
import type { AppContext, AuthenticatedUser } from '../types'
import { verifyTurnstileChallenge, type TurnstileAction } from './turnstile'

const SupabaseUserSchema = z.object({ id: z.string().uuid() }).passthrough()

function requireSupabaseConfig(context: AppContext) {
  const url = context.env.SUPABASE_URL?.replace(/\/$/, '')
  const publishableKey = context.env.SUPABASE_PUBLISHABLE_KEY
  if (!url || !publishableKey) {
    throw new AppError('DEPENDENCY_UNAVAILABLE', '生产模式缺少 Supabase 配置', 503, {
      userAction: '请联系管理员检查服务配置',
    })
  }
  return { url, publishableKey }
}

const AUTH_PROXY_METHODS: Record<string, readonly string[]> = {
  '/signup': ['POST'],
  '/token': ['POST'],
  '/verify': ['POST'],
  '/recover': ['POST'],
  '/resend': ['POST'],
  '/user': ['GET', 'PUT'],
  '/logout': ['POST'],
  '/settings': ['GET'],
}

function requiredTurnstileAction(
  authPath: string,
  method: string,
  requestUrl: URL,
): TurnstileAction | null {
  if (method !== 'POST') return null
  if (authPath === '/signup') return 'signup'
  if (authPath === '/recover') return 'password_reset'
  if (authPath === '/token' && requestUrl.searchParams.get('grant_type') === 'password') {
    return 'login'
  }
  return null
}

function captchaTokenFromBody(rawBody: string): string | undefined {
  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    throw new AppError('VALIDATION_FAILED', '认证请求不是有效 JSON', 400)
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const security = (body as Record<string, unknown>).gotrue_meta_security
  if (!security || typeof security !== 'object' || Array.isArray(security)) return undefined
  const token = (security as Record<string, unknown>).captcha_token
  return typeof token === 'string' ? token : undefined
}

export async function proxySupabaseAuthRequest(context: AppContext): Promise<Response> {
  const requestUrl = new URL(context.req.url)
  const origin = context.req.header('origin')
  if (origin && origin !== requestUrl.origin) {
    throw new AppError('FORBIDDEN', '不允许跨站调用账号接口', 403)
  }
  const authPath = requestUrl.pathname.slice('/supabase/auth/v1'.length) || '/settings'
  const allowedMethods = AUTH_PROXY_METHODS[authPath]
  if (!allowedMethods?.includes(context.req.method)) {
    throw new AppError('VALIDATION_FAILED', '认证接口不存在', 404)
  }

  const contentLength = Number(context.req.header('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > 64 * 1_024) {
    throw new AppError('VALIDATION_FAILED', '认证请求内容过大', 413)
  }
  if (!['GET', 'HEAD'].includes(context.req.method)) {
    const contentType = (context.req.header('content-type') ?? '').toLowerCase()
    if (!contentType.includes('application/json')) {
      throw new AppError('VALIDATION_FAILED', '认证请求必须使用 application/json', 415)
    }
  }

  const { url, publishableKey } = requireSupabaseConfig(context)
  const headers = new Headers({
    apikey: publishableKey,
    accept: 'application/json',
  })
  const authorization = context.req.header('authorization')
  const contentType = context.req.header('content-type')
  const clientInfo = context.req.header('x-client-info')
  if (authorization) headers.set('authorization', authorization)
  if (contentType) headers.set('content-type', contentType)
  if (clientInfo) headers.set('x-client-info', clientInfo.slice(0, 200))

  let rawBody: string | undefined
  if (!['GET', 'HEAD'].includes(context.req.method)) {
    rawBody = await context.req.raw.text()
    if (new TextEncoder().encode(rawBody).byteLength > 64 * 1_024) {
      throw new AppError('VALIDATION_FAILED', '认证请求内容过大', 413)
    }
    const turnstileAction = requiredTurnstileAction(authPath, context.req.method, requestUrl)
    if (turnstileAction) {
      await verifyTurnstileChallenge(context, captchaTokenFromBody(rawBody), turnstileAction)
    }
  }

  let response: Response
  try {
    response = await fetch(`${url}/auth/v1${authPath}${requestUrl.search}`, {
      method: context.req.method,
      headers,
      body: rawBody,
      redirect: 'manual',
    })
  } catch {
    throw new AppError('DEPENDENCY_UNAVAILABLE', '账号服务暂时不可用', 503, {
      retryable: true,
      userAction: '请稍后重试',
    })
  }

  const responseHeaders = new Headers()
  for (const name of ['content-type', 'cache-control', 'x-supabase-api-version']) {
    const value = response.headers.get(name)
    if (value) responseHeaders.set(name, value)
  }
  responseHeaders.set('cache-control', 'no-store')
  responseHeaders.set('x-content-type-options', 'nosniff')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  })
}

export async function requireAuthenticatedUser(
  context: AppContext,
): Promise<AuthenticatedUser> {
  if (context.get('mode') === 'demo') {
    return {
      id: 'd0000000-0000-4000-8000-000000000001',
      token: null,
      mode: 'demo',
    }
  }

  const authorization = context.req.header('authorization')
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? '')
  if (!match) {
    throw new AppError('AUTH_REQUIRED', '需要登录后继续', 401, {
      userAction: '请重新登录',
    })
  }
  const token = match[1].trim()
  const { url, publishableKey } = requireSupabaseConfig(context)
  let response: Response
  try {
    response = await fetch(`${url}/auth/v1/user`, {
      headers: {
        apikey: publishableKey,
        authorization: `Bearer ${token}`,
      },
    })
  } catch {
    throw new AppError('DEPENDENCY_UNAVAILABLE', '暂时无法验证登录状态', 503, {
      retryable: true,
      userAction: '请稍后重试',
    })
  }
  if (response.status === 401 || response.status === 403) {
    throw new AppError('AUTH_REQUIRED', '登录状态无效或已过期', 401, {
      userAction: '请重新登录',
    })
  }
  if (!response.ok) {
    throw new AppError('DEPENDENCY_UNAVAILABLE', '暂时无法验证登录状态', 503, {
      retryable: true,
      userAction: '请稍后重试',
    })
  }
  const parsed = SupabaseUserSchema.safeParse(await response.json())
  if (!parsed.success) {
    throw new AppError('AUTH_REQUIRED', '登录凭据未通过验证', 401, {
      userAction: '请重新登录',
    })
  }
  return { id: parsed.data.id, token, mode: 'production' }
}

export async function callSupabaseRpc<T>(
  context: AppContext,
  functionName: string,
  payload: Record<string, unknown>,
  token?: string | null,
): Promise<T> {
  const { url, publishableKey } = requireSupabaseConfig(context)
  let response: Response
  try {
    response = await fetch(`${url}/rest/v1/rpc/${encodeURIComponent(functionName)}`, {
      method: 'POST',
      headers: {
        apikey: publishableKey,
        authorization: `Bearer ${token ?? publishableKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(payload),
    })
  } catch {
    throw new AppError('DEPENDENCY_UNAVAILABLE', '数据库请求暂时不可用', 503, {
      retryable: true,
    })
  }
  if (!response.ok) {
    const body = await response.text()
    throw mapDatabaseError(body)
  }
  return (await response.json()) as T
}

export async function readSupabaseRow<T>(
  context: AppContext,
  table: string,
  query: string,
  token: string,
): Promise<T | null> {
  const { url, publishableKey } = requireSupabaseConfig(context)
  let response: Response
  try {
    response = await fetch(`${url}/rest/v1/${encodeURIComponent(table)}?${query}`, {
      headers: {
        apikey: publishableKey,
        authorization: `Bearer ${token}`,
        accept: 'application/json',
      },
    })
  } catch {
    throw new AppError('DEPENDENCY_UNAVAILABLE', '数据库请求暂时不可用', 503, {
      retryable: true,
    })
  }
  if (!response.ok) throw mapDatabaseError(await response.text())
  const rows = (await response.json()) as T[]
  return rows[0] ?? null
}

export async function readSupabaseRows<T>(
  context: AppContext,
  table: string,
  query: string,
  token: string,
): Promise<T[]> {
  const { url, publishableKey } = requireSupabaseConfig(context)
  let response: Response
  try {
    response = await fetch(`${url}/rest/v1/${encodeURIComponent(table)}?${query}`, {
      headers: {
        apikey: publishableKey,
        authorization: `Bearer ${token}`,
        accept: 'application/json',
      },
    })
  } catch {
    throw new AppError('DEPENDENCY_UNAVAILABLE', '数据库请求暂时不可用', 503, {
      retryable: true,
    })
  }
  if (!response.ok) throw mapDatabaseError(await response.text())
  return (await response.json()) as T[]
}
