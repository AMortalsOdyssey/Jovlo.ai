import { cloneJson, stableHash } from './canonical'
import { recalculateTrip } from './planning'
import {
  ActualRecordSchema,
  ExpenseSchema,
  ReportGenerationSchema,
  RouteLegSchema,
  RouteTemplateSchema,
  TripChangeSetSchema,
  TripPlaceSnapshotSchema,
  TripSnapshotSchema,
  TripSourceSnapshotSchema,
  TripVersionSchema,
  type MoneyRange,
  type RouteEndpoint,
  type RouteLeg,
  type TripPlaceSnapshot,
} from './schemas'

export const DEMO_IDS = {
  trip: '10000000-0000-4000-8000-000000000001',
  owner: 'd0000000-0000-4000-8000-000000000001',
  places: {
    meilan: '20000000-0000-4000-8000-000000000001',
    qilou: '20000000-0000-4000-8000-000000000002',
    museum: '20000000-0000-4000-8000-000000000003',
    tongguling: '20000000-0000-4000-8000-000000000004',
    stonePark: '20000000-0000-4000-8000-000000000005',
    boao: '20000000-0000-4000-8000-000000000006',
    tanmen: '20000000-0000-4000-8000-000000000007',
    xinglong: '20000000-0000-4000-8000-000000000008',
    riyueBay: '20000000-0000-4000-8000-000000000009',
    boundaryIsland: '20000000-0000-4000-8000-000000000010',
    yalongBay: '20000000-0000-4000-8000-000000000011',
    shimeiHotel: '20000000-0000-4000-8000-000000000012',
    phoenix: '20000000-0000-4000-8000-000000000013',
    dongjiao: '20000000-0000-4000-8000-000000000014',
    shenzhou: '20000000-0000-4000-8000-000000000015',
    nanshan: '20000000-0000-4000-8000-000000000016',
  },
  sources: {
    tourism: '30000000-0000-4000-8000-000000000001',
    transport: '30000000-0000-4000-8000-000000000002',
    wanning: '30000000-0000-4000-8000-000000000003',
    traveler: '30000000-0000-4000-8000-000000000004',
  },
  areas: {
    haikou: '40000000-0000-4000-8000-000000000001',
    wenchang: '40000000-0000-4000-8000-000000000002',
    boao: '40000000-0000-4000-8000-000000000003',
    wanning: '40000000-0000-4000-8000-000000000004',
  },
  days: [
    '50000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000002',
    '50000000-0000-4000-8000-000000000003',
    '50000000-0000-4000-8000-000000000004',
    '50000000-0000-4000-8000-000000000005',
  ],
  stops: [
    '60000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000002',
    '60000000-0000-4000-8000-000000000003',
    '60000000-0000-4000-8000-000000000004',
    '60000000-0000-4000-8000-000000000005',
    '60000000-0000-4000-8000-000000000006',
    '60000000-0000-4000-8000-000000000007',
    '60000000-0000-4000-8000-000000000008',
    '60000000-0000-4000-8000-000000000009',
    '60000000-0000-4000-8000-000000000010',
  ],
  versions: [
    '80000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000002',
  ],
} as const

const CALCULATED_AT = '2026-07-11T12:00:00+08:00'

const money = (low: number, expected: number, high: number): MoneyRange => ({
  low,
  expected,
  high,
  currency: 'CNY',
})

const coordinate = (lon: number, lat: number, crs: 'WGS84' | 'GCJ02') => ({
  lon,
  lat,
  crs,
})

const sourceList = [
  {
    sourceId: DEMO_IDS.sources.tourism,
    platform: 'official-tourism',
    url: 'https://www.explorehainan.com/',
    title: '海南旅游文化资源公开信息',
    author: '海南省旅游和文化广电体育厅',
    summary: '用于演示地点类型、区域顺序与基础开放信息；上线前仍需逐地点复核。',
    commercialRelationship: 'no' as const,
  },
  {
    sourceId: DEMO_IDS.sources.transport,
    platform: 'official-government',
    url: 'https://www.hainan.gov.cn/',
    title: '海南公共交通与道路信息入口',
    author: '海南省人民政府',
    summary: '用于种子路书的交通边界说明；演示路段距离不是实时道路结果。',
    commercialRelationship: 'no' as const,
  },
  {
    sourceId: DEMO_IDS.sources.wanning,
    platform: 'official-government',
    url: 'https://wanning.hainan.gov.cn/',
    title: '万宁目的地公开信息',
    author: '万宁市人民政府',
    summary: '用于兴隆、日月湾和石梅湾区域的演示地点说明与最近核验标记。',
    commercialRelationship: 'no' as const,
  },
  {
    sourceId: DEMO_IDS.sources.traveler,
    platform: 'user-research',
    url: 'https://example.com/jovlo/hainan-east-coast-notes',
    title: '海南东线五日路线人工核验笔记',
    author: 'Jovlo seed curator',
    publishedAt: '2026-07-10',
    summary: '人工整理的演示摘要，覆盖停车缓冲、停留时长和跨城节奏，不含平台原文。',
    commercialRelationship: 'unknown' as const,
  },
]

export const DEMO_SOURCES = sourceList.map((source) => TripSourceSnapshotSchema.parse(source))

const sources = Object.fromEntries(DEMO_SOURCES.map((source) => [source.sourceId, source]))

function place(
  placeId: string,
  name: string,
  type: string,
  address: string,
  lon: number,
  lat: number,
  sourceIds: string[],
  options: {
    price?: MoneyRange
    parking?: string
    openingHours?: Record<string, string>
  } = {},
): TripPlaceSnapshot {
  return TripPlaceSnapshotSchema.parse({
    placeId,
    catalogRevision: 1,
    name,
    type,
    address,
    wgs84: coordinate(lon, lat, 'WGS84'),
    gcj02: coordinate(lon + 0.0045, lat - 0.0021, 'GCJ02'),
    selectedVariant:
      options.price || options.parking || options.openingHours
        ? {
            openingHours: options.openingHours,
            priceRange: options.price,
            parkingNote: options.parking,
          }
        : undefined,
    sourceIds,
    verifiedAt: CALCULATED_AT,
  })
}

const placeList = [
  place(
    DEMO_IDS.places.meilan,
    '海口美兰国际机场',
    'airport',
    '海口市美兰区',
    110.459,
    19.9349,
    [DEMO_IDS.sources.transport],
  ),
  place(
    DEMO_IDS.places.qilou,
    '海口骑楼老街',
    'attraction',
    '海口市龙华区中山路',
    110.3434,
    20.0458,
    [DEMO_IDS.sources.tourism, DEMO_IDS.sources.traveler],
    { parking: '老街周边停车紧张，建议预留步行时间' },
  ),
  place(
    DEMO_IDS.places.museum,
    '海南省博物馆',
    'museum',
    '海口市琼山区国兴大道',
    110.3904,
    20.0187,
    [DEMO_IDS.sources.tourism],
    { openingHours: { note: '开放时间以官方当日公告为准' } },
  ),
  place(
    DEMO_IDS.places.tongguling,
    '铜鼓岭',
    'attraction',
    '文昌市龙楼镇',
    111.0305,
    19.6534,
    [DEMO_IDS.sources.tourism, DEMO_IDS.sources.traveler],
    { parking: '景区入口与观景点之间需预留接驳时间' },
  ),
  place(
    DEMO_IDS.places.stonePark,
    '石头公园',
    'attraction',
    '文昌市龙楼镇',
    111.0258,
    19.6437,
    [DEMO_IDS.sources.traveler],
    { parking: '海边步道受天气影响，雨天谨慎前往' },
  ),
  place(
    DEMO_IDS.places.boao,
    '博鳌亚洲论坛永久会址',
    'attraction',
    '琼海市博鳌镇',
    110.5876,
    19.1592,
    [DEMO_IDS.sources.tourism],
    { price: money(100, 115, 130), openingHours: { note: '票价与开放项目以现场为准' } },
  ),
  place(
    DEMO_IDS.places.tanmen,
    '潭门渔港',
    'meal',
    '琼海市潭门镇',
    110.6168,
    19.2422,
    [DEMO_IDS.sources.traveler],
    { parking: '午餐高峰建议错峰抵达' },
  ),
  place(
    DEMO_IDS.places.xinglong,
    '兴隆热带植物园',
    'attraction',
    '万宁市兴隆华侨旅游经济区',
    110.1957,
    18.7338,
    [DEMO_IDS.sources.wanning, DEMO_IDS.sources.tourism],
    { price: money(45, 50, 60), openingHours: { note: '闭园前一小时停止入园' } },
  ),
  place(
    DEMO_IDS.places.riyueBay,
    '日月湾',
    'activity',
    '万宁市礼纪镇',
    110.2099,
    18.6254,
    [DEMO_IDS.sources.wanning, DEMO_IDS.sources.traveler],
    { parking: '周末停车与步行缓冲建议至少 30 分钟' },
  ),
  place(
    DEMO_IDS.places.boundaryIsland,
    '分界洲岛',
    'attraction',
    '陵水黎族自治县光坡镇',
    110.1969,
    18.5755,
    [DEMO_IDS.sources.tourism],
    { price: money(122, 132, 150), openingHours: { note: '轮渡受天气与海况影响' } },
  ),
  place(
    DEMO_IDS.places.yalongBay,
    '亚龙湾',
    'attraction',
    '三亚市吉阳区',
    109.637,
    18.2319,
    [DEMO_IDS.sources.tourism, DEMO_IDS.sources.traveler],
  ),
  place(
    DEMO_IDS.places.shimeiHotel,
    '石梅湾舒适型酒店示例',
    'hotel',
    '万宁市石梅湾旅游度假区',
    110.2364,
    18.6657,
    [DEMO_IDS.sources.wanning],
    { price: money(480, 620, 880), parking: '演示酒店，不代表实时库存或最低价' },
  ),
  place(
    DEMO_IDS.places.phoenix,
    '三亚凤凰国际机场',
    'airport',
    '三亚市天涯区',
    109.4123,
    18.3029,
    [DEMO_IDS.sources.transport],
  ),
]

const places = Object.fromEntries(placeList.map((item) => [item.placeId, item]))

export const DEMO_CANDIDATES = [
  place(
    DEMO_IDS.places.dongjiao,
    '东郊椰林',
    'attraction',
    '文昌市东郊镇',
    110.867,
    19.578,
    [DEMO_IDS.sources.tourism],
  ),
  place(
    DEMO_IDS.places.shenzhou,
    '神州半岛',
    'attraction',
    '万宁市东澳镇',
    110.33,
    18.674,
    [DEMO_IDS.sources.wanning],
  ),
  place(
    DEMO_IDS.places.nanshan,
    '南山文化旅游区',
    'attraction',
    '三亚市崖州区',
    109.208,
    18.306,
    [DEMO_IDS.sources.tourism],
    { price: money(108, 129, 145) },
  ),
]

const stayAreaRefs = {
  [DEMO_IDS.areas.haikou]: {
    areaId: DEMO_IDS.areas.haikou,
    name: '海口骑楼周边住宿区',
    region: '海口',
    wgs84: coordinate(110.345, 20.04, 'WGS84'),
    gcj02: coordinate(110.3495, 20.0379, 'GCJ02'),
    priceReference: money(260, 360, 520),
    verifiedAt: CALCULATED_AT,
    bookingUrl: 'https://www.amap.com/',
  },
  [DEMO_IDS.areas.wenchang]: {
    areaId: DEMO_IDS.areas.wenchang,
    name: '文昌龙楼住宿区',
    region: '文昌',
    wgs84: coordinate(110.966, 19.651, 'WGS84'),
    gcj02: coordinate(110.9705, 19.6489, 'GCJ02'),
    priceReference: money(220, 320, 480),
    verifiedAt: CALCULATED_AT,
    bookingUrl: 'https://www.amap.com/',
  },
  [DEMO_IDS.areas.boao]: {
    areaId: DEMO_IDS.areas.boao,
    name: '博鳌镇住宿区',
    region: '琼海',
    wgs84: coordinate(110.584, 19.161, 'WGS84'),
    gcj02: coordinate(110.5885, 19.1589, 'GCJ02'),
    priceReference: money(300, 430, 680),
    verifiedAt: CALCULATED_AT,
    bookingUrl: 'https://www.amap.com/',
  },
  [DEMO_IDS.areas.wanning]: {
    areaId: DEMO_IDS.areas.wanning,
    name: '日月湾住宿锚点区',
    region: '万宁',
    wgs84: coordinate(110.215, 18.63, 'WGS84'),
    gcj02: coordinate(110.2195, 18.6279, 'GCJ02'),
    priceReference: money(360, 520, 820),
    verifiedAt: CALCULATED_AT,
    bookingUrl: 'https://www.amap.com/',
  },
}

export const DEMO_TRIP = TripSnapshotSchema.parse({
  schemaVersion: 1,
  tripId: DEMO_IDS.trip,
  title: '海南东线 5 日自驾示例',
  timezone: 'Asia/Shanghai',
  intent: {
    startDate: '2026-08-10',
    days: 5,
    entryAnchor: { placeId: DEMO_IDS.places.meilan, label: '海口美兰机场' },
    exitAnchor: { placeId: DEMO_IDS.places.phoenix, label: '三亚凤凰机场' },
    partySize: 2,
    vehicle: { type: 'fuel', consumption: 7.6 },
    pace: 'balanced',
    maxDriveMinutesPerDay: 240,
    dayEndLimit: '22:00',
    totalBudget: 8_500,
    mustPlaceIds: [DEMO_IDS.places.boao, DEMO_IDS.places.riyueBay],
    avoidTags: ['高强度徒步'],
  },
  placeRefs: places,
  sourceRefs: sources,
  stayAreaRefs,
  days: [
    {
      id: DEMO_IDS.days[0],
      dayIndex: 1,
      date: '2026-08-10',
      startTime: '10:00',
      overnightStay: {
        kind: 'area',
        areaId: DEMO_IDS.areas.haikou,
        label: '海口骑楼周边住宿区',
      },
      stops: [
        {
          id: DEMO_IDS.stops[0],
          placeId: DEMO_IDS.places.qilou,
          kind: 'attraction',
          stayMinutes: 120,
          locked: false,
          publicNote: '抵达日放慢节奏，步行看骑楼街区。',
          sourceIds: [DEMO_IDS.sources.tourism, DEMO_IDS.sources.traveler],
        },
        {
          id: DEMO_IDS.stops[1],
          placeId: DEMO_IDS.places.museum,
          kind: 'attraction',
          stayMinutes: 120,
          locked: false,
          sourceIds: [DEMO_IDS.sources.tourism],
        },
      ],
    },
    {
      id: DEMO_IDS.days[1],
      dayIndex: 2,
      date: '2026-08-11',
      startTime: '08:30',
      overnightStay: {
        kind: 'area',
        areaId: DEMO_IDS.areas.wenchang,
        label: '文昌龙楼住宿区',
      },
      stops: [
        {
          id: DEMO_IDS.stops[2],
          placeId: DEMO_IDS.places.tongguling,
          kind: 'attraction',
          stayMinutes: 150,
          locked: false,
          sourceIds: [DEMO_IDS.sources.tourism, DEMO_IDS.sources.traveler],
        },
        {
          id: DEMO_IDS.stops[3],
          placeId: DEMO_IDS.places.stonePark,
          kind: 'attraction',
          stayMinutes: 90,
          locked: false,
          sourceIds: [DEMO_IDS.sources.traveler],
        },
      ],
    },
    {
      id: DEMO_IDS.days[2],
      dayIndex: 3,
      date: '2026-08-12',
      startTime: '08:30',
      overnightStay: {
        kind: 'area',
        areaId: DEMO_IDS.areas.boao,
        label: '博鳌镇住宿区',
      },
      stops: [
        {
          id: DEMO_IDS.stops[4],
          placeId: DEMO_IDS.places.boao,
          kind: 'attraction',
          stayMinutes: 150,
          locked: true,
          publicNote: '必去点，门票和开放项目需出发前复核。',
          privateNote: '演示私人备注：不应进入公开 DTO。',
          sourceIds: [DEMO_IDS.sources.tourism],
        },
        {
          id: DEMO_IDS.stops[5],
          placeId: DEMO_IDS.places.tanmen,
          kind: 'meal',
          plannedStart: '13:00',
          stayMinutes: 90,
          locked: false,
          sourceIds: [DEMO_IDS.sources.traveler],
        },
      ],
    },
    {
      id: DEMO_IDS.days[3],
      dayIndex: 4,
      date: '2026-08-13',
      startTime: '08:30',
      overnightStay: {
        kind: 'place',
        placeId: DEMO_IDS.places.shimeiHotel,
        label: '石梅湾舒适型酒店示例',
        checkInNote: '参考酒店，不代表已预订。',
      },
      stops: [
        {
          id: DEMO_IDS.stops[6],
          placeId: DEMO_IDS.places.xinglong,
          kind: 'attraction',
          stayMinutes: 120,
          locked: false,
          sourceIds: [DEMO_IDS.sources.wanning, DEMO_IDS.sources.tourism],
        },
        {
          id: DEMO_IDS.stops[7],
          placeId: DEMO_IDS.places.riyueBay,
          kind: 'activity',
          stayMinutes: 150,
          locked: true,
          publicNote: '必去点，预留停车和步行缓冲。',
          sourceIds: [DEMO_IDS.sources.wanning, DEMO_IDS.sources.traveler],
        },
      ],
    },
    {
      id: DEMO_IDS.days[4],
      dayIndex: 5,
      date: '2026-08-14',
      startTime: '08:00',
      stops: [
        {
          id: DEMO_IDS.stops[8],
          placeId: DEMO_IDS.places.boundaryIsland,
          kind: 'activity',
          stayMinutes: 210,
          locked: false,
          sourceIds: [DEMO_IDS.sources.tourism],
        },
        {
          id: DEMO_IDS.stops[9],
          placeId: DEMO_IDS.places.yalongBay,
          kind: 'attraction',
          stayMinutes: 120,
          locked: false,
          sourceIds: [DEMO_IDS.sources.tourism, DEMO_IDS.sources.traveler],
        },
      ],
    },
  ],
  budgetAssumptions: {
    currency: 'CNY',
    lodgingDefaultPerNight: money(280, 420, 650),
    lodgingByArea: {
      [DEMO_IDS.areas.haikou]: money(260, 360, 520),
      [DEMO_IDS.areas.wenchang]: money(220, 320, 480),
      [DEMO_IDS.areas.boao]: money(300, 430, 680),
      [DEMO_IDS.areas.wanning]: money(360, 520, 820),
    },
    mealPerPersonPerDay: money(90, 130, 190),
    fuelLitersPer100Km: 7.6,
    electricityKwhPer100Km: 16,
    fuelPricePerLiter: money(7.4, 7.8, 8.2),
    electricityPricePerKwh: money(1.2, 1.6, 2.1),
    rentalCarPerDay: money(180, 240, 360),
    insurancePerDay: money(35, 50, 80),
    parkingAndTollsPerDay: money(25, 45, 80),
    ticketByPlaceId: {
      [DEMO_IDS.places.boao]: money(100, 115, 130),
      [DEMO_IDS.places.xinglong]: money(45, 50, 60),
      [DEMO_IDS.places.boundaryIsland]: money(122, 132, 150),
    },
    specialMealByStopId: {
      [DEMO_IDS.stops[5]]: money(180, 260, 420),
    },
    contingency: { kind: 'percentage', rate: 0.1 },
    verifiedAt: CALCULATED_AT,
  },
  userNotes: '演示行程用于前后端联调，不代表实时价格、开放时间或道路 ETA。',
})

function endpointPlace(placeId: string): RouteEndpoint {
  return { kind: 'place', placeId }
}

function endpointArea(areaId: string): RouteEndpoint {
  return { kind: 'area', areaId }
}

function leg(
  index: number,
  dayId: string,
  from: RouteEndpoint,
  to: RouteEndpoint,
  distanceMeters: number,
  durationSeconds: number,
): RouteLeg {
  return RouteLegSchema.parse({
    id: `70000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    dayId,
    provider: 'reference',
    from,
    to,
    distanceMeters,
    durationSeconds,
    strategy: 'curated-reference-v1',
    calculatedAt: CALCULATED_AT,
    status: 'stale',
    estimateKind: from.kind === 'area' || to.kind === 'area' ? 'area-reference' : 'reference',
  })
}

export const DEMO_ROUTE_LEGS = [
  leg(1, DEMO_IDS.days[0], endpointPlace(DEMO_IDS.places.meilan), endpointPlace(DEMO_IDS.places.qilou), 26_000, 2_400),
  leg(2, DEMO_IDS.days[0], endpointPlace(DEMO_IDS.places.qilou), endpointPlace(DEMO_IDS.places.museum), 7_000, 1_200),
  leg(3, DEMO_IDS.days[0], endpointPlace(DEMO_IDS.places.museum), endpointArea(DEMO_IDS.areas.haikou), 8_000, 1_200),
  leg(4, DEMO_IDS.days[1], endpointArea(DEMO_IDS.areas.haikou), endpointPlace(DEMO_IDS.places.tongguling), 92_000, 6_000),
  leg(5, DEMO_IDS.days[1], endpointPlace(DEMO_IDS.places.tongguling), endpointPlace(DEMO_IDS.places.stonePark), 18_000, 1_800),
  leg(6, DEMO_IDS.days[1], endpointPlace(DEMO_IDS.places.stonePark), endpointArea(DEMO_IDS.areas.wenchang), 20_000, 2_100),
  leg(7, DEMO_IDS.days[2], endpointArea(DEMO_IDS.areas.wenchang), endpointPlace(DEMO_IDS.places.boao), 90_000, 5_700),
  leg(8, DEMO_IDS.days[2], endpointPlace(DEMO_IDS.places.boao), endpointPlace(DEMO_IDS.places.tanmen), 18_000, 1_800),
  leg(9, DEMO_IDS.days[2], endpointPlace(DEMO_IDS.places.tanmen), endpointArea(DEMO_IDS.areas.boao), 15_000, 1_500),
  leg(10, DEMO_IDS.days[3], endpointArea(DEMO_IDS.areas.boao), endpointPlace(DEMO_IDS.places.xinglong), 80_000, 4_800),
  leg(11, DEMO_IDS.days[3], endpointPlace(DEMO_IDS.places.xinglong), endpointPlace(DEMO_IDS.places.riyueBay), 32_000, 2_400),
  leg(12, DEMO_IDS.days[3], endpointPlace(DEMO_IDS.places.riyueBay), endpointPlace(DEMO_IDS.places.shimeiHotel), 35_000, 2_400),
  leg(13, DEMO_IDS.days[4], endpointPlace(DEMO_IDS.places.shimeiHotel), endpointPlace(DEMO_IDS.places.boundaryIsland), 40_000, 2_700),
  leg(14, DEMO_IDS.days[4], endpointPlace(DEMO_IDS.places.boundaryIsland), endpointPlace(DEMO_IDS.places.yalongBay), 95_000, 6_000),
  leg(15, DEMO_IDS.days[4], endpointPlace(DEMO_IDS.places.yalongBay), endpointPlace(DEMO_IDS.places.phoenix), 32_000, 2_400),
]

export const DEMO_DERIVED = recalculateTrip(DEMO_TRIP, DEMO_ROUTE_LEGS, CALCULATED_AT)

const firstSnapshot = cloneJson(DEMO_TRIP)
firstSnapshot.days[3].stops[0].stayMinutes = 90
const validatedFirstSnapshot = TripSnapshotSchema.parse(firstSnapshot)
const firstDerived = recalculateTrip(validatedFirstSnapshot, DEMO_ROUTE_LEGS, CALCULATED_AT)

export const DEMO_VERSIONS = [
  TripVersionSchema.parse({
    id: DEMO_IDS.versions[0],
    tripId: DEMO_IDS.trip,
    versionNo: 1,
    parentVersionId: null,
    source: 'template',
    message: '从海南东线五日模板生成',
    snapshot: validatedFirstSnapshot,
    snapshotHash: stableHash(validatedFirstSnapshot),
    derivedSnapshot: firstDerived,
    derivedHash: stableHash(firstDerived),
    createdBy: DEMO_IDS.owner,
    createdAt: '2026-07-11T10:00:00+08:00',
  }),
  TripVersionSchema.parse({
    id: DEMO_IDS.versions[1],
    tripId: DEMO_IDS.trip,
    versionNo: 2,
    parentVersionId: DEMO_IDS.versions[0],
    source: 'manual',
    message: '补充兴隆停留时间与住宿假设',
    snapshot: DEMO_TRIP,
    snapshotHash: stableHash(DEMO_TRIP),
    derivedSnapshot: DEMO_DERIVED,
    derivedHash: stableHash(DEMO_DERIVED),
    createdBy: DEMO_IDS.owner,
    createdAt: CALCULATED_AT,
  }),
]

export const DEMO_EXPENSES = [
  ExpenseSchema.parse({
    id: '90000000-0000-4000-8000-000000000001',
    tripId: DEMO_IDS.trip,
    dayId: DEMO_IDS.days[0],
    category: 'transport',
    amount: 240,
    currency: 'CNY',
    occurredOn: '2026-08-10',
    note: '取车首日费用',
    createdAt: '2026-08-10T10:10:00+08:00',
    updatedAt: '2026-08-10T10:10:00+08:00',
  }),
  ExpenseSchema.parse({
    id: '90000000-0000-4000-8000-000000000002',
    tripId: DEMO_IDS.trip,
    dayId: DEMO_IDS.days[0],
    category: 'lodging',
    amount: 368,
    currency: 'CNY',
    occurredOn: '2026-08-10',
    createdAt: '2026-08-10T21:00:00+08:00',
    updatedAt: '2026-08-10T21:00:00+08:00',
  }),
  ExpenseSchema.parse({
    id: '90000000-0000-4000-8000-000000000003',
    tripId: DEMO_IDS.trip,
    dayId: DEMO_IDS.days[2],
    stopId: DEMO_IDS.stops[5],
    category: 'meals',
    amount: 286,
    currency: 'CNY',
    occurredOn: '2026-08-12',
    note: '潭门午餐',
    createdAt: '2026-08-12T14:30:00+08:00',
    updatedAt: '2026-08-12T14:30:00+08:00',
  }),
  ExpenseSchema.parse({
    id: '90000000-0000-4000-8000-000000000004',
    tripId: DEMO_IDS.trip,
    category: 'fuel_charging_tolls',
    amount: 336,
    currency: 'CNY',
    occurredOn: '2026-08-14',
    createdAt: '2026-08-14T18:00:00+08:00',
    updatedAt: '2026-08-14T18:00:00+08:00',
  }),
]

export const DEMO_ACTUALS = [
  ActualRecordSchema.parse({
    id: 'a0000000-0000-4000-8000-000000000001',
    tripId: DEMO_IDS.trip,
    sourceVersionId: DEMO_IDS.versions[1],
    dayId: DEMO_IDS.days[0],
    stopId: DEMO_IDS.stops[0],
    status: 'visited',
    rating: 4,
    note: '傍晚步行舒适。',
    actualStartAt: '2026-08-10T13:10:00+08:00',
    actualEndAt: '2026-08-10T15:05:00+08:00',
    orphaned: false,
    createdAt: '2026-08-10T15:10:00+08:00',
    updatedAt: '2026-08-10T15:10:00+08:00',
  }),
  ActualRecordSchema.parse({
    id: 'a0000000-0000-4000-8000-000000000002',
    tripId: DEMO_IDS.trip,
    sourceVersionId: DEMO_IDS.versions[1],
    dayId: DEMO_IDS.days[2],
    stopId: DEMO_IDS.stops[4],
    status: 'visited',
    rating: 4,
    orphaned: false,
    createdAt: '2026-08-12T13:00:00+08:00',
    updatedAt: '2026-08-12T13:00:00+08:00',
  }),
  ActualRecordSchema.parse({
    id: 'a0000000-0000-4000-8000-000000000003',
    tripId: DEMO_IDS.trip,
    sourceVersionId: DEMO_IDS.versions[1],
    dayId: DEMO_IDS.days[4],
    stopId: DEMO_IDS.stops[9],
    status: 'skipped',
    note: '轮渡延误后主动缩短最后一天。',
    orphaned: false,
    createdAt: '2026-08-14T17:00:00+08:00',
    updatedAt: '2026-08-14T17:00:00+08:00',
  }),
]

export const DEMO_REPORTS = [
  ReportGenerationSchema.parse({
    id: 'b0000000-0000-4000-8000-000000000001',
    tripId: DEMO_IDS.trip,
    versionId: DEMO_IDS.versions[1],
    expenseSnapshotId: 'e0000000-0000-4000-8000-000000000001',
    actualSnapshotId: 'e0000000-0000-4000-8000-000000000002',
    type: 'plan',
    status: 'ready',
    config: { showSources: true, showExactDates: false },
    configHash: stableHash({ showSources: true, showExactDates: false }),
    outputKey: 'demo/reports/hainan-east-5d-plan.html',
    createdAt: CALCULATED_AT,
    updatedAt: CALCULATED_AT,
  }),
  ReportGenerationSchema.parse({
    id: 'b0000000-0000-4000-8000-000000000002',
    tripId: DEMO_IDS.trip,
    versionId: DEMO_IDS.versions[1],
    expenseSnapshotId: 'e0000000-0000-4000-8000-000000000003',
    actualSnapshotId: 'e0000000-0000-4000-8000-000000000004',
    type: 'actual',
    status: 'ready',
    config: { showSources: true, showExactDates: true, showActualSummary: true },
    configHash: stableHash({ showSources: true, showExactDates: true, showActualSummary: true }),
    outputKey: 'demo/reports/hainan-east-5d-actual.html',
    createdAt: '2026-08-15T10:00:00+08:00',
    updatedAt: '2026-08-15T10:00:00+08:00',
  }),
]

export const DEMO_CHANGESET = TripChangeSetSchema.parse({
  schemaVersion: 1,
  changeSetId: 'c0000000-0000-4000-8000-000000000001',
  tripId: DEMO_IDS.trip,
  baseVersionId: DEMO_IDS.versions[1],
  idempotencyKey: 'demo-changeset-20260711-v1',
  createdAt: '2026-07-11T13:00:00+08:00',
  producer: {
    type: 'external-agent',
    name: 'Agent',
    conversationRef: 'demo-hainan-review',
  },
  sources: [
    {
      sourceRef: DEMO_IDS.sources.wanning,
      platform: 'official-government',
      url: 'https://wanning.hainan.gov.cn/',
      title: '万宁目的地公开信息',
      author: '万宁市人民政府',
      summary: '用于复核日月湾停车缓冲与住宿区域选择。',
      commercialRelationship: 'no',
    },
  ],
  proposalGroups: [
    {
      groupId: 'wanning-stop-buffer',
      title: '增加兴隆停留并补充日月湾停车证据',
      rationale: '东线跨城后需要更明确的停留与停车缓冲。',
      atomic: true,
      operations: [
        {
          type: 'UPDATE_STOP',
          stopId: DEMO_IDS.stops[6],
          patch: { stayMinutes: 150 },
        },
        {
          type: 'UPSERT_PLACE_CLAIM',
          placeId: DEMO_IDS.places.riyueBay,
          field: 'parking',
          value: { note: '周末建议预留至少 30 分钟停车和步行时间' },
          sourceRefs: [DEMO_IDS.sources.wanning],
        },
      ],
    },
    {
      groupId: 'wanning-area-anchor',
      title: '把 Day 4 住宿改为日月湾区域锚点',
      rationale: '尚未确定具体酒店时保持路线可发布，但明确标记为区域估算。',
      atomic: true,
      operations: [
        {
          type: 'SET_HOTEL',
          nightAfterDayId: DEMO_IDS.days[3],
          anchor: {
            kind: 'area',
            areaId: DEMO_IDS.areas.wanning,
            label: '日月湾住宿锚点区',
          },
        },
      ],
    },
  ],
})

export const DEMO_TEMPLATES = [
  RouteTemplateSchema.parse({
    slug: 'hainan-east-5d-haikou-sanya',
    version: 1,
    name: '海口进三亚出 · 海南东线 5 日',
    days: 5,
    entryPlaceId: DEMO_IDS.places.meilan,
    exitPlaceId: DEMO_IDS.places.phoenix,
    tags: ['自驾', '东线', '海岸', '平衡节奏'],
    dayAreas: [
      { dayIndex: 1, region: '海口', overnightAreaId: DEMO_IDS.areas.haikou },
      { dayIndex: 2, region: '文昌', overnightAreaId: DEMO_IDS.areas.wenchang },
      { dayIndex: 3, region: '琼海', overnightAreaId: DEMO_IDS.areas.boao },
      { dayIndex: 4, region: '万宁', overnightAreaId: DEMO_IDS.areas.wanning },
      { dayIndex: 5, region: '陵水至三亚' },
    ],
    corridorGeoJson: {
      type: 'LineString',
      coordinates: [
        [110.459, 19.9349],
        [111.03, 19.6534],
        [110.5876, 19.1592],
        [110.2099, 18.6254],
        [109.4123, 18.3029],
      ],
    },
    status: 'verified',
    verifiedAt: CALCULATED_AT,
  }),
]
