import { stableCanonicalString } from '../../packages/domain/src/index'

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(`${normalized}${padding}`)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function agentBridgeKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

const AGENT_SESSION_AAD = new TextEncoder().encode('jovlo-agent-session-v1')

export async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return toHex(digest)
}

export async function sha256Canonical(value: unknown): Promise<string> {
  return `sha256:${await sha256Text(stableCanonicalString(value))}`
}

export async function hashPublicationToken(token: string, pepper: string): Promise<string> {
  return sha256Text(`${token}.${pepper}`)
}

export async function sealAgentSession(value: unknown, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(value))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: AGENT_SESSION_AAD },
    await agentBridgeKey(secret),
    plaintext,
  )
  return `jovlo1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`
}

export async function openAgentSession(token: string, secret: string): Promise<unknown> {
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== 'jovlo1') throw new Error('invalid agent ticket')
  const iv = fromBase64Url(parts[1])
  const ciphertext = fromBase64Url(parts[2])
  if (iv.byteLength !== 12 || ciphertext.byteLength < 17) throw new Error('invalid agent ticket')
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: AGENT_SESSION_AAD },
    await agentBridgeKey(secret),
    ciphertext,
  )
  return JSON.parse(new TextDecoder().decode(plaintext)) as unknown
}
