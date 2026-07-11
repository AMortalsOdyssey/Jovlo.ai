import {
  ArrowDown,
  ArrowUp,
  Banknote,
  Check,
  Clock3,
  ExternalLink,
  MapPin,
  Navigation,
  RefreshCcw,
  SkipForward,
  Star,
} from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'

import { buildAmapNavigationUrl } from '@/lib/amap'
import { useTripStore } from '@/store/useTripStore'

import {
  Button,
  EmptyState,
  FormField,
  PageHeader,
  PageShell,
  RouteSpine,
  RouteSpineItem,
  SaveStatus,
  StatusBadge,
} from '@/features/trips/feature-ui'
import {
  asArray,
  asRecord,
  formatDateLabel,
  formatMinutes,
  getDerivedDay,
  getPlaceRefs,
  getTripDays,
  getTripId,
  getTripTitle,
  normalizeActuals,
  readNumber,
  readString,
} from '@/features/trips/model'

function actualStatusLabel(status?: string) {
  if (status === 'visited') return '已到访'
  if (status === 'skipped') return '今天跳过'
  return '未记录'
}

export function TodayPage() {
  const state = useTripStore()
  const days = useMemo(() => getTripDays(state.trip), [state.trip])
  const places = useMemo(() => getPlaceRefs(state.trip), [state.trip])
  const actuals = useMemo(() => normalizeActuals(state.actuals), [state.actuals])
  const todayIso = new Date().toISOString().slice(0, 10)
  const selectedDay =
    days.find((day) => day.id === state.selectedDayId) ??
    days.find((day) => day.date === todayIso) ??
    days[0]
  const [delayOpen, setDelayOpen] = useState(false)
  const [replaceStopId, setReplaceStopId] = useState<string | null>(null)
  const [replacementNames, setReplacementNames] = useState<Record<string, string>>({})
  const [expenseOpen, setExpenseOpen] = useState(false)
  const [expenseAmount, setExpenseAmount] = useState('')
  const [expenseCategory, setExpenseCategory] = useState('meals')
  const [expenseNote, setExpenseNote] = useState('')
  const [actualStopId, setActualStopId] = useState<string | null>(null)
  const [rating, setRating] = useState(5)
  const [actualNote, setActualNote] = useState('')
  const [actualStart, setActualStart] = useState('')
  const [actualEnd, setActualEnd] = useState('')
  const [publishPromptDismissed, setPublishPromptDismissed] = useState(false)

  if (!state.trip || !selectedDay) {
    return (
      <PageShell>
        <PageHeader title="今日行程" backTo="/trips" />
        <EmptyState icon={Navigation} title="今天还没有可执行的行程" />
      </PageShell>
    )
  }

  const tripId = getTripId(state.trip)
  const dayDerived = getDerivedDay(state.derived, selectedDay.id, selectedDay.dayIndex)
  const schedules = asArray(dayDerived.stops)
  const routeLegs = asArray(asRecord(state.derived).routeLegs)
  const actualByStop = new Map(actuals.filter((actual) => actual.stopId).map((actual) => [actual.stopId!, actual]))
  const nextStop = selectedDay.stops.find((stop) => !actualByStop.has(stop.id)) ?? selectedDay.stops.at(-1)
  const nextPlace = nextStop ? places[nextStop.placeId] : undefined
  const nextCoordinate = asRecord(nextPlace?.gcj02)
  const navigationUrl = nextStop && readNumber(nextCoordinate, 'lon') !== undefined && readNumber(nextCoordinate, 'lat') !== undefined
    ? buildAmapNavigationUrl({
        name: replacementNames[nextStop.id] ?? nextStop.name,
        lon: readNumber(nextCoordinate, 'lon')!,
        lat: readNumber(nextCoordinate, 'lat')!,
      })
    : undefined
  const nextSchedule = schedules.find((item) => readString(item, 'stopId') === nextStop?.id)
  const nextIndex = nextStop ? selectedDay.stops.findIndex((stop) => stop.id === nextStop.id) : -1
  const nextLeg = nextStop
    ? routeLegs.find((leg) => {
        const to = asRecord(asRecord(leg).to)
        return readString(to, 'placeId') === nextStop.placeId && readString(leg, 'dayId') === selectedDay.id
      })
    : undefined
  const completedCount = selectedDay.stops.filter((stop) => actualByStop.has(stop.id)).length
  const dayFinished = selectedDay.stops.length > 0 && completedCount === selectedDay.stops.length
  const plannedPlaceIds = new Set(days.flatMap((day) => day.stops.map((stop) => stop.placeId)))
  const candidates = state.candidates
    .filter((candidate) => !plannedPlaceIds.has(candidate.placeId))
    .slice(0, 3)

  const delay = (minutes: number) => {
    if (!nextStop) return
    state.delayToday(minutes, selectedDay.id)
    setDelayOpen(false)
  }

  const skip = (stopId: string) => {
    state.skipTodayStop(stopId)
  }

  const move = (stopId: string, direction: -1 | 1) => {
    const index = selectedDay.stops.findIndex((stop) => stop.id === stopId)
    const targetIndex = Math.max(0, Math.min(selectedDay.stops.length - 1, index + direction))
    state.moveStop(stopId, selectedDay.id, targetIndex)
  }

  const replace = (stopId: string, placeId: string, name: string) => {
    state.skipTodayStop(stopId)
    state.addCandidateStop(placeId, selectedDay.id)
    setReplacementNames((current) => ({ ...current, [stopId]: name }))
    setReplaceStopId(null)
  }

  const saveActual = (event: FormEvent) => {
    event.preventDefault()
    if (!actualStopId) return
    const date = selectedDay.date ?? todayIso
    state.markActual({
      dayId: selectedDay.id,
      stopId: actualStopId,
      status: 'visited',
      rating,
      note: actualNote.trim() || undefined,
      actualStartAt: actualStart ? `${date}T${actualStart}:00+08:00` : undefined,
      actualEndAt: actualEnd ? `${date}T${actualEnd}:00+08:00` : undefined,
    })
    setActualStopId(null)
    setActualNote('')
    setActualStart('')
    setActualEnd('')
  }

  const addExpense = (event: FormEvent) => {
    event.preventDefault()
    const amount = Number(expenseAmount)
    if (!Number.isFinite(amount) || amount <= 0) return
    state.addExpense({
      tripId,
      dayId: selectedDay.id,
      stopId: nextStop?.id,
      category: expenseCategory,
      amount,
      currency: 'CNY',
      occurredOn: selectedDay.date ?? todayIso,
      note: expenseNote.trim() || undefined,
    })
    setExpenseAmount('')
    setExpenseNote('')
    setExpenseOpen(false)
  }

  return (
    <PageShell width="reading" className="today-page">
      <PageHeader
        eyebrow={getTripTitle(state.trip)}
        title={`Day ${selectedDay.dayIndex} · ${selectedDay.overnightLabel ?? formatDateLabel(selectedDay.date)}`}
        backTo={`/trips/${tripId}/plan`}
        meta={<><SaveStatus status={state.saveStatus} dirty={state.dirty} /><StatusBadge tone="sun">调整只写草稿</StatusBadge></>}
      />

      <nav className="today-day-strip" aria-label="选择日期">
        {days.map((day) => <button className={day.id === selectedDay.id ? 'is-active' : ''} type="button" onClick={() => state.selectDay(day.id)} key={day.id}><span>D{day.dayIndex}</span><small>{formatDateLabel(day.date)}</small></button>)}
      </nav>

      {nextStop ? (
        <section className="today-next" aria-labelledby="today-next-title">
          <div className="today-next-copy">
            <span>下一站{nextIndex >= 0 ? ` · 第 ${nextIndex + 1} 站` : ''}</span>
            <h2 id="today-next-title">{replacementNames[nextStop.id] ?? nextStop.name}</h2>
            <p><Clock3 aria-hidden="true" size={16} /> {readString(nextSchedule, 'arrivalTime') ?? nextStop.plannedStart ?? '时间待确认'} · {nextLeg ? `${(readNumber(nextLeg, 'distanceMeters') ?? 0) / 1000 >= 1 ? `${((readNumber(nextLeg, 'distanceMeters') ?? 0) / 1000).toFixed(0)} km` : '短途'} · ${formatMinutes((readNumber(nextLeg, 'durationSeconds') ?? 0) / 60)}` : '路段待计算'}</p>
          </div>
          <div className="today-next-actions">
            {navigationUrl ? <a className="feature-button feature-button--primary" href={navigationUrl} target="_blank" rel="noreferrer"><Navigation aria-hidden="true" size={18} /><span>高德导航</span></a> : <Button variant="primary" icon={MapPin} disabled>地址待确认</Button>}
            <Button icon={Banknote} onClick={() => setExpenseOpen((open) => !open)}>记一笔</Button>
          </div>
          <div className="today-adjust-actions">
            <Button variant="quiet" icon={Clock3} onClick={() => setDelayOpen((open) => !open)}>延后</Button>
            <Button variant="quiet" icon={SkipForward} onClick={() => skip(nextStop.id)}>今天跳过</Button>
            <Button variant="quiet" icon={RefreshCcw} onClick={() => setReplaceStopId(nextStop.id)}>替换</Button>
          </div>
          {delayOpen ? <div className="today-delay-menu" aria-label="延后时间"><span>延后</span>{[15, 30, 60].map((minutes) => <Button key={minutes} onClick={() => delay(minutes)}>{minutes} 分钟</Button>)}</div> : null}
          {expenseOpen ? (
            <form className="today-inline-form" onSubmit={addExpense}>
              <FormField label="金额"><input autoFocus inputMode="decimal" min="0.01" step="0.01" type="number" value={expenseAmount} onChange={(event) => setExpenseAmount(event.target.value)} required /></FormField>
              <FormField label="类别"><select value={expenseCategory} onChange={(event) => setExpenseCategory(event.target.value)}><option value="meals">餐饮</option><option value="fuel_charging_tolls">油电路费</option><option value="tickets_activities">门票活动</option><option value="parking">停车</option><option value="other">其他</option></select></FormField>
              <FormField label="备注"><input value={expenseNote} onChange={(event) => setExpenseNote(event.target.value)} placeholder={nextStop.name} /></FormField>
              <Button type="submit" variant="primary">记入</Button>
            </form>
          ) : null}
        </section>
      ) : null}

      <section className="feature-section today-timeline-section">
        <RouteSpine>
          {selectedDay.stops.map((stop, index) => {
            const actual = actualByStop.get(stop.id)
            const schedule = schedules.find((item) => readString(item, 'stopId') === stop.id)
            return (
              <RouteSpineItem
                key={stop.id}
                marker={actual?.status === 'visited' ? <Check aria-hidden="true" size={15} /> : index + 1}
                title={replacementNames[stop.id] ?? stop.name}
                meta={<>{readString(schedule, 'arrivalTime') ?? stop.plannedStart ?? '--:--'}–{readString(schedule, 'departureTime') ?? '--:--'} · 停留 {formatMinutes(stop.stayMinutes)} · <StatusBadge tone={actual?.status === 'visited' ? 'sea' : actual?.status === 'skipped' ? 'sun' : 'neutral'}>{actualStatusLabel(actual?.status)}</StatusBadge></>}
                note={stop.note}
                action={
                  <details className="today-stop-menu">
                    <summary aria-label={`${stop.name}操作`}>•••</summary>
                    <div>
                      <button type="button" onClick={() => { state.markActual({ dayId: selectedDay.id, stopId: stop.id, status: 'visited' }); setActualStopId(stop.id) }}><Check aria-hidden="true" size={16} />已到访并记录</button>
                      <button type="button" onClick={() => skip(stop.id)}><SkipForward aria-hidden="true" size={16} />今天跳过</button>
                      <button type="button" disabled={index === 0} onClick={() => move(stop.id, -1)}><ArrowUp aria-hidden="true" size={16} />提前一站</button>
                      <button type="button" disabled={index === selectedDay.stops.length - 1} onClick={() => move(stop.id, 1)}><ArrowDown aria-hidden="true" size={16} />延后一站</button>
                      <button type="button" onClick={() => setReplaceStopId(stop.id)}><RefreshCcw aria-hidden="true" size={16} />替换</button>
                    </div>
                  </details>
                }
              />
            )
          })}
          {selectedDay.overnightLabel ? <RouteSpineItem marker={<MapPin aria-hidden="true" size={15} />} title={`宿 · ${selectedDay.overnightLabel}`} meta="前日终点 / 次日起点" kind="stay" /> : null}
        </RouteSpine>
      </section>

      {replaceStopId ? (
        <section className="today-sheet" role="dialog" aria-modal="true" aria-labelledby="replace-title">
          <div className="today-sheet-handle" />
          <div className="feature-section-heading"><div><h2 id="replace-title">替换地点</h2><p>候选仅来自当前行程地点池，确认后写入草稿并重算。</p></div><Button variant="quiet" onClick={() => setReplaceStopId(null)}>关闭</Button></div>
          {candidates.length ? <div className="today-candidates">{candidates.map((place) => <button type="button" onClick={() => replace(replaceStopId, place.placeId, place.name)} key={place.placeId}><span><strong>{place.name}</strong><small>{place.type} · {place.address ?? '地址待确认'}</small></span><RefreshCcw aria-hidden="true" size={18} /></button>)}</div> : <div className="today-no-candidates">当前地点池没有可替换候选。</div>}
        </section>
      ) : null}

      {actualStopId ? (
        <section className="today-sheet" role="dialog" aria-modal="true" aria-labelledby="actual-title">
          <div className="today-sheet-handle" />
          <div className="feature-section-heading"><div><h2 id="actual-title">记录实际体验</h2><p>未填写的时间和体验不会由系统推断。</p></div><Button variant="quiet" onClick={() => setActualStopId(null)}>关闭</Button></div>
          <form className="today-actual-form" onSubmit={saveActual}>
            <fieldset className="today-rating"><legend>评分</legend>{[1, 2, 3, 4, 5].map((value) => <button className={value <= rating ? 'is-active' : ''} type="button" onClick={() => setRating(value)} aria-label={`${value} 星`} key={value}><Star aria-hidden="true" size={22} fill={value <= rating ? 'currentColor' : 'none'} /></button>)}</fieldset>
            <div className="feature-grid"><FormField label="实际开始"><input type="time" value={actualStart} onChange={(event) => setActualStart(event.target.value)} /></FormField><FormField label="实际结束"><input type="time" value={actualEnd} onChange={(event) => setActualEnd(event.target.value)} /></FormField></div>
            <FormField label="简短备注"><textarea value={actualNote} onChange={(event) => setActualNote(event.target.value)} placeholder="只记录你明确感受到的内容" /></FormField>
            <div className="feature-action-row"><Button type="submit" variant="primary">保存实际记录</Button></div>
          </form>
        </section>
      ) : null}

      {dayFinished && state.dirty && !publishPromptDismissed ? (
        <aside className="today-publish-prompt" aria-live="polite">
          <div><strong>今天有途中调整</strong><span>已完成 {completedCount} 处实际记录。现在可以把草稿一次性发布为新版本。</span></div>
          <div className="feature-action-row"><Button variant="quiet" onClick={() => setPublishPromptDismissed(true)}>稍后</Button><Button variant="primary" onClick={() => state.publishVersion(`Day ${selectedDay.dayIndex} 途中调整`)}>发布新版本</Button></div>
        </aside>
      ) : null}
    </PageShell>
  )
}

export default TodayPage
