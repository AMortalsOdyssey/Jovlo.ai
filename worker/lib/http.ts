import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import { AppError } from './errors'
import type { ApiEnvelope, AppContext, Env, RuntimeMode } from '../types'

export function runtimeMode(env: Env): RuntimeMode {
  return env.JOVLO_MODE === 'demo' ? 'demo' : 'production'
}

export function success<T>(
  context: AppContext,
  data: T,
  status: ContentfulStatusCode = 200,
  meta: Record<string, unknown> = {},
) {
  const envelope: ApiEnvelope<T> = {
    data,
    meta: {
      requestId: context.get('requestId'),
      mode: context.get('mode'),
      ...meta,
    },
    error: null,
  }
  return context.json(envelope, status)
}

export function failure(context: AppContext, error: AppError) {
  const envelope: ApiEnvelope<never> = {
    data: null,
    meta: {
      requestId: context.get('requestId'),
      mode: context.get('mode'),
    },
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      userAction: error.userAction,
      details: error.details,
    },
  }
  return context.json(envelope, error.status)
}

export async function parseJson<T>(
  context: AppContext,
  schema: z.ZodType<T>,
  maximumBytes = 256 * 1_024,
): Promise<T> {
  const contentType = context.req.header('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new AppError('VALIDATION_FAILED', '请求必须使用 application/json', 415, {
      userAction: '请检查请求 Content-Type',
    })
  }
  const contentLength = Number(context.req.header('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new AppError('VALIDATION_FAILED', '请求内容超过大小限制', 413, {
      userAction: '请缩小请求内容后重试',
    })
  }

  let value: unknown
  try {
    value = await context.req.json()
  } catch {
    throw new AppError('VALIDATION_FAILED', '请求不是有效 JSON', 400)
  }
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', '请求字段校验失败', 400, {
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    })
  }
  return parsed.data
}

export function requireIdempotencyKey(context: AppContext, expected?: string): string {
  const key = context.req.header('idempotency-key')?.trim()
  if (!key || key.length < 8 || key.length > 160) {
    throw new AppError('VALIDATION_FAILED', '缺少有效的 Idempotency-Key', 400, {
      userAction: '请为写请求提供 8 至 160 字符的幂等键',
    })
  }
  if (expected && expected !== key) {
    throw new AppError('IDEMPOTENCY_KEY_REUSED', '请求头与负载中的幂等键不一致', 409, {
      userAction: '请使用同一个幂等键重试原请求',
    })
  }
  return key
}
