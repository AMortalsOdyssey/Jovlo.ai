import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearStaleAssetReloadGuard,
  isStaleAssetError,
  reloadForStaleAsset,
} from './route-recovery'

describe('route recovery', () => {
  afterEach(() => {
    clearStaleAssetReloadGuard()
  })

  it('recognizes stale dynamic import failures', () => {
    expect(isStaleAssetError(new TypeError('Failed to fetch dynamically imported module'))).toBe(true)
    expect(isStaleAssetError(new Error('Unable to preload CSS for /assets/page.css'))).toBe(true)
    expect(isStaleAssetError(new Error('接口暂时不可用'))).toBe(false)
  })

  it('reloads once for the same route', () => {
    const reload = vi.fn()
    const error = new TypeError('Failed to fetch dynamically imported module')

    expect(reloadForStaleAsset(error, reload)).toBe(true)
    expect(reloadForStaleAsset(error, reload)).toBe(false)
    expect(reload).toHaveBeenCalledOnce()
  })
})
