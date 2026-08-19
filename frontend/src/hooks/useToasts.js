import { useCallback, useEffect, useRef, useState } from 'react'

const DEFAULT_TIMEOUT_MS = 4000

/**
 * Small stacked toast queue for map feedback (save status, errors, connection).
 *
 * Replaces the single-slot notice so a save result and a connection warning can
 * not overwrite each other. Timers are tracked per toast and all cleared on
 * unmount, so nothing fires against an unmounted component.
 */
export default function useToasts() {
  const [toasts, setToasts] = useState([])
  const timersRef = useRef(new Map())
  const counterRef = useRef(0)

  const dismissToast = useCallback((id) => {
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  /**
   * @param {'success'|'error'|'info'} type
   * @param {string} message
   * @param {{ timeout?: number, id?: string, placement?: 'bottom'|'top' }} [options]
   *   a fixed `id` replaces the toast already carrying it instead of stacking a
   *   duplicate.
   *
   *   `placement` ayrı bir yığın seçer. Varsayılan alt yığın, çizim
   *   talimatının (`.map-hint`) durduğu yerdedir; oraya düşen bir uyarı
   *   talimatın ÜSTÜNÜ kapatır ve iki ayrı iş tek bir karmaşaya dönüşür.
   *   Kalıcı olarak okunması gereken bir kural ile geçici bir bildirim aynı
   *   noktada yarışmamalıdır.
   */
  const showToast = useCallback(
    (type, message, options = {}) => {
      counterRef.current += 1
      const id = options.id ?? `toast-${counterRef.current}`
      const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS
      const placement = options.placement ?? 'bottom'

      const existingTimer = timersRef.current.get(id)
      if (existingTimer) clearTimeout(existingTimer)

      setToasts((current) => {
        const without = current.filter((toast) => toast.id !== id)
        return [...without, { id, type, message, placement }]
      })

      if (timeout > 0) {
        timersRef.current.set(
          id,
          setTimeout(() => {
            timersRef.current.delete(id)
            setToasts((current) => current.filter((toast) => toast.id !== id))
          }, timeout),
        )
      }

      return id
    },
    [],
  )

  useEffect(
    () => () => {
      for (const timer of timersRef.current.values()) clearTimeout(timer)
      timersRef.current.clear()
    },
    [],
  )

  return { toasts, showToast, dismissToast }
}
