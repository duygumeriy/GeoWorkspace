import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { readApiError } from '../services/api.js'
import { previewJourney } from '../services/transportApi.js'
import {
  PANEL_STATES,
  buildJourneyPreviewRequest,
  initialJourneyPlannerState,
  journeyPickingActive,
  journeyPlannerReducer,
  shouldDisarmJourneySlot,
} from '../map/journeyPlanning.js'
import { journeyErrorMessage } from '../map/journeyPresentation.js'

/**
 * Yolculuk planlayıcısının durumu ve önizleme yaşam döngüsü.
 *
 * <b>MapPage şişirilmez.</b> Kip, profil, seçimler, geçiş noktaları, panel
 * durumu ve istek yaşam döngüsü burada yaşar; sayfa yalnızca sonucu bağlar.
 *
 * <b>Mevcut simülasyon kancasıyla BİRLEŞTİRİLMEZ.</b> Önizleme canlı durum
 * değildir: burada ne SignalR, ne hub grubu, ne takip kamerası, ne de bir
 * araç vardır. İki kavramı tek kancada toplamak, bir önizlemenin yanlışlıkla
 * bir hattı izlemeye başlamasına kapı aralardı.
 *
 * <b>Otomatik istek YOKTUR.</b> Her tuş vuruşunda yönlendirme motorunu
 * dövmemek için hesaplama yalnızca açık `requestPreview` çağrısıyla başlar.
 *
 * <b>Seçim ÇALIŞMA ALANINA tabidir.</b> `workspaceAtRest`, `useWorkspaceMode`
 * sıradan tekli seçimdeyken doğrudur; başka bir araç ailesi (çizim, ölçüm,
 * analiz, yerleştirme, düzenleme, alan seçimi) etkinken seçim ne silahlanabilir
 * ne de silahlı kalabilir. Aksi hâlde tek bir tıklama hem o aracın hem de
 * planlayıcının işine yarardı.
 *
 * @param {{ permitted?: boolean, canUseTransport?: boolean, workspaceAtRest?: boolean }} [options]
 */
export default function useJourneyPlanner({
  permitted = false,
  canUseTransport = true,
  workspaceAtRest = true,
} = {}) {
  /* Başlangıç kipi, kullanıcının erişebildiği kipe göre seçilir; yalnızca ilk
     kurulumda okunur (useReducer'ın init argümanı). Bu bir yetkilendirme
     kararı DEĞİL, bir başlangıç seçimidir. */
  const [state, dispatch] = useReducer(
    journeyPlannerReducer,
    canUseTransport,
    (allowed) => initialJourneyPlannerState({ canUseTransport: allowed }),
  )
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  /* İKİ koruma birden, ikisi de gerekli: AbortController uçan isteği iptal
     eder, sayaç ise iptalden ÖNCE yola çıkmış bir cevabın geç gelip yeni
     sonucu geri sarmasını engeller. Yalnızca birine güvenmek, hızlı seçim
     değiştiren kullanıcıda A→B cevabını A→C'nin üstüne yazabilirdi. */
  const controllerRef = useRef(null)
  const requestIdRef = useRef(0)

  /** Yeni bir BAŞARILI önizlemede kameranın bir kez oturması için sayaç. */
  const [previewToken, setPreviewToken] = useState(0)

  const abort = useCallback(() => {
    requestIdRef.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
  }, [])

  useEffect(() => () => abort(), [abort])

  // Yetki düşerse (canlı yetkilendirme) planlayıcı kendini toplar.
  useEffect(() => {
    if (permitted) return
    abort()
    setPreview(null)
    setLoading(false)
    setError('')
  }, [permitted, abort])

  /* Başka bir araç ailesi devraldığı anda silah BIRAKILIR. Koşul saf kuralda
     durur ve zaten silahsızken hiçbir eylem gönderilmez — aksi hâlde her
     render yeni bir durum nesnesi üretip döngü kurardı. */
  useEffect(() => {
    if (!shouldDisarmJourneySlot({ activeSlotKey: state.activeSlotKey, workspaceAtRest })) return
    dispatch({ type: 'armSlot', key: null })
  }, [workspaceAtRest, state.activeSlotKey])

  const validation = useMemo(() => buildJourneyPreviewRequest(state), [state])

  const requestPreview = useCallback(async () => {
    if (!permitted) return
    if (!validation.ok) {
      setError(validation.error ?? '')
      return
    }

    abort()
    const requestId = requestIdRef.current
    const controller = new AbortController()
    controllerRef.current = controller

    setLoading(true)
    setError('')

    try {
      const response = await previewJourney(validation.request, { signal: controller.signal })

      // Geç kalan cevap, daha yeni bir isteğin sonucunu EZEMEZ.
      if (requestId !== requestIdRef.current) return

      if (!response.ok) {
        const message = await readApiError(response, '')
        setPreview(null)
        setError(journeyErrorMessage(response.status, message))
        return
      }

      const body = await response.json()
      if (requestId !== requestIdRef.current) return

      setPreview(body)
      // Kamera YALNIZCA yeni bir başarılı önizlemede oynar.
      setPreviewToken((token) => token + 1)
    } catch (caught) {
      // İptal bir hata değil, yaşam döngüsüdür.
      if (caught?.name === 'AbortError') return
      if (requestId !== requestIdRef.current) return
      setPreview(null)
      setError(journeyErrorMessage(0, ''))
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [permitted, validation, abort])

  const clear = useCallback(() => {
    abort()
    dispatch({ type: 'reset' })
    setPreview(null)
    setError('')
    setLoading(false)
  }, [abort])

  /* Seçim değişince ESKİ önizleme geçersizdir. Silinmesi bilinçlidir:
     ekranda duran güzergah, artık panelde yazan yolculuğa ait olmazdı. */
  const requestSignature = useMemo(
    () => (validation.ok ? JSON.stringify(validation.request) : ''),
    [validation],
  )
  const lastAppliedSignature = useRef(requestSignature)

  useEffect(() => {
    if (lastAppliedSignature.current === requestSignature) return
    lastAppliedSignature.current = requestSignature
    setPreview((current) => (current == null ? current : null))
    setError('')
  }, [requestSignature])

  const actions = useMemo(() => ({
    setMode: (mode) => dispatch({ type: 'setMode', mode }),
    setProfile: (profile) => dispatch({ type: 'setProfile', profile }),
    setRoute: (routeId) => dispatch({ type: 'setRoute', routeId }),
    setSegmentStop: (end, stopId) => dispatch({ type: 'setSegmentStop', end, stopId }),
    swapSegmentStops: () => dispatch({ type: 'swapSegmentStops' }),
    addWaypoint: () => dispatch({ type: 'addWaypoint' }),
    removeWaypoint: (key) => dispatch({ type: 'removeWaypoint', key }),
    moveWaypoint: (key, direction) => dispatch({ type: 'moveWaypoint', key, direction }),
    assignWaypoint: (key, reference) => dispatch({ type: 'assignWaypoint', key, reference }),
    armSlot: (key) => dispatch({ type: 'armSlot', key }),
    disarmSlot: () => dispatch({ type: 'armSlot', key: null }),
    /* ÜRÜN seçimi bir sunum kararıdır: ne kişisel yolculuğu ne de paylaşılan
       hattı durdurur, hiçbir kanalı kapatmaz ve hiçbir takibi bırakmaz. */
    setProduct: (product) => dispatch({ type: 'setProduct', product }),
    openPanel: () => dispatch({ type: 'setPanel', panel: PANEL_STATES.OPEN }),
    collapsePanel: () => dispatch({ type: 'setPanel', panel: PANEL_STATES.COLLAPSED }),
    closePanel: () => dispatch({ type: 'setPanel', panel: PANEL_STATES.CLOSED }),
  }), [])

  /**
   * Sunucuya gönderilecek KANONİK yolculuk niyeti.
   *
   * Simülasyon başlatma bunu kullanır: önizlemenin planId'si, geometrisi ya da
   * ölçümleri gönderilmez — sunucu yolculuğu kendi verisinden yeniden planlar.
   * Seçim geçersizse <code>null</code> döner ve hiçbir istek yola çıkmaz.
   */
  const buildIntent = useCallback(
    () => (validation.ok ? validation.request : null),
    [validation],
  )

  return {
    state,
    ...actions,
    buildIntent,
    preview,
    previewToken,
    loading,
    error,
    canRequest: validation.ok && !loading,
    validationError: validation.ok ? '' : validation.error ?? '',
    requestPreview,
    clear,
    /* Harita seçimi yalnızca serbest kipte, panel AÇIKKEN ve çalışma alanı
       dinlenme durumundayken silahlanır: görünmeyen bir yuvaya atama
       yapılmamalı, başka bir aracın tıklaması da paylaşılmamalıdır. Kural saf
       modüldedir; burada yalnızca uygulanır. */
    /* Nokta seçimi KİŞİSEL ürünün etkileşimidir: ürün kapısı yoksa hiç
       silahlanamaz. Kural, çalışma alanının paylaşılan bölümünü kullanan ama
       `journey.use` taşımayan kullanıcıda da doğru kalır — onun için kişisel
       yüzey hiç çizilmez ve bir tıklama görünmeyen bir yuvaya yazamaz. */
    isPicking: permitted && journeyPickingActive({
      product: state.product,
      mode: state.mode,
      panel: state.panel,
      activeSlotKey: state.activeSlotKey,
      workspaceAtRest,
    }),
  }
}
