import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey)

let client: SupabaseClient | null = null

function authApiUrl() {
  if (typeof window === 'undefined') return supabaseUrl as string
  return `${window.location.origin}/supabase`
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null

  if (!client) {
    client = createClient(authApiUrl(), supabasePublishableKey as string, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
        persistSession: true,
      },
    })
  }

  return client
}

export async function getSupabaseAccessToken(): Promise<string | null> {
  const supabase = getSupabaseClient()
  if (!supabase) return null

  const { data, error } = await supabase.auth.getSession()
  if (error) return null

  return data.session?.access_token ?? null
}
