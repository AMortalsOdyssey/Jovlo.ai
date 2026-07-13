import { lazy, type ComponentType } from 'react'

const STALE_ASSET_RELOAD_KEY = 'jovlo-stale-asset-reload'
const STALE_ASSET_MESSAGES = [
  'failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'importing a module script failed',
  'unable to preload css',
  'chunkloaderror',
  'loading chunk',
]

function errorText(error: unknown) {
  if (error instanceof Error) return `${error.name} ${error.message}`.toLowerCase()
  return String(error ?? '').toLowerCase()
}

export function isStaleAssetError(error: unknown) {
  const message = errorText(error)
  return STALE_ASSET_MESSAGES.some((pattern) => message.includes(pattern))
}

function currentRoute() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

export function clearStaleAssetReloadGuard() {
  try {
    window.sessionStorage.removeItem(STALE_ASSET_RELOAD_KEY)
  } catch {
    // Storage may be unavailable in restricted browsing modes.
  }
}

export function reloadForStaleAsset(error: unknown, reload = () => window.location.reload()) {
  if (typeof window === 'undefined' || !isStaleAssetError(error)) return false

  const route = currentRoute()
  try {
    if (window.sessionStorage.getItem(STALE_ASSET_RELOAD_KEY) === route) return false
    window.sessionStorage.setItem(STALE_ASSET_RELOAD_KEY, route)
  } catch {
    // A reload is still the safest recovery when storage is unavailable.
  }

  reload()
  return true
}

export function lazyRoute<T extends ComponentType<Record<string, never>>>(
  loader: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      const loaded = await loader()
      clearStaleAssetReloadGuard()
      return loaded
    } catch (error) {
      reloadForStaleAsset(error)
      throw error
    }
  })
}
