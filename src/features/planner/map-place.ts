import type { MapPlaceType } from './types'

export const MAP_PLACE_TYPE_LABEL: Record<MapPlaceType, string> = {
  scenic: '景点',
  food: '餐饮',
  coffee: '咖啡',
  hotel: '住宿',
  beach: '海滨',
  culture: '人文',
  transport: '交通',
  shopping: '购物',
  other: '地点',
}

const EXPLICIT_TYPE_RULES: Array<[RegExp, MapPlaceType]> = [
  [/meal|restaurant|food|dining|餐饮|美食/i, 'food'],
  [/coffee|cafe|咖啡/i, 'coffee'],
  [/hotel|lodging|accommodation|stay|住宿|民宿/i, 'hotel'],
  [/beach|coast|bay|island|海滩|海湾/i, 'beach'],
  [/museum|culture|heritage|人文|文化/i, 'culture'],
  [/airport|station|transport|交通|机场/i, 'transport'],
  [/shop|market|mall|购物|市场/i, 'shopping'],
]

const NAME_RULES: Array<[RegExp, MapPlaceType]> = [
  [/酒店|民宿|住宿|旅店|客栈|度假村|住宿区|锚点区/i, 'hotel'],
  [/咖啡|coffee|cafe/i, 'coffee'],
  [/餐厅|饭店|食堂|小吃|茶楼|美食|海鲜|渔港|夜宵/i, 'food'],
  [/机场|高铁|火车站|汽车站|客运站|码头|港口/i, 'transport'],
  [/免税|商场|商城|市场|夜市|购物/i, 'shopping'],
  [/博物馆|骑楼|古城|论坛|会址|寺|庙|纪念馆|文化|书院|遗址/i, 'culture'],
  [/海滩|沙滩|海湾|湾|半岛|海岛|岛|滨海|海岸/i, 'beach'],
  [/公园|景区|风景区|山|岭|瀑布|植物园|雨林|灯塔|石头|洞|谷/i, 'scenic'],
]

export function inferMapPlaceType(name: string, sourceType?: string): MapPlaceType {
  const normalizedType = sourceType?.trim() ?? ''
  for (const [pattern, type] of EXPLICIT_TYPE_RULES) {
    if (pattern.test(normalizedType)) return type
  }
  for (const [pattern, type] of NAME_RULES) {
    if (pattern.test(name)) return type
  }
  if (/attraction|activity|scenic|景点|活动/i.test(normalizedType)) return 'scenic'
  return 'other'
}
