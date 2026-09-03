import { useCallback, useEffect, useRef, useState } from 'react'
import { readApiError } from '../services/api.js'
import {
  fetchCurrentJourneySimulation,
  startJourneySimulation,
  stopJourneySimulation,
} from '../services/transportApi.js'
import { createJourneySimulationConnection } from '../services/journeySimulationHub.js'
import {
  JOURNEY_ADOPTION,
  JOURNEY_PHASES,
  adoptedJourneyFollow,
  applyJourneySnapshot,
  isTerminalJourneyStatus,
  journeyPhase,
} from '../map/journeySimulationState.js'
import { journeyErrorMessage } from '../map/journeyPresentation.js'
import { liveConnectionMessage } from '../map/liveConnectionMessage.js'

export const JOURNEY_UPDATED_EVENT = 'JourneySimulationUpdated'
export const JOIN_SIMULATION_METHOD = 'JoinSimulation'
export const LEAVE_SIMULATION_METHOD = 'LeaveSimulation'

/**
 * Kişisel yolculuk simülasyonunun canlı durumu.
 *
 * <b><code>useTransportSimulation</code> ile BİRLEŞTİRİLMEZ.</b> O kanca
 * paylaşılan bir hattın çalıştırmasını izler, rota gruplarına katılır ve
 * <code>followingRouteId</code> ile kamera sahipliği paylaşır. Buradaki ürün
 * kişiseldir, hatta bağlı değildir ve kendi hub'ına gider; ikisini tek kancada
 * toplamak, bir yolculuğun kazara bir hat grubuna katılmasına ya da iki
 * kamera sahipliğinin çakışmasına kapı aralardı.
 *
 * <b>Tek bağlantı, tek dinleyici.</b> Bağlantı ilk ihtiyaçta kurulur, olay
 * dinleyicisi ömür boyu BİR kez kaydedilir. Her katılımda yeniden kaydetmek,
 * aynı olayın iki kez işlenmesi demekti.
 *
 * <b>Sunucu otoriterdir.</b> LocalStorage'a hiçbir oturum durumu YAZILMAZ;
 * yenileme sonrası kurtarma "mevcut" ucundan gelir.
 */
export default function useJourneySimulation({ permitted = false } = {}) {
  const [simulation, setSimulation] = useState(null)
  const [snapshot, setSnapshot] = useState(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  /* Kamera sahipliği KAPALI doğar. Açılışta ortada bir yolculuk yoktur ve
     benimseme yollarının ikisi de değeri AÇIKÇA yazar (`adoptedJourneyFollow`);
     böylece hiçbir çalıştırma bir öncekinin kamera hakkını devralmaz. */
  const [following, setFollowing] = useState(false)

  const connectionRef = useRef(null)
  const startPromiseRef = useRef(null)
  const joinedRef = useRef(null)
  const disposedRef = useRef(false)

  const applyUpdate = useCallback((incoming) => {
    /* `stop()` asenkrondur: sökülmeyle durmanın tamamlanması arasında yolda
       kalmış bir olay hâlâ tetiklenebilir. Sökülmüş bir bağlantıdan gelen
       güncelleme duruma YAZILMAZ. */
    if (disposedRef.current) return

    /* <b>Karşılaştırma İŞLEVSEL güncelleyicinin içinde yapılır.</b> Dinleyici
       ömür boyu BİR kez kaydedilir; bir state closure'ı okusaydı sonsuza dek
       ilk render'ın anlık görüntüsüyle karşılaştırma yapardı ve ikinci
       güncellemeden sonrası sessizce yanlış kararlar üretirdi. Güncelleyici
       ise React'in tuttuğu GÜNCEL değeri verir — bunun için ayrıca bir ref
       tutmak, aynı gerçeğin ikinci ve render sırasında yazılan bir kopyası
       olurdu. */
    setSnapshot((current) => applyJourneySnapshot(current, incoming))
  }, [])

  const ensureConnection = useCallback(async () => {
    if (disposedRef.current) return null
    if (connectionRef.current) {
      await startPromiseRef.current
      return connectionRef.current
    }

    const connection = createJourneySimulationConnection()
    connectionRef.current = connection

    // Ömür boyu TEK kayıt: aynı olayın iki kez işlenmesi engellenir.
    connection.on(JOURNEY_UPDATED_EVENT, applyUpdate)

    /* Yeniden bağlanma sunucu tarafında grup üyeliğini KAYBETTİRİR; sahip
       olunan çalıştırmaya yeniden katılmak zorunludur, yoksa araç sessizce
       donardı. */
    connection.onreconnected(async () => {
      const active = joinedRef.current
      if (!active) return
      try {
        const latest = await connection.invoke(JOIN_SIMULATION_METHOD, active)
        if (latest) applyUpdate(latest)
      } catch {
        // Sahiplik düşmüş ya da çalıştırma bitmiş olabilir; sessizce bırakılır.
      }
    })

    startPromiseRef.current = connection.start()
    await startPromiseRef.current
    return connection
  }, [applyUpdate])

  const join = useCallback(async (simulationId) => {
    if (!simulationId) return
    try {
      const connection = await ensureConnection()
      if (!connection || disposedRef.current) return
      joinedRef.current = simulationId
      const latest = await connection.invoke(JOIN_SIMULATION_METHOD, simulationId)
      if (latest) applyUpdate(latest)
    } catch (caught) {
      /* Canlı kanal kurulamazsa simülasyon SUNUCUDA devam eder; kullanıcıya
         gösterilen son anlık görüntü başlatma yanıtındakidir. Ama SESSİZ
         kalmak yanıltıcıydı: işaretçi kıpırdamıyorken arayüz her şey yolunda
         gibi görünürdü. Metin güvenlidir, teknik ayrıntı konsoldadır. */
      if (!disposedRef.current) {
        setError(liveConnectionMessage(caught, 'Canlı bağlantı kurulamadı.'))
      }
    }
  }, [ensureConnection, applyUpdate])

  const leave = useCallback(async () => {
    const active = joinedRef.current
    joinedRef.current = null
    if (!active || !connectionRef.current) return
    try {
      await connectionRef.current.invoke(LEAVE_SIMULATION_METHOD, active)
    } catch {
      // Bağlantı zaten kopmuş olabilir; ayrılmak bir yan etki üretmez.
    }
  }, [])

  /* Sökülme bayrağı BU ETKİNİN İÇİNDE sıfırlanır.

     React bir bileşeni söküp AYNI örnekle yeniden monte edebilir — geliştirme
     modundaki `StrictMode` her montajda tam olarak bunu yapar: efektler
     çalışır, temizlenir, sonra yeniden çalışır. State ve `useRef` kutuları bu
     sırada KORUNUR. Bayrak yalnızca temizlikte yazılıp bir daha hiç
     sıfırlanmasaydı — ki hata buydu — ikinci montajda kalıcı olarak `true`
     kalırdı: `ensureConnection` `null` döner, `JoinSimulation` hiç çağrılmaz
     ve gelen her anlık görüntü `applyUpdate`'in ilk satırında düşerdi. Panel,
     balon ve işaretçi başlatma yanıtındaki %0'da DONARDI; oysa sunucu
     ilerlemeye devam ediyordu.

     Paylaşılan hat kancasında böyle bir bayrak yoktur (istemci atılır, ref
     boşaltılır) ve o yüzden aynı arızaya hiç düşmedi. Buradaki kanca bayrağa
     ihtiyaç duyar — `stop()` asenkrondur ve yolda kalmış bir olay sökülmüş
     bağlantıdan hâlâ gelebilir — ama bayrak MONTAJA ait olmalıdır, bileşenin
     ömrüne değil. */
  useEffect(() => {
    disposedRef.current = false

    return () => {
      disposedRef.current = true
      joinedRef.current = null
      connectionRef.current?.stop?.().catch(() => {})
      connectionRef.current = null
      startPromiseRef.current = null
    }
  }, [])

  /* Yenileme/yeniden bağlanma kurtarması: otorite SUNUCUDUR. Yetki yoksa hiç
     sorulmaz — garanti 403 alacak bir isteği döngüye sokmanın anlamı yok. */
  useEffect(() => {
    if (!permitted) return undefined

    let cancelled = false
    const controller = new AbortController()

    ;(async () => {
      try {
        const response = await fetchCurrentJourneySimulation({ signal: controller.signal })
        if (cancelled || !response.ok) return
        const body = await response.json()
        if (cancelled) return
        setSimulation(body)
        setSnapshot(body.snapshot ?? null)
        /* GÖZLEM ≠ TAKİP. Kurtarma yalnızca sunucudaki yolculuğu izlemeye
           devam eder; kullanıcının bıraktığı görüntü kaydırılmaz. Kamerayı
           istemek için "Takip Et" vardır. */
        setFollowing(adoptedJourneyFollow(JOURNEY_ADOPTION.RECOVERY))
        await join(body.simulationId)
      } catch {
        // Aktif çalıştırma yok ya da istek iptal edildi; ikisi de normaldir.
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [permitted, join])

  /**
   * Sunucunun OTORİTER başlatma yanıtını benimser.
   *
   * <b>Neden ayrı.</b> Kişisel bir çalıştırma iki yoldan doğabilir: planlanan
   * bir niyetten ya da KAYDEDİLMİŞ bir tanımın yeniden kullanılmasından. İkisi
   * de aynı yanıtı üretir ve aynı canlı kanala katılmalıdır; benimseme
   * mantığını ikinci kez yazmak, iki yolun zamanla farklı davranması demekti.
   * <b>İKİNCİ bir kişisel SignalR istemcisi açılmaz</b> — kanal hâlâ bir
   * tanedir ve sahibi bu kancadır.
   *
   * Yanıt istemcinin YENİ gerçeğidir: geometri ve ölçümler eski önizlemeden
   * farklı olabilir ve farklı olması yeniden doğrulamanın beklenen sonucudur.
   */
  const adopt = useCallback(async (body) => {
    if (!body?.simulationId) return null

    setSimulation(body)
    setSnapshot(body.snapshot ?? null)
    // Taze başlatma kamerayı TALEP EDER: kullanıcı yolculuğu o an başlattı.
    setFollowing(adoptedJourneyFollow(JOURNEY_ADOPTION.START))
    await join(body.simulationId)
    return body
  }, [join])

  const start = useCallback(async (intent) => {
    if (!permitted || !intent) return null

    setStarting(true)
    setError('')

    try {
      const response = await startJourneySimulation(intent)

      if (!response.ok) {
        setError(journeyErrorMessage(response.status, await readApiError(response, '')))
        return null
      }

      /* Benimseme TEK yerdedir: kaydedilmiş bir tanımın yeniden kullanımı da
         aynı yoldan geçer ve aynı kanala katılır. */
      return await adopt(await response.json())
    } catch {
      setError(journeyErrorMessage(0, ''))
      return null
    } finally {
      setStarting(false)
    }
  }, [permitted, adopt])

  const stop = useCallback(async () => {
    const active = simulation?.simulationId
    if (!active) return

    try {
      const response = await stopJourneySimulation(active)
      if (response.ok) {
        const body = await response.json()
        // Terminal olay her zaman kabul edilir; kilit buradan sonra devreye girer.
        applyUpdate(body)
      }
    } catch {
      // Ağ hatası: sunucu durumu otoriterdir, bir sonraki okuma düzeltir.
    } finally {
      await leave()
    }
  }, [simulation, applyUpdate, leave])

  /**
   * Benimsenen çalıştırmayı BIRAKIR: paneli ve haritayı serbest bırakır.
   *
   * <b>Sunucuya durdurma İSTEĞİ GÖNDERMEZ.</b> Biten bir yolculuk zaten
   * bitmiştir; onu bir kez daha durdurmaya çalışmak anlamsız bir istek
   * olurdu. Çalışan bir yolculukta ise durdurmak kullanıcının AYRI bir
   * kararıdır ve kendi eylemi vardır — bırakmak onu susturmaz, sunucuda
   * çalışmaya devam eder.
   *
   * Tekrar çağrılması güvenlidir: grup üyeliği zaten bırakılmışsa `leave`
   * hiçbir yan etki üretmez ve durum zaten boştur.
   */
  const dismiss = useCallback(async () => {
    await leave()
    setSimulation(null)
    setSnapshot(null)
    setError('')
    // Bırakılan çalıştırmanın kamera hakkı da BİTER; bir sonrakine miras kalmaz.
    setFollowing(false)
  }, [leave])

  /* Yolculuk bittiğinde grup üyeliği bırakılır; zombi abonelik kalmaz. Kamera
     hakkı da orada biter: hareket etmeyen bir aracı takip etmek diye bir şey
     yoktur ve sonuç ekranda dururken görüntü kilitli kalmamalıdır. */
  useEffect(() => {
    if (!snapshot || !isTerminalJourneyStatus(snapshot.status)) return
    leave()
    setFollowing(false)
  }, [snapshot, leave])

  /* Evre TEK bir yerden türetilir ve sunucunun durumundan başka hiçbir şeye
     bakmaz; "benimsenmiş bir çalıştırma var" ile "hâlâ hareket ediyor" ayrı
     iki sorudur. */
  const phase = journeyPhase({ simulation, snapshot })

  return {
    simulation,
    snapshot,
    starting,
    error,
    phase,
    isActive: phase === JOURNEY_PHASES.ACTIVE,
    isTerminal: phase === JOURNEY_PHASES.TERMINAL,
    following,
    setFollowing,
    start,
    /* Kaydedilmiş bir tanımdan doğan çalıştırma da BURADAN benimsenir; ikinci
       bir canlı durum ya da ikinci bir bağlantı kurulmaz. */
    adopt,
    stop,
    dismiss,
  }
}
