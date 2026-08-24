import { foldForSearch } from './drawingFilters.js'

/**
 * POI kategori aramasının TEK tanımı: normalizasyon, eşleşme ve sıralama.
 *
 * <b>Arama normalizasyonu burada YENİDEN yazılmaz.</b> `foldForSearch`
 * uygulamanın tek Türkçe-duyarlı katlama fonksiyonudur (küçük harf, aksan
 * ayrıştırma, ı/ğ eşlemesi) ve çizim/çöp kutusu aramaları da onu kullanır.
 * Kategoriler için ikinci bir kopya yazmak, "kafe" ile "Kafé"nin bir ekranda
 * eşleşip diğerinde eşleşmemesi demek olurdu.
 *
 * <b>Eşleşme hem ADA hem YOLA bakar.</b> "kafe" yazan kişi yaprağı arar,
 * "Yeme" yazan kişi bütün dalı; ikisi de aynı alandan sorulur:
 *
 *   "kafe" -> Yeme-İçme / Kafe
 *   "Yeme" -> Yeme-İçme, Yeme-İçme / Kafe, Yeme-İçme / Restoran
 *
 * <b>Kullanılamaz kategori seçilemez.</b> Pasif ve silinmiş satırlar listeden
 * DÜŞÜRÜLÜR; sunucu da onları reddeder, dolayısıyla göstermek yalnızca garanti
 * bir 400'e davet olurdu. Bu bir güvenlik sınırı değil, sunucunun kuralının
 * arayüzdeki yansımasıdır.
 */

/** Kategori POI'ye bağlanabilir mi. Alan yoksa (harita ucu) satır kullanılabilir. */
export function isSelectableCategory(category) {
  if (!category) return false
  if (category.isDeleted === true) return false
  return category.isActive !== false
}

/** Satırın gösterilecek etiketi: yol varsa yol, yoksa ad. */
export function categoryLabel(category) {
  return category?.path || category?.name || ''
}

/** Aranabilir metin: ad + tam yol. */
function haystack(category) {
  return foldForSearch(`${category?.name ?? ''} ${category?.path ?? ''}`)
}

/**
 * Aramayı uygular.
 *
 * Boş sorgu her şeyi döndürür (seçilebilir olanları): arama alanı bir filtre
 * kutusudur, listeyi gizleyen bir kapı değil.
 *
 * @param {Array<{id:number,name:string,path?:string,isActive?:boolean,isDeleted?:boolean}>} categories
 * @param {string} query
 * @returns {Array} eşleşenler, yola göre sıralı
 */
export function searchPoiCategories(categories, query) {
  const usable = (categories ?? []).filter(isSelectableCategory)
  const needle = foldForSearch(query ?? '')

  const matched = needle ? usable.filter((category) => haystack(category).includes(needle)) : usable

  /* Sıralama YOLA göredir: her alt ağaç kendi üstünün ardında durur ve liste
     hiyerarşi gibi okunur. Sunucu da aynı anahtarı kullanır
     (PoiCategoryHierarchy.SortKey); burada yeniden sıralanması, sunucudan
     farklı sıralanmış bir listeyi filtrelemenin sonucu bozmamasını sağlar. */
  return [...matched].sort((a, b) =>
    categoryLabel(a).localeCompare(categoryLabel(b), 'tr', { sensitivity: 'base' }),
  )
}
