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

  /* Dinleyici her zaman EN GÜNCEL anlık görüntüyü görmelidir; state closure'ı
     yakalasaydı ilk render'ın değeriyle karşılaştırma yapardı. */
  const snapshotRef = useRef(null)
  snapshotRef.current = snapshot

  const applyUpdate = useCallback((incoming) => {
    /* `stop()` asenkrondur: sökülmeyle durmanın tamamlanması arasında yolda
       kalmış bir olay hâlâ tetiklenebilir. Sökülmüş bir bağlantıdan gelen
       güncelleme duruma YAZILMAZ. */
    if (disposedRef.current) return
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
    } catch {
      /* Canlı kanal kurulamazsa simülasyon SUNUCUDA devam eder; kullanıcıya
         gösterilen son anlık görüntü başlatma yanıtındakidir. */
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

  useEffect(() => () => {
    disposedRef.current = true
    joinedRef.current = null
    connectionRef.current?.stop?.().catch(() => {})
    connectionRef.current = null
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

      const body = await response.json()

      /* Sunucu yanıtı YENİ gerçektir: geometri ve ölçümler önizlemedekinden
         farklı olabilir ve farklı olması yeniden doğrulamanın beklenen
         sonucudur. Eski önizleme burada bırakılır. */
      setSimulation(body)
      setSnapshot(body.snapshot ?? null)
      // Taze başlatma kamerayı TALEP EDER: kullanıcı yolculuğu o an başlattı.
      setFollowing(adoptedJourneyFollow(JOURNEY_ADOPTION.START))
      await join(body.simulationId)
      return body
    } catch {
      setError(journeyErrorMessage(0, ''))
      return null
    } finally {
      setStarting(false)
    }
  }, [permitted, join])

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
    stop,
    dismiss,
  }
}
