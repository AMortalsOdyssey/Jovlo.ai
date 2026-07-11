import {
  BudgetEstimateSchema,
  type BudgetEstimate,
  type MoneyRange,
  type RouteLeg,
  type TripSnapshot,
} from './schemas'

const zeroRange = (): MoneyRange => ({ low: 0, expected: 0, high: 0, currency: 'CNY' })

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function addRange(left: MoneyRange, right: MoneyRange): MoneyRange {
  return {
    low: roundMoney(left.low + right.low),
    expected: roundMoney(left.expected + right.expected),
    high: roundMoney(left.high + right.high),
    currency: 'CNY',
  }
}

function scaleRange(range: MoneyRange, factor: number): MoneyRange {
  return {
    low: roundMoney(range.low * factor),
    expected: roundMoney(range.expected * factor),
    high: roundMoney(range.high * factor),
    currency: 'CNY',
  }
}

function lodgingRange(snapshot: TripSnapshot): MoneyRange {
  return snapshot.days.reduce((total, day) => {
    const stay = day.overnightStay
    if (!stay) return total
    if (stay.kind === 'area') {
      const range =
        snapshot.budgetAssumptions.lodgingByArea[stay.areaId] ??
        snapshot.stayAreaRefs[stay.areaId]?.priceReference ??
        snapshot.budgetAssumptions.lodgingDefaultPerNight
      return addRange(total, range)
    }
    const range =
      snapshot.placeRefs[stay.placeId]?.selectedVariant?.priceRange ??
      snapshot.budgetAssumptions.lodgingDefaultPerNight
    return addRange(total, range)
  }, zeroRange())
}

function ticketRange(snapshot: TripSnapshot): MoneyRange {
  return snapshot.days.flatMap((day) => day.stops).reduce((total, stop) => {
    if (stop.kind === 'meal') return total
    const range =
      snapshot.budgetAssumptions.ticketByPlaceId[stop.placeId] ??
      snapshot.placeRefs[stop.placeId]?.selectedVariant?.priceRange
    return range ? addRange(total, scaleRange(range, snapshot.intent.partySize)) : total
  }, zeroRange())
}

function specialMealsRange(snapshot: TripSnapshot): MoneyRange {
  return snapshot.days.flatMap((day) => day.stops).reduce((total, stop) => {
    const specialMeal = snapshot.budgetAssumptions.specialMealByStopId[stop.id]
    return specialMeal ? addRange(total, specialMeal) : total
  }, zeroRange())
}

function energyRange(snapshot: TripSnapshot, distanceKm: number): MoneyRange {
  const assumptions = snapshot.budgetAssumptions
  const vehicle = snapshot.intent.vehicle
  if (vehicle.type === 'ev') {
    const consumption = vehicle.consumption ?? assumptions.electricityKwhPer100Km
    return scaleRange(assumptions.electricityPricePerKwh, (distanceKm / 100) * consumption)
  }
  if (vehicle.type === 'hybrid') {
    const fuelConsumption = vehicle.consumption ?? assumptions.fuelLitersPer100Km * 0.6
    const fuel = scaleRange(assumptions.fuelPricePerLiter, (distanceKm / 100) * fuelConsumption)
    const electricity = scaleRange(
      assumptions.electricityPricePerKwh,
      (distanceKm / 100) * assumptions.electricityKwhPer100Km * 0.25,
    )
    return addRange(fuel, electricity)
  }
  const consumption = vehicle.consumption ?? assumptions.fuelLitersPer100Km
  return scaleRange(assumptions.fuelPricePerLiter, (distanceKm / 100) * consumption)
}

export function calculateBudget(
  snapshot: TripSnapshot,
  routeLegs: readonly RouteLeg[] = [],
  calculatedAt = new Date().toISOString(),
): BudgetEstimate {
  const totalDistanceMeters = routeLegs.reduce(
    (total, leg) => total + (leg.status === 'failed' ? 0 : leg.distanceMeters),
    0,
  )
  const distanceKm = totalDistanceMeters / 1_000
  const assumptions = snapshot.budgetAssumptions
  const lodging = lodgingRange(snapshot)
  const meals = addRange(
    scaleRange(
      assumptions.mealPerPersonPerDay,
      snapshot.intent.partySize * snapshot.intent.days,
    ),
    specialMealsRange(snapshot),
  )
  const tickets = ticketRange(snapshot)
  const energy = energyRange(snapshot, distanceKm)
  const rental = scaleRange(assumptions.rentalCarPerDay, snapshot.intent.days)
  const insurance = scaleRange(assumptions.insurancePerDay, snapshot.intent.days)
  const knownTolls = routeLegs.reduce((total, leg) => total + (leg.tollsCny ?? 0), 0)
  const parkingTolls = addRange(
    scaleRange(assumptions.parkingAndTollsPerDay, snapshot.intent.days),
    { low: knownTolls, expected: knownTolls, high: knownTolls, currency: 'CNY' },
  )

  const categoriesWithoutContingency = [
    { category: 'lodging' as const, amount: lodging, assumption: '住宿锚点参考价逐晚汇总' },
    {
      category: 'meals' as const,
      amount: meals,
      assumption: `每人每日餐饮标准 × ${snapshot.intent.partySize} 人 × ${snapshot.intent.days} 天`,
    },
    { category: 'tickets' as const, amount: tickets, assumption: '门票/活动参考价按人数计算' },
    {
      category: 'energy' as const,
      amount: energy,
      assumption: `${roundMoney(distanceKm)} km 道路里程与车型能耗假设`,
    },
    { category: 'rental' as const, amount: rental, assumption: '租车日价按行程天数计算' },
    { category: 'insurance' as const, amount: insurance, assumption: '保险日价按行程天数计算' },
    {
      category: 'parking_tolls' as const,
      amount: parkingTolls,
      assumption: '停车/路桥日均区间加已知路桥费',
    },
  ]
  const subtotal = categoriesWithoutContingency.reduce(
    (total, category) => addRange(total, category.amount),
    zeroRange(),
  )
  const contingency =
    assumptions.contingency.kind === 'fixed'
      ? assumptions.contingency.amount
      : scaleRange(subtotal, assumptions.contingency.rate)
  const categories = [
    ...categoriesWithoutContingency,
    {
      category: 'contingency' as const,
      amount: contingency,
      assumption:
        assumptions.contingency.kind === 'fixed'
          ? '固定机动金'
          : `按小计 ${roundMoney(assumptions.contingency.rate * 100)}% 计算`,
    },
  ]
  const total = addRange(subtotal, contingency)
  const warnings: string[] = []
  if (routeLegs.some((leg) => leg.provider === 'reference' || leg.estimateKind !== 'road')) {
    warnings.push('包含参考或区域锚点路段，接入道路 Provider 后预算会变化')
  }
  if (snapshot.intent.totalBudget && total.high > snapshot.intent.totalBudget) {
    warnings.push('预算高位估算超过用户总预算')
  }

  return BudgetEstimateSchema.parse({
    currency: 'CNY',
    categories,
    total,
    perPerson: scaleRange(total, 1 / snapshot.intent.partySize),
    totalDistanceMeters,
    warnings,
    calculatedAt,
  })
}
