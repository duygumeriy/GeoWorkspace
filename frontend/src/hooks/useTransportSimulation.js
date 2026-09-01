import { useCallback, useEffect, useRef, useState } from 'react'
import { readApiError } from '../services/api.js'
import { liveConnectionMessage } from '../map/liveConnectionMessage.js'
import {
  fetchTransportSimulation,
  startTransportSimulation,
  stopTransportSimulation,
} from '../services/transportApi.js'
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
  /* Durdurma UÇUŞTAYKEN düğme kapanır: çift gönderim, ikinci isteğin ya
     404/409 alması ya da (kimlik olmasaydı) yerine geçmiş bir çalıştırmayı
     vurması demekti. */
  const [stopping, setStopping] = useState(false)
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
      setError(liveConnectionMessage(loadError, 'Simülasyon durumu okunamadı.'))
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
      setError(liveConnectionMessage(startError, 'Simülasyon başlatılamadı.'))
      return null
    } finally {
      setStarting(false)
    }
  }, [applyState, canView, client, starting, syncSubscriptions])

  /**
   * PAYLAŞILAN çalıştırmayı herkes için durdurur.
   *
   * <b>Komut İKİ kimlik taşır.</b> Rota tek başına yetmez: eski bir sekme,
   * yerine geçmiş yeni bir çalıştırmayı durduramamalıdır. Kimlik
   * bilinmiyorsa istek HİÇ yola çıkmaz — "en güncel olanı durdur" gibi bir
   * geri dönüş YOKTUR.
   *
   * <b>Terminal durum UYDURULMAZ.</b> Ekran, sunucunun döndürdüğü otoriter
   * terminal güncellemeyle — gözlemcilerin SignalR'dan aldığının aynısıyla —
   * güncellenir; yerel bir "durdu" varsayımı yazılmaz. Kamera/takip da burada
   * bırakılmaz: terminal durumu gören mevcut yaşam döngüsü onu zaten çözer.
   */
  const stop = useCallback(async (targetRouteId, simulationId) => {
    if (!targetRouteId || !simulationId || stopping) return null

    setStopping(true)
    setError('')
    try {
      const response = await stopTransportSimulation(targetRouteId, simulationId)
      if (!response.ok) {
        throw new Error(await readApiError(response, 'Simülasyon durdurulamadı.'))
      }

      /* Yanıt canlı yayın SÖZLEŞMESİDİR; aynı saf normalleştirme ve aynı tek
         birleştirme kuralından geçer. Geç gelen bir Running olayı terminal
         durumu geri saramaz — kural `mergeSimulationState`'tedir. */
      const terminal = normalizeLiveUpdate(await response.json())
      applyState(terminal)
      return terminal
    } catch (stopError) {
      setError(liveConnectionMessage(stopError, 'Simülasyon durdurulamadı.'))
      return null
    } finally {
      setStopping(false)
    }
  }, [applyState, stopping])

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
      // Ham pazarlık hatası arayüze çıkmaz; teknik ayrıntı konsolda kalır.
      setError(liveConnectionMessage(followError, 'Canlı takip başlatılamadı.'))
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

  /* TERMİNAL DURUM KAMERAYI BIRAKIR — ABONELİĞİ DEĞİL.

     Takip edilen çalıştırma bittiğinde kamera sahipliği kullanıcıda kalmaya
     devam etmemelidir: aksi hâlde "Aktif simülasyon yok" ile "Takibi Bırak"
     aynı anda görünür ve aynı hatta başlayan YENİ çalıştırma B, kullanıcı hiç
     istemeden takip ediliyormuş gibi davranır.

     Bırakma SIRALI yapılır ve sıra kritiktir: ÖNCE pasif izleme yuvasına
     geçilir (grup üyeliği o yuvada tutulur), SONRA takip yuvası boşaltılır.
     Ters sıra gruptan çıkıp yeniden katılmak olurdu ve o pencerede B'nin ilk
     yayını kaçabilirdi. İstemci "diğer yuva da istiyorsa ayrılma" kuralını
     zaten uyguladığı için burada tek bir JoinRoute/LeaveRoute bile
     gerekmez. */
  const releasedFollowRef = useRef(null)

  useEffect(() => {
    if (followingRouteId == null) return

    const followed = byRoute[followingRouteId] ?? null
    if (!followed || !isTerminalSimulationStatus(followed.status)) return

    // Aynı çalıştırma için ikinci kez devretmeye çalışılmaz.
    if (releasedFollowRef.current === followed.simulationId) return
    releasedFollowRef.current = followed.simulationId

    const route = followingRouteId

    ;(async () => {
      try {
        /* Abonelik KORUNUR: pasif izleme yuvası aynı rotayı devralır ve
           gruptan çıkılmaz. */
        await client().observe(route)
        await clientRef.current?.unfollow()
      } catch {
        /* Devir başarısız olsa bile kamera sahipliği bırakılmalıdır; sunucu
           durumu otoriterdir ve kullanıcı Takip Et ile yeniden deneyebilir. */
      } finally {
        syncSubscriptions()
      }
    })()
  }, [followingRouteId, byRoute, client, syncSubscriptions])

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

  /* Pasif izlemenin ömrü ROTA SEÇİMİNE bağlıdır — çalıştırmanın yaşam
     döngüsüne DEĞİL.

     ESKİ KURAL YANLIŞTI: çalıştırma terminal olunca abonelik bırakılıyordu.
     Ama ROTA GÖZLEMİ ile ÇALIŞTIRMA YAŞAM DÖNGÜSÜ ayrı şeylerdir: A bitince
     kullanıcı hâlâ R hattına bakıyordur ve az sonra AYNI hatta B
     başlayabilir. Grubu terk etmek, B'nin ilk otoriter yayınının sayfaya hiç
     ulaşmaması ve kullanıcının onu ancak SAYFAYI YENİLEYEREK görmesi
     demekti.

     Grup yalnızca gerçek GÖZLEM olayları için bırakılır: seçili rota
     değişti, seçim temizlendi, yetki düştü ya da bileşen söküldü. */
  useEffect(() => {
    if (observedRouteId == null) return
    if (observedRouteId === followingRouteId) return
    // Hâlâ seçili olan rotanın aboneliği KORUNUR; durumu ne olursa olsun.
    if (observedRouteId === routeId) return
    stopObserving()
  }, [observedRouteId, followingRouteId, routeId, stopObserving])

  return {
    simulation,
    followedSimulation,
    observedSimulation,
    followingRouteId,
    observedRouteId,
    statusLoading,
    starting,
    stopping,
    following,
    error,
    clearError: () => setError(''),
    start,
    stop,
    follow,
    unfollow,
    reloadStatus: () => loadStatus(routeId),
  }
}
