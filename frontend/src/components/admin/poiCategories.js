/**
 * Kategori ağacının arayüz tarafındaki saf yardımcıları: durum etiketi, üst
 * kategori seçenekleri ve güvenli girinti.
 *
 * <b>İş kuralının sahibi backend'dir.</b> Buradaki eleme yalnızca UX içindir —
 * kullanıcıya sunucunun zaten reddedeceği bir seçeneği göstermemek. Döngü
 * koruması, üst kategori geçerliliği ve silinmiş satır kuralları sunucuda
 * yeniden uygulanır ve orada verilen karar bağlayıcıdır.
 */

/** Girintinin görsel üst sınırı: çok derin bir yol satırı taşırmasın. */
export const MAX_INDENT_DEPTH = 6

/**
 * Kategorinin gösterim durumu.
 *
 * Silinmişlik önceliklidir: soft-delete edilmiş bir satır pasif de olabilir ve
 * o durumda anlamlı olan bilgi silinmiş olmasıdır.
 */
export function categoryStatus(category) {
  if (category.isDeleted) return { label: 'Silinmiş', tone: 'danger' }
  if (category.isActive) return { label: 'Aktif', tone: 'success' }
  return { label: 'Pasif', tone: 'warning' }
}

/** Girinti seviyesi; derin yollarda sabitlenir. */
export function indentOf(category) {
  return Math.min(category.depth ?? 0, MAX_INDENT_DEPTH)
}

/**
 * Yeni bir kategorinin ya da yeniden konumlandırılan bir kategorinin
 * seçebileceği üst kategoriler.
 *
 * Elenenler:
 * <ul>
 *   <li>silinmiş ve pasif satırlar — sunucu da bunları reddeder; doğduğu anda
 *       görünmeyen bir dal yaratmanın anlamı yok,</li>
 *   <li>düzenlenen kategorinin KENDİSİ — kendi üstü olamaz,</li>
 *   <li>düzenlenen kategorinin alt ağacı — `path` ön eki üzerinden, veri buna
 *       elveriyorsa.</li>
 * </ul>
 *
 * <b>Alt ağaç elemesi bir garanti değil, bir kolaylıktır.</b> `path` adlardan
 * üretilir ve aynı adlı kardeşler teorik olarak yanlış eşleşebilir; bu yüzden
 * eleme "kesin doğru" iddiasında bulunmaz. Emin olunamayan her durumda seçenek
 * listede kalır ve kararı sunucunun döngü koruması verir — tarayıcıda ikinci
 * bir özyinelemeli kural motoru yazmak, iki ayrı gerçek kaynağı demek olurdu.
 */
export function parentOptions(categories, editing = null) {
  const usable = categories.filter((category) => category.isActive && !category.isDeleted)

  if (!editing) return usable

  const prefix = editing.path ? `${editing.path} / ` : null

  return usable.filter((category) => {
    if (category.id === editing.id) return false
    // Alt ağaç: yolu düzenlenen kategorinin yolu ile başlayanlar.
    return !(prefix && typeof category.path === 'string' && category.path.startsWith(prefix))
  })
}

/** Açılır listede yolu gösterilir ki aynı adlı kardeşler ayırt edilebilsin. */
export function optionLabel(category) {
  return category.path || category.name
}
