import { CalendarClock, CloudLightning, CloudOff, CloudRain, CloudSun, Sun, Wind } from 'lucide-react'

import './plan-page.css'

export type DailyWeatherResult = {
  status: 'forecast' | 'outside-window' | 'unavailable'
  date: string
  provider: 'amap'
  location: { name: string; adcode?: string }
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

export type DayWeatherStripProps = {
  date: string
  placeName: string
  weather?: DailyWeatherResult
  loading?: boolean
  error?: boolean
}

function weatherIcon(description: string) {
  if (/雷/.test(description)) return CloudLightning
  if (/雨|雪|冰雹/.test(description)) return CloudRain
  if (/晴/.test(description) && /云|阴/.test(description)) return CloudSun
  if (/晴/.test(description)) return Sun
  return CloudSun
}

export function DayWeatherStrip({ date, placeName, weather, loading = false, error = false }: DayWeatherStripProps) {
  if (loading) {
    return (
      <section className="plan-weather-strip" aria-label={`${placeName}天气加载中`} aria-busy="true">
        <CloudSun aria-hidden="true" size={19} />
        <span className="plan-weather-strip__copy"><strong>正在获取天气</strong><small>{placeName} · {date}</small></span>
        <span className="plan-weather-strip__skeleton" aria-hidden="true" />
      </section>
    )
  }

  if (error || !weather || weather.status === 'unavailable') {
    return (
      <section className="plan-weather-strip plan-weather-strip--muted" aria-label={`${placeName}天气暂不可用`}>
        <CloudOff aria-hidden="true" size={19} />
        <span className="plan-weather-strip__copy"><strong>天气暂不可用</strong><small>{weather?.notice ?? '稍后自动重试'}</small></span>
      </section>
    )
  }

  if (weather.status === 'outside-window') {
    return (
      <section className="plan-weather-strip plan-weather-strip--muted" aria-label={`${placeName}天气预报尚未发布`}>
        <CalendarClock aria-hidden="true" size={19} />
        <span className="plan-weather-strip__copy"><strong>{placeName}</strong><small>{weather.notice}</small></span>
      </section>
    )
  }

  const forecast = weather.forecast
  if (!forecast) return null
  const description = forecast.dayWeather === forecast.nightWeather
    ? forecast.dayWeather
    : `${forecast.dayWeather}转${forecast.nightWeather}`
  const Icon = weatherIcon(description)
  const needsUmbrella = /雨|雷|雪|冰雹/.test(description)

  return (
    <section className="plan-weather-strip" aria-label={`${placeName} ${date} 天气：${description}`}>
      <Icon aria-hidden="true" size={20} />
      <span className="plan-weather-strip__copy">
        <strong>{description}</strong>
        <small>{placeName} · 高德预报</small>
      </span>
      <span className="plan-weather-strip__temperature" aria-label={`最低 ${forecast.nightTempC} 度，最高 ${forecast.dayTempC} 度`}>
        {forecast.nightTempC}° / <b>{forecast.dayTempC}°</b>
      </span>
      <span className="plan-weather-strip__wind">
        <Wind aria-hidden="true" size={13} />{forecast.dayWind}风 {forecast.dayPower}级
      </span>
      {needsUmbrella ? <span className="plan-weather-strip__advice">带伞</span> : null}
    </section>
  )
}
