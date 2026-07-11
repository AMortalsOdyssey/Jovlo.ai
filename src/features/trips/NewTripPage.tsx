import { ArrowLeft, ArrowRight, BedDouble, CarFront, Gauge, MapPinned, Route } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { useTripStore } from '@/store/useTripStore'

import {
  Button,
  FormField,
  PageHeader,
  PageShell,
  RouteSpine,
  RouteSpineItem,
  SegmentedControl,
  StatusBadge,
  Stepper,
} from './feature-ui'
import { formatMoney, getTripId } from './model'

type Pace = 'relaxed' | 'balanced' | 'packed'
type Vehicle = 'fuel' | 'ev' | 'hybrid'

type WizardState = {
  startDate: string
  days: number
  entry: string
  exit: string
  partySize: number
  vehicle: Vehicle
  pace: Pace
  budget: number
  budgetUnknown: boolean
  mustGo: string
  avoid: string
  preferences: string[]
  maxDriveMinutesPerDay: number
}

const initialWizard: WizardState = {
  startDate: '',
  days: 6,
  entry: '海口',
  exit: '三亚',
  partySize: 2,
  vehicle: 'fuel',
  pace: 'balanced',
  budget: 8_000,
  budgetUnknown: false,
  mustGo: '',
  avoid: '',
  preferences: ['海滩', '美食'],
  maxDriveMinutesPerDay: 180,
}

const preferenceOptions = ['海滩', '咖啡', '亲子', '徒步', '人文', '冲浪', '美食', '雨天友好']

const corridors: Record<number, Array<{ city: string; drive: string; note: string }>> = {
  4: [
    { city: '海口', drive: '参考 0h', note: '抵达与骑楼散步' },
    { city: '文昌', drive: '参考 1h30', note: '东郊椰林与海岸' },
    { city: '万宁', drive: '参考 2h10', note: '日月湾与兴隆' },
    { city: '三亚', drive: '参考 2h20', note: '海湾收尾' },
  ],
  5: [
    { city: '海口', drive: '参考 0h', note: '抵达与城市漫步' },
    { city: '文昌', drive: '参考 1h30', note: '椰林海岸' },
    { city: '博鳌', drive: '参考 1h40', note: '河海交汇' },
    { city: '万宁', drive: '参考 1h20', note: '冲浪与咖啡' },
    { city: '三亚', drive: '参考 2h20', note: '海湾收尾' },
  ],
  6: [
    { city: '海口', drive: '参考 0h', note: '抵达与骑楼' },
    { city: '文昌', drive: '参考 1h30', note: '航天与椰林' },
    { city: '琼海', drive: '参考 1h35', note: '博鳌慢行' },
    { city: '万宁', drive: '参考 1h20', note: '日月湾' },
    { city: '陵水', drive: '参考 1h15', note: '分界洲周边' },
    { city: '三亚', drive: '参考 1h30', note: '海湾收尾' },
  ],
  7: [
    { city: '海口', drive: '参考 0h', note: '抵达与城市漫步' },
    { city: '文昌', drive: '参考 1h30', note: '东海岸' },
    { city: '琼海', drive: '参考 1h35', note: '博鳌与潭门' },
    { city: '万宁', drive: '参考 1h20', note: '冲浪海湾' },
    { city: '陵水', drive: '参考 1h15', note: '清水湾' },
    { city: '保亭', drive: '参考 1h40', note: '雨林与温泉' },
    { city: '三亚', drive: '参考 1h30', note: '海湾收尾' },
  ],
  9: [
    { city: '海口', drive: '参考 0h', note: '北岸抵达' },
    { city: '临高', drive: '参考 1h45', note: '西线海岸' },
    { city: '昌江', drive: '参考 2h10', note: '山海走廊' },
    { city: '东方', drive: '参考 1h25', note: '西岸日落' },
    { city: '三亚', drive: '参考 2h30', note: '南岸海湾' },
    { city: '陵水', drive: '参考 1h25', note: '清水湾' },
    { city: '万宁', drive: '参考 1h20', note: '日月湾' },
    { city: '文昌', drive: '参考 2h20', note: '椰林海岸' },
    { city: '海口', drive: '参考 1h35', note: '环岛收尾' },
  ],
}

function buildReferenceRoute(days: number, entry: string, exit: string) {
  const closest = [4, 5, 6, 7, 9].reduce((best, current) =>
    Math.abs(current - days) < Math.abs(best - days) ? current : best,
  )
  const route = corridors[closest].slice(0, Math.min(days, corridors[closest].length))
  if (route.length) {
    route[0] = { ...route[0], city: entry }
    route[route.length - 1] = { ...route[route.length - 1], city: exit }
  }
  return route
}

export function NewTripPage() {
  const navigate = useNavigate()
  const state = useTripStore()
  const [step, setStep] = useState(1)
  const [form, setForm] = useState<WizardState>(initialWizard)
  const referenceRoute = useMemo(
    () => buildReferenceRoute(form.days, form.entry, form.exit),
    [form.days, form.entry, form.exit],
  )

  const update = <K extends keyof WizardState>(key: K, value: WizardState[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const togglePreference = (preference: string) => {
    setForm((current) => {
      const exists = current.preferences.includes(preference)
      if (exists) return { ...current, preferences: current.preferences.filter((item) => item !== preference) }
      if (current.preferences.length >= 4) return current
      return { ...current, preferences: [...current.preferences, preference] }
    })
  }

  const next = (event: FormEvent) => {
    event.preventDefault()
    setStep((current) => Math.min(3, current + 1))
  }

  const createDraft = () => {
    const payload = {
      title: `${form.entry}到${form.exit} · 海南${form.days}日`,
      intent: {
        startDate: form.startDate || undefined,
        days: form.days,
        entryAnchor: { placeId: `anchor-${form.entry}`, label: form.entry },
        exitAnchor: { placeId: `anchor-${form.exit}`, label: form.exit },
        partySize: form.partySize,
        vehicle: { type: form.vehicle },
        pace: form.pace,
        maxDriveMinutesPerDay: form.maxDriveMinutesPerDay,
        dayEndLimit: '22:00',
        totalBudget: form.budgetUnknown ? undefined : form.budget,
        mustPlaceIds: form.mustGo.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 5),
        avoidTags: form.avoid.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 5),
        preferenceTags: form.preferences,
      },
      templateReference: referenceRoute,
    }
    state.resetDemo()
    state.requestSettingsUpdate(payload)
    navigate(`/trips/${getTripId(useTripStore.getState().trip)}/plan`)
  }

  return (
    <PageShell width="reading">
      <PageHeader
        title="创建海南自驾路书"
        description="先确定会牵动整条路线的条件，地点细节进入编辑台后再慢慢共创。"
        backTo="/trips"
      />
      <Stepper current={step} labels={['基础条件', '路线倾向', '草案预览']} />

      {step === 1 ? (
        <form onSubmit={next}>
          <section className="feature-wizard-panel">
            <div className="feature-grid">
              <FormField label="出发日期" hint="不确定时可以留空">
                <input type="date" value={form.startDate} onChange={(event) => update('startDate', event.target.value)} />
              </FormField>
              <FormField label="天数">
                <select value={form.days} onChange={(event) => update('days', Number(event.target.value))}>
                  {[4, 5, 6, 7, 9].map((days) => <option value={days} key={days}>{days} 天</option>)}
                </select>
              </FormField>
              <FormField label="进岛地点">
                <select value={form.entry} onChange={(event) => update('entry', event.target.value)}>
                  <option>海口</option><option>三亚</option>
                </select>
              </FormField>
              <FormField label="离岛地点">
                <select value={form.exit} onChange={(event) => update('exit', event.target.value)}>
                  <option>三亚</option><option>海口</option>
                </select>
              </FormField>
              <FormField label="出行人数">
                <input min="1" max="12" type="number" value={form.partySize} onChange={(event) => update('partySize', Number(event.target.value))} />
              </FormField>
              <FormField label="车辆">
                <select value={form.vehicle} onChange={(event) => update('vehicle', event.target.value as Vehicle)}>
                  <option value="fuel">燃油车</option><option value="ev">纯电车</option><option value="hybrid">混动车</option>
                </select>
              </FormField>
            </div>

            <div className="new-trip-choice-row">
              <fieldset className="feature-fieldset">
                <legend>旅行节奏</legend>
                <SegmentedControl
                  label="旅行节奏"
                  value={form.pace}
                  onChange={(value) => update('pace', value)}
                  options={[{ value: 'relaxed', label: '轻松' }, { value: 'balanced', label: '均衡' }, { value: 'packed', label: '尽量多玩' }]}
                />
              </fieldset>
              <div className="new-trip-budget">
                <FormField label="总预算">
                  <input disabled={form.budgetUnknown} min="0" step="500" type="number" value={form.budget} onChange={(event) => update('budget', Number(event.target.value))} />
                </FormField>
                <label className="new-trip-checkbox">
                  <input type="checkbox" checked={form.budgetUnknown} onChange={(event) => update('budgetUnknown', event.target.checked)} />
                  <span>先看区间</span>
                </label>
              </div>
            </div>
          </section>
          <div className="feature-wizard-footer"><span /><Button type="submit" variant="primary" icon={ArrowRight}>下一步</Button></div>
        </form>
      ) : null}

      {step === 2 ? (
        <form onSubmit={next}>
          <section className="feature-wizard-panel">
            <div className="feature-grid">
              <FormField label="必去地点" hint="用逗号分隔，最多 5 个">
                <textarea value={form.mustGo} onChange={(event) => update('mustGo', event.target.value)} placeholder="例如：日月湾、骑楼老街" />
              </FormField>
              <FormField label="避开项" hint="用逗号分隔，最多 5 个">
                <textarea value={form.avoid} onChange={(event) => update('avoid', event.target.value)} placeholder="例如：长距离徒步、热门排队" />
              </FormField>
            </div>
            <fieldset className="feature-fieldset new-trip-preferences">
              <legend>偏好标签 <small>{form.preferences.length}/4</small></legend>
              <div className="feature-chip-grid">
                {preferenceOptions.map((preference) => (
                  <label className="feature-choice" key={preference}>
                    <input type="checkbox" checked={form.preferences.includes(preference)} onChange={() => togglePreference(preference)} />
                    <span>{preference}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="feature-fieldset new-trip-drive-limit">
              <legend>每日驾驶上限</legend>
              <SegmentedControl
                label="每日驾驶上限"
                value={String(form.maxDriveMinutesPerDay)}
                onChange={(value) => update('maxDriveMinutesPerDay', Number(value))}
                options={[{ value: '120', label: '2 小时' }, { value: '180', label: '3 小时' }, { value: '240', label: '4 小时' }]}
              />
            </fieldset>
          </section>
          <div className="feature-wizard-footer">
            <Button icon={ArrowLeft} onClick={() => setStep(1)}>上一步</Button>
            <Button type="submit" variant="primary" icon={ArrowRight}>查看草案</Button>
          </div>
        </form>
      ) : null}

      {step === 3 ? (
        <>
          <section className="feature-wizard-panel new-trip-preview">
            <div className="new-trip-reference-note">
              <div>
                <StatusBadge tone="sun">模板参考</StatusBadge>
                <h2>{form.entry} → {form.exit} · {form.days} 天</h2>
                <p>路程来自人工核验的路线模板，仅用于判断走向和节奏，不是高德道路算路结果。</p>
              </div>
              <div className="new-trip-preview-budget">
                <span>预算参考</span>
                <strong>{form.budgetUnknown ? `${formatMoney(form.partySize * form.days * 700)}–${formatMoney(form.partySize * form.days * 1_200)}` : formatMoney(form.budget)}</strong>
              </div>
            </div>

            <div className="feature-grid feature-grid--sidebar new-trip-preview-grid">
              <RouteSpine>
                {referenceRoute.map((item, index) => (
                  <RouteSpineItem
                    key={`${item.city}-${index}`}
                    marker={index + 1}
                    title={`Day ${index + 1} · ${item.city}`}
                    meta={<><CarFront aria-hidden="true" size={14} /> {item.drive}</>}
                    note={item.note}
                    kind={index === referenceRoute.length - 1 ? 'stay' : 'stop'}
                  />
                ))}
              </RouteSpine>
              <aside className="new-trip-summary-panel">
                <div><MapPinned aria-hidden="true" size={20} /><span>进出岛</span><strong>{form.entry} → {form.exit}</strong></div>
                <div><BedDouble aria-hidden="true" size={20} /><span>过夜锚点</span><strong>{Math.max(0, form.days - 1)} 晚</strong></div>
                <div><Gauge aria-hidden="true" size={20} /><span>驾驶上限</span><strong>{form.maxDriveMinutesPerDay / 60} 小时/天</strong></div>
                <div><Route aria-hidden="true" size={20} /><span>节奏</span><strong>{form.pace === 'relaxed' ? '轻松' : form.pace === 'packed' ? '尽量多玩' : '均衡'}</strong></div>
              </aside>
            </div>
          </section>
          <div className="feature-wizard-footer">
            <Button icon={ArrowLeft} onClick={() => setStep(2)}>修改倾向</Button>
            <Button variant="primary" icon={Route} onClick={createDraft}>开始编辑</Button>
          </div>
        </>
      ) : null}
    </PageShell>
  )
}

export default NewTripPage
