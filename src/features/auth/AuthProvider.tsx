import type { Session, User } from '@supabase/supabase-js'
import { createContext, type PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react'

import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase'

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated' | 'demo'

type AuthContextValue = {
  status: AuthStatus
  session: Session | null
  user: User | null
  sendOtp: (email: string, redirectTo?: string) => Promise<void>
  verifyOtp: (email: string, token: string) => Promise<void>
  signOut: () => Promise<void>
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
      setStatus(nextSession ? 'authenticated' : 'anonymous')
    }

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      authEventSeen = true
      updateSession(nextSession)
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

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      user: session?.user ?? null,
      async sendOtp(email, redirectTo) {
        const { error } = await requireSupabase().auth.signInWithOtp({
          email,
          options: {
            shouldCreateUser: true,
            emailRedirectTo: redirectTo,
          },
        })
        if (error) throw error
      },
      async verifyOtp(email, token) {
        const { error } = await requireSupabase().auth.verifyOtp({
          email,
          token,
          type: 'email',
        })
        if (error) throw error
      },
      async signOut() {
        const { error } = await requireSupabase().auth.signOut()
        if (error) throw error
      },
    }),
    [session, status],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth 必须在 AuthProvider 内使用')
  return value
}
