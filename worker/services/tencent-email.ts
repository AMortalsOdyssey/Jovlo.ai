import { z } from 'zod'

import type { AppContext, Env } from '../types'

const TENCENT_SES_HOST = 'ses.tencentcloudapi.com'
const TENCENT_SES_SERVICE = 'ses'
const TENCENT_SES_VERSION = '2020-10-02'
const MAX_HOOK_AGE_SECONDS = 5 * 60
const MAX_HOOK_BYTES = 128 * 1_024
const encoder = new TextEncoder()

const EmailActionSchema = z.enum([
  'signup',
  'recovery',
  'invite',
  'magiclink',
  'email_change',
  'reauthentication',
])

const SendEmailHookSchema = z.object({
  user: z.object({
    email: z.string().email().max(320),
    new_email: z.string().email().max(320).optional(),
  }).passthrough(),
  email_data: z.object({
    token: z.string().max(2_048).default(''),
    token_hash: z.string().max(2_048).default(''),
    token_new: z.string().max(2_048).default(''),
    token_hash_new: z.string().max(2_048).default(''),
    redirect_to: z.string().max(2_048).default(''),
    email_action_type: EmailActionSchema,
    site_url: z.string().max(2_048).default(''),
  }).strict(),
}).passthrough()

type EmailAction = z.infer<typeof EmailActionSchema>
type HookPayload = z.infer<typeof SendEmailHookSchema>

type EmailIssueReporter = (issue: {
  provider: 'tencent-ses'
  code: string
  message: string
  impact: string
  notifyByEmail: false
}) => void

type TencentApiError = {
  Code: string
  Message: string
}

type TencentApiResponse = {
  Response?: {
    Error?: TencentApiError
    RequestId?: string
    MessageId?: string
  }
}

export class TencentEmailError extends Error {
  readonly code: string
  readonly requestId?: string
  readonly retryable: boolean

  constructor(code: string, message: string, options: { requestId?: string; retryable?: boolean } = {}) {
    super(message)
    this.name = 'TencentEmailError'
    this.code = code
    this.requestId = options.requestId
    this.retryable = options.retryable ?? false
  }
}

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(`${normalized}${padding}`)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function sha256(value: string): Promise<string> {
  return bytesToHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

async function hmac(key: Uint8Array<ArrayBuffer> | string, value: string): Promise<Uint8Array<ArrayBuffer>> {
  const rawKey = typeof key === 'string' ? encoder.encode(key) : key
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(value)))
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  let difference = 0
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

function webhookSecretBytes(secret: string): Uint8Array<ArrayBuffer> {
  const stripped = secret.replace(/^v1,whsec_/, '').replace(/^whsec_/, '')
  if (!stripped) throw new Error('empty hook secret')
  return base64ToBytes(stripped)
}

export async function verifyStandardWebhook(
  rawBody: string,
  headers: Headers,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<boolean> {
  const id = headers.get('webhook-id')
  const timestampText = headers.get('webhook-timestamp')
  const signatureHeader = headers.get('webhook-signature')
  const timestamp = Number(timestampText)
  if (!id || !timestampText || !signatureHeader || !Number.isInteger(timestamp)) return false
  if (Math.abs(nowSeconds - timestamp) > MAX_HOOK_AGE_SECONDS) return false

  const expected = await hmac(webhookSecretBytes(secret), `${id}.${timestampText}.${rawBody}`)
  const signatures = signatureHeader.split(' ').flatMap((part) => {
    const [version, value] = part.split(',', 2)
    if (version !== 'v1' || !value) return []
    try {
      return [base64ToBytes(value)]
    } catch {
      return []
    }
  })
  return signatures.some((signature) => timingSafeEqual(expected, signature))
}

export async function createTencentAuthorization(input: {
  secretId: string
  secretKey: string
  timestamp: number
  payload: string
}): Promise<string> {
  const algorithm = 'TC3-HMAC-SHA256'
  const date = new Date(input.timestamp * 1_000).toISOString().slice(0, 10)
  const signedHeaders = 'content-type;host'
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${TENCENT_SES_HOST}\n`
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${await sha256(input.payload)}`
  const credentialScope = `${date}/${TENCENT_SES_SERVICE}/tc3_request`
  const stringToSign = `${algorithm}\n${input.timestamp}\n${credentialScope}\n${await sha256(canonicalRequest)}`
  const secretDate = await hmac(`TC3${input.secretKey}`, date)
  const secretService = await hmac(secretDate, TENCENT_SES_SERVICE)
  const secretSigning = await hmac(secretService, 'tc3_request')
  const signature = bytesToHex((await hmac(secretSigning, stringToSign)).buffer)
  return `${algorithm} Credential=${input.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}

function requireTencentConfig(env: Env) {
  const secretId = env.TENCENTCLOUD_SECRET_ID?.trim()
  const secretKey = env.TENCENTCLOUD_SECRET_KEY?.trim()
  const from = env.TENCENT_SES_FROM?.trim()
  if (!secretId || !secretKey || !from) {
    throw new TencentEmailError('CONFIGURATION', '邮件服务尚未完成配置')
  }
  return {
    secretId,
    secretKey,
    from,
    replyTo: env.TENCENT_SES_REPLY_TO?.trim() || 'founder@8xd.io',
    region: env.TENCENT_SES_REGION?.trim() || 'ap-hongkong',
  }
}

function retryableTencentCode(code: string): boolean {
  return code === 'RequestLimitExceeded' || code === 'InternalError' || code.startsWith('InternalError.')
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export async function sendTencentTemplateEmail(
  env: Env,
  input: {
    to: string
    subject: string
    templateId: number
    templateData: Record<string, string>
  },
): Promise<{ messageId: string; requestId: string }> {
  const config = requireTencentConfig(env)
  const payload = JSON.stringify({
    FromEmailAddress: config.from,
    ReplyToAddresses: config.replyTo,
    Destination: [input.to],
    Subject: input.subject,
    Template: {
      TemplateID: input.templateId,
      TemplateData: JSON.stringify(input.templateData),
    },
    TriggerType: 1,
  })

  let lastError = new TencentEmailError('UNAVAILABLE', '邮件服务暂时不可用', { retryable: true })
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const timestamp = Math.floor(Date.now() / 1_000)
    const authorization = await createTencentAuthorization({
      secretId: config.secretId,
      secretKey: config.secretKey,
      timestamp,
      payload,
    })
    let response: Response
    try {
      response = await fetch(`https://${TENCENT_SES_HOST}/`, {
        method: 'POST',
        headers: {
          authorization,
          'content-type': 'application/json; charset=utf-8',
          host: TENCENT_SES_HOST,
          'x-tc-action': 'SendEmail',
          'x-tc-region': config.region,
          'x-tc-timestamp': String(timestamp),
          'x-tc-version': TENCENT_SES_VERSION,
        },
        body: payload,
      })
    } catch {
      lastError = new TencentEmailError('UNAVAILABLE', '邮件服务暂时不可用', { retryable: true })
      if (attempt < 2) await sleep(250 * 2 ** attempt)
      continue
    }

    let parsed: TencentApiResponse = {}
    try {
      parsed = await response.json() as TencentApiResponse
    } catch {
      // Tencent normally returns JSON even on HTTP failures.
    }
    const api = parsed.Response
    if (response.ok && api?.MessageId && api.RequestId) {
      return { messageId: api.MessageId, requestId: api.RequestId }
    }
    const code = api?.Error?.Code || `HTTP_${response.status}`
    const retryable = response.status === 429 || response.status >= 500 || retryableTencentCode(code)
    lastError = new TencentEmailError(code, conciseTencentMessage(code), {
      requestId: api?.RequestId,
      retryable,
    })
    if (!retryable || attempt === 2) break
    await sleep(250 * 2 ** attempt + Math.floor(Math.random() * 100))
  }
  throw lastError
}

export function conciseTencentMessage(code: string): string {
  if (code === 'LimitExceeded' || code === 'ResourceInsufficient') return '邮件发送额度不足'
  if (code === 'RequestLimitExceeded') return '邮件发送请求过于频繁'
  if (code.includes('InvalidEmailIdentity')) return '发信域名尚未通过验证'
  if (code.includes('WithOutPermission') || code === 'UnauthorizedOperation') return '邮件模板或接口权限不可用'
  if (code.includes('Template')) return '邮件模板尚未通过审核'
  if (code === 'AuthFailure' || code.includes('Signature')) return '邮件服务凭据无效'
  return '邮件服务暂时不可用'
}

function publicOrigin(payload: HookPayload): string {
  try {
    const origin = new URL(payload.email_data.site_url).origin
    if (origin === 'https://jovlo.8xd.io') return origin
  } catch {
    // Fall through to the production origin.
  }
  return 'https://jovlo.8xd.io'
}

function returnTo(payload: HookPayload): string {
  try {
    const target = new URL(payload.email_data.redirect_to)
    if (target.origin === publicOrigin(payload) && target.pathname.startsWith('/trips')) {
      return `${target.pathname}${target.search}`
    }
  } catch {
    // Use the safe product default.
  }
  return '/trips'
}

function actionSubject(action: EmailAction): string {
  if (action === 'recovery') return '重置你的 Jovlo 密码'
  if (action === 'email_change') return '确认你的 Jovlo 新邮箱'
  if (action === 'magiclink') return '登录 Jovlo'
  return '验证你的 Jovlo 邮箱'
}

function templateId(env: Env, action: EmailAction): number {
  const value = action === 'recovery'
    ? env.TENCENT_SES_RECOVERY_TEMPLATE_ID
    : env.TENCENT_SES_SIGNUP_TEMPLATE_ID
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new TencentEmailError('CONFIGURATION', '邮件模板尚未完成配置')
  }
  return parsed
}

function confirmationQuery(payload: HookPayload, tokenHash: string, action: EmailAction): string {
  const url = new URL('/auth/callback', publicOrigin(payload))
  url.searchParams.set('token_hash', tokenHash)
  url.searchParams.set('type', action === 'reauthentication' ? 'email' : action)
  url.searchParams.set('returnTo', returnTo(payload))
  return url.search.slice(1)
}

function deliveries(payload: HookPayload): Array<{ to: string; tokenHash: string }> {
  const { user, email_data: data } = payload
  if (data.email_action_type !== 'email_change' || !user.new_email) {
    return [{ to: user.email, tokenHash: data.token_hash }]
  }
  const output: Array<{ to: string; tokenHash: string }> = []
  if (data.token_hash_new) output.push({ to: user.email, tokenHash: data.token_hash_new })
  if (data.token_hash) output.push({ to: user.new_email, tokenHash: data.token_hash })
  return output
}

function hookError(status: number, message: string): Response {
  return Response.json({ error: { http_code: status, message } }, { status })
}

export async function handleSupabaseSendEmailHook(
  context: AppContext,
  reportIssue?: EmailIssueReporter,
): Promise<Response> {
  if (context.req.method !== 'POST') return hookError(405, '不支持该请求方式')
  const contentLength = Number(context.req.header('content-length') ?? '0')
  if (Number.isFinite(contentLength) && contentLength > MAX_HOOK_BYTES) {
    return hookError(413, '邮件请求内容过大')
  }
  const secret = context.env.SUPABASE_SEND_EMAIL_HOOK_SECRET?.trim()
  if (!secret) return hookError(503, '邮件服务尚未完成配置')
  const rawBody = await context.req.raw.text()
  if (encoder.encode(rawBody).byteLength > MAX_HOOK_BYTES) return hookError(413, '邮件请求内容过大')
  if (!(await verifyStandardWebhook(rawBody, context.req.raw.headers, secret))) {
    return hookError(401, '邮件请求签名无效')
  }

  let payload: HookPayload
  try {
    payload = SendEmailHookSchema.parse(JSON.parse(rawBody))
  } catch {
    return hookError(400, '邮件请求内容无效')
  }
  const action = payload.email_data.email_action_type
  const pending = deliveries(payload)
  if (!pending.length || pending.some((item) => !item.tokenHash)) {
    return hookError(400, '邮件验证信息不完整')
  }

  try {
    for (const delivery of pending) {
      await sendTencentTemplateEmail(context.env, {
        to: delivery.to,
        subject: actionSubject(action),
        templateId: templateId(context.env, action),
        templateData: {
          action_query: confirmationQuery(payload, delivery.tokenHash, action),
        },
      })
    }
  } catch (error) {
    const failure = error instanceof TencentEmailError
      ? error
      : new TencentEmailError('UNAVAILABLE', '邮件服务暂时不可用', { retryable: true })
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      requestId: context.get('requestId'),
      provider: 'tencent-ses',
      code: failure.code,
      message: failure.message,
      providerRequestId: failure.requestId,
    }))
    reportIssue?.({
      provider: 'tencent-ses',
      code: failure.code,
      message: failure.message,
      impact: '账号验证邮件暂未发出，用户可稍后重试',
      notifyByEmail: false,
    })
    const quotaError = failure.code === 'LimitExceeded' || failure.code === 'ResourceInsufficient'
    return hookError(quotaError ? 429 : 503, failure.message)
  }
  return Response.json({}, { status: 200, headers: { 'cache-control': 'no-store' } })
}
