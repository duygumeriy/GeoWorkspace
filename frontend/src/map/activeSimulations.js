import {
  isPausedSimulationStatus,
  isTerminalSimulationStatus,
  mergeSimulationState,
  normalizeStatusSnapshot,
  simulationStatusLabel,
} from './transportSimulationState.js'

/**
 * AKTİF paylaşılan simülasyonların SAF çekirdeği (Faz 4A).
 *
 * <b>Dört kavram BİRBİRİNDEN bağımsızdır ve bu dosya karışmalarını yapısal
 * olarak engeller:</b>
 * <ul>
 *   <li><b>AKTİF</b> — sunucu gerçeği: şu anda çalışan ya da duraklatılmış
 *       tüm paylaşılan çalıştırmalar.</li>
 *   <li><b>İZLENEN</b> — kullanıcının haritada ARAÇ olarak görmeyi seçtiği
 *       çalıştırmalar. Sıfır, bir, birkaç ya da hepsi olabilir.</li>
 *   <li><b>SEÇİLİ</b> — ayrıntı/denetim bağlamına sahip TEK hat. Yalnızca
 *       sunumdur.</li>
 *   <li><b>TAKİP EDİLEN</b> — kamerayı elinde tutan EN FAZLA bir araç.</li>
 * </ul>
 *
 * <b>İzlemek seçmek değildir, seçmek takip etmek değildir.</b> Bir hattı
 * izlemeye almak onu Duraklat/Sıfırla bağlamına taşımaz; bir hattı seçmek
 * izleme listesini değiştirmez; takip etmek ise yalnızca kamerayı ilgilendirir
 * ve hiçbir aracın verisini kesmez.
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
 * görüntüsünden, ad/renk mevcut rota katalogundan gelir. Satır YAŞAM DÖNGÜSÜ
 * denetimi TAŞIMAZ — Faz 4A'da liste bir yönetim yüzeyi değildir.
 */
export function activeSimulationRows({
  byRoute = {},
  routes = [],
  watchedRuns = {},
  selectedRouteId = null,
  followedRouteId = null,
} = {}) {
  const selected = finiteId(selectedRouteId)
  const followed = finiteId(followedRouteId)

  return Object.values(byRoute)
    .filter(isActiveState)
    .map((state) => {
      const route = routes.find((candidate) => finiteId(candidate?.id) === state.routeId) ?? null
      const watched = watchedRuns[state.routeId] === state.simulationId

      return Object.freeze({
        routeId: state.routeId,
        simulationId: state.simulationId,
        routeName: route?.name || `Hat #${state.routeId}`,
        routeColor: route?.colorHex || null,
        status: state.status,
        statusLabel: simulationStatusLabel(state.status),
        isPaused: isPausedSimulationStatus(state.status),
        progressPercent: state.progressPercent,
        progressLabel: `%${Math.round(state.progressPercent)}`,
        isWatched: watched,
        /* İzleme etiketi bir EYLEM adıdır; satırın seçili olup olmamasıyla
           ilgisi yoktur. */
        watchLabel: watched ? 'İzlemeyi Bırak' : 'İzle',
        isSelected: selected !== null && selected === state.routeId,
        isFollowed: followed !== null && followed === state.routeId,
      })
    })
    .sort(compareRows)
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
  selectedRouteId = null,
  followedRouteId = null,
  search = '',
  loading = false,
  loaded = false,
  error = '',
} = {}) {
  const rows = activeSimulationRows({
    byRoute,
    routes,
    watchedRuns,
    selectedRouteId,
    followedRouteId,
  })

  const visible = filterActiveRows(rows, search)
  const watchedCount = rows.filter((row) => row.isWatched).length

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
  })
}
