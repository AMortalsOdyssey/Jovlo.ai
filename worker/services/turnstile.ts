import { z } from 'zod'
import { AppError } from '../lib/errors'
import type { AppContext } from '../types'

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const TURNSTILE_ALWAYS_PASS_TEST_SECRET = '1x0000000000000000000000000000000AA'
const PRODUCTION_HOSTNAME = 'jovlo.8xd.io'

const TurnstileResponseSchema = z
  .object({
    success: z.boolean(),
    action: z.string().optional(),
    hostname: z.string().optional(),
  })
  .passthrough()

export type TurnstileAction = 'signup' | 'login' | 'password_reset'

function requireTurnstileSecret(context: AppContext): string {
  const secret = context.env.TURNSTILE_SECRET_KEY?.trim()
  if (!secret && context.get('mode') === 'demo') return TURNSTILE_ALWAYS_PASS_TEST_SECRET
  if (!secret || (context.get('mode') === 'production' && secret === TURNSTILE_ALWAYS_PASS_TEST_SECRET)) {
    throw new AppError('DEPENDENCY_UNAVAILABLE', '人机验证服务暂不可用', 503, {
      retryable: true,
      userAction: '请稍后重试',
    })
  }
  return secret
}

export async function verifyTurnstileChallenge(
  context: AppContext,
  token: string | undefined,
  expectedAction: TurnstileAction,
): Promise<void> {
  const normalizedToken = token?.trim()
  if (!normalizedToken || normalizedToken.length > 2_048) {
    throw new AppError('FORBIDDEN', '请完成人机验证', 403, {
      userAction: '请完成人机验证后重试',
    })
  }

  const form = new URLSearchParams({
    secret: requireTurnstileSecret(context),
    response: normalizedToken,
  })
  const remoteIp = context.req.header('cf-connecting-ip')?.trim()
  if (remoteIp) form.set('remoteip', remoteIp.slice(0, 64))

  let response: Response
  try {
    response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    })
  } catch {
    throw new AppError('DEPENDENCY_UNAVAILABLE', '人机验证服务暂不可用', 503, {
      retryable: true,
      userAction: '请稍后重试',
    })
  }

  if (!response.ok) {
    throw new AppError('DEPENDENCY_UNAVAILABLE', '人机验证服务暂不可用', 503, {
      retryable: true,
      userAction: '请稍后重试',
    })
  }

  let result: z.infer<typeof TurnstileResponseSchema>
  try {
    const parsed = TurnstileResponseSchema.safeParse(await response.json())
    if (!parsed.success) throw new Error('Invalid Turnstile response')
    result = parsed.data
  } catch {
    throw new AppError('DEPENDENCY_UNAVAILABLE', '人机验证服务暂不可用', 503, {
      retryable: true,
      userAction: '请稍后重试',
    })
  }

  const hostnameMatches =
    context.get('mode') !== 'production' || result.hostname === PRODUCTION_HOSTNAME
  if (!result.success || result.action !== expectedAction || !hostnameMatches) {
    throw new AppError('FORBIDDEN', '人机验证未通过，请重试', 403, {
      userAction: '请刷新验证后重试',
    })
  }
}
