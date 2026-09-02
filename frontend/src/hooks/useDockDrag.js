import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  DOCK_KEYBOARD_STEP,
  clampDockOffset,
  dockOffsetToPosition,
  dockPositionToOffset,
  readDockPosition,
  writeDockPosition,
} from '../map/dockPosition.js'

/**
 * Yüzer paneli SÜRÜKLENEBİLİR yapar.
 *
 * <b>Yalnızca sunum.</b> Kanca hiçbir iş durumuna dokunmaz: izleme, takip,
 * seçim, yönetim ve panelin açık/kapalı durumu buradan HİÇ okunmaz ve HİÇ
 * yazılmaz. Sürüklemek bir şeyi açmaz, kapatmaz ve seçmez.
 *
 * <b>Sınır KULLANILABİLİR harita alanıdır.</b> Ölçü, panelin konumlanmış
 * atasından (`offsetParent` — `.map-viewport`) okunur. Üst şerit ve kenar
 * çubuğu bu kutunun DIŞINDA olduğu için panel onların arkasına hiç
 * sürüklenemez; ayrı bir "üst şerit yüksekliği" sabiti tutmak, iki ayrı
 * doğruluk kaynağı yaratmak olurdu.
 *
 * <b>Tek işaretçi sahipliği.</b> Sürükleme Pointer Events ile yürür ve
 * `setPointerCapture` ile tutamağa kilitlenir: fare, dokunmatik ve trackpad
 * için ayrı uygulamalar yoktur. Yakalama sırasında olay haritaya hiç ulaşmaz.
 */
export default function useDockDrag() {
  const elementRef = useRef(null)
  const dragRef = useRef(null)

  const storage = useCallback(() => {
    try {
      return window.localStorage
    } catch {
      /* Depolama engelli: sürükleme yine çalışır, yalnızca hatırlanmaz. */
      return null
    }
  }, [])

  /* Kanonik konum ORANDIR. Piksel yerleşimi ondan TÜRETİLİR; tersi değil. */
  const [position, setPosition] = useState(() => readDockPosition(storage()))
  const [offset, setOffset] = useState(null)
  const [dragging, setDragging] = useState(false)

  /** Panelin ve kullanılabilir alanın güncel ölçüleri. */
  const measure = useCallback(() => {
    const element = elementRef.current
    const parent = element?.offsetParent
    if (!element || !parent) return null

    const rect = element.getBoundingClientRect()
    const parentRect = parent.getBoundingClientRect()
    if (!(parentRect.width > 0) || !(parentRect.height > 0)) return null

    return {
      parentRect,
      viewport: { width: parentRect.width, height: parentRect.height },
      dock: { width: rect.width, height: rect.height },
      rect,
    }
  }, [])

  /* Oran → piksel. Geri yüklemede, sürükleme bitiminde, pencere yeniden
     boyutlandığında ve kenar çubuğu açılıp kapandığında AYNI yol işler. */
  const reflow = useCallback(() => {
    if (dragRef.current) return
    const measured = measure()
    if (!measured) return
    setOffset(dockPositionToOffset({ position, viewport: measured.viewport, dock: measured.dock }))
  }, [measure, position])

  useLayoutEffect(() => { reflow() }, [reflow])

  /* Kullanılabilir alan DEĞİŞİRSE panel geri kelepçelenir: kenara bırakılmış
     bir panel, pencere daraldığında ya da kenar çubuğu açıldığında ekranın
     dışında kalmamalıdır. */
  useEffect(() => {
    const parent = elementRef.current?.offsetParent
    if (!parent) return undefined

    const handle = () => reflow()
    window.addEventListener('resize', handle)

    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(handle) : null
    observer?.observe(parent)

    return () => {
      window.removeEventListener('resize', handle)
      observer?.disconnect()
    }
  }, [reflow])

  const finishDrag = useCallback((event) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    dragRef.current = null
    setDragging(false)
    try {
      event.currentTarget?.releasePointerCapture?.(event.pointerId)
    } catch {
      /* Yakalama zaten bırakılmış olabilir. */
    }

    if (!drag.latest) return
    const next = dockOffsetToPosition({ ...drag.latest, viewport: drag.viewport, dock: drag.dock })
    if (!next) return
    setPosition(next)
    writeDockPosition(storage(), next)
  }, [storage])

  const onPointerDown = useCallback((event) => {
    // Yalnızca birincil düğme; sağ tık bağlam menüsünü çalar.
    if (event.pointerType === 'mouse' && event.button !== 0) return

    const measured = measure()
    if (!measured) return

    dragRef.current = {
      pointerId: event.pointerId,
      grabX: event.clientX - measured.rect.left,
      grabY: event.clientY - measured.rect.top,
      parentRect: measured.parentRect,
      viewport: measured.viewport,
      dock: measured.dock,
      latest: null,
    }

    try {
      event.currentTarget.setPointerCapture?.(event.pointerId)
    } catch {
      /* Yakalama desteklenmiyorsa sürükleme yine olay dinleyicileriyle yürür. */
    }

    /* Jest gesture'ın SAHİBİ bu tutamaktır: olay ne haritaya sızar ne de
       tarayıcının kendi metin seçimi/kaydırma davranışını tetikler. */
    event.preventDefault()
    event.stopPropagation()
    setDragging(true)
  }, [measure])

  const onPointerMove = useCallback((event) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    event.preventDefault()
    event.stopPropagation()

    const next = clampDockOffset({
      left: event.clientX - drag.parentRect.left - drag.grabX,
      top: event.clientY - drag.parentRect.top - drag.grabY,
      viewport: drag.viewport,
      dock: drag.dock,
    })
    if (!next) return

    drag.latest = next
    setOffset(next)
  }, [])

  /**
   * Klavyeyle taşıma ve varsayılana dönüş.
   *
   * Sürükleme bir EKLENTİDİR: fare kullanamayan biri de paneli yerinden
   * oynatabilmeli ve — daha önemlisi — <kbd>Home</kbd> ile varsayılan yerine
   * geri getirebilmelidir. Bunun için panele ayrı bir düğme eklenmez.
   */
  const onKeyDown = useCallback((event) => {
    if (event.key === 'Home') {
      event.preventDefault()
      setPosition(null)
      setOffset(null)
      writeDockPosition(storage(), null)
      return
    }

    const step = {
      ArrowLeft: [-DOCK_KEYBOARD_STEP, 0],
      ArrowRight: [DOCK_KEYBOARD_STEP, 0],
      ArrowUp: [0, -DOCK_KEYBOARD_STEP],
      ArrowDown: [0, DOCK_KEYBOARD_STEP],
    }[event.key]
    if (!step) return

    const measured = measure()
    if (!measured) return

    event.preventDefault()

    const current = offset ?? {
      left: measured.rect.left - measured.parentRect.left,
      top: measured.rect.top - measured.parentRect.top,
    }

    const next = clampDockOffset({
      left: current.left + step[0],
      top: current.top + step[1],
      viewport: measured.viewport,
      dock: measured.dock,
    })
    if (!next) return

    setOffset(next)
    const stored = dockOffsetToPosition({ ...next, viewport: measured.viewport, dock: measured.dock })
    setPosition(stored)
    writeDockPosition(storage(), stored)
  }, [measure, offset, storage])

  return {
    elementRef,
    dragging,
    /* Konum yoksa satır içi stil de YOKTUR: panel CSS'teki varsayılan
       yerinde (alt-orta) kalır. */
    style: offset ? { left: `${offset.left}px`, top: `${offset.top}px` } : undefined,
    placed: Boolean(offset),
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finishDrag,
      onPointerCancel: finishDrag,
      onKeyDown,
    },
  }
}
