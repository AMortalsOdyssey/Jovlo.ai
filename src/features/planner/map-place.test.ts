import { describe, expect, it } from 'vitest'

import { inferMapPlaceType } from './map-place'

describe('map place type inference', () => {
  it.each([
    ['文昌龙楼住宿区', undefined, 'hotel'],
    ['海口美兰机场', undefined, 'transport'],
    ['潭门渔港', 'meal', 'food'],
    ['兴隆咖啡园', undefined, 'coffee'],
    ['博鳌亚洲论坛永久会址', undefined, 'culture'],
    ['亚龙湾', 'activity', 'beach'],
    ['博鳌亚洲论坛永久会址', 'attraction', 'culture'],
    ['铜鼓岭', undefined, 'scenic'],
    ['临时观景点', 'attraction', 'scenic'],
    ['临时集合点', undefined, 'other'],
  ])('classifies %s as %s', (name, sourceType, expected) => {
    expect(inferMapPlaceType(name, sourceType)).toBe(expected)
  })
})
