import { describe, expect, it } from 'vitest'

import { buildAmapMarkerUrl, buildAmapNavigationUrl } from './amap'

const target = { name: '文昌龙楼住宿区', lon: 110.94, lat: 19.65 }

describe('AMap URI builders', () => {
  it('opens a single location marker without starting navigation', () => {
    const url = new URL(buildAmapMarkerUrl(target))

    expect(url.pathname).toBe('/marker')
    expect(url.searchParams.get('position')).toBe('110.94,19.65')
    expect(url.searchParams.get('name')).toBe(target.name)
    expect(url.searchParams.get('coordinate')).toBe('gaode')
    expect(url.searchParams.get('callnative')).toBe('1')
    expect(url.searchParams.has('to')).toBe(false)
    expect(url.searchParams.has('mode')).toBe(false)
  })

  it('keeps leg navigation on the dedicated navigation URI', () => {
    expect(new URL(buildAmapNavigationUrl(target)).pathname).toBe('/navigation')
  })
})
