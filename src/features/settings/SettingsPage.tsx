import { CalendarRange, CircleAlert, Gauge, MapPin, Save, Settings2, UsersRound } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'

import { useTripStore } from '@/store/useTripStore'

import {
  Button,
  EmptyState,
  FormField,
  ImpactBar,
  PageHeader,
  PageShell,
  SaveStatus,
  SectionHeading,
  SegmentedControl,
  StatusBadge,
} from '@/features/trips/feature-ui'
import {
  asRecord,
  getTripDays,
  getTripId,
  getTripIntent,
  getTripTitle,
  readNumber,
  readString,
} from '@/features/trips/model'

type Pace = 'relaxed' | 'balanced' | 'packed'
type Vehicle = 'fuel' | 'ev' | 'hybrid'

type SettingsForm = {
  title: string
  startDate: string
  days: number
  entry: string
  exit: string
  partySize: number
  vehicle: Vehicle
  pace: Pace
  totalBudget: number
  maxDriveMinutesPerDay: number
  dayEndLimit: string
}

const emptySettings: SettingsForm = {
  title: '',
  startDate: '',
  days: 6,
  entry: '海口',
  exit: '三亚',
  partySize: 2,
  vehicle: 'fuel',
  pace: 'balanced',
  totalBudget: 8_000,
  maxDriveMinutesPerDay: 180,
  dayEndLimit: '22:00',
}

function settingsFromTrip(trip: unknown): SettingsForm {
  const intent = getTripIntent(trip)
  const days = getTripDays(trip)
  const vehicle = asRecord(intent.vehicle)
  const vehicleType = readString(vehicle, 'type')
  const pace = readString(intent, 'pace')
  return {
    title: getTripTitle(trip),
    startDate: readString(intent, 'startDate') ?? days[0]?.date ?? '',
    days: readNumber(intent, 'days') ?? (days.length || 6),
    entry: readString(intent.entryAnchor, 'label') ?? '海口',
    exit: readString(intent.exitAnchor, 'label') ?? '三亚',
    partySize: readNumber(intent, 'partySize') ?? 2,
    vehicle: vehicleType === 'ev' || vehicleType === 'hybrid' ? vehicleType : 'fuel',
    pace: pace === 'relaxed' || pace === 'packed' ? pace : 'balanced',
    totalBudget: readNumber(intent, 'totalBudget') ?? 8_000,
    maxDriveMinutesPerDay: readNumber(intent, 'maxDriveMinutesPerDay') ?? 180,
    dayEndLimit: readString(intent, 'dayEndLimit') ?? '22:00',
  }
}

export function SettingsPage() {
  const state = useTripStore()
  const original = useMemo(() => (state.trip ? settingsFromTrip(state.trip) : emptySettings), [state.trip])
  const [form, setForm] = useState<SettingsForm>(original)
  const [showImpact, setShowImpact] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    setForm(original)
    setShowImpact(false)
  }, [original])

  const highImpactChanged =
    form.days !== original.days || form.entry !== original.entry || form.exit !== original.exit
  const dayDelta = form.days - original.days
  const affectedDayCount = Math.max(Math.abs(dayDelta), form.entry !== original.entry ? 1 : 0, form.exit !== original.exit ? 1 : 0)
  const pending = asRecord(state.pendingAction)
  const pendingImpact = asRecord(pending.impact)
  const pendingDescription = readString(pendingImpact, 'description')

  const update = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => {
    setSubmitted(false)
    setShowImpact(false)
    setForm((current) => ({ ...current, [key]: value }))
  }

  const payload = {
    title: form.title,
    intent: {
      startDate: form.startDate || undefined,
      days: form.days,
      entryAnchor: { placeId: `anchor-${form.entry}`, label: form.entry },
      exitAnchor: { placeId: `anchor-${form.exit}`, label: form.exit },
      partySize: form.partySize,
      vehicle: { type: form.vehicle },
      pace: form.pace,
      totalBudget: form.totalBudget,
      maxDriveMinutesPerDay: form.maxDriveMinutesPerDay,
      dayEndLimit: form.dayEndLimit,
    },
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (highImpactChanged) {
      setShowImpact(true)
      return
    }
    state.requestSettingsUpdate(payload)
    setSubmitted(true)
  }

  const applyHighImpact = () => {
    state.requestSettingsUpdate(payload)
    setShowImpact(false)
    setSubmitted(true)
  }

  if (!state.trip) {
    return (
      <PageShell>
        <PageHeader title="行程设置" backTo="/trips" />
        <EmptyState icon={Settings2} title="还没有可设置的行程" />
      </PageShell>
    )
  }

  const tripId = getTripId(state.trip)

  return (
    <PageShell>
      <PageHeader
        eyebrow={getTripTitle(state.trip)}
        title="行程设置"
        description="改天数或进出岛地点会重排路线；其他条件会更新当前草稿。"
        backTo={`/trips/${tripId}/plan`}
        meta={<><SaveStatus status={state.saveStatus} dirty={state.dirty} />{submitted ? <StatusBadge tone="sea">设置已提交</StatusBadge> : null}</>}
      />

      <form className="settings-form" onSubmit={handleSubmit}>
        <section className="feature-section">
          <SectionHeading title="基本信息" description="标题和日期会出现在版本、分享与报告中。" />
          <div className="feature-grid">
            <FormField label="路书标题" className="settings-field-wide">
              <input value={form.title} onChange={(event) => update('title', event.target.value)} required />
            </FormField>
            <FormField label="出发日期" hint="留空时，公开页只展示 Day 序号">
              <input type="date" value={form.startDate} onChange={(event) => update('startDate', event.target.value)} />
            </FormField>
          </div>
        </section>

        <section className="feature-section">
          <SectionHeading
            title="路线骨架"
            description="以下三项会改变日程结构，保存前先查看新增、移除和待安排地点。"
            action={<StatusBadge tone="sun">需影响预览</StatusBadge>}
          />
          <div className="feature-grid feature-grid--three settings-impact-fields">
            <FormField label="天数">
              <div className="settings-input-icon"><CalendarRange aria-hidden="true" size={18} /><input min="2" max="14" type="number" value={form.days} onChange={(event) => update('days', Number(event.target.value))} /></div>
            </FormField>
            <FormField label="进岛地点">
              <div className="settings-input-icon"><MapPin aria-hidden="true" size={18} /><select value={form.entry} onChange={(event) => update('entry', event.target.value)}><option>海口</option><option>三亚</option></select></div>
            </FormField>
            <FormField label="离岛地点">
              <div className="settings-input-icon"><MapPin aria-hidden="true" size={18} /><select value={form.exit} onChange={(event) => update('exit', event.target.value)}><option>三亚</option><option>海口</option></select></div>
            </FormField>
          </div>
          {highImpactChanged ? (
            <div className="settings-change-summary" role="status">
              <CircleAlert aria-hidden="true" size={18} />
              <span>
                {dayDelta > 0 ? `将新增 ${dayDelta} 天` : dayDelta < 0 ? `将移除 ${Math.abs(dayDelta)} 天，原地点进入待安排池` : '天数不变'}
                {form.entry !== original.entry ? ` · 入口 ${original.entry} → ${form.entry}` : ''}
                {form.exit !== original.exit ? ` · 出口 ${original.exit} → ${form.exit}` : ''}
              </span>
            </div>
          ) : null}
        </section>

        <section className="feature-section">
          <SectionHeading title="同行与车辆" />
          <div className="feature-grid">
            <FormField label="出行人数">
              <div className="settings-input-icon"><UsersRound aria-hidden="true" size={18} /><input min="1" max="12" type="number" value={form.partySize} onChange={(event) => update('partySize', Number(event.target.value))} /></div>
            </FormField>
            <FormField label="车辆类型">
              <select value={form.vehicle} onChange={(event) => update('vehicle', event.target.value as Vehicle)}><option value="fuel">燃油车</option><option value="ev">纯电车</option><option value="hybrid">混动车</option></select>
            </FormField>
          </div>
        </section>

        <section className="feature-section">
          <SectionHeading title="节奏与边界" description="驾驶上限与最晚结束时间用于判断偏紧和超载。" />
          <div className="settings-controls-grid">
            <fieldset className="feature-fieldset">
              <legend>旅行节奏</legend>
              <SegmentedControl
                label="旅行节奏"
                value={form.pace}
                onChange={(value) => update('pace', value)}
                options={[{ value: 'relaxed', label: '轻松' }, { value: 'balanced', label: '均衡' }, { value: 'packed', label: '尽量多玩' }]}
              />
            </fieldset>
            <FormField label="每日驾驶上限">
              <div className="settings-input-icon"><Gauge aria-hidden="true" size={18} /><select value={form.maxDriveMinutesPerDay} onChange={(event) => update('maxDriveMinutesPerDay', Number(event.target.value))}><option value={120}>2 小时</option><option value={180}>3 小时</option><option value={240}>4 小时</option><option value={300}>5 小时</option></select></div>
            </FormField>
            <FormField label="每日最晚结束">
              <input type="time" value={form.dayEndLimit} onChange={(event) => update('dayEndLimit', event.target.value)} />
            </FormField>
            <FormField label="总预算">
              <input min="0" step="500" type="number" value={form.totalBudget} onChange={(event) => update('totalBudget', Number(event.target.value))} />
            </FormField>
          </div>
        </section>

        <div className="settings-submit-row">
          <Button type="button" variant="quiet" onClick={() => setForm(original)}>恢复当前值</Button>
          <Button type="submit" variant="primary" icon={Save}>{highImpactChanged ? '预览影响' : '保存设置'}</Button>
        </div>
      </form>

      {showImpact ? (
        <ImpactBar
          summary={`${affectedDayCount || 1} 个行程段受影响 · 路线与预算将重新计算`}
          detail={pendingDescription ?? `${dayDelta < 0 ? `${Math.abs(dayDelta)} 天的地点会进入待安排池` : '新增日期会先建立空日程与住宿锚点'} · 入口/出口相邻路段将重新计算`}
          onDiscard={() => setShowImpact(false)}
          onApply={applyHighImpact}
          applyLabel="确认应用"
        />
      ) : null}
    </PageShell>
  )
}

export default SettingsPage
