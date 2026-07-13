import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Env } from '../types'
import {
  TencentEmailError,
  sendTencentTemplateEmail,
  verifyStandardWebhook,
} from './tencent-email'

const encoder = new TextEncoder()

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function signWebhook(secret: Uint8Array, id: string, timestamp: number, body: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    secret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return toBase64(new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(`${id}.${timestamp}.${body}`)),
  ))
}

describe('Tencent email delivery', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('accepts a current Standard Webhooks signature and rejects stale requests', async () => {
    const secret = crypto.getRandomValues(new Uint8Array(32))
    const hookSecret = `v1,whsec_${toBase64(secret)}`
    const body = JSON.stringify({ event: 'send-email' })
    const timestamp = 1_800_000_000
    const id = 'msg_test_123'
    const signature = await signWebhook(secret, id, timestamp, body)
    const headers = new Headers({
      'webhook-id': id,
      'webhook-timestamp': String(timestamp),
      'webhook-signature': `v1,${signature}`,
    })

    await expect(verifyStandardWebhook(body, headers, hookSecret, timestamp)).resolves.toBe(true)
    await expect(verifyStandardWebhook(body, headers, hookSecret, timestamp + 301)).resolves.toBe(false)
  })

  it('sends only the reviewed template ID and one template variable', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      Response: { RequestId: 'request-1', MessageId: 'message-1' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const env: Env = {
      TENCENTCLOUD_SECRET_ID: 'AKIDTEST',
      TENCENTCLOUD_SECRET_KEY: 'test-secret-key',
      TENCENT_SES_FROM: 'Jovlo <no-reply@auth.8xd.io>',
      TENCENT_SES_REPLY_TO: 'founder@8xd.io',
    }

    await expect(sendTencentTemplateEmail(env, {
      to: 'traveler@example.com',
      subject: '验证你的 Jovlo 邮箱',
      templateId: 123,
      templateData: { action_query: 'token_hash=test&type=signup' },
    })).resolves.toEqual({ requestId: 'request-1', messageId: 'message-1' })

    const [, init] = fetchMock.mock.calls[0]
    const payload = JSON.parse(String(init.body))
    expect(payload.Template.TemplateID).toBe(123)
    expect(JSON.parse(payload.Template.TemplateData)).toEqual({
      action_query: 'token_hash=test&type=signup',
    })
    expect(payload.Destination).toEqual(['traveler@example.com'])
    expect(new Headers(init.headers).get('authorization')).toMatch(/^TC3-HMAC-SHA256 /)
  })

  it('reduces provider quota errors to a concise message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      Response: {
        RequestId: 'request-quota',
        Error: { Code: 'LimitExceeded', Message: 'long upstream provider diagnostic' },
      },
    }), { status: 400, headers: { 'content-type': 'application/json' } })))
    const env: Env = {
      TENCENTCLOUD_SECRET_ID: 'AKIDTEST',
      TENCENTCLOUD_SECRET_KEY: 'test-secret-key',
      TENCENT_SES_FROM: 'Jovlo <no-reply@auth.8xd.io>',
    }

    await expect(sendTencentTemplateEmail(env, {
      to: 'traveler@example.com',
      subject: 'test',
      templateId: 123,
      templateData: { action_query: 'x=1' },
    })).rejects.toMatchObject({
      code: 'LimitExceeded',
      message: '邮件发送额度不足',
      requestId: 'request-quota',
    } satisfies Partial<TencentEmailError>)
  })
})
