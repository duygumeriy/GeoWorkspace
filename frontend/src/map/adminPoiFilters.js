import { foldForSearch } from './drawingFilters.js'
import { categoryLabel } from './poiCategorySearch.js'

/**
 * Yönetim panelindeki POI ve kategori listelerinin süzme/sıralama hattı.
 *
 * <b>Bileşenin DIŞINDADIR</b>, tıpkı `buildDrawingView` ve `buildMyPoiView`
 * gibi: kayıtlar ve denetim değerleri verilir, çizilecek liste döner. JSX
 * içinde zincirlenmiş bir `.filter().filter().sort()` yığını, kuralı
 * gözle okunamaz ve tek başına ölçülemez hâle getirirdi.
 *
 * <b>Arama normalizasyonu YENİDEN yazılmaz.</b> `foldForSearch` uygulamanın
 * tek Türkçe-duyarlı katlama fonksiyonudur (küçük harf, aksan ayrıştırma,
 * ı/ğ eşlemesi); çizim listesi, çöp kutusu, POI'lerim ve kategori seçici de
 * onu kullanır. İkinci bir kopya, "kafe" aramasının bir ekranda çalışıp
 * diğerinde çalışmaması demek olurdu.
 *
 * <b>Süzme bir GÜVENLİK SINIRI DEĞİLDİR.</b> Sunucu listeyi zaten
 * <c>poi.manage</c> / <c>poi.categories.manage</c> ile döndürdü; buradaki her
 * şey o listenin üzerine kurulan sunumdur.
 *
 * <b>Neden istemcide.</b> Yönetim uçları listenin TAMAMINI tek seferde döner
 * (sayfalama yoktur) ve süzme anında yanıt vermelidir. Bunun için bir sorgu
 * API'si açmak, sayfalama tasarımını da beraberinde getirir ve bu fazın
 * çözdüğü sorun bu değildir.
 */

/* ===========================================================================
   POI'ler
   =========================================================================== */

export const ADMIN_POI_SORT_OPTIONS = Object.freeze([
  { id: 'newest', label: 'En Yeni' },
  { id: 'oldest', label: 'En Eski' },
  { id: 'name-asc', label: 'Ada Göre A → Z' },
  { id: 'name-desc', label: 'Ada Göre Z → A' },
])

/** Sunucu zaten en yeni kaydı başta döner; varsayılan o sırayı korur. */
export const DEFAULT_ADMIN_POI_SORT = 'newest'

/**
 * Durum seçenekleri.
 *
 * Üçü de yönetim sözleşmesinde GERÇEKTEN temsil edilir (`isActive`,
 * `isDeleted`); listenin gösteremeyeceği bir durum uydurulmaz.
 */
export const ADMIN_POI_STATUS_OPTIONS = Object.freeze([
  { id: 'all', label: 'Tümü' },
  { id: 'active', label: 'Aktif' },
  { id: 'inactive', label: 'Pasif' },
  { id: 'deleted', label: 'Silinmiş' },
])

const categoryOf = (poi) => poi?.categoryPath || poi?.categoryName || ''
const nameOf = (poi) => poi?.name ?? ''
const creatorOf = (poi) => poi?.creatorUsername ?? ''

/**
 * Aranabilir metin: ad + kategori yolu + oluşturan.
 *
 * Üçü de kullanıcının aklındaki alanlardır — "star" kaydı, "kafe" kategoriyi,
 * "duygu2" ise kimin eklediğini arar. Oluşturan bilgisi YALNIZCA yönetim
 * sözleşmesinde vardır; harita listesi onu hiç taşımaz ve orada aranamaz.
 */
function poiHaystack(poi) {
  return foldForSearch(`${nameOf(poi)} ${categoryOf(poi)} ${creatorOf(poi)}`)
}

function statusMatches(poi, status) {
  if (status === 'all') return true
  if (status === 'deleted') return poi?.isDeleted === true
  // Silinmişlik önceliklidir: silinmiş bir satır "pasif" diye listelenmez.
  if (poi?.isDeleted === true) return false
  return status === 'active' ? poi?.isActive === true : poi?.isActive === false
}

const timeOf = (value) => {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

/** Adsız kayıt her iki yönde de sona düşer: eksik veri "ilk" değildir. */
function compareNames(a, b) {
  const left = nameOf(a)
  const right = nameOf(b)
  if (!left) return right ? 1 : 0
  if (!right) return -1
  return left.localeCompare(right, 'tr', { sensitivity: 'base' })
}

const POI_COMPARATORS = {
  // Eşit tarihte kimlik sırayı deterministik yapar.
  newest: (a, b) => timeOf(b?.createdDate) - timeOf(a?.createdDate) || (b?.id ?? 0) - (a?.id ?? 0),
  oldest: (a, b) => timeOf(a?.createdDate) - timeOf(b?.createdDate) || (a?.id ?? 0) - (b?.id ?? 0),
  'name-asc': compareNames,
  'name-desc': (a, b) => compareNames(b, a),
}

/** Kategori süzgeci seçenekleri: listede GERÇEKTEN bulunan yollar. */
export function adminPoiCategoryOptions(pois) {
  const paths = new Set()

  for (const poi of pois ?? []) {
    const label = categoryOf(poi)
    if (label) paths.add(label)
  }

  return [
    { id: 'all', label: 'Tüm Kategoriler' },
    ...[...paths]
      .sort((a, b) => a.localeCompare(b, 'tr', { sensitivity: 'base' }))
      .map((path) => ({ id: path, label: path })),
  ]
}

/**
 * Oluşturan süzgeci seçenekleri: veri kümesinde GEÇEN kullanıcı adları.
 *
 * Kullanıcı listesi için ayrı bir uç çağrılmaz — bu açılır liste "kimler
 * kayıt eklemiş" sorusunu yanıtlar, "sistemde kimler var" sorusunu değil, ve
 * ikincisi burada bir bilgi sızıntısı olurdu.
 */
export function adminPoiCreatorOptions(pois) {
  const names = new Set()

  for (const poi of pois ?? []) {
    const creator = creatorOf(poi)
    if (creator) names.add(creator)
  }

  return [
    { id: 'all', label: 'Tümü' },
    ...[...names]
      .sort((a, b) => a.localeCompare(b, 'tr', { sensitivity: 'base' }))
      .map((name) => ({ id: name, label: name })),
  ]
}

export const EMPTY_ADMIN_POI_FILTERS = Object.freeze({
  search: '',
  category: 'all',
  status: 'all',
  creator: 'all',
  sort: DEFAULT_ADMIN_POI_SORT,
})

/** Kullanıcı gerçekten bir şey süzdü mü ("Filtreleri Temizle" bunu sorar). */
export function hasActivePoiFilters({ search = '', category = 'all', status = 'all', creator = 'all' } = {}) {
  return search.trim().length > 0 || category !== 'all' || status !== 'all' || creator !== 'all'
}

/**
 * Hattı çalıştırır: `kayıtlar -> durum -> kategori -> oluşturan -> arama ->
 * sıralama`.
 *
 * Süzgeçler BİRLEŞİR (VE), birbirinin yerine geçmez: "star" + Yeme-İçme +
 * duygu2 + Aktif aynı listeyi dört kez daraltır.
 */
export function buildAdminPoiView(pois, controls = {}) {
  const {
    search = '',
    category = 'all',
    status = 'all',
    creator = 'all',
    sort = DEFAULT_ADMIN_POI_SORT,
  } = controls

  const needle = foldForSearch(search)

  const filtered = (pois ?? []).filter((poi) => {
    if (!statusMatches(poi, status)) return false
    if (category !== 'all' && categoryOf(poi) !== category) return false
    if (creator !== 'all' && creatorOf(poi) !== creator) return false
    if (!needle) return true
    return poiHaystack(poi).includes(needle)
  })

  const sorted = [...filtered].sort(POI_COMPARATORS[sort] ?? POI_COMPARATORS[DEFAULT_ADMIN_POI_SORT])

  return { items: sorted, matchCount: sorted.length, total: (pois ?? []).length }
}

/* ===========================================================================
   Kategoriler
   =========================================================================== */

export const ADMIN_CATEGORY_STATUS_OPTIONS = Object.freeze([
  { id: 'all', label: 'Tümü' },
  { id: 'active', label: 'Aktif' },
  { id: 'inactive', label: 'Pasif' },
])

/**
 * Tür süzgeci: kök mü, alt mı.
 *
 * Karar `parentId`den okunur — GİRİNTİDEN değil. Girinti bir sunum ayrıntısıdır
 * ve ondan hiyerarşi çıkarmak, biçimlendirmeyi iş kuralına dönüştürmek olurdu.
 */
export const ADMIN_CATEGORY_KIND_OPTIONS = Object.freeze([
  { id: 'all', label: 'Tümü' },
  { id: 'root', label: 'Ana Kategoriler' },
  { id: 'child', label: 'Alt Kategoriler' },
])

export const EMPTY_ADMIN_CATEGORY_FILTERS = Object.freeze({
  search: '',
  status: 'all',
  kind: 'all',
})

export function hasActiveCategoryFilters({ search = '', status = 'all', kind = 'all' } = {}) {
  return search.trim().length > 0 || status !== 'all' || kind !== 'all'
}

/** Aranabilir metin: ad + tam yol — kategori seçicisiyle AYNI alanlar. */
function categoryHaystack(category) {
  return foldForSearch(`${category?.name ?? ''} ${category?.path ?? ''}`)
}

/**
 * Kategori hattı: `satırlar -> durum -> tür -> arama`.
 *
 * <b>Sıra KORUNUR.</b> Sunucu satırları yol sırasında döner ve her satır kendi
 * `path`/`depth` değerini taşır; süzme yalnızca satır DÜŞÜRÜR, yeniden
 * sıralamaz. Böylece süzülmüş liste de hiyerarşi gibi okunur ve eşleşen bir
 * alt kategori tam yoluyla (`Yeme-İçme / kafe`) kendi bağlamını taşır —
 * ağacı yeniden kurmaya gerek kalmaz.
 *
 * <b>Silinmiş kategori için süzgeç YOKTUR</b> çünkü bu ekranın sözleşmesinde
 * öyle bir durum ayrı bir seçenek olarak sunulmuyor; olmayan bir durumu
 * seçenek yapmak, hiçbir zaman sonuç vermeyen bir filtre olurdu.
 */
export function buildAdminCategoryView(categories, controls = {}) {
  const { search = '', status = 'all', kind = 'all' } = controls
  const needle = foldForSearch(search)

  const filtered = (categories ?? []).filter((category) => {
    if (status === 'active' && category?.isActive !== true) return false
    if (status === 'inactive' && category?.isActive !== false) return false

    const isRoot = (category?.parentId ?? null) === null
    if (kind === 'root' && !isRoot) return false
    if (kind === 'child' && isRoot) return false

    if (!needle) return true
    return categoryHaystack(category).includes(needle)
  })

  return { items: filtered, matchCount: filtered.length, total: (categories ?? []).length }
}

/** Satırın gösterilecek etiketi; kategori seçicisiyle aynı kural. */
export { categoryLabel }
