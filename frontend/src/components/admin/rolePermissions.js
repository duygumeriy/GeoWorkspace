/**
 * Yetki matrisinin gösterim yardımcıları.
 *
 * Hiçbir yetkilendirme kararı burada verilmez. Katalog, kategoriler, sıra ve
 * atanmışlık sunucudan gelir; bu dosya yalnızca gelen listeyi ekrana çizilebilir
 * hâle getirir. Yetki kodlarının sabit bir kopyası BİLİNÇLİ olarak tutulmaz —
 * ikinci bir katalog, seed değiştiği gün sessizce yanlışa düşerdi.
 */

/**
 * Teknik kategori anahtarının Türkçe başlığı.
 *
 * Sunucu kategorileri İngilizce ve teknik tutar (`DrawingCreate`, `Users` …);
 * gruplama anahtarıdır, başlık metni değil. Eşleşmeyen bir kategori uydurma bir
 * ada dönüştürülmez, olduğu gibi gösterilir: katalog büyüdüğünde ekran eksik
 * bilgi vermek yerine ham anahtarı gösterip kendini ele verir.
 */
const CATEGORY_LABELS = {
  Map: 'Harita',
  DrawingCreate: 'Çizim Oluşturma',
  DrawingManagement: 'Çizim Yönetimi',
  Tools: 'Araçlar',
  Inventory: 'Envanter',
  Layers: 'Katmanlar',
  Users: 'Kullanıcı Yönetimi',
  Roles: 'Rol Yönetimi',
  Permissions: 'Yetki Yönetimi',
  Geography: 'Coğrafi Yetkilendirme',
}

export function categoryLabel(category) {
  return CATEGORY_LABELS[category] || category || 'Diğer'
}

/**
 * Satırları kategorilere ayırır ve SUNUCUNUN sırasını korur.
 *
 * Yanıt `category`, sonra `sortOrder`, sonra `code` ile sıralı gelir. Burada
 * yeniden sıralamak — alfabetik ya da başka türlü — kasıtla seed edilmiş
 * gösterim sırasını bozardı. Kategoriler ilk görüldükleri sırada, satırlar da
 * geldikleri sırada kalır.
 *
 * @param {Array<{category: string}>} permissions
 * @returns {Array<{ category: string, label: string, items: Array }>}
 */
export function groupByCategory(permissions) {
  const groups = []
  const index = new Map()

  for (const permission of permissions) {
    const key = permission.category ?? ''
    let group = index.get(key)
    if (!group) {
      group = { category: key, label: categoryLabel(key), items: [] }
      index.set(key, group)
      groups.push(group)
    }
    group.items.push(permission)
  }

  return groups
}

/**
 * İki kümenin aynı olup olmadığı.
 *
 * Kirli durum SIRAYA değil ÜYELİĞE bakar: aynı yetkileri farklı sırayla
 * işaretlemek bir değişiklik değildir ve "Kaydet"i açmamalıdır.
 */
export function sameSet(a, b) {
  if (a.size !== b.size) return false
  for (const value of a) if (!b.has(value)) return false
  return true
}

/**
 * Sunucu satırlarından İLK seçim kümesi.
 *
 * Yalnızca AKTİF ve atanmış kodlar girer. Pasif bağlar kümenin dışında tutulur
 * çünkü istek gövdesine hiç girmezler: sunucu pasif kodu reddeder ama rolün
 * mevcut pasif bağlarını kendi korur. Onları buraya almak, ilk kaydetmede 400
 * demek olurdu.
 */
export function assignedActiveCodes(permissions) {
  return new Set(permissions.filter((p) => p.isActive && p.assigned).map((p) => p.code))
}

/** Atanmış ama kullanımdan kaldırılmış satırlar — salt okunur gösterilir. */
export function assignedInactive(permissions) {
  return permissions.filter((p) => !p.isActive && p.assigned)
}

/** İşaretlenebilir satır sayısı: pasif yetkiler yeni atanamaz. */
export function activeCount(permissions) {
  return permissions.filter((p) => p.isActive).length
}
