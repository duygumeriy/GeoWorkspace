/**
 * Yolculuk çalışma alanının SAF çekirdeği: hangi ÜRÜNLER sunulur, hangisi
 * gösterilir ve paylaşılan hattın sunum modeli nasıl kurulur.
 *
 * <b>İki ürün, tek çalışma alanı.</b> Kişisel yolculuk ile paylaşılan hat
 * simülasyonu teknik olarak AYRI kalır — ayrı servis, ayrı hub, ayrı depo,
 * ayrı sahiplik. Birleşen tek şey SUNUMDUR: kullanıcı ikisini de aynı panelden
 * görür. Bu dosya o sunum kararlarını DOM'suz sınanabilir kılar; hiçbir yaşam
 * döngüsü komutu, hiçbir ağ çağrısı ve hiçbir birleşik durum makinesi burada
 * YOKTUR.
 *
 * <b>Yetki yalnızca GÖRÜNÜRLÜKTÜR.</b> Kararlar etkin yetki KODLARINDAN türer;
 * rol adı, kullanıcı adı ya da yönetici bayrağı hiçbir biçimde okunmaz.
 * Bağlayıcı denetim her zaman backend'dedir — bir düğmeyi gizlemek
 * yetkilendirme değildir.
 */

/** Çalışma alanının ÜST DÜZEY ürünleri. Kişisel planlama KİPLERİ değildir. */
export const JOURNEY_PRODUCTS = Object.freeze({
  PERSONAL: 'personal',
  SHARED: 'shared',
})

/**
 * Ürün adları.
 *
 * <b>Paylaşımlı ürün artık bir SİMÜLASYONDAN fazlasıdır:</b> kalıcı hatlar,
 * canlı çalıştırmalar, izleme/takip ve — yetkisi olana — yaşam döngüsü
 * yönetimi. "Hat Simülasyonu" adı bu bütünün yalnızca bir parçasını anlatıyor
 * ve üst düzey ürün ekseninde kişisel yolculuğun karşısına bir ÖZELLİK adı
 * koyuyordu. İki ürün de artık ne olduklarıyla adlandırılır.
 *
 * Ad yalnızca SUNUMDUR: ürün kimlikleri (`personal` / `shared`), yetkiler ve
 * hiçbir yaşam döngüsü davranışı bundan etkilenmez.
 */
const PRODUCT_LABELS = Object.freeze({
  [JOURNEY_PRODUCTS.PERSONAL]: 'Kendi Yolculuğum',
  [JOURNEY_PRODUCTS.SHARED]: 'Paylaşımlı Ulaşım',
})

export function journeyProductLabel(product) {
  return PRODUCT_LABELS[product] ?? ''
}

/**
 * Kullanıcının erişebildiği ürünler, gösterim sırasıyla.
 *
 * İki yetki BİRBİRİNİ İMA ETMEZ ve burada birleştirilmez: `journey.use`
 * kişisel ürünü, `transport.view` paylaşılan ürünü açar. Biri yoksa o ürün
 * listede hiç yer almaz — kullanılamayacak bir sekme göstermek, kullanıcıyı
 * garanti 403'e davet etmektir.
 */
export function journeyWorkspaceProducts({ canUseJourney = false, canViewTransport = false } = {}) {
  const products = []
  if (canUseJourney) products.push(JOURNEY_PRODUCTS.PERSONAL)
  if (canViewTransport) products.push(JOURNEY_PRODUCTS.SHARED)
  return products
}

/**
 * Çalışma alanı kısayolu görünür mü?
 *
 * <b>EN AZ BİR ürün yeter.</b> Paylaşılan hat bu fazda çalışma alanının içine
 * taşındığı için, kısayolu yalnızca `journey.use`'a bağlamak
 * `transport.view` taşıyan bir kullanıcının hat simülasyonuna hiçbir yerden
 * ulaşamaması demek olurdu. Bu bir yetki genişletmesi DEĞİLDİR: kapı açılır
 * ama içerideki her bölüm kendi yetkisini ayrıca ister.
 */
export function canOpenJourneyWorkspace(capabilities) {
  return journeyWorkspaceProducts(capabilities).length > 0
}

/**
 * Gerçekten gösterilecek ürün.
 *
 * İstenen ürün kullanıcıya kapalıysa sessizce boş bir panel çizilmez: erişilen
 * TEK ürün gösterilir. Hiçbir ürün yoksa <code>null</code> döner ve panel
 * çizilmez (fail-closed).
 */
export function resolveJourneyProduct({ requested = null, ...capabilities } = {}) {
  const products = journeyWorkspaceProducts(capabilities)
  if (products.length === 0) return null
  return products.includes(requested) ? requested : products[0]
}

/**
 * Ürün sekmeleri YALNIZCA birden fazla ürün varken anlamlıdır.
 *
 * Tek ürünü olan kullanıcıya, tek seçeneği olan bir sekme çubuğu göstermek
 * hiçbir şey anlatmaz ve paneli gereksizce daraltırdı.
 */
export function journeyProductTabs(capabilities) {
  const products = journeyWorkspaceProducts(capabilities)
  if (products.length < 2) return []
  return products.map((product) => ({ id: product, label: journeyProductLabel(product) }))
}

/**
 * Paylaşılan hattın SUNUM modeli.
 *
 * <b>Hiçbir değer burada üretilmez.</b> Rota adı katalogdan, durum/ilerleme
 * sunucunun anlık görüntüsünden, hangi denetimin görüneceği ise mevcut saf
 * <code>transportSimulationControls</code> kararından gelir. Bu fonksiyon
 * onları tek bir okunabilir nesnede toplar; ikinci bir durum makinesi kurmaz.
 *
 * <b>Uydurulmayanlar bilinçlidir.</b> Paylaşılan hattın kalıcı güzergahı
 * (<code>TransportRoutePath</code>) manevra bilgisi TAŞIMAZ: bu yüzden burada
 * "şu anki talimat", "sonraki dönüş" ya da adım listesi YOKTUR ve geometriden
 * türetilmez. Mesafe/süre yalnızca sunucudan geldiyse taşınır. Paylaşılan
 * durdurma da yoktur — açık durdurma komutu henüz backend'de bulunmuyor.
 */
function finiteId(value) {
  /* `Number(null)` ve `Number('')` SIFIR verir; "seçim yok" ile "0. rota"
     ayrımı bu yüzden ayrıştırmadan ÖNCE yapılır. */
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function sharedJourneyPresentation({
  routeId = null,
  routes = [],
  paths = [],
  controls = null,
  statusLoading = false,
  starting = false,
  stopping = false,
  pausing = false,
  resuming = false,
  error = '',
} = {}) {
  const id = finiteId(routeId)

  if (id === null) return null

  const route = routes.find((candidate) => finiteId(candidate?.id) === id) ?? null

  /* Mesafe ve süre rotanın KALICI güzergahından gelir (`TransportRoutePath`)
     — hesaplanmış tek otorite odur. Rota kaydının kendisinde bu alanlar
     YOKTUR ve tarayıcıda geometriden türetilmezler. */
  const path = paths.find((candidate) => finiteId(candidate?.routeId) === id) ?? null

  return Object.freeze({
    routeId: id,
    routeName: route?.name ?? '',
    routeColor: route?.colorHex || null,
    /* Sunucu ölçüleri YALNIZCA varsa taşınır. Yokken sıfır göstermek, henüz
       hesaplanmamış bir değeri ölçülmüş gibi sunardı. */
    distanceMeters: finiteNumber(path?.distanceMeters),
    durationSeconds: finiteNumber(path?.durationSeconds),
    isActive: Boolean(controls?.isActive),
    isFollowing: Boolean(controls?.isFollowing),
    statusLabel: controls?.statusLabel ?? null,
    progressPercent: controls?.progressPercent ?? null,
    progressLabel: controls?.progressLabel ?? null,
    showStart: Boolean(controls?.showStart),
    startDisabled: Boolean(controls?.startDisabled),

    /* DURDURMA çok kullanıcılı canlı bir çalıştırmayı sonlandırır ve komut
       ÇALIŞTIRMA KİMLİĞİ taşır. Kimlik burada da taşınır çünkü düğmeyi basan
       yüzey onu isteğe koymak zorundadır — rota tek başına gönderilirse eski
       bir sekme, yerine geçmiş yeni bir çalıştırmayı durdurabilirdi. */
    showStop: Boolean(controls?.showStop),
    stopDisabled: Boolean(controls?.stopDisabled),
    stoppableSimulationId: controls?.stoppableSimulationId ?? null,

    /* DURAKLATMA terminal DEĞİLDİR: `isActive` yine doğrudur ve panel hattı
       boş sanmaz. Ayrım yalnızca hangi yaşam döngüsü düğmesinin sunulacağı
       ve durumun nasıl adlandırılacağıdır. */
    isPaused: Boolean(controls?.isPaused),
    showPause: Boolean(controls?.showPause),
    showResume: Boolean(controls?.showResume),
    pauseDisabled: Boolean(controls?.pauseDisabled),
    showFollow: Boolean(controls?.showFollow),
    showUnfollow: Boolean(controls?.showUnfollow),
    followDisabled: Boolean(controls?.followDisabled),
    statusLoading: Boolean(statusLoading),
    starting: Boolean(starting),
    stopping: Boolean(stopping),
    pausing: Boolean(pausing),
    resuming: Boolean(resuming),
    error: error || '',
  })
}

/* --- Yolculuk Merkezi başlığı ---------------------------------------------------
   Başlık SABİTTİR ve ürüne göre değişmez: kullanıcı önce nerede olduğunu
   ("Yolculuk Merkezi"), sonra hangi ürüne baktığını (ürün çubuğu) okur.
   Başlığın ürün adını tekrar etmesi, aynı bilgiyi üst üste iki kez yazmak ve
   ürün çubuğunu gereksiz kılmaktı. */

/** Panelin değişmeyen kimliği. */
export const JOURNEY_CENTER_TITLE = 'Yolculuk Merkezi'

/**
 * Başlığın altındaki TEK satırlık bağlam özeti.
 *
 * <b>Yeni veri İSTENMEZ.</b> Yalnızca panelin zaten elinde olan değerler
 * okunur; süslemek için bir istek atmak, bir metin uğruna sunucuya gitmek
 * olurdu. Elde anlamlı bir şey yoksa <code>null</code> döner ve satır hiç
 * çizilmez — boş bir alt başlık, yer kaplayan bir gürültüdür.
 *
 * <b>Ölçüm HESAPLANMAZ.</b> Yüzde, süre ya da mesafe burada üretilmez; gelen
 * etiketler olduğu gibi kullanılır.
 *
 * @param {{ product?: string, live?: { label?: string } | null,
 *           shared?: { routeName?: string, routeId?: number,
 *                      isActive?: boolean, statusLabel?: string } | null,
 *           planner?: { profileLabel?: string, pointCount?: number } | null }} context
 */
export function journeyCenterSubtitle({ product, live = null, shared = null, planner = null } = {}) {
  if (product === JOURNEY_PRODUCTS.SHARED) {
    if (!shared) return null

    const name = shared.routeName || (shared.routeId != null ? `Hat #${shared.routeId}` : null)
    if (!name) return null

    /* Durum yalnızca ÇALIŞAN bir hat için yazılır. "Aktif simülasyon yok"
       cümlesi zaten gövdede duruyor; başlıkta tekrarlamak aynı olumsuzu iki
       kez söylemekti. */
    return shared.isActive && shared.statusLabel ? `${name} · ${shared.statusLabel}` : name
  }

  /* Kişisel üründe CANLI durum her şeyin önündedir: çalışan bir yolculuk
     varken kullanıcının taslağını özetlemek, olup biteni gizlerdi. */
  if (live?.label) return live.label

  if (!planner?.profileLabel) return null

  const points = Number.isFinite(planner.pointCount) && planner.pointCount > 0
    ? `${planner.pointCount} nokta`
    : null

  return [planner.profileLabel, points].filter(Boolean).join(' · ')
}
