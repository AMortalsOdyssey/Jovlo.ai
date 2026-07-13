import { describe, expect, it } from 'vitest'

import { readableAuthError } from './auth-utils'

describe('readableAuthError', () => {
  it('explains Supabase email quota errors without exposing provider details', () => {
    expect(readableAuthError(new Error('email rate limit exceeded'))).toBe(
      '验证邮件发送过于频繁，请稍后再试。',
    )
  })
})
