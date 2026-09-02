/**
 * Simülasyonun ARAYÜZ tarafındaki saf durumu: normalleştirme, sıralama
 * güvenliği ve hangi denetimin görüneceği.
 *
 * <b>Neden ayrı ve saf.</b> Canlı bir kanalda olayların sırası garanti
 * değildir: geç kalmış bir `SimulationUpdated`, yavaş dönen bir `JoinRoute`
 * cevabı ya da yeniden bağlanma sonrası gelen bir anlık görüntü, ekrandaki
 * daha yeni durumu geri saracak şekilde gelebilir. Bu kararların bir React
 * bileşeninin içine gömülmesi, onları yalnızca tarayıcıda ve elle
 * sınanabilir kılardı; burada saf fonksiyonlar olarak dururlar.
 */

export const SIMULATION_STATUS = Object.freeze({
  RUNNING: 'Running',
  /* DURAKLATILDI ve TERMİNAL DEĞİLDİR: çalıştırma hattın aktif yuvasını işgal
     etmeye devam eder, aynı kimlikle sürdürülür ve "çalışmıyor" ile
     karıştırılmamalıdır. */
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
})

/* Terminal küme BÜYÜMEZ: yalnızca biten çalıştırmalar. Duraklatma buraya
   girseydi gözlem bırakılır, takip düşer ve panel hattı boş sanardı. */
const TERMINAL_STATUSES = new Set([SIMULATION_STATUS.COMPLETED, SIMULATION_STATUS.CANCELLED])

const STATUS_LABELS = Object.freeze({
  [SIMULATION_STATUS.RUNNING]: 'Çalışıyor',
  [SIMULATION_STATUS.PAUSED]: 'Duraklatıldı',
  [SIMULATION_STATUS.COMPLETED]: 'Tamamlandı',
  [SIMULATION_STATUS.CANCELLED]: 'İptal edildi',
})

/** Duraklatılmış mı? Terminal DEĞİLDİR. */
export function isPausedSimulationStatus(status) {
  return status === SIMULATION_STATUS.PAUSED
}

/** Çalıştırma bitti mi? Bitmiş bir çalıştırma "aktif" sayılmaz. */
export function isTerminalSimulationStatus(status) {
  return TERMINAL_STATUSES.has(status)
}

export function simulationStatusLabel(status) {
  return STATUS_LABELS[status] ?? 'Bilinmiyor'
}

function finiteNumber(value) {
  /* `Number(null)` ve `Number('')` SIFIR verir. Bu, "değer yok" ile "değer 0"
     ayrımını yok eder: seçili güzergah yokken routeId sessizce 0. rotaya
     dönüşür ve seçim yapılmamışken denetimler görünürdü. Boş girdi burada
     ayrıştırılmadan önce elenir. */
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function clampPercent(value) {
  const number = finiteNumber(value)
  if (number === null) return 0
  return Math.min(100, Math.max(0, number))
}

/** Zaman damgasını karşılaştırılabilir sayıya çevirir; okunamıyorsa `null`. */
function timestamp(value) {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalize({ simulationId, routeId, status, longitude, latitude, progressPercent, updatedAtUtc }) {
  const id = simulationId ?? null
  const route = finiteNumber(routeId)
  if (!id || route === null) return null

  return Object.freeze({
    simulationId: id,
    routeId: route,
    status: status ?? SIMULATION_STATUS.RUNNING,
    longitude: finiteNumber(longitude) ?? 0,
    latitude: finiteNumber(latitude) ?? 0,
    progressPercent: clampPercent(progressPercent),
    updatedAtUtc: updatedAtUtc ?? null,
  })
}

/**
 * SignalR `SimulationUpdated` yükünü arayüz durumuna çevirir.
 *
 * Sözleşme Faz 2'de tanımlıdır ve yalnızca istemcinin ihtiyacı olanı taşır;
 * burada da fazlası okunmaz.
 */
export function normalizeLiveUpdate(update) {
  if (!update) return null
  return normalize(update)
}

/**
 * REST anlık görüntüsünü (`GET /api/transport/simulations/routes/{id}`) aynı
 * biçime çevirir.
 *
 * <b>DURUM UYDURULMAZ.</b> Eskiden burada koşulsuz `Running` yazılıyordu:
 * REST yalnızca çalışan bir simülasyon için 200 döndüğü ve o gün başka bir
 * canlı durum bulunmadığı için doğru sayılıyordu. `Paused` eklendikten sonra
 * bu varsayım YANLIŞ oldu — duraklatılmış bir hattın REST okuması onu
 * "çalışıyor" diye bildiriyordu. Durum artık sunucudan gelirse ONDAN okunur;
 * yük durumu taşımıyorsa (mevcut DTO taşımıyor) `Running`'e düşülür ve
 * gerçeği canlı kanaldaki otoriter anlık görüntü düzeltir.
 *
 * İlerleme REST'te oran, canlı yayında yüzdedir; iki ölçünün arayüzde
 * karışmaması için burada tek biçime indirgenir.
 */
export function normalizeStatusSnapshot(snapshot) {
  if (!snapshot) return null
  return normalize({
    simulationId: snapshot.simulationId,
    routeId: snapshot.routeId,
    status: snapshot.status ?? SIMULATION_STATUS.RUNNING,
    longitude: snapshot.longitude,
    latitude: snapshot.latitude,
    progressPercent: clampPercent((finiteNumber(snapshot.progressRatio) ?? 0) * 100),
    updatedAtUtc: snapshot.capturedAt ?? null,
  })
}

/**
 * Yeni gelen durumu mevcut durumla birleştirir. TEK yazma kuralı budur.
 *
 * Kurallar:
 * <ul>
 *   <li><b>Farklı <code>simulationId</code> yeni bir çalıştırmadır</b> ve
 *       kabul edilir — ilerlemesi daha düşük olsa bile; ancak KANITLANABİLİR
 *       biçimde eskiyse (zaman damgası geriye gidiyorsa) yok sayılır, çünkü o
 *       bir önceki çalıştırmanın gecikmiş olayıdır.</li>
 *   <li><b>Aynı çalıştırmada zaman geriye akmaz:</b> daha eski damgalı olay
 *       yok sayılır.</li>
 *   <li><b>Aynı çalıştırmada ilerleme geri sarmaz.</b></li>
 *   <li><b>Bitiş (tamamlandı/iptal) kazanır:</b> daha eski olmadığı sürece
 *       çalıştırmayı sonlandırır.</li>
 * </ul>
 */
export function mergeSimulationState(current, incoming) {
  if (!incoming) return current
  if (!current) return incoming

  // Durum rota BAŞINA tutulur; başka bir rotanın olayı buraya yazılmaz.
  if (current.routeId !== incoming.routeId) return current

  const incomingTime = timestamp(incoming.updatedAtUtc)
  const currentTime = timestamp(current.updatedAtUtc)
  const isOlder = incomingTime !== null && currentTime !== null && incomingTime < currentTime

  if (incoming.simulationId !== current.simulationId) {
    return isOlder ? current : incoming
  }

  if (isOlder) return current

  /* DURAKLATILMIŞ durumu, KESİN OLARAK daha yeni olmayan bir `Running`
     olayı geri alamaz. Sunucu duraklatma/sürdürme geçişlerinde damgayı
     tazeler, bu yüzden gerçek bir "Devam Ettir" olayı her zaman daha
     yenidir; yolda kalmış bir tick ise eşit ya da eski damga taşır ve
     burada elenir. Duraklatma TERMİNAL DEĞİLDİR — bu yüzden aşağıdaki
     terminal kilidi bu durumu kapsayamaz. */
  if (isPausedSimulationStatus(current.status)
    && incoming.status === SIMULATION_STATUS.RUNNING
    && !(incomingTime !== null && currentTime !== null && incomingTime > currentTime)) {
    return current
  }

  /* AYNI çalıştırma bir kez bittiyse GERİ DÖNMEZ. Zaman damgası tek başına
     yetmiyor: terminal anlık görüntü son Running tick'iyle AYNI damgayı
     taşır, dolayısıyla sırası bozulmuş bir Running olayı "daha eski"
     sayılmaz ve eski kural onu kabul ederdi — bitmiş bir çalıştırma yeniden
     yürüyor görünürdü.

     Kilit ÇALIŞTIRMAYA ÖZELDİR: yukarıdaki dal farklı `simulationId`'yi
     zaten yeni bir çalıştırma olarak kabul eder, bu yüzden aynı hatta
     başlayan YENİ çalıştırma B bu kuraldan ETKİLENMEZ. */
  if (isTerminalSimulationStatus(current.status)) return current

  if (isTerminalSimulationStatus(incoming.status)) return incoming

  /* İlerleme GERİLEMEZ; eşit kalması ise meşrudur ve bu fazda zorunludur:
     Duraklat/Devam Ettir geçişleri aracı hiç oynatmaz, dolayısıyla aynı
     yüzdeyle gelir. Sıkı "artmalı" kuralı o geçişleri sessizce düşürürdü. */
  if (incoming.progressPercent < current.progressPercent) return current

  return incoming
}

/**
 * Kullanıcının durdurmak İSTEDİĞİ çalıştırmanın YAKALANMIŞ kimliği.
 *
 * <b>Neden bir nesne, bir bayrak değil.</b> Onay kutusu açıkken dünya
 * değişebilir: A çalıştırması bitip AYNI rotada B başlayabilir. Bekleyen
 * durum yalnızca "onay açık mı" bilgisini taşısaydı, onay anında o anki
 * kimlik okunur ve kullanıcının A için verdiği karar sessizce B'yi
 * durdururdu. Niyet bu yüzden TETİKLEME anında dondurulur.
 *
 * <b>Rota tek başına bir niyet DEĞİLDİR.</b> İkisinden biri eksikse
 * <c>null</c> döner; böylece "şu hatta ne çalışıyorsa durdur" biçiminde bir
 * bekleyen niyet KURULAMAZ.
 */
export function sharedStopIntent({ routeId = null, simulationId = null } = {}) {
  const route = finiteNumber(routeId)
  if (route === null) return null
  if (typeof simulationId !== 'string' || simulationId.length === 0) return null

  return Object.freeze({ routeId: route, simulationId })
}

/**
 * Yakalanmış niyet HÂLÂ o anki çalıştırmaya mı işaret ediyor?
 *
 * <b>Eşitlik İKİ eksende birden aranır.</b> Rota değişmişse kullanıcı artık
 * başka bir hatta bakıyordur; çalıştırma kimliği değişmişse A bitmiş ve
 * yerine B geçmiştir. İkisinde de doğru cevap komutu GÖNDERMEMEKTİR —
 * yakalanan kimliği o anki kimlikle DEĞİŞTİRMEK, kullanıcının hiç vermediği
 * bir kararı uygulamak olurdu.
 *
 * Sunucu yine son sözü söyler (yetki + rota + çalıştırma kimliği + atomik
 * denetim); buradaki kural KULLANICI NİYETİNİ korur, sunucunun yetkisini
 * değil.
 */
export function sharedStopIntentIsCurrent(intent, { routeId = null, stoppableSimulationId = null } = {}) {
  if (!intent) return false

  const current = sharedStopIntent({ routeId, simulationId: stoppableSimulationId })
  if (!current) return false

  return current.routeId === intent.routeId && current.simulationId === intent.simulationId
}

/**
 * Seçili güzergah için hangi denetimin görüneceği.
 *
 * <b>Yalnızca ETKİN yetki koduna bakar.</b> Rol/kullanıcı kimliğine ya da
 * ayrıcalık bayraklarına dayanan hiçbir kestirme burada YOKTUR ve olmamalıdır:
 * bunlar arayüzü backend'in gerçek kuralından ayrı bir kural kitabına
 * bağlardı. Görünürlük yalnızca DENEYİMDİR — düğmeyi gizlemek yetkilendirme
 * değildir; backend aynı isteğe 403 döndürmeye devam eder.
 */
export function transportSimulationControls({
  routeId = null,
  simulation = null,
  followingRouteId = null,
  canStart = false,
  canStop = false,
  starting = false,
  stopping = false,
  pausing = false,
  resuming = false,
  following = false,
} = {}) {
  const route = finiteNumber(routeId)
  const active = route !== null
    && simulation != null
    && simulation.routeId === route
    && !isTerminalSimulationStatus(simulation.status)

  const isFollowing = route !== null && followingRouteId === route

  /* Durdurma komutu ÇALIŞTIRMA KİMLİĞİ ister; kimlik bilinmiyorsa düğme hiç
     sunulmaz. Rota tek başına yeterli olsaydı, eski bir sekme yerine geçmiş
     YENİ bir çalıştırmayı durdurabilirdi — o yüzden kimlik burada bir
     GÖRÜNÜRLÜK koşuludur, sonradan yapılan bir doğrulama değil. */
  const stoppableSimulationId = active ? simulation.simulationId ?? null : null

  /* DURAKLATILMIŞ da AKTİFTİR (terminal değildir), bu yüzden `active`
     içindedir; ayrım yalnızca hangi yaşam döngüsü düğmesinin sunulacağıdır. */
  const paused = active && isPausedSimulationStatus(simulation.status)

  return {
    isActive: active,
    isFollowing,
    // Çalışan bir simülasyon varken başlatma sunulmaz: backend zaten 409 döner.
    showStart: route !== null && canStart === true && !active,
    startDisabled: starting === true,

    /* BAŞLATMA ile DURDURMA birbirini İMA ETMEZ: `canStop` ayrı bir etkin
       yetkiden (`transport.simulation.stop`) gelir ve `canStart`'a hiç
       bakmaz. Görünürlük yalnızca DENEYİMDİR — backend yetkisiz isteğe 403
       döndürmeye devam eder. */
    isPaused: paused,

    /* ÜÇ yaşam döngüsü eylemi de AYNI yetkiye (`transport.simulation.stop`)
       bağlıdır ve `canStart`'tan türetilmez. Duraklat yalnızca çalışırken,
       Devam Ettir yalnızca duraklatılmışken sunulur; Sıfırla ikisinde de
       geçerlidir çünkü her ikisi de canlı bir çalıştırmadır. */
    showPause: active && !paused && canStop === true && stoppableSimulationId !== null,
    showResume: paused && canStop === true && stoppableSimulationId !== null,
    pauseDisabled: pausing === true || resuming === true,

    /* Terminal eylem: arayüzde "Sıfırla" olarak sunulur. Ürün anlamı
       "çalıştırmayı bitir ve hattı yeniden başlatılabilir hâle getir"dir;
       backend sözleşmesi (Stop) DEĞİŞMEZ. */
    showStop: active && canStop === true && stoppableSimulationId !== null,
    stopDisabled: stopping === true,
    stoppableSimulationId,

    /* Duraklatılmış çalıştırma da takip EDİLEBİLİR: aynı canlı çalıştırmadır,
       yalnızca hareket etmiyordur. */
    showFollow: active && !isFollowing,

    /* TAKİBİ BIRAK yalnızca AKTİF bir çalıştırmada anlamlıdır. Eskiden
       koşul yalnızca `isFollowing` idi; çalıştırma bittiğinde ekranda aynı
       anda "Aktif simülasyon yok" ve "Takibi Bırak" görünüyordu — üstelik o
       düğmeye basmak rotanın SignalR grubundan çıkmaya yol açıyor ve aynı
       hatta başlayan YENİ çalıştırma sayfaya hiç ulaşmıyordu. Kamera
       sahipliğinin terminal durumda bırakılması artık kancanın işidir ve
       ABONELİĞİ KORUYARAK yapılır. */
    showUnfollow: active && isFollowing,
    followDisabled: following === true,
    statusLabel: simulation && simulation.routeId === route
      ? simulationStatusLabel(simulation.status)
      : null,
    progressPercent: active ? simulation.progressPercent : null,
    progressLabel: active ? `%${Math.round(simulation.progressPercent)}` : null,
  }
}
