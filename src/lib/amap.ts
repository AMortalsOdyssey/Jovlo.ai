export type NavTarget = {
  name: string
  lon: number
  lat: number
}

declare global {
  interface Window {
    _AMapSecurityConfig?: {
      serviceHost: string
    }
  }
}

export const AMAP_SERVICE_PATH = '/_AMapService'

export function configureAmapServiceHost(): string {
  const serviceHost = new URL(AMAP_SERVICE_PATH, window.location.origin).toString().replace(/\/$/, '')
  window._AMapSecurityConfig = { serviceHost }
  return serviceHost
}

export function buildAmapNavigationUrl(target: NavTarget, origin?: NavTarget): string {
  const url = new URL('https://uri.amap.com/navigation')
  if (origin) {
    url.searchParams.set('from', `${origin.lon},${origin.lat},${origin.name}`)
  }
  url.searchParams.set('to', `${target.lon},${target.lat},${target.name}`)
  url.searchParams.set('mode', 'car')
  url.searchParams.set('policy', '1')
  url.searchParams.set('src', 'Jovlo.ai')
  url.searchParams.set('callnative', '1')
  return url.toString()
}

export async function copyNavigationTarget(target: NavTarget): Promise<void> {
  await navigator.clipboard.writeText(`${target.name} ${target.lon},${target.lat}`)
}
