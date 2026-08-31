import { useCallback, useEffect, useRef, useState } from 'react'
import { readApiError } from '../services/api.js'
import { fetchTransportSimulation, startTransportSimulation } from '../services/transportApi.js'
import { createTransportSimulationHubClient } from '../services/transportSimulationHub.js'
import {
  isTerminalSimulationStatus,
  mergeSimulationState,
  normalizeLiveUpdate,
  normalizeStatusSnapshot,
} from '../map/transportSimulationState.js'

/**
 * Seçili güzergahın simülasyon durumu ve canlı takip yaşam döngüsü.
 *
 * <b>Karar verme burada değil.</b> Sıralama/eskime kuralları saf
 * <code>mergeSimulationState</code>'te, bağlantı yaşam döngüsü de
 * <code>transportSimulationClient</code>'tadır; bu kanca yalnızca ikisini
 * React'e bağlar. Böylece asıl mantık tarayıcı olmadan sınanabilir kalır.
 *
 * <b>Tek bağlantı.</b> İstemci bir ref'te tutulur ve ilk takip isteğinde
 * kurulur; her render'da yeni bir HubConnection üretilmez. Sökülmede ya da
 * kullanıcı değiştiğinde bağlantı kapatılır ve grup üyeliği bırakılır.
 */
export default function useTransportSimulation({ routeId = null, canView = false } = {}) {
  /* Durum ROTA BAŞINA tutulur. Kullanıcı A rotasını takip ederken B'yi
     inceleyebilir; tek bir kutuda tutulsaydı B'nin durumu A'nınkini ezer ve
     takip edilen aracın canlı akışı sessizce kaybolurdu. */
  const [byRoute, setByRoute] = useState({})
  const [followingRouteId, setFollowingRouteId] = useState(null)
  /* İZLEME, TAKİP DEĞİLDİR. Kullanıcı bir simülasyonu başlattığında araç canlı
     akmalıdır, ama kamerayı ele geçirmemelidir; bu yüzden abonelik ayrı bir
     yuvada tutulur ve `followingRouteId` aşırı yüklenmez. */
  const [observedRouteId, setObservedRouteId] = useState(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [following, setFollowing] = useState(false)
  const [error, setError] = useState('')

  const clientRef = useRef(null)
  const statusRequestId = useRef(0)

  /* Gelen her durum TEK kural üzerinden yazılır; kanca kendi sıralama
     mantığını yazmaz. */
  const applyState = useCallback((next) => {
    if (!next) return
    setByRoute((current) => ({
      ...current,
      [next.routeId]: mergeSimulationState(current[next.routeId] ?? null, next),
    }))
  }, [])

  const setRouteState = useCallback((targetRouteId, value) => {
    setByRoute((current) => ({ ...current, [targetRouteId]: value }))
  }, [])

  const client = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = createTransportSimulationHubClient({
        onUpdate: (payload) => applyState(normalizeLiveUpdate(payload)),
        onError: () => {
          /* Bağlantı arızaları takip durumunu düşürmez: otomatik yeniden
             bağlanma devrededir ve yeniden katılım anlık görüntüyü kurtarır. */
          setError('Canlı bağlantıda sorun oluştu. Yeniden bağlanılıyor…')
        },
      })
    }
    return clientRef.current
  }, [applyState])

  /** Yuva durumları TEK kaynaktan (istemci) okunur; kanca kendi kopyasını tutmaz. */
  const syncSubscriptions = useCallback(() => {
    setFollowingRouteId(clientRef.current?.followingRouteId ?? null)
    setObservedRouteId(clientRef.current?.observedRouteId ?? null)
  }, [])

  /** Seçili güzergahın durumu REST'ten okunur: rota ZATEN çalışıyor olabilir. */
  const loadStatus = useCallback(async (targetRouteId) => {
    const requestId = ++statusRequestId.current
    if (!targetRouteId || !canView) return null

    setStatusLoading(true)
    try {
      const response = await fetchTransportSimulation(targetRouteId)
      if (requestId !== statusRequestId.current) return null

      // 404: bu güzergahta çalışan simülasyon yok — hata değil, bilgidir.
      if (response.status === 404) {
        setRouteState(targetRouteId, null)
        return null
      }
      if (!response.ok) throw new Error(await readApiError(response, 'Simülasyon durumu okunamadı.'))

      const snapshot = normalizeStatusSnapshot(await response.json())
      if (requestId !== statusRequestId.current) return null
      setRouteState(targetRouteId, snapshot)
      return snapshot
    } catch (loadError) {
      if (requestId !== statusRequestId.current) return null
      setRouteState(targetRouteId, null)
      setError(loadError?.message || 'Simülasyon durumu okunamadı.')
      return null
    } finally {
      if (requestId === statusRequestId.current) setStatusLoading(false)
    }
  }, [canView, setRouteState])

  useEffect(() => {
    setError('')
    loadStatus(routeId)
  }, [routeId, loadStatus])

  const start = useCallback(async (targetRouteId) => {
    if (!targetRouteId || starting) return null
    setStarting(true)
    setError('')
    try {
      const response = await startTransportSimulation(targetRouteId)
      if (!response.ok) {
        throw new Error(await readApiError(response, 'Simülasyon başlatılamadı.'))
      }

      /* Başlatma cevabı zaten %0'lık sunucu anlık görüntüsüdür: ekranı hemen
         onunla güncellemek, sayfa yenilemeyi ya da fazladan bir isteği
         gereksiz kılar. */
      const snapshot = normalizeStatusSnapshot(await response.json())
      applyState(snapshot)

      /* Başlatan kullanıcı aracı CANLI görmelidir: aynı tek bağlantı üzerinden
         rotanın grubuna PASİF olarak abone olunur. Bu bir "Takip Et" değildir —
         kamera talebi doğmaz, arayüz takip durumuna geçmez. Yeni bir bağlantı,
         ikinci bir istemci, yoklama ya da zamanlayıcı kurulmaz. */
      if (canView) {
        try {
          await client().observe(targetRouteId)
        } catch {
          /* Canlı abonelik kurulamadıysa başlatma yine BAŞARILIDIR: sunucu
             simülasyonu çalışıyor. Kullanıcı Takip Et ile yeniden deneyebilir. */
          setError('Simülasyon başlatıldı ancak canlı bağlantı kurulamadı.')
        } finally {
          syncSubscriptions()
        }
      }

      return snapshot
    } catch (startError) {
      setError(startError?.message || 'Simülasyon başlatılamadı.')
      return null
    } finally {
      setStarting(false)
    }
  }, [applyState, canView, client, starting, syncSubscriptions])

  const follow = useCallback(async (targetRouteId) => {
    if (!targetRouteId || !canView) return null
    setFollowing(true)
    setError('')
    try {
      const snapshot = await client().follow(targetRouteId)
      syncSubscriptions()
      // Geç katılım: JoinRoute'un döndürdüğü anlık görüntü hemen uygulanır.
      applyState(normalizeLiveUpdate(snapshot))
      return snapshot
    } catch (followError) {
      setError(followError?.message || 'Canlı takip başlatılamadı.')
      syncSubscriptions()
      return null
    } finally {
      setFollowing(false)
    }
  }, [applyState, canView, client, syncSubscriptions])

  /* Takibi bırakmak yalnızca KAMERA sahipliğini geri verir; varsa pasif
     izleme aboneliği olduğu gibi kalır (istemci grup üyeliğini iki yuvanın
     birleşimine göre yönetir). */
  const unfollow = useCallback(async () => {
    if (!clientRef.current) {
      syncSubscriptions()
      return
    }
    setFollowing(true)
    try {
      await clientRef.current.unfollow()
    } finally {
      syncSubscriptions()
      setFollowing(false)
    }
  }, [syncSubscriptions])

  const stopObserving = useCallback(async () => {
    if (!clientRef.current) return
    await clientRef.current.stopObserving()
    syncSubscriptions()
  }, [syncSubscriptions])

  /* Sökülme / oturum sonu: grup üyeliği bırakılır ve bağlantı kapatılır.
     Kapanmayan bir bağlantı, çıkış yapıldıktan sonra da yayın almaya devam
     eden bir dinleyici bırakırdı. */
  useEffect(() => () => {
    clientRef.current?.dispose()
    clientRef.current = null
  }, [])

  /* Görüntüleme yetkisi düşerse canlı kanal da kapanır: arayüz, backend'in
     artık reddedeceği bir aboneliği sürdürmez. */
  useEffect(() => {
    if (canView) return
    clientRef.current?.dispose()
    clientRef.current = null
    setFollowingRouteId(null)
    setObservedRouteId(null)
  }, [canView])

  /* Seçili rotanın durumu Faz 3 denetimlerini besler; takip edilen rotanınki
     canlı aracın sahibidir. İkisi AYNI olmak zorunda değildir. */
  const simulation = routeId == null ? null : byRoute[routeId] ?? null
  const followedSimulation = followingRouteId == null ? null : byRoute[followingRouteId] ?? null

  const observedSimulation = observedRouteId == null ? null : byRoute[observedRouteId] ?? null

  /* Pasif izlemenin ömrü DAR tutulur: yalnızca izlenen rota hâlâ seçiliyken ve
     çalıştırma sürerken anlamlıdır. Başka bir rotaya geçildiğinde ya da
     çalıştırma bittiğinde abonelik bırakılır — açıkça takip ediliyorsa
     dokunulmaz, çünkü o karar kullanıcınındır. */
  useEffect(() => {
    if (observedRouteId == null) return
    if (observedRouteId === followingRouteId) return
    const finished = observedSimulation != null && isTerminalSimulationStatus(observedSimulation.status)
    if (observedRouteId === routeId && !finished) return
    stopObserving()
  }, [observedRouteId, followingRouteId, observedSimulation, routeId, stopObserving])

  return {
    simulation,
    followedSimulation,
    observedSimulation,
    followingRouteId,
    observedRouteId,
    statusLoading,
    starting,
    following,
    error,
    clearError: () => setError(''),
    start,
    follow,
    unfollow,
    reloadStatus: () => loadStatus(routeId),
  }
}
