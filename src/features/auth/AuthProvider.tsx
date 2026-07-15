import type { EmailOtpType, Session, User } from '@supabase/supabase-js'
import { createContext, type PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react'

import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase'
import { useTripStore } from '@/store/useTripStore'
import { normalizeEmail } from './auth-utils'

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated' | 'recovering' | 'trial' | 'demo'

type AuthContextValue = {
  status: AuthStatus
  session: Session | null
  user: User | null
  signUp: (email: string, password: string, captchaToken: string, redirectTo?: string) => Promise<void>
  signInWithPassword: (email: string, password: string, captchaToken: string) => Promise<void>
  requestPasswordReset: (email: string, captchaToken: string, redirectTo?: string) => Promise<void>
  verifyOtp: (tokenHash: string, type: EmailOtpType) => Promise<void>
  verifyEmailToken: (tokenHash: string, type: EmailOtpType) => Promise<void>
  updatePassword: (password: string) => Promise<void>
  startLocalTrial: () => void
  signOut: (options?: { scope?: 'global' | 'local' | 'others' }) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function requireSupabase() {
  const supabase = getSupabaseClient()
  if (!supabase) throw new Error('Supabase 认证尚未配置')
  return supabase
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<AuthStatus>(isSupabaseConfigured ? 'loading' : 'demo')

  useEffect(() => {
    const supabase = getSupabaseClient()
    if (!supabase) return

    let mounted = true
    let authEventSeen = false
    const updateSession = (nextSession: Session | null) => {
      if (!mounted) return
      setSession(nextSession)
      if (nextSession) {
        setStatus('authenticated')
        return
      }
      if (localStorage.getItem('jovlo-local-trial') === '1') {
        setStatus('trial')
        return
      }
      useTripStore.getState().resetDemo()
      setStatus('anonymous')
    }

    const { data: authListener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      authEventSeen = true
      if (event === 'PASSWORD_RECOVERY' && nextSession) {
        setSession(nextSession)
        setStatus('recovering')
      } else {
        updateSession(nextSession)
      }
    })

    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!authEventSeen) updateSession(error ? null : data.session)
      })
      .catch(() => {
        if (!authEventSeen) updateSession(null)
      })

    return () => {
      mounted = false
      authListener.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthContextValue>(() => {
    const verifyEmailToken = async (tokenHash: string, type: EmailOtpType) => {
      const { data, error } = await requireSupabase().auth.verifyOtp({
        token_hash: tokenHash,
        type,
      })
      if (error) throw error
      if (data.session) {
        setSession(data.session)
        setStatus(type === 'recovery' ? 'recovering' : 'authenticated')
      }
    }

    return {
      status,
      session,
      user: session?.user ?? null,
      async signUp(email, password, captchaToken, redirectTo) {
        // TODO: 接入临时邮箱域名库，在服务端同步拦截一次性邮箱。
        const { error } = await requireSupabase().auth.signUp({
          email: normalizeEmail(email),
          password,
          options: {
            captchaToken,
            emailRedirectTo: redirectTo,
          },
        })
        if (error) throw error
      },
      async signInWithPassword(email, password, captchaToken) {
        const { data, error } = await requireSupabase().auth.signInWithPassword({
          email: normalizeEmail(email),
          password,
          options: { captchaToken },
        })
        if (error) throw error
        localStorage.removeItem('jovlo-local-trial')
        setSession(data.session)
        setStatus('authenticated')
      },
      async requestPasswordReset(email, captchaToken, redirectTo) {
        const { error } = await requireSupabase().auth.resetPasswordForEmail(normalizeEmail(email), {
          captchaToken,
          redirectTo,
        })
        if (error) throw error
      },
      verifyOtp: verifyEmailToken,
      verifyEmailToken,
      async updatePassword(password) {
        const { error } = await requireSupabase().auth.updateUser({ password })
        if (error) throw error
        setStatus('authenticated')
      },
      startLocalTrial() {
        localStorage.setItem('jovlo-local-trial', '1')
        setSession(null)
        setStatus('trial')
      },
      async signOut(options) {
        const { error } = await requireSupabase().auth.signOut(options)
        if (error) throw error
        localStorage.removeItem('jovlo-local-trial')
        useTripStore.getState().resetDemo()
        setSession(null)
        setStatus('anonymous')
      },
    }
  }, [session, status])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth 必须在 AuthProvider 内使用')
  return value
}
