function canonicalize(value: unknown, inArray = false): string | undefined {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON only supports finite numbers')
    return Object.is(value, -0) ? '0' : JSON.stringify(value)
  }
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    return inArray ? 'null' : undefined
  }
  if (typeof value === 'bigint') throw new TypeError('Canonical JSON does not support bigint')
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item, true) ?? 'null').join(',')}]`
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([key, item]) => {
        const serialized = canonicalize(item)
        return serialized === undefined ? [] : [`${JSON.stringify(key)}:${serialized}`]
      })
    return `{${entries.join(',')}}`
  }
  throw new TypeError(`Unsupported canonical JSON value: ${typeof value}`)
}

export function stableCanonicalString(value: unknown): string {
  return canonicalize(value) ?? 'null'
}

export function stableHash(value: unknown): string {
  const input = stableCanonicalString(value)
  const hash = fnv1a64(input, 0xcbf29ce484222325n)
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`
}

function fnv1a64(input: string, offset: bigint): bigint {
  let hash = offset
  const prime = 0x100000001b3n
  for (let index = 0; index < input.length; index += 1) {
    const codePoint = input.codePointAt(index) ?? 0
    hash ^= BigInt(codePoint)
    hash = BigInt.asUintN(64, hash * prime)
    if (codePoint > 0xffff) index += 1
  }
  return hash
}

export function stableUuid(value: unknown): string {
  const input = stableCanonicalString(value)
  const first = fnv1a64(input, 0xcbf29ce484222325n).toString(16).padStart(16, '0')
  const second = fnv1a64(input, 0x84222325cbf29cen).toString(16).padStart(16, '0')
  const raw = `${first}${second}`.split('')
  raw[12] = '5'
  raw[16] = ((Number.parseInt(raw[16], 16) & 0x3) | 0x8).toString(16)
  const hex = raw.join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
