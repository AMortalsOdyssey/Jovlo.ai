import { AppError } from '../lib/errors'
import type { Env } from '../types'

const WEATHER_CACHE_SECONDS = 6 * 60 * 60
const REGION_CACHE_SECONDS = 30 * 24 * 60 * 60
const WEATHER_TIMEOUT_MS = 6_000
const AMAP_SUCCESS_CODE = '10000'
const AMAP_QUOTA_CODES = new Set(['10003', '10044', '40000', '40002', '40003'])
const AMAP_RATE_LIMIT_CODES = new Set(['10004', '10014', '10015', '10019', '10020', '10021', '10029'])

export type DailyWeatherStatus = 'forecast' | 'outside-window' | 'unavailable'

export type DailyWeatherResult = {
  status: DailyWeatherStatus
  date: string
  provider: 'amap'
  location: {
    name: string
    adcode?: string
  }
  forecast?: {
    dayWeather: string
    nightWeather: string
    dayTempC: number
    nightTempC: number
    dayWind: string
    nightWind: string
    dayPower: string
    nightPower: string
  }
  notice?: string
  reportTime?: string
  fetchedAt: string
  nextRefreshAt: string
}

type WeatherRequest = {
  date: string
  lon: number
  lat: number
}

type CachedValue = {
  expiresAt: number
  value: unknown
}

type AmapEnvelope = {
  status?: string
  info?: string
  infocode?: string
}

type AmapRegeoResponse = AmapEnvelope & {
  regeocode?: {
    addressComponent?: {
      adcode?: string
      city?: string | string[]
      district?: string
      province?: string
    }
  }
}

type AmapWeatherCast = {
  date?: string
  dayweather?: string
  nightweather?: string
  daytemp?: string
  nighttemp?: string
  daywind?: string
  nightwind?: string
  daypower?: string
  nightpower?: string
}

type AmapWeatherResponse = AmapEnvelope & {
  forecasts?: Array<{
    city?: string
    adcode?: string
    reporttime?: string
    casts?: AmapWeatherCast[]
  }>
}

const memoryCache = new Map<string, CachedValue>()

function currentDateInChina() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function dayDifference(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

function cacheStorage(): Cache | undefined {
  const storage = (globalThis as typeof globalThis & { caches?: { default?: Cache } }).caches
  return storage?.default
}

async function readCache<T>(key: string): Promise<T | undefined> {
  const memoryEntry = memoryCache.get(key)
  if (memoryEntry && memoryEntry.expiresAt > Date.now()) return memoryEntry.value as T
  if (memoryEntry) memoryCache.delete(key)

  const storage = cacheStorage()
  if (!storage) return undefined
  try {
    const response = await storage.match(new Request(key))
    return response?.ok ? (await response.json()) as T : undefined
  } catch {
    return undefined
  }
}

async function writeCache<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  memoryCache.set(key, { expiresAt: Date.now() + ttlSeconds * 1_000, value })
  const storage = cacheStorage()
  if (!storage) return
  try {
    await storage.put(
      new Request(key),
      new Response(JSON.stringify(value), {
        headers: {
          'cache-control': `public, max-age=${ttlSeconds}`,
          'content-type': 'application/json; charset=utf-8',
        },
      }),
    )
  } catch {
    // Local development and some test runtimes do not expose the edge cache.
  }
}

function cacheKey(kind: 'region' | 'weather', input: WeatherRequest) {
  const coordinate = `${input.lon.toFixed(3)},${input.lat.toFixed(3)}`
  const url = new URL(`https://jovlo.8xd.io/_internal/${kind}`)
  url.searchParams.set('location', coordinate)
  if (kind === 'weather') url.searchParams.set('date', input.date)
  return url.toString()
}

function compactAmapNotice(infocode?: string) {
  if (infocode && AMAP_QUOTA_CODES.has(infocode)) return '天气服务额度已用尽，稍后自动重试'
  if (infocode && AMAP_RATE_LIMIT_CODES.has(infocode)) return '天气服务请求较多，稍后自动重试'
  return '天气服务暂时不可用，稍后自动重试'
}

async function fetchAmap<T extends AmapEnvelope>(url: URL): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), WEATHER_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) throw new AppError('DEPENDENCY_UNAVAILABLE', '天气服务暂时不可用', 502, { retryable: true })
    const value = (await response.json()) as T
    if (value.status !== '1' || value.infocode !== AMAP_SUCCESS_CODE) {
      throw new AppError('DEPENDENCY_UNAVAILABLE', compactAmapNotice(value.infocode), 502, { retryable: true })
    }
    return value
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('DEPENDENCY_UNAVAILABLE', '天气服务暂时不可用，稍后自动重试', 502, {
      retryable: true,
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function resolveRegion(input: WeatherRequest, key: string) {
  const keyUrl = cacheKey('region', input)
  const cached = await readCache<{ adcode: string; name: string }>(keyUrl)
  if (cached) return cached

  const url = new URL('https://restapi.amap.com/v3/geocode/regeo')
  url.searchParams.set('key', key)
  url.searchParams.set('location', `${input.lon},${input.lat}`)
  url.searchParams.set('extensions', 'base')
  url.searchParams.set('output', 'JSON')
  const response = await fetchAmap<AmapRegeoResponse>(url)
  const component = response.regeocode?.addressComponent
  const adcode = component?.adcode
  if (!adcode) {
    throw new AppError('DEPENDENCY_UNAVAILABLE', '暂时无法识别天气区域', 502, { retryable: true })
  }
  const city = Array.isArray(component.city) ? '' : component.city
  const region = {
    adcode,
    name: component.district || city || component.province || '当前地点',
  }
  await writeCache(keyUrl, region, REGION_CACHE_SECONDS)
  return region
}

function unavailable(input: WeatherRequest, status: DailyWeatherStatus, notice: string): DailyWeatherResult {
  const fetchedAt = new Date()
  return {
    status,
    date: input.date,
    provider: 'amap',
    location: { name: '当前地点' },
    notice,
    fetchedAt: fetchedAt.toISOString(),
    nextRefreshAt: new Date(fetchedAt.getTime() + WEATHER_CACHE_SECONDS * 1_000).toISOString(),
  }
}

export async function getDailyWeather(input: WeatherRequest, env: Env): Promise<DailyWeatherResult> {
  const existing = await readCache<DailyWeatherResult>(cacheKey('weather', input))
  if (existing) return existing

  const daysFromToday = dayDifference(currentDateInChina(), input.date)
  if (daysFromToday < 0) {
    const result = unavailable(input, 'outside-window', '行程日期已过，不再刷新预报')
    await writeCache(cacheKey('weather', input), result, WEATHER_CACHE_SECONDS)
    return result
  }
  if (daysFromToday > 2) {
    const result = unavailable(input, 'outside-window', `距出发 ${daysFromToday} 天，临近出发 3 天自动更新`)
    await writeCache(cacheKey('weather', input), result, WEATHER_CACHE_SECONDS)
    return result
  }
  if (!env.AMAP_WEB_SERVICE_KEY) {
    return unavailable(input, 'unavailable', '天气服务尚未配置')
  }

  try {
    const region = await resolveRegion(input, env.AMAP_WEB_SERVICE_KEY)
    const url = new URL('https://restapi.amap.com/v3/weather/weatherInfo')
    url.searchParams.set('key', env.AMAP_WEB_SERVICE_KEY)
    url.searchParams.set('city', region.adcode)
    url.searchParams.set('extensions', 'all')
    url.searchParams.set('output', 'JSON')
    const response = await fetchAmap<AmapWeatherResponse>(url)
    const forecast = response.forecasts?.[0]
    const cast = forecast?.casts?.find((item) => item.date === input.date)
    const dayTempC = Number(cast?.daytemp)
    const nightTempC = Number(cast?.nighttemp)
    if (!forecast || !cast || !Number.isFinite(dayTempC) || !Number.isFinite(nightTempC)) {
      throw new AppError('DEPENDENCY_UNAVAILABLE', '目标日期的天气尚未发布', 502, { retryable: true })
    }

    const fetchedAt = new Date()
    const result: DailyWeatherResult = {
      status: 'forecast',
      date: input.date,
      provider: 'amap',
      location: { name: forecast.city || region.name, adcode: forecast.adcode || region.adcode },
      forecast: {
        dayWeather: cast.dayweather || '待确认',
        nightWeather: cast.nightweather || '待确认',
        dayTempC,
        nightTempC,
        dayWind: cast.daywind || '风向待确认',
        nightWind: cast.nightwind || '风向待确认',
        dayPower: cast.daypower || '待确认',
        nightPower: cast.nightpower || '待确认',
      },
      reportTime: forecast.reporttime,
      fetchedAt: fetchedAt.toISOString(),
      nextRefreshAt: new Date(fetchedAt.getTime() + WEATHER_CACHE_SECONDS * 1_000).toISOString(),
    }
    await writeCache(cacheKey('weather', input), result, WEATHER_CACHE_SECONDS)
    return result
  } catch (error) {
    const notice = error instanceof AppError ? error.message : '天气服务暂时不可用，稍后自动重试'
    const result = unavailable(input, 'unavailable', notice)
    await writeCache(cacheKey('weather', input), result, WEATHER_CACHE_SECONDS)
    return result
  }
}
