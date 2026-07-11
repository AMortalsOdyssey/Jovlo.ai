import { stableCanonicalString } from '../../packages/domain/src/index'

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

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
