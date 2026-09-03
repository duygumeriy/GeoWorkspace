import {
  isPausedSimulationStatus,
  isTerminalSimulationStatus,
  mergeSimulationState,
  normalizeStatusSnapshot,
  simulationStatusLabel,
} from './transportSimulationState.js'

/**
 * AKTİF paylaşılan simülasyonların SAF çekirdeği (Faz 4A + 4B).
 *
 * <b>BEŞ kavram BİRBİRİNDEN bağımsızdır ve bu dosya karışmalarını yapısal
 * olarak engeller:</b>
 * <ul>
 *   <li><b>AKTİF</b> — sunucu gerçeği: şu anda çalışan ya da duraklatılmış
 *       tüm paylaşılan çalıştırmalar.</li>
 *   <li><b>İZLENEN</b> — kullanıcının haritada ARAÇ olarak görmeyi seçtiği
 *       çalıştırmalar. Sıfır, bir, birkaç ya da hepsi olabilir.</li>
 *   <li><b>SEÇİLİ</b> — ayrıntı/denetim bağlamına sahip TEK hat. Yalnızca
 *       sunumdur.</li>
 *   <li><b>TAKİP EDİLEN</b> — kamerayı elinde tutan EN FAZLA bir araç.</li>
 *   <li><b>YÖNETİM SEÇİMİ</b> (Faz 4B) — kullanıcının TOPLU yaşam döngüsü
 *       komutu uygulamayı seçtiği çalıştırmalar.</li>
 * </ul>
 *
 * <b>İzlemek seçmek değildir, seçmek takip etmek değildir, yönetim seçimi de
 * bunların hiçbiri değildir.</b> Bir hattı izlemeye almak onu toplu komut
 * hedefi yapmaz; bir hattı yönetim için seçmek haritada araç çizdirmez, hattı
 * seçili hâle getirmez ve kamerayı ele geçirmez. Bir çalıştırma HARİTADA HİÇ
 * GÖRÜNMEDEN yönetilebilir; görünen bir araç da yönetim seçiminde olmayabilir.
 *
 * <b>İkinci bir durum makinesi YOKTUR.</b> Gelen her durum, mevcut tek
 * birleştirme kuralından (<code>mergeSimulationState</code>) geçer; burada
 * "aktif liste için ayrı bir birleştirme" yazılmaz — o kural sıralama ve
 * eskime garantilerinin tek sahibidir.
 *
 * <b>Yetki burada YOKTUR.</b> Bu dosya kimin ne görebileceğine karar vermez;
 * yalnızca sunucudan gelmiş veriyi düzenler.
 */

function finiteId(value) {
  /* `Number(null)` ve `Number('')` SIFIR verir; "seçim yok" ile "0. rota"
     ayrımı bu yüzden ayrıştırmadan ÖNCE yapılır. */
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/** Aktif çalıştırma mı? Duraklatılmış çalıştırma AKTİFTİR. */
function isActiveState(state) {
  return Boolean(state) && !isTerminalSimulationStatus(state.status)
}

/**
 * `GET /api/transport/simulations/active` yanıtını kanonik duruma çevirir.
 *
 * Her satır, TEK rota okumasıyla AYNI normalleştirmeden geçer
 * (<code>normalizeStatusSnapshot</code>): ikinci bir alan eşlemesi, iki okuma
 * yolunun zamanla ayrışması demekti. Okunamayan ya da terminal satırlar
 * düşürülür — sunucu terminal satır göndermemelidir, ama istemci ona
 * GÜVENMEK zorunda değildir.
 */
export function normalizeActiveSimulationList(payload) {
  if (!Array.isArray(payload)) return []

  const seen = new Set()
  const result = []

  for (const item of payload) {
    const state = normalizeStatusSnapshot(item)
    if (!isActiveState(state)) continue
    // Rota BAŞINA en fazla bir çalıştırma: sunucu değişmezi burada da korunur.
    if (seen.has(state.routeId)) continue
    seen.add(state.routeId)
    result.push(state)
  }

  return result
}

/** Kanonik sözlükten türetilen AKTİF rota kimlikleri (artan sırada). */
export function activeRouteIdsOf(byRoute = {}) {
  return Object.values(byRoute)
    .filter(isActiveState)
    .map((state) => state.routeId)
    .sort((left, right) => left - right)
}

/**
 * Aktif liste okumasını KANONİK sözlüğe uygular.
 *
 * <b>Yanıt bir ANIN gerçeğidir.</b> O anda listede olmayan bir rota artık
 * aktif değildir ve sözlükte "çalışıyor" gibi bırakılamaz — panel bayat bir
 * durumu güncel diye gösterirdi. Bu yüzden yanıtta bulunmayan girdiler
 * TEMİZLENİR.
 *
 * <b>Ama okuma sırasında öğrenilenler KORUNUR.</b> İstek yolda iken canlı
 * kanaldan yeni bir hattın (D) olayı gelmiş olabilir; yanıt onu içermez çünkü
 * sunucu tarafında henüz başlamamıştı. Körü körüne temizlemek, D'nin bir daha
 * hiç görünmemesi demekti. <code>protectedRouteIds</code> tam olarak bu
 * yarışı kapatır: çağıran, isteği gönderdikten SONRA canlı olay aldığı
 * rotaları bildirir.
 */
export function applyActiveSimulationList({
  byRoute = {},
  list = [],
  protectedRouteIds = [],
} = {}) {
  const incoming = normalizeActiveSimulationList(list)
  const responseRouteIds = new Set(incoming.map((state) => state.routeId))
  const guarded = new Set(
    protectedRouteIds.map(finiteId).filter((routeId) => routeId !== null),
  )

  const next = { ...byRoute }

  /* TEK yazma kuralı: aktif liste de sıralama/eskime denetiminden geçer.
     Yolda kalmış bir okuma, canlı kanaldan gelmiş DAHA YENİ bir durumu geri
     saramaz. */
  for (const state of incoming) {
    next[state.routeId] = mergeSimulationState(next[state.routeId] ?? null, state)
  }

  for (const key of Object.keys(next)) {
    const routeId = finiteId(key)
    if (routeId === null) continue
    if (responseRouteIds.has(routeId) || guarded.has(routeId)) continue
    if (next[key] == null) continue
    next[key] = null
  }

  return { byRoute: next, activeRouteIds: activeRouteIdsOf(next) }
}

/* --- İZLEME (watch) ----------------------------------------------------------
   İzleme seçimi ROTA anahtarlıdır çünkü rota başına en fazla bir aktif
   çalıştırma vardır ve kullanıcı "şu hattı izle" der. Ama saklanan DEĞER
   ÇALIŞTIRMA KİMLİĞİDİR ve bu zorunludur: A biter, aynı hatta B başlarsa,
   yalnızca rota kimliği tutulsaydı B kullanıcının hiç vermediği bir kararla
   izleniyor sayılırdı. Kimlik eşleşmesi bu devralmayı YAPISAL olarak
   engeller. */

/** İzlenen rota kimlikleri (artan sırada). */
export function watchedRouteIdsOf(watchedRuns = {}) {
  return Object.keys(watchedRuns)
    .map(finiteId)
    .filter((routeId) => routeId !== null && watchedRuns[routeId] != null)
    .sort((left, right) => left - right)
}

export function isRouteWatched(watchedRuns = {}, routeId = null) {
  const id = finiteId(routeId)
  return id !== null && watchedRuns[id] != null
}

/**
 * Bir çalıştırmanın izlenmesini açar/kapatır.
 *
 * Niyet TETİKLEME anında dondurulur: hangi ÇALIŞTIRMANIN izlendiği kaydedilir,
 * "şu hatta ne varsa" değil.
 */
export function toggleWatchedRun(watchedRuns = {}, { routeId = null, simulationId = null } = {}) {
  const id = finiteId(routeId)
  if (id === null) return watchedRuns

  if (watchedRuns[id] != null) {
    const next = { ...watchedRuns }
    delete next[id]
    return next
  }

  if (typeof simulationId !== 'string' || simulationId.length === 0) return watchedRuns

  return { ...watchedRuns, [id]: simulationId }
}

/**
 * Bir çalıştırmanın izlendiğinden EMİN OLUR (idempotent).
 *
 * <b>Neden gerekli.</b> Kamera görünür bir araç ister: <i>Takip Et</i>, aracı
 * çizilmeyen bir çalıştırma için basıldığında kullanıcıyı boş bir haritaya
 * bakarken bırakırdı. Bu yüzden takip, izlemeyi İMA EDER — ama tersi değil.
 *
 * <b>Aynı hattaki ESKİ kayıt yenisiyle DEĞİŞTİRİLİR:</b> A bitip yerine B
 * geçmişken B takip edilirse, hattın izleme kaydı B'yi göstermelidir; aksi
 * hâlde uzlaştırma kaydı bayat sayıp düşürür ve araç anında kaybolurdu.
 */
export function ensureWatchedRun(watchedRuns = {}, { routeId = null, simulationId = null } = {}) {
  const id = finiteId(routeId)
  if (id === null) return watchedRuns
  if (typeof simulationId !== 'string' || simulationId.length === 0) return watchedRuns
  if (watchedRuns[id] === simulationId) return watchedRuns

  return { ...watchedRuns, [id]: simulationId }
}

/**
 * TÜMÜNÜ İZLE: o ANDA aktif olan her çalıştırmayı izlemeye alır.
 *
 * <b>Gelecekteki çalıştırmalar KAPSAM DIŞIDIR.</b> "Hepsi" kalıcı bir kural
 * değil, o anki kümeye verilmiş bir karardır; sonradan başlayan C listede
 * belirir ama izlenmez. Aksi hâlde kullanıcı, hiç görmediği bir hattın
 * aracının haritasına düşmesine sessizce razı olmuş sayılırdı.
 */
export function watchAllActiveRuns(byRoute = {}) {
  const next = {}
  for (const state of Object.values(byRoute)) {
    if (!isActiveState(state)) continue
    next[state.routeId] = state.simulationId
  }
  return next
}

/** İZLEMEYİ TEMİZLE: yalnızca sunum; hiçbir simülasyona dokunmaz. */
export function clearWatchedRuns() {
  return {}
}

/**
 * İzleme seçimini SUNUCU GERÇEĞİYLE uzlaştırır.
 *
 * İki durumda giriş düşer:
 * <ul>
 *   <li>çalıştırma artık aktif değil (bitti/iptal edildi) — ölü bir işaretçi
 *       haritada bırakılmaz;</li>
 *   <li>hattaki çalıştırma DEĞİŞTİ — yerine geçen B, A için verilmiş izleme
 *       kararını DEVRALMAZ.</li>
 * </ul>
 */
export function reconcileWatchedRuns(watchedRuns = {}, byRoute = {}) {
  const next = {}
  let changed = false

  for (const key of Object.keys(watchedRuns)) {
    const routeId = finiteId(key)
    const simulationId = watchedRuns[key]
    const state = routeId === null ? null : byRoute[routeId] ?? null

    if (isActiveState(state) && state.simulationId === simulationId) {
      next[routeId] = simulationId
    } else {
      changed = true
    }
  }

  return changed ? next : watchedRuns
}

/* --- YÖNETİM SEÇİMİ (Faz 4B) --------------------------------------------------
   İZLEME ile AYNI veri biçimi ama AYRI bir kutu: rota anahtarlı, ÇALIŞTIRMA
   değerli. Aynı biçimi paylaşmaları onları aynı kavram yapmaz — biri haritada
   ne çizileceğine, diğeri hangi çalıştırmaya komut gideceğine karar verir ve
   ikisini tek kutuda toplamak "gördüğüm her aracı yönetiyorum" (ya da tersi)
   demek olurdu.

   YALNIZCA rota kimliği tutmak YETMEZ: A biter, aynı hatta B başlarsa,
   kullanıcının A için verdiği yönetim kararı B'ye geçer ve toplu bir Sıfırla
   hiç seçilmemiş bir çalıştırmayı bitirirdi. Kimlik eşleşmesi bu devralmayı
   YAPISAL olarak engeller. */

/** Toplu yaşam döngüsü işlemlerinin KANONİK adları. */
export const LIFECYCLE_OPERATIONS = Object.freeze({
  PAUSE: 'pause',
  RESUME: 'resume',
  RESET: 'reset',
  RESTART: 'restart',
})

/** Sunumun izlediği sabit sıra: önce sürdüren, sonra yıkıcı olan. */
const LIFECYCLE_ORDER = Object.freeze([
  LIFECYCLE_OPERATIONS.PAUSE,
  LIFECYCLE_OPERATIONS.RESUME,
  LIFECYCLE_OPERATIONS.RESET,
  LIFECYCLE_OPERATIONS.RESTART,
])

/** Yönetim seçimindeki rota kimlikleri (artan sırada). */
export function managedRouteIdsOf(managedRuns = {}) {
  return Object.keys(managedRuns)
    .map(finiteId)
    .filter((routeId) => routeId !== null && managedRuns[routeId] != null)
    .sort((left, right) => left - right)
}

export function isRouteManaged(managedRuns = {}, routeId = null) {
  const id = finiteId(routeId)
  return id !== null && managedRuns[id] != null
}

/**
 * Yönetim seçimini açar/kapatır.
 *
 * <b>Hiçbir şeyi tetiklemez.</b> Sunucuya istek gitmez, izleme değişmez, hat
 * seçilmez, kamera talep edilmez: bu yalnızca "bu çalıştırmayı toplu komut
 * hedefi say" demektir. Niyet TETİKLEME anında dondurulur — kaydedilen şey
 * ÇALIŞTIRMA kimliğidir, "şu hatta ne varsa" değil.
 */
export function toggleManagedRun(managedRuns = {}, { routeId = null, simulationId = null } = {}) {
  const id = finiteId(routeId)
  if (id === null) return managedRuns

  if (managedRuns[id] != null) {
    const next = { ...managedRuns }
    delete next[id]
    return next
  }

  if (typeof simulationId !== 'string' || simulationId.length === 0) return managedRuns

  return { ...managedRuns, [id]: simulationId }
}

/**
 * AKTİFLERİ SEÇ: o ANDA aktif olan her çalıştırmayı yönetim seçimine alır.
 *
 * <b>TÜMÜNÜ İZLE ile aynı şey DEĞİLDİR</b> ve arayüzde de öyle sunulmaz: biri
 * haritada araç açar, bu ise komut hedefi belirler. Ortak olan tek şey kapsam
 * kuralıdır — <b>gelecekteki çalıştırmalar KAPSAM DIŞIDIR</b>: sonradan
 * başlayan D listede belirir ama yönetim seçimine kendiliğinden GİRMEZ.
 * Aksi hâlde kullanıcı, hiç görmediği bir hattın sıfırlanmasına sessizce razı
 * olmuş sayılırdı.
 */
export function manageAllActiveRuns(byRoute = {}) {
  const next = {}
  for (const state of Object.values(byRoute)) {
    if (!isActiveState(state)) continue
    next[state.routeId] = state.simulationId
  }
  return next
}

/** SEÇİMİ TEMİZLE: yalnızca yönetim seçimi düşer; izleme ve takip DOKUNULMAZ. */
export function clearManagedRuns() {
  return {}
}

/**
 * Yönetim seçimini SUNUCU GERÇEĞİYLE uzlaştırır.
 *
 * İzleme ile aynı iki kural: çalıştırma terminal olduysa ya da hattaki
 * çalıştırma DEĞİŞTİYSE giriş düşer. Yeniden başlatmada B, A için verilmiş
 * yönetim kararını DEVRALMAZ — kullanıcı onu ayrıca seçmelidir.
 */
export function reconcileManagedRuns(managedRuns = {}, byRoute = {}) {
  const next = {}
  let changed = false

  for (const key of Object.keys(managedRuns)) {
    const routeId = finiteId(key)
    const simulationId = managedRuns[key]
    const state = routeId === null ? null : byRoute[routeId] ?? null

    if (isActiveState(state) && state.simulationId === simulationId) {
      next[routeId] = simulationId
    } else {
      changed = true
    }
  }

  return changed ? next : managedRuns
}

/**
 * Yönetim seçiminin GEÇERLİ hedefleri: `{ routeId, simulationId }` çiftleri.
 *
 * <b>Bayat kayıt hedefe DÖNÜŞMEZ.</b> Sözlükte hâlâ `R -> A` yazıyor olsa bile
 * hattaki güncel çalıştırma B ise o giriş burada düşer; komut yolu asla
 * "hattaki güncel olan" ile ikame yapmaz.
 */
export function managedRunTargets(managedRuns = {}, byRoute = {}) {
  return managedRouteIdsOf(managedRuns)
    .map((routeId) => {
      const state = byRoute[routeId] ?? null
      if (!isActiveState(state)) return null
      if (state.simulationId !== managedRuns[routeId]) return null
      return Object.freeze({ routeId, simulationId: state.simulationId, status: state.status })
    })
    .filter(Boolean)
}

/** Bir çalıştırma, verilen işlem için UYGUN mu? */
function isEligibleFor(operation, status) {
  if (operation === LIFECYCLE_OPERATIONS.PAUSE) return !isPausedSimulationStatus(status)
  if (operation === LIFECYCLE_OPERATIONS.RESUME) return isPausedSimulationStatus(status)
  // Sıfırla ve Yeniden Başlat CANLI bir çalıştırmanın ikisinde de geçerlidir.
  return true
}

/**
 * Bir işlemin UYGUN hedefleri.
 *
 * <b>Açıkça uygun olmayan hedef GÖNDERİLMEZ.</b> Duraklatılmış bir hattı
 * "duraklat" diye yollamak, kaçınılabilir bir hata almak ve kullanıcıya
 * kendisinin yol açmadığı bir başarısızlık göstermek olurdu. Sunucu yine de
 * durumu DOĞRULAR: istemci durumu bayat olabilir ve son söz sunucunundur.
 */
export function eligibleLifecycleTargets(operation, { managedRuns = {}, byRoute = {} } = {}) {
  return managedRunTargets(managedRuns, byRoute)
    .filter((target) => isEligibleFor(operation, target.status))
    .map((target) => Object.freeze({ routeId: target.routeId, simulationId: target.simulationId }))
}

/**
 * ONAY/KOMUT NİYETİ: işlem + hedeflerin TAM kimlikleri, TETİKLEME anında
 * dondurulmuş.
 *
 * <b>Yalnızca rota listesi TAŞINMAZ.</b> Onay kutusu açıkken A bitip yerine B
 * geçebilir; niyet rota taşısaydı onay anında o anki kimlik okunur ve
 * kullanıcının A için verdiği karar sessizce B'ye uygulanırdı. Bu, paylaşılan
 * Sıfırla akışında zaten kullanılan ilkenin aynısıdır — yalnızca çoğul hâli.
 */
export function lifecycleIntent(operation, { managedRuns = {}, byRoute = {} } = {}) {
  const targets = eligibleLifecycleTargets(operation, { managedRuns, byRoute })
  if (targets.length === 0) return null

  return Object.freeze({ operation, targets: Object.freeze(targets) })
}

/**
 * Dondurulmuş niyetin SUNUCUYA gidecek gövdesi.
 *
 * Hedefler onay anında YENİDEN HESAPLANMAZ: gövde, niyetin içindeki kimlikleri
 * olduğu gibi taşır.
 */
export function lifecycleRequestTargets(intent) {
  if (!intent || !Array.isArray(intent.targets)) return []
  return intent.targets.map(({ routeId, simulationId }) => ({ routeId, simulationId }))
}

/* --- UÇUŞ HALİNDEKİ KOMUTLAR --------------------------------------------------
   Küresel tek bir `isMutating` bayrağı, bir hattın komutu yoldayken İLGİSİZ
   hatların denetimlerini de kilitlerdi. Bekleme durumu bu yüzden ÇALIŞTIRMA +
   İŞLEM kırılımındadır: aynı komut iki kez gönderilemez, komşusu ise serbest
   kalır. */

/** Bekleme anahtarı: `routeId:simulationId:operation`. */
export function lifecyclePendingKey({ routeId = null, simulationId = null, operation = '' } = {}) {
  const id = finiteId(routeId)
  if (id === null) return null
  if (typeof simulationId !== 'string' || simulationId.length === 0) return null
  if (!operation) return null
  return `${id}:${simulationId}:${operation}`
}

export function isLifecyclePending(pending = {}, target = null, operation = '') {
  const key = lifecyclePendingKey({ ...(target ?? {}), operation })
  return key !== null && pending[key] === true
}

/** Verilen hedeflerin/işlemin bekleme kaydını açar ya da kapatır. */
export function withLifecyclePending(pending = {}, operation, targets = [], value = true) {
  const next = { ...pending }

  for (const target of targets) {
    const key = lifecyclePendingKey({ ...target, operation })
    if (key === null) continue
    if (value) next[key] = true
    else delete next[key]
  }

  return next
}

/* --- TOPLU SONUCUN OKUNMASI ----------------------------------------------------
   Kısmi başarı GERÇEKTİR ve gizlenmez. Rotalar bağımsızdır; biri bayat çıktı
   diye diğerlerinin uygulanmış komutu geri alınmaz — dolayısıyla "hepsi oldu"
   ya da "hiçbiri olmadı" demek kullanıcıya YANLIŞ bir dünya anlatırdı. */

const OPERATION_LABELS = Object.freeze({
  [LIFECYCLE_OPERATIONS.PAUSE]: 'Duraklatma',
  [LIFECYCLE_OPERATIONS.RESUME]: 'Devam ettirme',
  [LIFECYCLE_OPERATIONS.RESET]: 'Sıfırlama',
  [LIFECYCLE_OPERATIONS.RESTART]: 'Yeniden başlatma',
})

/** Bayatlık, kullanıcının hatası değildir ve ayrı bir cümleyle anlatılır. */
const STALE_CODES = new Set(['Stale', 'NoActiveSimulation'])

/**
 * Sunucunun toplu yanıtını TEK bir dürüst cümleye indirger.
 *
 * Ham JSON, iç hata metni ya da kimlik GUID'i kullanıcıya GÖSTERİLMEZ; başarısız
 * hedeflerin kimlikleri yine de döner, böylece arayüz onları işaretleyebilir.
 */
export function batchResultSummary(operation, payload) {
  const results = Array.isArray(payload?.results) ? payload.results : []
  const total = results.length

  if (total === 0) return Object.freeze({ total: 0, succeeded: 0, failed: 0, stale: 0, message: '', isPartial: false, failedTargets: Object.freeze([]) })

  const succeeded = results.filter((item) => item?.succeeded === true).length
  const failures = results.filter((item) => item?.succeeded !== true)
  const stale = failures.filter((item) => STALE_CODES.has(item?.resultCode)).length
  const label = OPERATION_LABELS[operation] ?? 'İşlem'

  const sentences = [`${total} işlemden ${succeeded}'si tamamlandı.`]

  if (stale > 0) {
    sentences.push(`${stale} işlem artık güncel olmadığı için uygulanmadı.`)
  }

  const other = failures.length - stale
  if (other > 0) {
    sentences.push(`${other} işlem uygulanabilir durumda değildi.`)
  }

  return Object.freeze({
    total,
    succeeded,
    failed: failures.length,
    stale,
    isPartial: succeeded > 0 && failures.length > 0,
    message: failures.length === 0 ? `${label} tamamlandı (${succeeded}).` : sentences.join(' '),
    failedTargets: Object.freeze(failures.map((item) => Object.freeze({
      routeId: item?.requestedRouteId ?? null,
      simulationId: item?.requestedSimulationId ?? null,
      resultCode: item?.resultCode ?? null,
    }))),
  })
}

/* --- YETKİ ---------------------------------------------------------------------
   Yalnızca ETKİN yetki kodları okunur; rol adı, kullanıcı adı ya da yönetici
   bayrağı YOKTUR. Görünürlük yalnızca DENEYİMDİR: backend yetkisiz isteğe 403
   döndürmeye devam eder. */

/**
 * Yaşam döngüsü yetenekleri.
 *
 * <b>Yeniden başlatmak İKİ yetenek ister</b> ve bu bir tercih değildir: komut
 * gerçekten hem canlı bir yayını herkes için bitirir hem de yenisini kurar.
 * Yalnızca durdurma yetkisi olan kullanıcı onu GÖRMEZ; yalnızca başlatma
 * yetkisi olan kullanıcı ise hiçbir yönetim denetimi görmez — başlatabilmek,
 * başkalarının çalıştırmalarına dokunma yetkisi DEĞİLDİR.
 */
export function lifecycleCapabilities({ canStart = false, canStop = false } = {}) {
  const stop = canStop === true
  const start = canStart === true

  return Object.freeze({
    canManage: stop,
    canPause: stop,
    canResume: stop,
    canReset: stop,
    canRestart: stop && start,
  })
}

/* --- SUNUM ------------------------------------------------------------------- */

/**
 * Aktif liste satırlarının SIRASI.
 *
 * Sunucunun sırasıyla AYNI kural: hat adı (büyük/küçük harf duyarsız),
 * eşitlikte rota kimliği. İlerlemeye göre sıralamak listeyi her tick'te
 * yeniden dizerdi; kullanıcının tıklamak istediği satır ayağının altından
 * kayardı.
 */
function compareRows(left, right) {
  const leftName = left.routeName.toUpperCase()
  const rightName = right.routeName.toUpperCase()
  if (leftName < rightName) return -1
  if (leftName > rightName) return 1
  return left.routeId - right.routeId
}

/**
 * Aktif liste satırları.
 *
 * Hiçbir değer burada ÜRETİLMEZ: durum ve ilerleme sunucunun anlık
 * görüntüsünden, ad/renk mevcut rota katalogundan gelir.
 *
 * <b>SATIR BİR YAŞAM DÖNGÜSÜ ARAÇ ÇUBUĞU DEĞİLDİR.</b> Satırda TEK bir eylem
 * vardır — İzle — ve yetkili kullanıcı için bir de yönetim onay kutusu. Her
 * satıra Duraklat/Devam Ettir/Sıfırla koymak, dar harita panelinde ad, durum,
 * ilerleme ve dört düğmeyi aynı genişlikte yarıştırıyor ve etiketleri
 * üst üste bindiriyordu. Yaşam döngüsü komutları SEÇİMİN üzerinde çalışır:
 * tek bir çalıştırma için de aynı yol kullanılır (tek hedefli seçim), böylece
 * ikinci bir komut yüzeyi doğmaz.
 *
 * <b>YÖNETİM ALANLARI YALNIZCA YETKİYLE VAR OLUR.</b> Yetkisi olmayan
 * kullanıcının satırında bu anahtarlar hiç BULUNMAZ — `false` da olmazlar.
 * Ayrım bilinçlidir: "gizlenmiş bir eylem" ile "olmayan bir eylem" farklı
 * şeylerdir ve sıradan izleyici için liste Faz 4A'daki gibi salt okuma
 * yüzeyi olarak kalır.
 */
export function activeSimulationRows({
  byRoute = {},
  routes = [],
  watchedRuns = {},
  managedRuns = {},
  selectedRouteId = null,
  followedRouteId = null,
  capabilities = null,
  pending = {},
} = {}) {
  const selected = finiteId(selectedRouteId)
  const followed = finiteId(followedRouteId)
  const able = capabilities ?? lifecycleCapabilities()

  return Object.values(byRoute)
    .filter(isActiveState)
    .map((state) => {
      const route = routes.find((candidate) => finiteId(candidate?.id) === state.routeId) ?? null
      const watched = watchedRuns[state.routeId] === state.simulationId
      /* YÖNETİM SEÇİMİ de KİMLİK eşleşmesidir: yerine geçmiş bir çalıştırma,
         eskisi için verilmiş kararı devralamaz. */
      const managed = managedRuns[state.routeId] === state.simulationId
      const paused = isPausedSimulationStatus(state.status)

      const base = {
        routeId: state.routeId,
        simulationId: state.simulationId,
        routeName: route?.name || `Hat #${state.routeId}`,
        routeColor: route?.colorHex || null,
        status: state.status,
        statusLabel: simulationStatusLabel(state.status),
        isPaused: paused,
        progressPercent: state.progressPercent,
        progressLabel: `%${Math.round(state.progressPercent)}`,
        isWatched: watched,
        /* İzleme etiketi bir EYLEM adıdır; satırın seçili olup olmamasıyla
           ilgisi yoktur. */
        watchLabel: watched ? 'İzlemeyi Bırak' : 'İzle',
        isSelected: selected !== null && selected === state.routeId,
        isFollowed: followed !== null && followed === state.routeId,
        canManage: able.canManage,
        isManaged: able.canManage && managed,
      }

      if (!able.canManage) return Object.freeze(base)

      const target = { routeId: state.routeId, simulationId: state.simulationId }

      return Object.freeze({
        ...base,
        /* Satır KOMUT TAŞIMAZ; yalnızca bu çalıştırmaya ait bir komutun YOLDA
           olduğunu bildirir. Meşgulken onay kutusu kilitlenir: uçuş hâlindeki
           bir komutun hedefini seçimden çıkarmak, kullanıcıya iptal ettiği
           izlenimi verirdi — oysa istek çoktan yola çıkmıştır. */
        isBusy: LIFECYCLE_ORDER.some(
          (operation) => isLifecyclePending(pending, target, operation),
        ),
      })
    })
    .sort(compareRows)
}

/**
 * TOPLU YÖNETİM araç çubuğunun sunum modeli.
 *
 * <b>İZLEME araç çubuğundan AYRIDIR</b> ve öyle kalmalıdır: "Tümünü İzle"
 * haritada araç açar, "Aktifleri Seç" ise komut hedefi belirler. İkisini aynı
 * yere koymak, kullanıcının bir onay kutusunun hangi anlama geldiğini tahmin
 * etmesini istemek olurdu.
 *
 * <b>Sayılar UYGUN hedeflerin sayısıdır</b>, seçimin büyüklüğü değil: karışık
 * bir seçimde "Seçilileri Duraklat (2)" tam olarak kaç çalıştırmanın
 * duraklatılacağını söyler.
 */
export function activeSimulationManagement({
  byRoute = {},
  managedRuns = {},
  capabilities = null,
  pending = {},
  totalActiveCount = 0,
} = {}) {
  const able = capabilities ?? lifecycleCapabilities()

  if (!able.canManage) {
    // Yetkisiz kullanıcı için yönetim yüzeyi YOKTUR.
    return Object.freeze({
      canManage: false,
      hasSelection: false,
      managedCount: 0,
      actions: Object.freeze([]),
    })
  }

  const targets = managedRunTargets(managedRuns, byRoute)

  const action = (operation, label, allowed, destructive) => {
    const eligible = targets.filter((target) => isEligibleFor(operation, target.status))

    /* UYGUN HEDEFİ OLMAYAN KOMUT HİÇ ÜRETİLMEZ. Eskiden kapalı bir düğme
       olarak "(0)" ile çiziliyordu; dar panelde bu, kullanıcının asla
       basamayacağı iki-üç düğmenin gerçek komutlarla aynı yeri paylaşması
       demekti. Yokluk, kapalılıktan daha sakin ve daha dürüsttür. */
    if (!allowed || eligible.length === 0) return null

    return Object.freeze({
      operation,
      // Etiket kısa: bağlam "Seçili: N" başlığında zaten söylenmiştir.
      label: `${label} (${eligible.length})`,
      count: eligible.length,
      busy: eligible.some((target) => isLifecyclePending(pending, target, operation)),
      /* YIKICI OLAN YALNIZCA GERÇEKTEN YIKICI OLANDIR: duraklat/sürdür aynı
         çalıştırmayı sürdürür, sıfırla onu bitirir, yeniden başlat ise bitirip
         yerine yenisini kurar. Her düğmeyi kırmızıya boyamak, uyarıyı
         anlamsızlaştırırdı. */
      destructive,
    })
  }

  const actions = [
    action(LIFECYCLE_OPERATIONS.PAUSE, 'Duraklat', able.canPause, false),
    action(LIFECYCLE_OPERATIONS.RESUME, 'Devam Ettir', able.canResume, false),
    action(LIFECYCLE_OPERATIONS.RESET, 'Sıfırla', able.canReset, true),
    action(LIFECYCLE_OPERATIONS.RESTART, 'Yeniden Başlat', able.canRestart, true),
  ].filter(Boolean)

  return Object.freeze({
    canManage: true,
    managedCount: targets.length,
    /* HİÇBİR ŞEY SEÇİLİ DEĞİLKEN KOMUT BLOĞU YOKTUR. Panel sürekli dört yıkıcı
       düğme taşımak zorunda değildir; seçim yapılmadan önce gösterilecek tek
       anlamlı şey, seçim yapmanın kısa yoludur. */
    hasSelection: targets.length > 0,
    selectionLabel: `Seçili: ${targets.length}`,
    // "Aktifleri Seç" YALNIZCA o anki kümeyi kapsar; sonrakiler otomatik gelmez.
    canSelectAllActive: totalActiveCount > 0 && targets.length < totalActiveCount,
    canClearManaged: targets.length > 0,
    actions: Object.freeze(actions),
  })
}

/**
 * SUNUM süzgeci: hat adına göre arama.
 *
 * <b>Yalnızca ne çizileceğini değiştirir.</b> Aktif kümeyi, izleme seçimini ve
 * SignalR aboneliklerini HİÇ etkilemez: aranan metne uymayan bir hattın aracı
 * haritadan kaybolmaz ve verisi donmaz. Sunucuda ikinci bir arama ucu da
 * açılmaz — küme zaten istemcide ve küçüktür.
 */
export function filterActiveRows(rows = [], query = '') {
  const needle = String(query ?? '').trim().toLocaleLowerCase('tr')
  if (needle.length === 0) return rows
  return rows.filter((row) => row.routeName.toLocaleLowerCase('tr').includes(needle))
}

/**
 * Aktif Simülasyonlar bölümünün tam sunum modeli.
 *
 * Yükleniyor / boş / hata durumları AÇIKÇA ayrılır: başarısız bir ilk keşif
 * okumasından sonra elde kalan bayat veriyi "güncel" diye göstermek,
 * kullanıcıya var olmayan bir gerçeği anlatırdı.
 */
export function activeSimulationsPresentation({
  byRoute = {},
  routes = [],
  watchedRuns = {},
  managedRuns = {},
  selectedRouteId = null,
  followedRouteId = null,
  search = '',
  loading = false,
  loaded = false,
  error = '',
  canStart = false,
  canStop = false,
  pending = {},
  batchError = '',
  batchSummary = '',
} = {}) {
  const capabilities = lifecycleCapabilities({ canStart, canStop })

  const rows = activeSimulationRows({
    byRoute,
    routes,
    watchedRuns,
    managedRuns,
    selectedRouteId,
    followedRouteId,
    capabilities,
    pending,
  })

  const visible = filterActiveRows(rows, search)
  const watchedCount = rows.filter((row) => row.isWatched).length

  /* ARAMA YALNIZCA SUNUMDUR: yönetim seçimi TÜM aktif kümeden hesaplanır,
     görünen satırlardan değil. Aksi hâlde bir arama yazmak, seçili ama gizli
     kalan çalıştırmaları sessizce komut dışı bırakırdı. */
  const management = activeSimulationManagement({
    byRoute,
    managedRuns,
    capabilities,
    pending,
    totalActiveCount: rows.length,
  })

  return Object.freeze({
    rows: Object.freeze(visible),
    totalCount: rows.length,
    visibleCount: visible.length,
    watchedCount,
    search: String(search ?? ''),
    /* Arama sonucu boş olmak, aktif simülasyon OLMAMASI değildir; iki boşluk
       farklı cümlelerle anlatılır. */
    isFiltered: String(search ?? '').trim().length > 0,
    loading: Boolean(loading) && !loaded,
    /* Hata varken "hiç aktif simülasyon yok" DENMEZ: bilinmeyen bir şey
       "yok" diye sunulamaz. */
    isEmpty: loaded && !error && rows.length === 0,
    error: error || '',
    // Toplu izleme eylemleri yalnızca anlamlı olduklarında sunulur.
    canWatchAll: rows.length > 0 && watchedCount < rows.length,
    canClearWatch: watchedCount > 0,
    /* YÖNETİM bölümü AYRI bir daldır: izleme sayaçlarıyla karıştırılmaz ve
       yetkisiz kullanıcıda `canManage: false` ile boş kalır. */
    management,
    /* Toplu komutun SONUCU dürüstçe taşınır: kısmen başarılı bir yığın
       "tamamlandı" diye gösterilmez. */
    batchError: batchError || '',
    batchSummary: batchSummary || '',
  })
}
