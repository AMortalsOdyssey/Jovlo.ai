import type { EmailOtpType } from '@supabase/supabase-js'

export const AUTH_ROUTES = {
  login: '/login',
  register: '/register',
  forgotPassword: '/forgot-password',
  callback: '/auth/callback',
  resetPassword: '/reset-password',
  account: '/account',
} as const

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const MIN_PASSWORD_LENGTH = 8

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export function isValidEmail(email: string) {
  return EMAIL_PATTERN.test(normalizeEmail(email))
}

export function hasRecommendedPasswordMix(password: string) {
  return /[a-z]/i.test(password) && /\d/.test(password)
}

export function safeReturnTo(value: string | null) {
  return value?.startsWith('/trips') && !value.startsWith('//') ? value : '/trips'
}

const supportedEmailTokenTypes = new Set<EmailOtpType>([
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
])

export function parseEmailTokenType(value: string | null): EmailOtpType | null {
  return value && supportedEmailTokenTypes.has(value) ? value : null
}

export function readableAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : ''

  if (/invalid login credentials|invalid credentials/i.test(message)) return '邮箱或密码不正确。'
  if (/email not confirmed/i.test(message)) return '请先完成邮箱验证，再登录。'
  if (/already registered|user already exists/i.test(message)) return '该邮箱已注册，请直接登录。'
  if (/same password|different from the old/i.test(message)) return '新密码不能与原密码相同。'
  if (/password.*(short|weak|characters)|weak_password/i.test(message)) return '密码强度不足，请设置至少 8 位密码。'
  if (/expired|invalid.*(token|otp)|otp.*invalid/i.test(message)) return '链接无效或已过期，请重新获取。'
  if (/rate|limit|seconds|too many/i.test(message)) return '请求有些频繁，请稍后再试。'
  if (/fetch|network|offline/i.test(message)) return '网络连接异常，请检查后重试。'
  return '暂时无法完成操作，请稍后重试。'
}

