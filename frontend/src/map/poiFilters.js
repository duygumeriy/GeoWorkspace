import { foldForSearch } from './drawingFilters.js'
import { summarize } from '../poi/workHours.js'

/**
 * "POI'lerim" panelinin arama / sıralama hattı.
 *
 * `buildDrawingView` ile aynı gerekçeyle bileşenin DIŞINDADIR: kayıtlar ve üç
 * denetim değeri verildiğinde çizilecek listeyi döndürür, panel de yalnızca
 * eline verileni çizer.
 *
 * <b>Arama normalizasyonu YENİDEN yazılmaz.</b> `foldForSearch` uygulamanın
 * tek Türkçe-duyarlı katlama fonksiyonudur (küçük harf, aksan ayrıştırma, ı/ğ
 * eşlemesi) ve çizim listesi, çöp kutusu ve kategori seçici de onu kullanır.
 * İkinci bir kopya, "kafe" aramasının bir ekranda çalışıp diğerinde
 * çalışmaması demek olurdu.
 *
 * <b>Hiçbiri bir güvenlik sınırı DEĞİLDİR.</b> Sunucu zaten yalnızca çağıranın
 * kendi aktif kayıtlarını döndürdü (<c>GET /api/poi/mine</c>); buradaki her
 * şey o listenin üzerine kurulan sunumdur.
 */

/**
 * Sıralama seçenekleri.
 *
 * Çizim listesindeki tarih tabanlı seçenekler burada YOKTUR: harita POI
 * sözleşmesi oluşturma/güncelleme tarihi taşımaz (denetim alanları yönetim
 * ekranına aittir). Elde olmayan bir alana göre sıralama sunmak, çalışmayan
 * bir denetim göstermek olurdu.
 */
export const POI_SORT_OPTIONS = Object.freeze([
  { id: 'name-asc', label: 'A → Z' },
  { id: 'name-desc', label: 'Z → A' },
  { id: 'category', label: 'Kategoriye Göre' },
])

export const DEFAULT_POI_SORT = 'name-asc'

/** Kategori süzgeci seçenekleri: listede GERÇEKTEN bulunan yollar. */
export function poiCategoryOptions(pois) {
  const paths = new Set()

  for (const poi of pois ?? []) {
    const label = poi?.categoryPath || poi?.categoryName
    if (label) paths.add(label)
  }

  return [
    { id: 'all', label: 'Tüm Kategoriler' },
    ...[...paths]
      .sort((a, b) => a.localeCompare(b, 'tr', { sensitivity: 'base' }))
      .map((path) => ({ id: path, label: path })),
  ]
}

/** Kayıt adı + kategori yolu: kullanıcının aklındaki iki alan. */
function haystack(poi) {
  return foldForSearch(`${poi?.name ?? ''} ${poi?.categoryPath ?? poi?.categoryName ?? ''}`)
}

const nameOf = (poi) => poi?.name ?? ''
const categoryOf = (poi) => poi?.categoryPath || poi?.categoryName || ''

/** Adsız kayıt her iki yönde de sona düşer: eksik veri "ilk" değildir. */
function compareNames(a, b) {
  const left = nameOf(a)
  const right = nameOf(b)
  if (!left) return right ? 1 : 0
  if (!right) return -1
  return left.localeCompare(right, 'tr', { sensitivity: 'base' })
}

const COMPARATORS = {
  'name-asc': compareNames,
  'name-desc': (a, b) => compareNames(b, a),
  // Kategori içinde ad sırası korunur; yol aynıysa liste rastgele dizilmez.
  category: (a, b) =>
    categoryOf(a).localeCompare(categoryOf(b), 'tr', { sensitivity: 'base' }) || compareNames(a, b),
}

/**
 * Hattı çalıştırır: `pois -> kategori -> arama -> sıralama`.
 *
 * @param {Array} pois `GET /api/poi/mine` kayıtları
 * @param {{ search?: string, category?: string, sort?: string }} controls
 * @returns {{ items: Array, matchCount: number }}
 */
export function buildMyPoiView(pois, { search = '', category = 'all', sort = DEFAULT_POI_SORT } = {}) {
  const needle = foldForSearch(search)

  const filtered = (pois ?? []).filter((poi) => {
    if (category !== 'all' && categoryOf(poi) !== category) return false
    if (!needle) return true
    return haystack(poi).includes(needle)
  })

  const sorted = [...filtered].sort(COMPARATORS[sort] ?? COMPARATORS[DEFAULT_POI_SORT])

  return { items: sorted, matchCount: sorted.length }
}

/**
 * Satırın ikinci satırında görünen kısa mesai özeti.
 *
 * Yorum `poi/workHours.js`e aittir ve burada tekrarlanmaz: "Kapalı" ile
 * "Belirtilmemiş" ayrımı listede de yönetim ekranındaki gibi korunur.
 */
export function workHoursSummary(poi) {
  return summarize(poi?.workHours)
}
