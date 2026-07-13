import { useLayoutEffect, useRef } from 'react'

const lastFlip = new WeakMap<HTMLElement, Animation>()

/**
 * FLIP 位置过渡：列表顺序变化（重排 / 插入 / 删除引起的位移）时，
 * 让每个带 data-flip-id 的条目从旧位置滑到新位置，代替瞬移。
 * 只在 orderKey 变化的那一帧测量并补一段 transform 动画，不影响布局。
 * 条目若是 display: contents（无盒模型），自动下钻到其子元素做测量与动画。
 */
export function useFlipChildren<T extends HTMLElement = HTMLDivElement>(orderKey: string) {
  const containerRef = useRef<T | null>(null)
  const tops = useRef(new Map<string, number>())

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const next = new Map<string, number>()

    for (const element of container.querySelectorAll<HTMLElement>('[data-flip-id]')) {
      const id = element.dataset.flipId
      if (!id) continue

      const ownBox = element.getBoundingClientRect()
      const targets =
        ownBox.width > 0 || ownBox.height > 0
          ? [element]
          : (Array.from(element.children) as HTMLElement[])
      if (targets.length === 0) continue

      const top = targets[0].getBoundingClientRect().top
      next.set(id, top)

      const previous = tops.current.get(id)
      if (reduced || previous === undefined) continue

      const delta = previous - top
      if (Math.abs(delta) < 4) continue

      for (const target of targets) {
        if (typeof target.animate !== 'function') continue
        lastFlip.get(target)?.cancel()
        const animation = target.animate(
          [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
          { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
        )
        lastFlip.set(target, animation)
      }
    }

    tops.current = next
  }, [orderKey])

  return containerRef
}
