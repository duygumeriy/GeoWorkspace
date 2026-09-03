/**
 * Canlı simülasyon aboneliğinin YAŞAM DÖNGÜSÜ.
 *
 * <b>Taşımadan bağımsızdır.</b> Bağlantıyı kendisi kurmaz; `createConnection`
 * dışarıdan verilir. Gerçek uygulamada bu bir SignalR `HubConnection`'dır
 * (bkz. <code>transportSimulationHub.js</code>), testlerde ise sahte bir
 * nesne — böylece katılma/ayrılma/yeniden bağlanma davranışı bir tarayıcı ya
 * da çalışan bir sunucu olmadan sınanabilir.
 *
 * <b>Tek bağlantı, tek dinleyici.</b> Bağlantı ilk ihtiyaçta kurulur ve
 * yeniden kullanılır; olay dinleyicileri ömür boyu BİR kez kaydedilir. Her
 * katılımda yeniden kaydetmek, aynı olayın iki kez işlenmesi demekti. Rota
 * yayını, keşif sinyali ve çoklu izleme AYNI bağlantıyı paylaşır: araç başına,
 * izleme başına ya da keşif için ayrı bir istemci AÇILMAZ.
 *
 * <b>Abonelik SAHİPLİK birleşimidir.</b> İstemci üç bağımsız sahip tanır:
 * <ul>
 *   <li><code>follow</code> — kullanıcının açık <i>Takip Et</i> eylemi; kamera
 *       sahipliği buna bağlıdır (EN FAZLA bir rota).</li>
 *   <li><code>observe</code> — SEÇİLİ hattın kamerasız pasif aboneliği (EN
 *       FAZLA bir rota).</li>
 *   <li><code>activeLive</code> — AKTİF kümedeki tüm hatlar. Aktif
 *       Simülasyonlar listesinin CANLI kalmasını bu sahiplik sağlar.</li>
 * </ul>
 * Fiziksel grup üyeliği bu üçünün BİRLEŞİMİDİR. Üçü aynı rotayı isterse gruba
 * yine BİR kez katılınır; grup, sahiplerden hiçbiri onu istemez hâle gelene
 * kadar bırakılmaz.
 *
 * <b>NİYET ile OLGU ayrı tutulur.</b> Sahiplikler "R'yi kim istiyor" der;
 * ayrı bir defter (<code>joinedRoutes</code>) "sunucu bu bağlantıyı R grubuna
 * gerçekten aldı mı" der ve yalnızca <code>JoinRoute</code> çözüldükten sonra
 * yazılır. İkisini tek kavram saymak gerçek bir arızaya yol açmıştı: bir
 * sahibin İDDİASI, başka bir sahibin katılım kanıtı sayılıyor; katılım
 * başarısız olduğunda ya da yeniden bağlanmada kaybolduğunda iddia yerinde
 * kalıyor ve sonraki her katılım "zaten katıldım" diye atlanıyordu. Hat
 * sessizce donuyor, ekranı yalnızca REST yanıtları güncelliyordu. Uzlaştırma
 * artık idempotenttir ve ayrışmayı kendiliğinden onarır.
 *
 * <b>İzleme (watch) burada YOKTUR ve bilinçlidir.</b> Kullanıcının haritada
 * hangi araçları çizdiği bir SUNUM kararıdır; aboneliğin sahibi değildir.
 * İzleme abonelik sahibi olsaydı, izlenmeyen aktif satırlar donar ve listede
 * bayat bir ilerleme gösterirdi.
 */

export const SIMULATION_UPDATED_EVENT = 'SimulationUpdated'
export const ACTIVE_SET_CHANGED_EVENT = 'ActiveSimulationSetChanged'
export const JOIN_ROUTE_METHOD = 'JoinRoute'
export const LEAVE_ROUTE_METHOD = 'LeaveRoute'
export const JOIN_DISCOVERY_METHOD = 'JoinActiveSimulationDiscovery'
export const LEAVE_DISCOVERY_METHOD = 'LeaveActiveSimulationDiscovery'

export const FOLLOW_SLOT = 'follow'
export const OBSERVE_SLOT = 'observe'

export function createTransportSimulationClient({
  createConnection,
  onUpdate,
  onError,
  onActiveSetChanged,
} = {}) {
  if (typeof createConnection !== 'function') {
    throw new Error('createTransportSimulationClient requires a createConnection factory.')
  }

  let connection = null
  let startPromise = null
  let disposed = false
  let discoveryJoined = false

  const slots = { [FOLLOW_SLOT]: null, [OBSERVE_SLOT]: null }

  /* AKTİF KÜME sahipliği. Tek yuvalardan farklı olarak bir KÜMEDİR: aynı anda
     çalışan her hat burada bulunur. */
  const activeLive = new Set()

  /* --- MANTIKSAL SAHİPLİK ≠ FİZİKSEL ÜYELİK -----------------------------------
     `slots` ve `activeLive` "R'yi KİM istiyor" sorusunu yanıtlar. Bu küme ise
     "sunucu bu bağlantıyı GERÇEKTEN R grubuna aldı mı" sorusunu yanıtlar ve
     yalnızca `JoinRoute` ÇÖZÜLDÜKTEN sonra yazılır.

     İKİSİ AYNI ŞEY DEĞİLDİR ve karıştırılması gerçek bir arızaya yol açtı:
     katılma kararı "başka bir sahip zaten istiyor" ölçütüne bağlıydı, yani
     bir İDDİA başka bir iddianın kanıtı sayılıyordu. Bir katılım
     başarısız olduğunda (ya da yeniden bağlanmada kaybolduğunda) sahiplik
     iddiası yerinde kalıyor, sonraki her katılım denemesi "zaten katıldım"
     diye atlanıyordu. Defter ile sunucu bir kez ayrıştığında sistem bunu
     ASLA onaramıyordu: hat sessizce donuyor, yalnızca REST yanıtları
     ekranı güncelliyordu.

     Kural artık tek yönlüdür: fiziksel üyelik, mantıksal sahipliklerin
     BİRLEŞİMİNE göre uzlaştırılır ve uzlaştırma İDEMPOTENTTİR. */
  const joinedRoutes = new Set()

  /* Yuva BAŞINA istek sırası. Kullanıcı hızlıca A → B → C takip ederse
     yalnızca EN SON isteğin sonucu uygulanır; yolda kalan eski bir cevabın
     yuvayı geri alması sessiz bir hata olurdu. Sıra yuva başınadır ki bir
     izleme isteği bir takip isteğini (veya tersini) iptal etmesin. */
  const slotSeq = { [FOLLOW_SLOT]: 0, [OBSERVE_SLOT]: 0 }

  const subscribedRoutes = () => [
    ...new Set([
      ...Object.values(slots).filter((routeId) => routeId != null),
      ...activeLive,
    ]),
  ]

  /** Rota hâlâ herhangi bir SAHİP tarafından isteniyor mu? */
  const isSubscribed = (routeId) => routeId != null && subscribedRoutes().includes(routeId)

  const report = (error) => {
    if (typeof onError === 'function') onError(error)
  }

  const emit = (payload) => {
    if (!payload || typeof onUpdate !== 'function') return
    /* Yalnızca ABONE olunan rotaların olayları yukarı verilir: rota
       değiştirildikten sonra yoldaki eski bir olay, artık izlenmeyen bir
       çalıştırmayı ekrana yazamaz. */
    if (!isSubscribed(payload.routeId)) return
    onUpdate(payload)
  }

  /* KEŞİF sinyali rota süzgecinden GEÇMEZ ve geçmemelidir: sinyalin varlık
     nedeni, istemcinin HENÜZ abone OLMADIĞI bir hattı öğrenmesidir. Rota
     yayınlarına uygulanan filtre burada uygulansaydı, yeni başlayan hat tam
     da öğrenilmesi gereken anda elenirdi. */
  const announceActiveSetChange = (payload) => {
    if (typeof onActiveSetChanged === 'function') onActiveSetChanged(payload ?? null)
  }

  const ensureStarted = async () => {
    if (disposed) throw new Error('Simülasyon bağlantısı kapatıldı.')

    if (!connection) {
      connection = createConnection()

      // Ömür boyu TEK kayıt.
      connection.on(SIMULATION_UPDATED_EVENT, emit)
      connection.on(ACTIVE_SET_CHANGED_EVENT, announceActiveSetChange)

      connection.onreconnected?.(async () => {
        /* Yeniden bağlanma grup üyeliğini KORUMAZ: sunucu tarafında bağlantı
           YENİ bir kimliktir ve eski grupların hiçbiri taşınmaz.

           DEFTER bu yüzden ÖNCE sıfırlanır. Sıfırlanmasaydı "zaten
           katıldım" kayıtları, artık var olmayan üyelikleri ebediyen doğru
           sanardı ve hiçbir rota yeniden katılmazdı.

           Ardından uzlaştırma, GERÇEKTEN gereken her aboneliği (takip,
           izleme ve aktif küme) yeniden kurar ve katılım cevabındaki güncel
           anlık görüntüyü uygular — kullanıcı bir sonraki tick'i beklemez.
           Aynı rota birden fazla sahipte olsa da BİR kez katılınır. */
        joinedRoutes.clear()
        await reconcileMemberships()

        /* Keşif üyeliği de yeniden kurulur ve ARDINDAN bir tazeleme istenir:
           bağlantı kopukken başlayan ya da biten hatların sinyali kaçmıştır,
           bu yüzden doğru davranış tek bir liste okumasıdır — yoklama değil. */
        if (discoveryJoined) {
          discoveryJoined = false
          try {
            await joinDiscovery()
            announceActiveSetChange(null)
          } catch (error) {
            report(error)
          }
        }
      })
    }

    if (!startPromise) {
      startPromise = Promise.resolve(connection.start()).catch((error) => {
        // Başarısız başlatma hatırlanmaz; sonraki deneme yeniden başlatabilsin.
        startPromise = null
        throw error
      })
    }

    return startPromise
  }

  const leaveQuietly = async (routeId) => {
    if (routeId == null || !connection) return
    // Girilmemiş bir gruptan ÇIKILMAZ: defter neyi bıraktığını bilmelidir.
    if (!joinedRoutes.has(routeId)) return

    joinedRoutes.delete(routeId)
    try {
      await connection.invoke(LEAVE_ROUTE_METHOD, routeId)
    } catch (error) {
      // Ayrılamamak kullanıcıya gösterilecek bir arıza değildir: bağlantı
      // kapandığında grup üyeliği zaten sunucuda düşer.
      report(error)
    }
  }

  /**
   * Gruba katılır ve üyeliği ANCAK sunucu onayladıktan sonra deftere yazar.
   *
   * <b>Sıra hayatidir.</b> Üyeliği çağrıdan ÖNCE kaydetmek, başarısız bir
   * katılımın ardından "zaten katıldım" diyen kalıcı bir yalan bırakırdı ve
   * o rota bir daha asla yeniden denenmezdi.
   */
  const joinRouteOnce = async (routeId) => {
    if (joinedRoutes.has(routeId)) return null

    const snapshot = await connection.invoke(JOIN_ROUTE_METHOD, routeId)
    joinedRoutes.add(routeId)
    return snapshot ?? null
  }

  /**
   * Fiziksel üyeliği mantıksal sahipliklerin BİRLEŞİMİNE çeker.
   *
   * <b>İdempotenttir</b> ve her sahiplik geçişinden sonra çağrılabilir:
   * istenmeyen üyelikler bırakılır, eksik olanlar tamamlanır, zaten doğru
   * olanlar için tek bir çağrı bile üretilmez. Başarısız bir katılım deftere
   * YAZILMAZ, dolayısıyla bir sonraki uzlaştırma onu yeniden dener —
   * ayrışma kendi kendini onarır. Zamanlayıcı ya da yoklama YOKTUR.
   */
  const reconcileMemberships = async () => {
    if (!connection) return

    const wanted = new Set(subscribedRoutes())

    for (const routeId of [...joinedRoutes]) {
      if (!wanted.has(routeId)) await leaveQuietly(routeId)
    }

    for (const routeId of wanted) {
      if (joinedRoutes.has(routeId)) continue
      try {
        const snapshot = await joinRouteOnce(routeId)
        if (isSubscribed(routeId)) emit(snapshot)
      } catch (error) {
        report(error)
      }
    }
  }

  /**
   * Tek yuvayı verilen rotaya ayarlar (veya boşaltır) ve grup üyeliğini buna
   * göre günceller. Katılma/ayrılma kararının TEK yeri burasıdır.
   */
  const setSlot = async (slot, routeId) => {
    const target = routeId == null ? null : Number(routeId)
    if (target !== null && !Number.isFinite(target)) return null

    const previous = slots[slot]
    // Aynı rota yeniden istendiğinde İKİNCİ bir JoinRoute yapılmaz.
    if (target === previous) return null

    const requestId = ++slotSeq[slot]

    if (target === null) {
      slots[slot] = null
      // Grup yalnızca BAŞKA hiçbir sahip istemiyorsa bırakılır.
      if (!isSubscribed(previous)) await leaveQuietly(previous)
      return null
    }

    await ensureStarted()
    if (requestId !== slotSeq[slot]) return null

    if (previous != null) {
      slots[slot] = null
      if (!isSubscribed(previous)) await leaveQuietly(previous)
      if (requestId !== slotSeq[slot]) return null
    }

    /* Piggyback YALNIZCA GERÇEK bir üyeliğe yapılır — başka bir sahibin
       İDDİASINA değil. Eski kural `isSubscribed(target)` idi: aktif küme
       rotayı istiyorsa bu yuva katılmadan kendini abone sayıyordu. O sahiplik
       düştüğünde ya da katılımı hiç başarılı olmadığında, geride hiçbir zaman
       var olmamış bir üyeliği bildiren kalıcı bir kayıt kalıyordu. */
    if (joinedRoutes.has(target)) {
      // Gerçekten katılınmış: çift üyelik ÜRETİLMEZ.
      slots[slot] = target
      return null
    }

    const snapshot = await joinRouteOnce(target)

    if (requestId !== slotSeq[slot]) {
      /* Bu istek aşıldı: az önce katıldığımız grupta ASILI kalmamak için
         çıkılır — meğer ki başka bir sahip o rotayı istiyor olsun. */
      if (!isSubscribed(target)) await leaveQuietly(target)
      return null
    }

    slots[slot] = target
    emit(snapshot)
    return snapshot ?? null
  }

  /**
   * AKTİF KÜME sahipliğini verilen rotalara ayarlar.
   *
   * Yalnızca GEÇİŞLERDE fiziksel işlem yapılır: sahiplik kazanan ve başka
   * hiçbir sahibi olmayan rotaya katılınır, sahipliği düşen ve başka hiçbir
   * sahibi kalmayan rotadan çıkılır. Aynı küme yeniden verildiğinde tek bir
   * `JoinRoute` bile üretilmez.
   */
  const setActiveLiveRoutes = async (routeIds) => {
    const next = new Set(
      (Array.isArray(routeIds) ? routeIds : [])
        .map(Number)
        .filter((routeId) => Number.isFinite(routeId)),
    )

    const added = [...next].filter((routeId) => !activeLive.has(routeId))
    const removed = [...activeLive].filter((routeId) => !next.has(routeId))

    if (added.length === 0 && removed.length === 0) return

    /* ÖNCE sahiplik düşürülür, SONRA ayrılma kararı verilir: kalan sahipleri
       (takip/gözlem) olan bir rotadan ASLA çıkılmaz. Terminal olmuş bir hattı
       kullanıcı hâlâ seçili tutuyorsa, aynı hatta başlayacak B'nin ilk yayını
       kaçmasın diye üyelik gözlem sahipliğiyle ayakta kalır. */
    for (const routeId of removed) activeLive.delete(routeId)
    for (const routeId of removed) {
      if (!isSubscribed(routeId)) await leaveQuietly(routeId)
    }

    if (added.length > 0) {
      await ensureStarted()

      for (const routeId of added) {
        // Piggyback YALNIZCA gerçek üyeliğe; iddiaya değil.
        const alreadyJoined = joinedRoutes.has(routeId)
        // Sahiplik ÖNCE yazılır: katılım cevabındaki anlık görüntü elenmesin.
        activeLive.add(routeId)
        if (alreadyJoined) continue

        try {
          const snapshot = await joinRouteOnce(routeId)
          if (activeLive.has(routeId)) emit(snapshot)
        } catch (error) {
          /* Tek bir rotaya katılamamak diğerlerini düşürmez: liste geri kalan
             hatlar için canlı kalır. Üyelik deftere YAZILMADIĞI için aşağıdaki
             uzlaştırma (ve sonraki her sahiplik geçişi) yeniden dener. */
          activeLive.delete(routeId)
          report(error)
        }
      }
    }

    /* SON SÖZ uzlaştırmanındır: bu çağrıdaki her şey başarılı olsa bile,
       başka bir yoldan (başarısız katılım, yeniden bağlanma) doğmuş bir
       ayrışma burada onarılır. İdempotenttir — doğru durumda tek bir çağrı
       bile üretmez. */
    await reconcileMemberships()
  }

  /**
   * KEŞİF üyeliği: "aktif küme değişti" sinyallerini almaya başlar.
   *
   * Rota gruplarından bağımsızdır ve olmak zorundadır: HİÇ bilinmeyen bir
   * hatta simülasyon başladığında istemci o rotanın grubunda değildir, yani
   * olayı hiçbir rota aboneliğiyle öğrenemez.
   */
  const joinDiscovery = async () => {
    if (disposed || discoveryJoined) return
    await ensureStarted()
    await connection.invoke(JOIN_DISCOVERY_METHOD)
    discoveryJoined = true
  }

  const leaveDiscovery = async () => {
    if (!discoveryJoined || !connection) {
      discoveryJoined = false
      return
    }
    discoveryJoined = false
    try {
      await connection.invoke(LEAVE_DISCOVERY_METHOD)
    } catch (error) {
      report(error)
    }
  }

  return {
    /** Kamera sahipliğini taşıyan rota (açık <i>Takip Et</i>). */
    get followingRouteId() {
      return slots[FOLLOW_SLOT]
    },

    /** Kamerasız, pasif canlı abonelik taşıyan rota. */
    get observedRouteId() {
      return slots[OBSERVE_SLOT]
    },

    /** AKTİF KÜME sahipliğindeki rotalar (tekrarsız). */
    get activeLiveRouteIds() {
      return [...activeLive]
    },

    /** Keşif üyeliği kurulmuş mu? */
    get isDiscovering() {
      return discoveryJoined
    },

    /** Herhangi bir SAHİBİN istediği rota kimlikleri (tekrarsız) — NİYET. */
    get subscribedRouteIds() {
      return subscribedRoutes()
    },

    /**
     * Sunucunun bu bağlantıyı GERÇEKTEN aldığı gruplar — OLGU.
     *
     * <code>subscribedRouteIds</code> ile arasındaki fark bilinçlidir ve
     * ölçülebilir olmalıdır: ikisinin sessizce ayrışması, hattın donduğu ama
     * arayüzün abone olduğunu sandığı arızanın ta kendisiydi.
     */
    get joinedRouteIds() {
      return [...joinedRoutes]
    },

    /**
     * Verilen rotayı takip etmeye başlar ve `JoinRoute`'un döndürdüğü GÜNCEL
     * anlık görüntüyü verir (çalışan simülasyon yoksa `null`).
     */
    follow(routeId) {
      return setSlot(FOLLOW_SLOT, routeId)
    },

    /** Takibi bırakır; bağlantı ve diğer sahiplikler olduğu gibi kalır. */
    async unfollow() {
      await setSlot(FOLLOW_SLOT, null)
    },

    /**
     * Rotayı kamerasız izlemeye başlar: seçili hat canlı akar ama görünüm
     * kullanıcının elinde kalır.
     */
    observe(routeId) {
      return setSlot(OBSERVE_SLOT, routeId)
    },

    /** Pasif gözlemi bırakır; açık takip ve aktif küme sahipliğine DOKUNMAZ. */
    async stopObserving() {
      await setSlot(OBSERVE_SLOT, null)
    },

    setActiveLiveRoutes,
    joinDiscovery,
    leaveDiscovery,

    /** Oturum kapanışı / bileşen sökülmesi: tüm üyelikler ve bağlantı bırakılır. */
    async dispose() {
      if (disposed) return
      disposed = true
      slotSeq[FOLLOW_SLOT] += 1
      slotSeq[OBSERVE_SLOT] += 1

      slots[FOLLOW_SLOT] = null
      slots[OBSERVE_SLOT] = null
      activeLive.clear()

      if (!connection) {
        discoveryJoined = false
        joinedRoutes.clear()
        return
      }

      await leaveDiscovery()
      /* Bırakılan şey NİYET değil, GERÇEKTEN girilmiş gruplardır: hiç
         katılınmamış bir gruptan çıkmaya çalışmak boş bir çağrıdır, ayrışmış
         bir defter ise geride üyelik bırakırdı. */
      for (const routeId of [...joinedRoutes]) await leaveQuietly(routeId)
      connection.off?.(SIMULATION_UPDATED_EVENT, emit)
      connection.off?.(ACTIVE_SET_CHANGED_EVENT, announceActiveSetChange)

      try {
        await connection.stop()
      } catch (error) {
        report(error)
      } finally {
        connection = null
        startPromise = null
      }
    },
  }
}
