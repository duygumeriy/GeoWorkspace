import { categoryLabel } from './rolePermissions.js'

/**
 * Yetki kataloğu ekranının saf yardımcıları.
 *
 * Hiçbir yetkilendirme kararı burada verilmez ve katalogun ikinci bir kopyası
 * TUTULMAZ: kodlar, adlar, kategoriler ve aktiflik sunucudan gelir. Buradaki iş
 * yalnızca gelen listeyi aramak, süzmek ve saymaktır.
 *
 * Kategori etiketleri rol düzenleyicisiyle AYNI tablodan okunur
 * (`rolePermissions.js`). İkinci bir eşleme, aynı kategorinin iki ekranda iki
 * farklı adla görünmesi demek olurdu.
 */

/** Durum süzgecinin seçenekleri. Kaynak tek alan: `isActive`. */
export const STATUS_FILTERS = [
  { value: 'All', label: 'Tümü' },
  { value: 'Active', label: 'Aktif' },
  { value: 'Inactive', label: 'Pasif' },
]

/**
 * Aramanın karşılaştırma biçimi.
 *
 * Türkçe yerel ayarla küçültülür: varsayılan `toLowerCase` "İZİN"i "i̇zin"e
 * çevirir ve "izin" araması eşleşmezdi. Kullanıcı listesi de aynı yerel ayarı
 * kullanıyor.
 */
export function normalize(value) {
  return (value ?? '').toLocaleLowerCase('tr-TR')
}

/**
 * Süzgeçteki kategori seçenekleri — YÜKLENEN veriden türer.
 *
 * Sabit bir kategori listesi, seed büyüdüğü gün yeni kategorileri süzülemez
 * yapardı. Sıra sunucunun gönderdiği sıradır (ilk görülme), tekrarlar bir kez
 * görünür. Bilinmeyen bir kategori de listeye girer: etiketi yoksa ham anahtarı
 * gösterilir, sessizce gizlenmez.
 *
 * @param {Array<{ category?: string }>} permissions
 * @returns {Array<{ value: string, label: string }>}
 */
export function categoryOptions(permissions) {
  const options = new Map()

  for (const permission of permissions ?? []) {
    const key = typeof permission?.category === 'string' ? permission.category.trim() : ''
    // Kategorisiz satır seçenek üretmez: seçilince hiçbir şey süzmeyen, boş
    // etiketli bir satır olurdu.
    if (!key || options.has(key)) continue
    options.set(key, { value: key, label: categoryLabel(key) })
  }

  return [...options.values()]
}

/**
 * Arama + kategori + durum, VE anlamıyla.
 *
 * Sunucunun sırası korunur: `filter` girdinin sırasını bozmaz ve burada hiçbir
 * yeniden sıralama yapılmaz — katalog kasıtla `sortOrder` ile seed edilmiştir.
 *
 * @param {Array<object>} permissions
 * @param {{ search?: string, category?: string, status?: string }} filters
 */
export function filterPermissions(permissions, { search = '', category = 'All', status = 'All' } = {}) {
  const term = normalize(search).trim()

  return (permissions ?? []).filter((permission) => {
    if (category !== 'All' && (permission?.category ?? '') !== category) return false
    if (status === 'Active' && !permission?.isActive) return false
    if (status === 'Inactive' && permission?.isActive) return false
    if (!term) return true

    /* Ad, kod ve açıklama birlikte aranır: yönetici bazen "silme" diye
       düşünür, bazen `drawings.delete` diye. */
    return normalize(permission?.name).includes(term)
      || normalize(permission?.code).includes(term)
      || normalize(permission?.description).includes(term)
  })
}

/**
 * Katalogun toplamı ve aktif/pasif dağılımı — daima gelen yanıttan.
 *
 * @param {Array<{ isActive?: boolean }>} permissions
 * @returns {{ total: number, active: number, inactive: number }}
 */
export function countStatuses(permissions) {
  const rows = permissions ?? []
  const active = rows.filter((permission) => permission?.isActive).length
  return { total: rows.length, active, inactive: rows.length - active }
}

/** Süzgeçlerin varsayılandan sapıp sapmadığı — "Filtreleri Temizle" buna bakar. */
export function hasActiveFilters({ search, category, status }) {
  return Boolean(search.trim()) || category !== 'All' || status !== 'All'
}
