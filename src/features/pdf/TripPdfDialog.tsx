import { Check, Download, FileText, LoaderCircle, MapPinned, QrCode, ShieldCheck, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import type { DerivedSnapshot, TripSnapshot, TripVersion } from '@domain'

import { apiRequest } from '@/lib/api'
import { formatCurrency, formatDistance, formatDuration } from '@/lib/format'
import { getSupabaseAccessToken } from '@/lib/supabase'
import { currentVersion, useTripStore } from '@/store/useTripStore'
import type { DisclosureConfig, LocalPublication } from '@/store/store-types'
import type { DailyWeatherResult } from '@/features/planner/DayWeatherStrip'
import './trip-pdf.css'

type PublicationResult = {
  publicationId: string
  token: string
  createdAt?: string
}

type PdfData = {
  version: TripVersion
  shareUrl: string
  qrCode: string
  maps: Record<string, string>
  weather: Record<string, DailyWeatherResult | null>
}

const PDF_DISCLOSURE: DisclosureConfig = {
  showExactDates: true,
  showSources: true,
  showBudget: true,
  viewScope: 'overview',
}

function samePdfDisclosure(config: DisclosureConfig) {
  return config.showExactDates && config.showSources && config.showBudget
    && (config.viewScope ?? 'overview') === 'overview'
}

function waitForCheckpoint(timeoutMs = 20_000) {
  return new Promise<void>((resolve, reject) => {
    const startedAt = Date.now()
    const inspect = () => {
      const state = useTripStore.getState()
      if (!state.dirty && state.productionPublishQueue.length === 0 && state.saveStatus === 'saved') {
        resolve()
        return
      }
      if (state.saveStatus === 'failed' || Date.now() - startedAt > timeoutMs) {
        reject(new Error(state.productionSync.error ?? '自动保存尚未完成，请稍后重试'))
        return
      }
      window.setTimeout(inspect, 100)
    }
    inspect()
  })
}

function mapTarget(snapshot: TripSnapshot, dayId: string) {
  const day = snapshot.days.find((item) => item.id === dayId)
  if (!day) return null
  const finalStop = day.stops.at(-1)
  if (finalStop) {
    const place = snapshot.placeRefs[finalStop.placeId]
    if (place) return { date: day.date, lon: place.gcj02.lon, lat: place.gcj02.lat }
  }
  const stay = day.overnightStay
  if (stay?.kind === 'place') {
    const place = snapshot.placeRefs[stay.placeId]
    if (place) return { date: day.date, lon: place.gcj02.lon, lat: place.gcj02.lat }
  }
  if (stay?.kind === 'area') {
    const area = snapshot.stayAreaRefs[stay.areaId]
    if (area) return { date: day.date, lon: area.gcj02.lon, lat: area.gcj02.lat }
  }
  return null
}

async function authenticatedImage(path: string) {
  const token = await getSupabaseAccessToken()
  const response = await fetch(path, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  })
  if (!response.ok) throw new Error('地图快照暂时不可用')
  return URL.createObjectURL(await response.blob())
}

function localFallbackMap(snapshot: TripSnapshot, dayId?: string) {
  const days = dayId ? snapshot.days.filter((day) => day.id === dayId) : snapshot.days
  const places = days.flatMap((day) => day.stops.map((stop) => snapshot.placeRefs[stop.placeId])).filter(Boolean)
  const labels = places.slice(0, 8).map((place, index) => `<text x="76" y="${174 + index * 56}" font-size="20" fill="#2d251d">${index + 1}. ${place.name.replace(/[&<>]/g, '')}</text>`).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="720"><rect width="1024" height="720" fill="#f4ecdb"/><path d="M80 580 C260 430 420 610 610 390 S850 250 940 130" fill="none" stroke="#0f8274" stroke-width="10" stroke-dasharray="18 13"/><rect x="44" y="42" width="430" height="72" rx="8" fill="#fffdf8" stroke="#dcc9ae"/><text x="70" y="87" font-size="24" font-weight="700" fill="#2d251d">${dayId ? '当日' : '全程'}参考路线 · 地图服务暂不可用</text>${labels}</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

async function loadPdfData(version: TripVersion, shareUrl: string) {
  const snapshot = version.snapshot
  const mapEntries = await Promise.all([
    authenticatedImage(`/api/v1/trips/${snapshot.tripId}/versions/${version.id}/static-map?scope=overview`)
      .then((url) => ['overview', url] as const)
      .catch(() => ['overview', localFallbackMap(snapshot)] as const),
    ...snapshot.days.map((day) => authenticatedImage(
      `/api/v1/trips/${snapshot.tripId}/versions/${version.id}/static-map?scope=day&dayId=${encodeURIComponent(day.id)}`,
    ).then((url) => [day.id, url] as const).catch(() => [day.id, localFallbackMap(snapshot, day.id)] as const)),
  ])
  const weatherEntries = await Promise.all(snapshot.days.map(async (day) => {
    const target = mapTarget(snapshot, day.id)
    if (!target?.date) return [day.id, null] as const
    const query = new URLSearchParams({ date: target.date, lon: String(target.lon), lat: String(target.lat) })
    try {
      return [day.id, await apiRequest<DailyWeatherResult>(`/api/v1/weather/daily?${query}`)] as const
    } catch {
      return [day.id, null] as const
    }
  }))
  return {
    maps: Object.fromEntries(mapEntries),
    weather: Object.fromEntries(weatherEntries),
    qrCode: await QRCode.toDataURL(shareUrl, { width: 420, margin: 1, color: { dark: '#2d251d', light: '#fffdf8' } }),
  }
}

function stopName(snapshot: TripSnapshot, placeId: string) {
  return snapshot.placeRefs[placeId]?.name ?? '未命名地点'
}

function dayTitle(snapshot: TripSnapshot, dayIndex: number) {
  const day = snapshot.days[dayIndex]
  const stay = day.overnightStay
  if (stay) return stay.label
  const last = day.stops.at(-1)
  return last ? stopName(snapshot, last.placeId) : '当日行程'
}

function dayRoute(derived: DerivedSnapshot, dayId: string) {
  return derived.routeLegs.filter((leg) => leg.dayId === dayId)
}

function chunks<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size))
}

function PdfDocument({ data, documentRef }: { data: PdfData; documentRef: React.RefObject<HTMLDivElement | null> }) {
  const { version, shareUrl, qrCode, maps, weather } = data
  const snapshot = version.snapshot
  const derived = version.derivedSnapshot
  const totalDistance = derived.routeLegs.reduce((sum, leg) => sum + leg.distanceMeters, 0)
  const totalDrivingMinutes = derived.routeLegs.reduce((sum, leg) => sum + leg.durationSeconds / 60, 0)
  return (
    <div className="jovlo-pdf-document" ref={documentRef} aria-hidden="true">
      <section className="jovlo-pdf-page jovlo-pdf-cover">
        <header><img src="/jovlo-mark.svg" alt="" /><span>Jovlo 路书</span><small>固定只读版本 v{version.versionNo}</small></header>
        <div className="jovlo-pdf-cover__copy">
          <p>{snapshot.intent.startDate ?? '日期待定'} · {snapshot.intent.days} 天</p>
          <h1>{snapshot.title}</h1>
          <strong>把攻略，变成一路可用的路书</strong>
        </div>
        <img className="jovlo-pdf-map jovlo-pdf-map--cover" src={maps.overview} alt="全程路线地图" />
        <div className="jovlo-pdf-metrics">
          <div><span>全程</span><strong>{formatDistance(totalDistance)}</strong></div>
          <div><span>驾驶</span><strong>{formatDuration(totalDrivingMinutes)}</strong></div>
          <div><span>预算</span><strong>{formatCurrency(derived.budget.total.expected)}</strong></div>
          <div><span>同行</span><strong>{snapshot.intent.partySize} 人</strong></div>
        </div>
        <footer>生成于 {new Date().toLocaleDateString('zh-CN')} · jovlo.8xd.io</footer>
      </section>

      {snapshot.days.map((day, dayIndex) => {
        const schedule = derived.daySchedules.find((item) => item.dayId === day.id)
        const legs = dayRoute(derived, day.id)
        const distance = legs.reduce((sum, leg) => sum + leg.distanceMeters, 0)
        const driving = legs.reduce((sum, leg) => sum + leg.durationSeconds / 60, 0)
        const forecast = weather[day.id]
        return (
          <section className="jovlo-pdf-page jovlo-pdf-day" key={day.id}>
            <header className="jovlo-pdf-day__header">
              <div><p>{day.date ?? `Day ${day.dayIndex}`}</p><h2>Day {day.dayIndex} · {dayTitle(snapshot, dayIndex)}</h2></div>
              <span>{forecast?.status === 'forecast' && forecast.forecast
                ? `${forecast.forecast.dayWeather} · ${forecast.forecast.nightTempC}° / ${forecast.forecast.dayTempC}°C`
                : '天气预报待发布'}</span>
            </header>
            <img className="jovlo-pdf-map" src={maps[day.id]} alt={`Day ${day.dayIndex} 路线地图`} />
            <div className="jovlo-pdf-day__metrics"><span>出发 {day.startTime}</span><span>{formatDistance(distance)}</span><span>驾驶 {formatDuration(driving)}</span><span>预算 {formatCurrency(derived.budget.total.expected / snapshot.days.length)}</span><span>预计 {schedule?.expectedEndTime ?? '--:--'} 结束</span></div>
            <ol className="jovlo-pdf-timeline">
              {day.stops.map((stop, index) => {
                const stopSchedule = schedule?.stops.find((item) => item.stopId === stop.id)
                const place = snapshot.placeRefs[stop.placeId]
                return <li key={stop.id}><b>{index + 1}</b><div><strong>{place?.name ?? '地点待定'}</strong><span>{stopSchedule?.arrivalTime ?? stop.plannedStart ?? '--:--'} · 停留 {formatDuration(stop.stayMinutes)}</span>{stop.publicNote || place?.address ? <small>{stop.publicNote ?? place?.address}</small> : null}</div></li>
              })}
            </ol>
            {day.overnightStay ? <div className="jovlo-pdf-stay"><span>住宿</span><strong>{day.overnightStay.label}</strong><small>{day.overnightStay.checkInNote}</small></div> : null}
            <footer>Jovlo · {snapshot.title} · Day {day.dayIndex}</footer>
          </section>
        )
      })}

      <section className="jovlo-pdf-page jovlo-pdf-budget">
        <header><p>预算汇总</p><h2>{formatCurrency(derived.budget.total.expected)}</h2><span>{formatCurrency(derived.budget.total.low)} 至 {formatCurrency(derived.budget.total.high)}</span></header>
        <div className="jovlo-pdf-budget__rows">{derived.budget.categories.map((category) => <div key={category.category}><span>{({ lodging: '住宿', meals: '餐饮', tickets: '门票活动', energy: '油电', rental: '租车', insurance: '保险', parking_tolls: '停车路费', contingency: '机动预算' } as Record<string, string>)[category.category] ?? category.category}</span><strong>{formatCurrency(category.amount.expected)}</strong><small>{category.assumption}</small></div>)}</div>
        {snapshot.userNotes ? <aside><strong>路书备注</strong><p>{snapshot.userNotes}</p></aside> : null}
        <footer>预算为规划参考，实际价格以出行时为准 · jovlo.8xd.io</footer>
      </section>

      {chunks(Object.values(snapshot.sourceRefs), 5).map((sources, pageIndex) => (
        <section className="jovlo-pdf-page jovlo-pdf-sources" key={`sources-${pageIndex}`}>
          <header><p>来源与核对</p><h2>这份路书使用的资料</h2><span>{Object.keys(snapshot.sourceRefs).length} 条来源 · 第 {pageIndex + 1} 页</span></header>
          <ol>
            {sources.map((source) => (
              <li key={source.sourceId}>
                <div><span>{source.platform}</span><strong>{source.title}</strong></div>
                <p>{source.summary}</p>
                <a className="jovlo-pdf-link" href={source.url}>{source.url}</a>
              </li>
            ))}
          </ol>
          <footer>打开原文可再次核对价格、营业时间与时效 · jovlo.8xd.io</footer>
        </section>
      ))}

      <section className="jovlo-pdf-page jovlo-pdf-finale">
        <img src="/jovlo-mark.svg" alt="" />
        <p>随时打开这份固定路书</p>
        <h2>把攻略，变成一路可用的路书</h2>
        <img className="jovlo-pdf-qr" src={qrCode} alt="路书二维码" />
        <strong>扫码查看路线、行程与预算</strong>
        <a className="jovlo-pdf-link" href={shareUrl}>{shareUrl}</a>
        <span>jovlo.8xd.io</span>
      </section>
    </div>
  )
}

async function renderPdf(container: HTMLDivElement, title: string) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')])
  const pages = [...container.querySelectorAll<HTMLElement>('.jovlo-pdf-page')]
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true })
  for (let index = 0; index < pages.length; index += 1) {
    const canvas = await html2canvas(pages[index], { scale: 1.45, backgroundColor: '#fffdf8', useCORS: true, logging: false })
    if (index > 0) pdf.addPage('a4', 'portrait')
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, 210, 297, undefined, 'FAST')
    const pageBox = pages[index].getBoundingClientRect()
    pages[index].querySelectorAll<HTMLAnchorElement>('a.jovlo-pdf-link[href]').forEach((link) => {
      const box = link.getBoundingClientRect()
      const x = ((box.left - pageBox.left) / pageBox.width) * 210
      const y = ((box.top - pageBox.top) / pageBox.height) * 297
      const width = Math.max(1, (box.width / pageBox.width) * 210)
      const height = Math.max(1, (box.height / pageBox.height) * 297)
      pdf.link(x, y, width, height, { url: link.href })
    })
  }
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 80)
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  pdf.save(`Jovlo-${safeTitle}-${date}.pdf`)
}

async function waitForImages(container: HTMLElement, timeoutMs = 10_000) {
  const images = [...container.querySelectorAll<HTMLImageElement>('img')]
  await Promise.race([
    Promise.all(images.map(async (image) => {
      if (image.complete && image.naturalWidth > 0) return
      if (typeof image.decode === 'function') {
        await image.decode().catch(() => undefined)
        return
      }
      await new Promise<void>((resolve) => {
        image.addEventListener('load', () => resolve(), { once: true })
        image.addEventListener('error', () => resolve(), { once: true })
      })
    })),
    new Promise((resolve) => window.setTimeout(resolve, timeoutMs)),
  ])
}

export function TripPdfDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = useTripStore()
  const documentRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'idle' | 'saving' | 'maps' | 'qr' | 'rendering' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<PdfData | null>(null)
  const busy = !['idle', 'done'].includes(status)

  useEffect(() => () => {
    if (!data) return
    Object.values(data.maps).forEach((url) => {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url)
    })
  }, [data])

  if (!open) return null

  const createPublication = async (version: TripVersion) => {
    const existing = state.publications.find((item) => item.targetKind === 'version' && item.versionId === version.id && !item.revokedAt && samePdfDisclosure(item.disclosureConfig))
    if (existing) return { publication: existing, created: false }
    if (state.productionSync.mode !== 'production') {
      return { publication: state.createTripPublication(PDF_DISCLOSURE), created: true }
    }
    const result = await apiRequest<PublicationResult>(`/api/v1/trips/${state.trip.tripId}/publications`, {
      method: 'POST',
      headers: { 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ versionId: version.id, disclosureConfig: PDF_DISCLOSURE }),
    })
    const publication: LocalPublication = { id: result.publicationId, token: result.token, targetKind: 'version', versionId: version.id, reportId: null, disclosureConfig: PDF_DISCLOSURE, createdAt: result.createdAt ?? new Date().toISOString(), revokedAt: null }
    state.recordPublication(publication)
    return { publication, created: true }
  }

  const generate = async () => {
    let createdPublication: LocalPublication | null = null
    try {
      setError(null)
      setStatus('saving')
      if (useTripStore.getState().dirty) useTripStore.getState().publishVersion('下载 PDF 前自动保存', 'manual_auto')
      await waitForCheckpoint()
      const version = currentVersion(useTripStore.getState())
      const { publication, created } = await createPublication(version)
      if (created) createdPublication = publication
      const shareUrl = new URL(`/s/${publication.token}`, window.location.origin).toString()
      setStatus('maps')
      const resources = await loadPdfData(version, shareUrl)
      setStatus('qr')
      setData({ version, shareUrl, ...resources })
      await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)))
      setStatus('rendering')
      if (!documentRef.current) throw new Error('PDF 页面尚未准备好')
      await waitForImages(documentRef.current)
      await renderPdf(documentRef.current, version.snapshot.title)
      setStatus('done')
    } catch (cause) {
      if (createdPublication && state.productionSync.mode === 'production') {
        try {
          await apiRequest(`/api/v1/publications/${createdPublication.id}`, { method: 'DELETE', headers: { 'idempotency-key': crypto.randomUUID() } })
          state.revokePublication(createdPublication.id)
        } catch {
          // Keep the original generation error as the primary user-facing message.
        }
      }
      setStatus('idle')
      setError(cause instanceof Error ? cause.message : 'PDF 暂时无法生成')
    }
  }

  const statusLabel = ({ saving: '保存当前行程', maps: '生成路线地图', qr: '生成分享二维码', rendering: '排版并下载', done: '下载完成', idle: '准备生成' } as const)[status]
  return (
    <div className="trip-pdf-backdrop" role="presentation" onMouseDown={busy ? undefined : onClose}>
      <section className="trip-pdf-dialog" role="dialog" aria-modal="true" aria-labelledby="trip-pdf-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>固定只读路书</span><h2 id="trip-pdf-title">下载 PDF 到本地</h2></div><button type="button" aria-label="关闭" onClick={onClose} disabled={busy}><X aria-hidden="true" /></button></header>
        <div className="trip-pdf-dialog__preview"><FileText aria-hidden="true" /><div><strong>完整行程、地图、耗时与预算</strong><span>末页二维码会指向当前版本的公开只读快照，之后的修改不会改变它。</span></div></div>
        <ul><li><MapPinned aria-hidden="true" />全程与每日地图</li><li><QrCode aria-hidden="true" />扫码打开固定链接</li><li><ShieldCheck aria-hidden="true" />访问者无需登录且不能编辑</li></ul>
        {error ? <p className="trip-pdf-dialog__error" role="alert">{error}</p> : null}
        {busy || status === 'done' ? <div className="trip-pdf-dialog__progress" role="status">{status === 'done' ? <Check /> : <LoaderCircle className="is-spinning" />}<span>{statusLabel}</span></div> : null}
        <footer><button type="button" className="jovlo-button jovlo-button--secondary" onClick={onClose} disabled={busy}>取消</button><button type="button" className="jovlo-button jovlo-button--primary" onClick={() => void generate()} disabled={busy}><Download aria-hidden="true" />{status === 'done' ? '再次下载' : '生成并下载'}</button></footer>
      </section>
      {data ? <PdfDocument data={data} documentRef={documentRef} /> : null}
    </div>
  )
}
