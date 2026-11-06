import { useLayoutEffect, useState, type RefObject } from 'react'

/** Track an element's content width (ResizeObserver). */
export function useWidth(ref: RefObject<HTMLElement | null>, fallback = 300) {
  const [w, setW] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(Math.max(40, Math.floor(el.clientWidth)) || fallback)
    const ro = new ResizeObserver(() => setW(Math.max(40, Math.floor(el.clientWidth)) || fallback))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, fallback])
  return w
}
