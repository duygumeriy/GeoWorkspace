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
 * yeniden kullanılır; olay dinleyicisi ömür boyu BİR kez kaydedilir. Her
 * katılımda yeniden kaydetmek, aynı olayın iki kez işlenmesi demekti.
 *
 * <b>İzleme ile KAMERA TAKİBİ ayrı kavramlardır.</b> İstemci iki adlandırılmış
 * yuva tutar:
 * <ul>
 *   <li><code>follow</code> — kullanıcının açık <i>Takip Et</i> eylemi; kamera
 *       sahipliği buna bağlıdır.</li>
 *   <li><code>observe</code> — kullanıcının kendi başlattığı çalıştırmayı
 *       CANLI görmesi için pasif abonelik; kamerayı ASLA talep etmez.</li>
 * </ul>
 * İkisi aynı rotayı gösterse bile gruba <b>bir kez</b> katılınır ve grup,
 * yuvalardan hiçbiri onu istemez hâle gelene kadar bırakılmaz. Böylece ne
 * çift üyelik ne de ikinci bir bağlantı oluşur. `followingRouteId` bu yüzden
 * aşırı yüklenmez; iki yuva ayrı ayrı okunur.
 */

export const SIMULATION_UPDATED_EVENT = 'SimulationUpdated'
export const JOIN_ROUTE_METHOD = 'JoinRoute'
export const LEAVE_ROUTE_METHOD = 'LeaveRoute'

export const FOLLOW_SLOT = 'follow'
export const OBSERVE_SLOT = 'observe'

export function createTransportSimulationClient({ createConnection, onUpdate, onError } = {}) {
  if (typeof createConnection !== 'function') {
    throw new Error('createTransportSimulationClient requires a createConnection factory.')
  }

  let connection = null
  let startPromise = null
  let disposed = false

  const slots = { [FOLLOW_SLOT]: null, [OBSERVE_SLOT]: null }

  /* Yuva BAŞINA istek sırası. Kullanıcı hızlıca A → B → C takip ederse
     yalnızca EN SON isteğin sonucu uygulanır; yolda kalan eski bir cevabın
     yuvayı geri alması sessiz bir hata olurdu. Sıra yuva başınadır ki bir
     izleme isteği bir takip isteğini (veya tersini) iptal etmesin. */
  const slotSeq = { [FOLLOW_SLOT]: 0, [OBSERVE_SLOT]: 0 }

  const subscribedRoutes = () =>
    [...new Set(Object.values(slots).filter((routeId) => routeId != null))]

  /** Rota hâlâ herhangi bir yuva tarafından isteniyor mu? */
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

  const ensureStarted = async () => {
    if (disposed) throw new Error('Simülasyon bağlantısı kapatıldı.')

    if (!connection) {
      connection = createConnection()

      // Ömür boyu TEK kayıt.
      connection.on(SIMULATION_UPDATED_EVENT, emit)

      connection.onreconnected?.(async () => {
        /* Yeniden bağlanma grup üyeliğini KORUMAZ: sunucu tarafında bağlantı
           yeni bir kimliktir. GERÇEKTEN gereken her abonelik (takip ve/veya
           izleme) yeniden kurulur ve katılım cevabındaki güncel anlık görüntü
           uygulanır — böylece kullanıcı bir sonraki tick'i beklemeden doğru
           durumu görür. Aynı rota iki yuvada da olsa listede BİR kez bulunur. */
        for (const routeId of subscribedRoutes()) {
          try {
            const snapshot = await connection.invoke(JOIN_ROUTE_METHOD, routeId)
            if (isSubscribed(routeId)) emit(snapshot)
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
    try {
      await connection.invoke(LEAVE_ROUTE_METHOD, routeId)
    } catch (error) {
      // Ayrılamamak kullanıcıya gösterilecek bir arıza değildir: bağlantı
      // kapandığında grup üyeliği zaten sunucuda düşer.
      report(error)
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
      // Grup yalnızca DİĞER yuva da istemiyorsa bırakılır.
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

    if (isSubscribed(target)) {
      // Diğer yuva zaten katılmış: çift üyelik ÜRETİLMEZ.
      slots[slot] = target
      return null
    }

    const snapshot = await connection.invoke(JOIN_ROUTE_METHOD, target)

    if (requestId !== slotSeq[slot]) {
      /* Bu istek aşıldı: az önce katıldığımız grupta ASILI kalmamak için
         çıkılır — meğer ki diğer yuva o rotayı istiyor olsun. */
      if (!isSubscribed(target)) await leaveQuietly(target)
      return null
    }

    slots[slot] = target
    emit(snapshot)
    return snapshot ?? null
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

    /** Şu an gerçekten katılınmış grupların rota kimlikleri (tekrarsız). */
    get subscribedRouteIds() {
      return subscribedRoutes()
    },

    /**
     * Verilen rotayı takip etmeye başlar ve `JoinRoute`'un döndürdüğü GÜNCEL
     * anlık görüntüyü verir (çalışan simülasyon yoksa `null`).
     */
    follow(routeId) {
      return setSlot(FOLLOW_SLOT, routeId)
    },

    /** Takibi bırakır; bağlantı ve varsa PASİF izleme olduğu gibi kalır. */
    async unfollow() {
      await setSlot(FOLLOW_SLOT, null)
    },

    /**
     * Rotayı kamerasız izlemeye başlar: kullanıcının başlattığı çalıştırma
     * canlı akar ama görünüm kullanıcının elinde kalır.
     */
    observe(routeId) {
      return setSlot(OBSERVE_SLOT, routeId)
    },

    /** Pasif izlemeyi bırakır; açık takip varsa ona DOKUNMAZ. */
    async stopObserving() {
      await setSlot(OBSERVE_SLOT, null)
    },

    /** Oturum kapanışı / bileşen sökülmesi: tüm üyelikler ve bağlantı bırakılır. */
    async dispose() {
      if (disposed) return
      disposed = true
      slotSeq[FOLLOW_SLOT] += 1
      slotSeq[OBSERVE_SLOT] += 1

      const previous = subscribedRoutes()
      slots[FOLLOW_SLOT] = null
      slots[OBSERVE_SLOT] = null

      if (!connection) return

      for (const routeId of previous) await leaveQuietly(routeId)
      connection.off?.(SIMULATION_UPDATED_EVENT, emit)

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
