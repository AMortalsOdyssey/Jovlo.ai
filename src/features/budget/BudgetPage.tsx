import { BedDouble, CarFront, CircleDollarSign, Plus, ReceiptText, ShoppingBag, Ticket, Utensils, WalletCards } from 'lucide-react'
import { useMemo, useState, type CSSProperties, type FormEvent } from 'react'

import { useTripStore } from '@/store/useTripStore'

import { JOVLO_COLORS } from '@/design-system'
import {
  Button,
  EmptyState,
  FormField,
  MetricStrip,
  PageHeader,
  PageShell,
  SectionHeading,
  StatusBadge,
} from '@/features/trips/feature-ui'
import {
  formatDateLabel,
  formatMoney,
  getDerivedDay,
  getPlannedBudget,
  getTripDays,
  getTripId,
  getTripTitle,
  normalizeExpenses,
  readNumber,
} from '@/features/trips/model'

const categories = [
  { value: 'meals', label: '餐饮', icon: Utensils, color: JOVLO_COLORS.sun },
  { value: 'fuel_charging_tolls', label: '油电路费', icon: CarFront, color: JOVLO_COLORS.sky },
  { value: 'lodging', label: '住宿', icon: BedDouble, color: JOVLO_COLORS.sea },
  { value: 'tickets_activities', label: '门票活动', icon: Ticket, color: JOVLO_COLORS.brand },
  { value: 'parking', label: '停车', icon: ShoppingBag, color: JOVLO_COLORS.coral },
  { value: 'transport', label: '其他交通', icon: CarFront, color: JOVLO_COLORS.skyText },
  { value: 'other', label: '其他', icon: CircleDollarSign, color: JOVLO_COLORS.muted },
] as const

function categoryLabel(category: string) {
  return categories.find((item) => item.value === category)?.label ?? category
}

export function BudgetPage() {
  const state = useTripStore()
  const expenses = useMemo(() => normalizeExpenses(state.expenses), [state.expenses])
  const days = useMemo(() => getTripDays(state.trip), [state.trip])
  const planned = getPlannedBudget(state.trip, state.derived)
  const spent = expenses.reduce((sum, expense) => sum + expense.amount, 0)
  const remaining = planned - spent
  const recordedDays = new Set(expenses.map((expense) => expense.dayId).filter(Boolean)).size
  const progress = days.length ? Math.max(1, recordedDays) / days.length : 0
  const projected = spent > 0 && progress > 0 ? Math.max(spent, spent / progress) : planned
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('meals')
  const [dayId, setDayId] = useState(() => state.selectedDayId ?? days[0]?.id ?? '')
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState(false)

  const daily = days.map((day) => {
    const derivedDay = getDerivedDay(state.derived, day.id, day.dayIndex)
    const expected =
      readNumber(derivedDay.budget, 'expected', 'planned', 'amount') ??
      readNumber(derivedDay, 'budgetExpected', 'plannedBudget') ??
      (days.length ? planned / days.length : 0)
    const actual = expenses.filter((expense) => expense.dayId === day.id).reduce((sum, expense) => sum + expense.amount, 0)
    return { day, expected, actual }
  })
  const maxDaily = Math.max(1, ...daily.flatMap((item) => [item.expected, item.actual]))

  const byCategory = categories.map((item) => ({
    ...item,
    amount: expenses.filter((expense) => expense.category === item.value).reduce((sum, expense) => sum + expense.amount, 0),
  })).filter((item) => item.amount > 0)
  const donut = byCategory.length
    ? (() => {
        let current = 0
        const stops = byCategory.map((item) => {
          const start = current
          current += (item.amount / spent) * 360
          return `${item.color} ${start}deg ${current}deg`
        })
        return `conic-gradient(${stops.join(', ')})`
      })()
    : 'conic-gradient(var(--line) 0deg 360deg)'

  const addExpense = (event: FormEvent) => {
    event.preventDefault()
    const numericAmount = Number(amount)
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return
    state.addExpense({
      tripId,
      amount: numericAmount,
      category,
      currency: 'CNY',
      dayId: dayId || undefined,
      occurredOn: days.find((day) => day.id === dayId)?.date ?? new Date().toISOString().slice(0, 10),
      note: note.trim() || undefined,
    })
    setAmount('')
    setNote('')
    setSaved(true)
  }

  if (!state.trip) {
    return (
      <PageShell>
        <PageHeader title="预算与记账" backTo="/trips" />
        <EmptyState icon={WalletCards} title="还没有可计算的行程" />
      </PageShell>
    )
  }

  const tripId = getTripId(state.trip)

  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow={getTripTitle(state.trip)}
        title="预算与记账"
        description="计划估算与实际流水分开保留，行程调整后仍能看出差额来自哪里。"
        backTo={`/trips/${tripId}/plan`}
        meta={saved ? <StatusBadge tone="sea">已记入草稿</StatusBadge> : undefined}
      />

      <MetricStrip
        metrics={[
          { label: '计划', value: formatMoney(planned), note: `${days.length} 天估算` },
          { label: '已花', value: formatMoney(spent), note: `${expenses.length} 笔流水`, tone: 'brand' },
          { label: '剩余', value: formatMoney(remaining), note: remaining >= 0 ? '仍在计划内' : '已超出计划', tone: remaining >= 0 ? 'sea' : 'coral' },
          { label: '预计', value: formatMoney(projected), note: spent ? '按已记录节奏' : '暂无实际流水', tone: projected > planned ? 'sun' : 'neutral' },
        ]}
      />

      <section className="feature-section budget-quick-section">
        <SectionHeading title="快速记一笔" description="金额优先，默认记在当前日；地点可在今日页自动带入。" />
        <form className="budget-quick-form" onSubmit={addExpense}>
          <FormField label="金额">
            <div className="budget-amount-input"><span aria-hidden="true">¥</span><input aria-label="金额" autoFocus inputMode="decimal" min="0.01" step="0.01" type="number" value={amount} onChange={(event) => { setAmount(event.target.value); setSaved(false) }} placeholder="0" required /></div>
          </FormField>
          <FormField label="类别">
            <select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select>
          </FormField>
          <FormField label="哪一天">
            <select value={dayId} onChange={(event) => setDayId(event.target.value)}>{days.map((day) => <option value={day.id} key={day.id}>Day {day.dayIndex} · {formatDateLabel(day.date)}</option>)}</select>
          </FormField>
          <FormField label="备注">
            <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="可选" />
          </FormField>
          <Button type="submit" variant="primary" icon={Plus}>记入</Button>
        </form>
      </section>

      <section className="feature-section">
        <SectionHeading title="每天花费" description="柱高按当前行程内的最大单日金额统一缩放。" />
        <div className="budget-daily-chart" role="img" aria-label="每日计划和实际支出柱状图">
          {daily.map(({ day, expected, actual }) => (
            <div className="budget-day-column" key={day.id}>
              <div className="budget-bars" aria-hidden="true">
                <span className="budget-bar budget-bar--planned" style={{ '--bar-height': `${Math.max(4, expected / maxDaily * 100)}%` } as CSSProperties} />
                <span className="budget-bar budget-bar--actual" style={{ '--bar-height': `${Math.max(actual ? 4 : 0, actual / maxDaily * 100)}%` } as CSSProperties} />
              </div>
              <strong>D{day.dayIndex}</strong>
              <span>{formatMoney(actual)}</span>
            </div>
          ))}
        </div>
        <div className="budget-chart-legend"><span><i className="budget-legend-planned" />计划</span><span><i className="budget-legend-actual" />实际</span></div>
      </section>

      <section className="feature-section budget-analysis-grid">
        <div>
          <SectionHeading title="分类占比" />
          <div className="budget-donut-layout">
            <div className="budget-donut" style={{ background: donut }} aria-label={`已花 ${formatMoney(spent)}`}><div><span>已花</span><strong>{formatMoney(spent)}</strong></div></div>
            <ul className="budget-category-list">
              {byCategory.length ? byCategory.map((item) => {
                const Icon = item.icon
                return <li key={item.value}><span><Icon aria-hidden="true" size={16} style={{ color: item.color }} />{item.label}</span><strong>{formatMoney(item.amount)}</strong><small>{spent ? `${Math.round(item.amount / spent * 100)}%` : '0%'}</small></li>
              }) : <li className="budget-no-expense"><ReceiptText aria-hidden="true" size={20} /><span>出行后在今日页记第一笔</span></li>}
            </ul>
          </div>
        </div>
        <div>
          <SectionHeading title="每日数值" />
          <div className="feature-table-wrap">
            <table className="feature-table">
              <caption className="jovlo-sr-only">每日预算与实际数值</caption>
              <thead><tr><th>日期</th><th className="feature-table-number">计划</th><th className="feature-table-number">实际</th><th className="feature-table-number">差额</th></tr></thead>
              <tbody>{daily.map(({ day, expected, actual }) => <tr key={day.id}><td>Day {day.dayIndex}<small>{formatDateLabel(day.date)}</small></td><td className="feature-table-number">{formatMoney(expected)}</td><td className="feature-table-number">{formatMoney(actual)}</td><td className={`feature-table-number ${actual > expected ? 'budget-over' : 'budget-under'}`}>{actual ? formatMoney(expected - actual) : '未记录'}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="feature-section">
        <SectionHeading title="流水" description={`${expenses.length} 笔记录`} />
        {expenses.length ? (
          <div className="feature-table-wrap"><table className="feature-table"><caption className="jovlo-sr-only">实际费用流水</caption><thead><tr><th>日期</th><th>类别</th><th>备注</th><th className="feature-table-number">金额</th></tr></thead><tbody>{expenses.slice().reverse().map((expense) => <tr key={expense.id}><td>{formatDateLabel(expense.occurredOn)}</td><td>{categoryLabel(expense.category)}</td><td>{expense.note ?? '—'}</td><td className="feature-table-number">{formatMoney(expense.amount)}</td></tr>)}</tbody></table></div>
        ) : (
          <div className="budget-ledger-empty"><ReceiptText aria-hidden="true" size={24} /><span>暂无实际流水，计划区间仍会随行程更新。</span></div>
        )}
      </section>
    </PageShell>
  )
}

export default BudgetPage
