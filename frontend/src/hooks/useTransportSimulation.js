import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { readApiError } from '../services/api.js'
import { liveConnectionMessage } from '../map/liveConnectionMessage.js'
import {
  fetchActiveTransportSimulations,
  fetchTransportSimulation,
  pauseTransportSimulation,
  resumeTransportSimulation,
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
import {
  activeRouteIdsOf,
  applyActiveSimulationList,
  clearWatchedRuns,
  ensureWatchedRun,
  reconcileWatchedRuns,
  toggleWatchedRun,
  watchAllActiveRuns,
  watchedRouteIdsOf,
} from '../map/activeSimulations.js'

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
export default function useTransportSimulation({
  routeId = null,
  canView = false,
  /**
   * AKTİF KEŞİF açık mı? (Faz 4A)
   *
   * <b>İsteğe bağlıdır ve varsayılanı KAPALIDIR.</b> Aktif liste ürünü ana
   * harita çalışma alanına aittir; güzergah yönetimi ekranı tek bir seçili
   * hatla ilgilenir ve orada tüm hatların yayınına abone olmak, o ekranın hiç
   * kullanmadığı bir trafiği açmak demekti. Bayrak yalnızca DAVRANIŞI açar —
   * yetkiyi değil: keşif yine `transport.view` ister ve bağlayıcı denetim
   * sunucudadır.
   */
  discoverActive = false,
} = {}) {
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
  /* Duraklat/Devam Ettir de UÇUŞTAYKEN kilitlenir: hızlı iki tıklama ikinci
     komutu yola çıkarır ve sunucu onu durum önkoşuluyla reddederdi. */
  const [pausing, setPausing] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [following, setFollowing] = useState(false)
  const [error, setError] = useState('')

  /* --- AKTİF KEŞİF (Faz 4A) ---------------------------------------------------
     İZLEME kaydı ROTA anahtarlı, ÇALIŞTIRMA değerlidir. Yalnızca rota
     tutulsaydı, A bitip aynı hatta B başladığında B kullanıcının hiç vermediği
     bir kararla izleniyor sayılırdı; kimlik eşleşmesi bu devralmayı yapısal
     olarak engeller. Bu durum tamamen İSTEMCİYE aittir: sunucuya yazılmaz ve
     başka kullanıcılara yayınlanmaz. */
  const [watchedRuns, setWatchedRuns] = useState({})
  const [activeLoading, setActiveLoading] = useState(false)
  const [activeLoaded, setActiveLoaded] = useState(false)
  const [activeError, setActiveError] = useState('')
  const [subscribedRouteIds, setSubscribedRouteIds] = useState([])

  const clientRef = useRef(null)
  const statusRequestId = useRef(0)
  const activeRequestId = useRef(0)

  /* CANLI OLAY SAYACI — bootstrap yarışının kapatıldığı yer.

     Aktif liste okuması bir ANIN gerçeğidir: yanıtta olmayan bir rota artık
     aktif değildir ve temizlenmelidir. Ama istek YOLDAYKEN yepyeni bir hat (D)
     başlamış ve keşif kanalından öğrenilmiş olabilir; yanıt onu içermez çünkü
     sunucu tarafında henüz yoktu. Körü körüne temizlemek D'nin sessizce
     kaybolması demekti.

     Bu yüzden her canlı olay bir sıra numarası alır; okuma, isteği gönderdiği
     andaki numarayı hatırlar ve o numaradan SONRA olay almış rotaları
     KORUNMUŞ sayar. */
  const liveSeq = useRef(0)
  const liveSeenRouteSeq = useRef(new Map())

  /* Tazeleme BİRLEŞTİRİLİR: uçuş hâlindeki bir okuma varken gelen sinyaller
     tek bir ek okumaya indirgenir. Zamanlayıcı, aralık ya da özyinelemeli
     yenileme YOKTUR — bu yoklama olurdu. */
  const activeRefreshInFlight = useRef(false)
  const activeRefreshPending = useRef(false)
  const requestActiveRefreshRef = useRef(null)

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
        onUpdate: (payload) => {
          const next = normalizeLiveUpdate(payload)
          if (next) {
            /* Bu rota hakkında CANLI kanaldan bilgi alındı: yolda olan bir
               aktif liste okuması onu "artık yok" diye temizleyemesin. */
            liveSeq.current += 1
            liveSeenRouteSeq.current.set(next.routeId, liveSeq.current)
          }
          applyState(next)
        },
        /* KEŞİF SİNYALİ: "aktif küme değişmiş olabilir". İkinci bir otorite
           değildir — tek bir liste okuması tetikler ve gerçeği o okuma
           söyler. Yoklama değildir: sinyal gelmezse hiçbir istek yapılmaz. */
        onActiveSetChanged: () => requestActiveRefreshRef.current?.(),
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
    /* FİZİKSEL üyelik de istemciden okunur: "canlı mı" sorusunun cevabı,
       kancanın tahmini değil gerçekten katılınmış grupların listesidir. */
    setSubscribedRouteIds(clientRef.current?.subscribedRouteIds ?? [])
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

      if (!snapshot) {
        setRouteState(targetRouteId, null)
        return null
      }

      /* REST okuması TEK YAZMA KURALINDAN geçer; ham bir üzerine yazma
         DEĞİLDİR. Eskiden `setRouteState` ile doğrudan yazılıyordu ve bu,
         canlı kanaldan gelmiş DAHA YENİ bir durumu geri sarabiliyordu:
         duraklatılmış bir hat seçildiğinde REST okuması onu "çalışıyor"
         hâline döndürüyor ve panel "Devam Ettir" yerine "Duraklat"
         gösteriyordu. Birleştirme kuralı bunu yapısal olarak engeller —
         duraklatılmış bir çalıştırmayı KESİN OLARAK daha yeni olmayan bir
         Running olayı geri alamaz. */
      applyState(snapshot)
      return snapshot
    } catch (loadError) {
      if (requestId !== statusRequestId.current) return null
      setRouteState(targetRouteId, null)
      setError(liveConnectionMessage(loadError, 'Simülasyon durumu okunamadı.'))
      return null
    } finally {
      if (requestId === statusRequestId.current) setStatusLoading(false)
    }
  }, [canView, setRouteState, applyState])

  useEffect(() => {
    setError('')
    loadStatus(routeId)
  }, [routeId, loadStatus])

  /* --- AKTİF KEŞİF OKUMASI -----------------------------------------------------
     TEK otoriter kaynak: `GET /api/transport/simulations/active`. İstemci aktif
     kümeyi her rotayı tek tek sorarak KURMAZ. */
  const loadActiveSimulations = useCallback(async () => {
    if (!canView || !discoverActive) return

    const requestId = ++activeRequestId.current
    /* İstek gönderilmeden ÖNCEKİ canlı olay numarası: yanıt döndüğünde bundan
       sonra olay almış rotalar korunacak. */
    const seqAtRequest = liveSeq.current

    setActiveLoading(true)
    try {
      const response = await fetchActiveTransportSimulations()
      if (requestId !== activeRequestId.current) return

      if (!response.ok) {
        throw new Error(await readApiError(response, 'Aktif simülasyonlar okunamadı.'))
      }

      const payload = await response.json()
      if (requestId !== activeRequestId.current) return

      const protectedRouteIds = [...liveSeenRouteSeq.current.entries()]
        .filter(([, seq]) => seq > seqAtRequest)
        .map(([protectedRouteId]) => protectedRouteId)

      /* Yanıt, aktif liste için AYRI bir birleştirme yazılmadan mevcut TEK
         kuraldan geçer; yolda kalmış bir okuma canlı kanaldan gelmiş daha yeni
         bir durumu geri saramaz. */
      setByRoute((current) => applyActiveSimulationList({
        byRoute: current,
        list: payload,
        protectedRouteIds,
      }).byRoute)

      setActiveError('')
      setActiveLoaded(true)
    } catch (loadError) {
      if (requestId !== activeRequestId.current) return
      /* Başarısız bir keşif okumasından sonra elde kalan veri GÜNCEL diye
         sunulmaz: hata açıkça bildirilir ve liste "yükleniyor"dan çıkar. */
      setActiveError(liveConnectionMessage(loadError, 'Aktif simülasyonlar okunamadı.'))
      setActiveLoaded(true)
    } finally {
      if (requestId === activeRequestId.current) setActiveLoading(false)
    }
  }, [canView, discoverActive])

  /**
   * Keşif sinyalinin tetiklediği TEK tazeleme.
   *
   * <b>Yoklama DEĞİLDİR.</b> Zamanlayıcı yoktur; istek yalnızca sunucu "küme
   * değişmiş olabilir" dediğinde yapılır. Uçuş hâlindeki bir okuma varken
   * gelen sinyaller TEK bir ek okumaya indirgenir: aksi hâlde beş hattın aynı
   * anda başlaması beş ardışık isteğe dönerdi.
   */
  const requestActiveRefresh = useCallback(async () => {
    if (!canView || !discoverActive) return

    if (activeRefreshInFlight.current) {
      activeRefreshPending.current = true
      return
    }

    activeRefreshInFlight.current = true
    try {
      do {
        activeRefreshPending.current = false
        await loadActiveSimulations()
      } while (activeRefreshPending.current)
    } finally {
      activeRefreshInFlight.current = false
    }
  }, [canView, discoverActive, loadActiveSimulations])

  /* Sinyal işleyicisi istemci kurulurken bağlanır ve o an oluşturulan kapanış
     eskiyebilir; en güncel tazeleyici bir ref'te tutulur. */
  useEffect(() => {
    requestActiveRefreshRef.current = requestActiveRefresh
  }, [requestActiveRefresh])

  /* --- BOOTSTRAP SIRASI ---------------------------------------------------------
     ÖNCE keşif kanalına katılınır, SONRA liste okunur. Sıra kritiktir:

     - D, katılımdan ÖNCE başlamışsa listede gelir;
     - D, katılımdan SONRA başlamışsa sinyali yakalanır ve tek bir tazeleme
       yapılır;
     - D, katılım ile yanıt arasında başlamışsa İKİSİ de olur ve birleştirme
       kuralı tekrarı zaten eler.

     Ters sıra (önce oku, sonra katıl) tam ortada bir KÖR PENCERE bırakırdı: o
     aralıkta başlayan hat ne yanıtta olurdu ne de sinyali duyulurdu. */
  useEffect(() => {
    if (!canView || !discoverActive) return undefined

    let cancelled = false

    ;(async () => {
      try {
        await client().joinDiscovery()
      } catch {
        /* Keşif üyeliği kurulamadıysa liste yine de okunur: kullanıcı en
           azından o anki gerçeği görür ve otomatik yeniden bağlanma üyeliği
           tazeler. */
        setActiveError('Canlı keşif kanalı kurulamadı. Yeniden bağlanılıyor…')
      } finally {
        syncSubscriptions()
      }

      if (!cancelled) await requestActiveRefresh()
    })()

    return () => {
      cancelled = true
    }
  }, [canView, discoverActive, client, requestActiveRefresh, syncSubscriptions])

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

  /**
   * Yaşam döngüsü geçişleri için ORTAK yol: aynı kimlik kuralı, aynı
   * uçuş-halinde kilidi, aynı otoriter yanıt işleme.
   *
   * <b>Terminal durum UYDURULMAZ.</b> Ekran yalnızca sunucunun döndürdüğü
   * güncellemeyle değişir ve o güncelleme, gözlemcilerin SignalR'dan
   * aldığının aynısıdır. İstemcide hiçbir yerel ilerleme ya da durum
   * hesaplanmaz.
   */
  const runTransition = useCallback(async ({
    targetRouteId,
    simulationId,
    inFlight,
    setInFlight,
    request,
    failureMessage,
  }) => {
    // KİMLİK ZORUNLUDUR: "hatta ne varsa ona uygula" yolu YOKTUR.
    if (!targetRouteId || !simulationId || inFlight) return null

    setInFlight(true)
    setError('')
    try {
      const response = await request(targetRouteId, simulationId)
      if (!response.ok) {
        throw new Error(await readApiError(response, failureMessage))
      }

      const next = normalizeLiveUpdate(await response.json())
      applyState(next)
      return next
    } catch (transitionError) {
      setError(liveConnectionMessage(transitionError, failureMessage))
      return null
    } finally {
      setInFlight(false)
    }
  }, [applyState])

  /** DURAKLAT: aynı çalıştırma, donmuş saat. Onay GEREKTİRMEZ. */
  const pause = useCallback((targetRouteId, simulationId) => runTransition({
    targetRouteId,
    simulationId,
    inFlight: pausing,
    setInFlight: setPausing,
    request: pauseTransportSimulation,
    failureMessage: 'Simülasyon duraklatılamadı.',
  }), [runTransition, pausing])

  /** DEVAM ETTİR: aynı çalıştırma, kaldığı yerden. */
  const resume = useCallback((targetRouteId, simulationId) => runTransition({
    targetRouteId,
    simulationId,
    inFlight: resuming,
    setInFlight: setResuming,
    request: resumeTransportSimulation,
    failureMessage: 'Simülasyon sürdürülemedi.',
  }), [runTransition, resuming])

  /**
   * TAKİP ET. Kamera sahipliğini alır ve — gerekiyorsa — aracı GÖRÜNÜR KILAR.
   *
   * <b>Takip izlemeyi İMA EDER.</b> Faz 4A'da aktif bir aracın haritada
   * görünmesinin TEK sahibi izleme seçimidir; kamera ise görünür bir araç
   * ister. İkisini bağlamasaydık "Takip Et" izlenmeyen bir hatta basıldığında
   * kullanıcıyı boş bir haritayı takip ederken bırakırdı.
   *
   * <b>Tersi DOĞRU DEĞİLDİR:</b> izlemek takip ettirmez, seçmek ne izletir ne
   * takip ettirir.
   *
   * <b>Kimlik TETİKLEME anında dondurulur:</b> izleme kaydına o an ekranda
   * duran çalıştırmanın kimliği yazılır, "bu hatta ne varsa" değil.
   */
  const follow = useCallback(async (targetRouteId) => {
    if (!targetRouteId || !canView) return null

    const target = byRoute[targetRouteId] ?? null
    if (target && !isTerminalSimulationStatus(target.status)) {
      setWatchedRuns((current) => ensureWatchedRun(current, {
        routeId: targetRouteId,
        simulationId: target.simulationId,
      }))
    }

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
  }, [applyState, byRoute, canView, client, syncSubscriptions])

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

  /** Seçili rotayı PASİF olarak izlemeye alır (kamera talep etmeden). */
  const observe = useCallback(async (targetRouteId) => {
    if (!targetRouteId || !canView) return
    try {
      await client().observe(targetRouteId)
    } catch {
      /* Abonelik kurulamadıysa panel REST anlık görüntüsüyle çalışmaya devam
         eder; otomatik yeniden bağlanma ve sonraki seçim yeniden dener. */
      setError('Canlı bağlantı kurulamadı. Yeniden bağlanılıyor…')
    } finally {
      syncSubscriptions()
    }
  }, [canView, client, syncSubscriptions])

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

  /* KAMERA YALNIZCA GÖRÜNÜR BİR ARACI TAKİP EDEBİLİR.
     — İzlemeyi Bırak / İzlemeyi Temizle ile takip arasındaki TEK bağ budur.

     Takip, izlemeyi İMA EDER (bkz. `follow`). Tersi yönde de bir tutarlılık
     borcu doğar: kullanıcı takip ettiği aracı AÇIKÇA gizlerse — tek tek
     "İzlemeyi Bırak" ya da toplu "İzlemeyi Temizle" ile — ekranda takip
     edilecek hiçbir şey kalmaz. Kamera sahipliğini o durumda korumak,
     "Takibi Bırak" düğmesinin görünmeye devam ettiği ama görünür aracın
     olmadığı bir durum yaratır; harita da bir sonraki tick'te GÖRÜNMEYEN bir
     aracın peşinde kaymaya devam ederdi.

     Kural DEKLARATİFTİR ve TEK yerdedir: "İzlemeyi Bırak" ile "İzlemeyi
     Temizle" düğmelerine ayrı ayrı takip bırakma kodu yazmak, ikisinin
     zamanla ayrışması demekti. İzleme kaydı ne şekilde düşerse düşsün kural
     aynı yerden işler.

     İKİ ŞEYE DOKUNMAZ:
     - ABONELİKLERE: çalıştırma hâlâ aktifse `activeLive` onu istemeye devam
       eder, dolayısıyla gruptan ÇIKILMAZ ve liste canlı kalır.
     - İZLEME KAYDINA: bu kural izleme yazmaz, yalnızca kamerayı okur.

     TERMİNAL durum bu kuralın KONUSU DEĞİLDİR ve bilinçle dışarıda bırakılır:
     onun kendi devir kuralı yukarıdadır ve gruptan çıkmamak için ÖNCE pasif
     gözleme geçer. İkisi aynı anda çalışsaydı, terminal devir yarıda kalır ve
     yerine geçecek B'nin ilk yayını kaçabilirdi. */
  useEffect(() => {
    if (followingRouteId == null) return

    const followed = byRoute[followingRouteId] ?? null

    // Terminal devir AYRI kuralın işidir; burada ona karışılmaz.
    if (followed && isTerminalSimulationStatus(followed.status)) return

    /* Takip edilen çalıştırma HÂLÂ izleniyorsa yapacak bir şey yok. Eşleşme
       KİMLİK üzerindendir: aynı hatta yerine geçmiş bir çalıştırma, eskisi
       için verilmiş takip kararını devralamaz. */
    if (followed && watchedRuns[followingRouteId] === followed.simulationId) return

    unfollow()
  }, [followingRouteId, watchedRuns, byRoute, unfollow])

  /* Görüntüleme yetkisi düşerse canlı kanal da kapanır: arayüz, backend'in
     artık reddedeceği bir aboneliği sürdürmez. */
  useEffect(() => {
    if (canView) return
    clientRef.current?.dispose()
    clientRef.current = null
    setFollowingRouteId(null)
    setObservedRouteId(null)
    setSubscribedRouteIds([])
    /* Keşif sonuçları da bırakılır: yetkisi olmayan birinin ekranında hangi
       hatların çalıştığı bilgisi ASILI KALMAZ. */
    setWatchedRuns(clearWatchedRuns())
    setActiveLoaded(false)
    setActiveError('')
  }, [canView])

  /* --- AKTİF KÜME: TÜRETİLİR, İKİNCİ BİR DEPO TUTULMAZ -------------------------
     "Hangi hatlar aktif" sorusunun cevabı kanonik sözlükten OKUNUR. Ayrı bir
     aktif liste durumu tutmak, aynı gerçeğin iki sahibi demekti: canlı bir
     terminal olay birini güncelleyip diğerini güncellemeyebilirdi. */
  const activeRouteIds = useMemo(() => activeRouteIdsOf(byRoute), [byRoute])

  /* Fiziksel abonelik anahtarı: küme AYNI kaldığı sürece tek bir JoinRoute
     bile üretilmez. */
  const activeRouteKey = activeRouteIds.join(',')

  /* AKTİF KÜME, ABONELİĞİN SAHİBİDİR — İZLEME DEĞİL.

     Kullanıcının haritada hangi araçları çizdiği bir SUNUM kararıdır. İzleme
     abonelik sahibi olsaydı, izlenmeyen aktif satırlar donar ve listede bayat
     bir ilerleme gösterirdi; oysa liste TÜM aktif çalıştırmalar için otoriter
     durum ve ilerleme göstermelidir.

     Fiziksel üyelik takip + gözlem + aktif küme BİRLEŞİMİDİR; istemci bunu
     zaten tekilleştirir, bu yüzden burada ikinci bir kayıt tutulmaz. */
  useEffect(() => {
    if (!canView || !discoverActive) return

    ;(async () => {
      try {
        await client().setActiveLiveRoutes(activeRouteIds)
      } catch {
        setActiveError('Canlı bağlantı kurulamadı. Yeniden bağlanılıyor…')
      } finally {
        syncSubscriptions()
      }
    })()
    // Küme kimliği bir dizeye indirgenir: aynı küme yeniden abone edilmez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, discoverActive, activeRouteKey, client, syncSubscriptions])

  /* İZLEME SEÇİMİ SUNUCU GERÇEĞİYLE UZLAŞTIRILIR.

     Biten çalıştırma izleme listesinden düşer (ölü işaretçi haritada
     kalmaz) ve yerine geçen B eski kararı DEVRALMAZ — kullanıcı onu ayrıca
     izlemeye almalıdır. */
  useEffect(() => {
    setWatchedRuns((current) => reconcileWatchedRuns(current, byRoute))
  }, [byRoute])

  /** İZLE / İZLEMEYİ BIRAK. Simülasyona DOKUNMAZ; yalnızca sunum. */
  const toggleWatch = useCallback((targetRouteId) => {
    setWatchedRuns((current) => {
      const state = byRoute[targetRouteId] ?? null
      return toggleWatchedRun(current, {
        routeId: targetRouteId,
        // Niyet TETİKLEME anındaki çalıştırmaya bağlanır.
        simulationId: state?.simulationId ?? null,
      })
    })
  }, [byRoute])

  /** TÜMÜNÜ İZLE: yalnızca O ANDA aktif olanlar; sonrakiler otomatik gelmez. */
  const watchAll = useCallback(() => {
    setWatchedRuns(watchAllActiveRuns(byRoute))
  }, [byRoute])

  /** İZLEMEYİ TEMİZLE: işaretçiler gider, simülasyonlar ÇALIŞMAYA DEVAM EDER. */
  const clearWatch = useCallback(() => {
    setWatchedRuns(clearWatchedRuns())
  }, [])

  const watchedRouteIds = useMemo(() => watchedRouteIdsOf(watchedRuns), [watchedRuns])

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

  /* SEÇİLİ ROTA, PASİF GÖZLEMİN SAHİBİDİR — takip DEĞİL.

     ESKİ DAVRANIŞ HATALIYDI: gözlem yuvası yalnızca kullanıcı simülasyonu
     KENDİ başlattığında ya da terminal devrinde doluyordu. Sıradan bir
     gözlemci için gruba katılmanın TEK yolu "Takip Et"ti; dolayısıyla
     "Takibi Bırak" son isteyen yuvayı da boşaltıyor ve istemci
     `LeaveRoute(R)` çağırıyordu. Simülasyon sunucuda sürerken panel donuyor,
     yeniden takip edildiğinde `JoinRoute`'un döndürdüğü güncel anlık görüntü
     ekranı bir anda ileri sıçratıyordu (%42 → %60).

     Takip yalnızca KAMERA sahipliğidir ve bir rotanın izlenmesinin TEK
     nedeni olamaz. İki yuvanın aynı rotayı göstermesi meşrudur: istemci
     fiziksel grup üyeliğini zaten tekilleştirir (`isSubscribed`), bu yüzden
     ikinci bir `JoinRoute` oluşmaz. */
  useEffect(() => {
    if (!canView || routeId == null) return
    if (observedRouteId === routeId) return
    observe(routeId)
  }, [canView, routeId, observedRouteId, observe])

  return {
    simulation,
    followedSimulation,
    observedSimulation,
    followingRouteId,
    observedRouteId,
    /* KANONİK sözlük dışarı verilir: aktif liste, işaretçiler ve seçili hat
       AYNI durumu okur; ikinci bir simülasyon deposu yoktur. */
    byRoute,
    activeRouteIds,
    subscribedRouteIds,
    watchedRuns,
    watchedRouteIds,
    toggleWatch,
    watchAll,
    clearWatch,
    activeLoading,
    activeLoaded,
    activeError,
    /** Keşif okumasının ELLE tetiklenmesi (hata sonrası "Yeniden dene"). */
    reloadActive: requestActiveRefresh,
    statusLoading,
    starting,
    stopping,
    pausing,
    resuming,
    following,
    error,
    clearError: () => setError(''),
    start,
    stop,
    pause,
    resume,
    follow,
    unfollow,
    reloadStatus: () => loadStatus(routeId),
  }
}
