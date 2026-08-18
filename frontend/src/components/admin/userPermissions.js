/**
 * Kullanıcı yetki tablosunun gösterim yardımcıları.
 *
 * Hiçbir yetkilendirme kararı burada verilmez. Kaynak (rolden mi, doğrudan mı),
 * etki ve mutasyon kabiliyeti sunucudan gelir; bu dosya yalnızca gelen listeyi
 * ekrana çizilebilir hâle getirir.
 *
 * Kategori adları ve gruplama BİLİNÇLİ olarak `rolePermissions.js`'ten
 * devralınır. Üçüncü bir kategori kaynağı, iki ekranın aynı yetkiyi farklı
 * başlıklar altında göstermesi demek olurdu.
 */
export { categoryLabel, groupByCategory, sameSet } from './rolePermissions.js'

/**
 * Sunucu satırlarından İLK seçim kümesi: yalnızca AKTİF ve DOĞRUDAN atamalar.
 *
 * Rolden gelen yetkiler bu kümeye GİRMEZ. Çalışma kümesi "etkin yetkiler"
 * değil, "kullanıcıya özel olarak verilmiş yetkiler"dir; ikisi karıştırılırsa
 * kaydetme isteği rolden gelen kodları da taşır ve sunucu haklı olarak 400
 * döner.
 *
 * Pasif yetkilere ait tarihsel satırlar da dışarıda kalır: istek gövdesine hiç
 * girmezler ve sunucu onları isteğe bakmadan korur.
 */
export function directActiveCodes(permissions) {
  return new Set(permissions.filter((p) => p.isActive && p.directAssigned).map((p) => p.code))
}

/** Doğrudan atanmış ama kullanımdan kaldırılmış satırlar — salt okunur. */
export function preservedInactiveDirect(permissions) {
  return permissions.filter((p) => !p.isActive && p.directAssigned)
}

/**
 * Satırın kaynağını anlatan metinler.
 *
 * Rozet RENGİ tek başına yeterli değildir: kaynak bilgisi ekran okuyucuya ve
 * renk ayrımı yapamayan kullanıcıya da ulaşmalıdır, bu yüzden her durum bir
 * CÜMLEYLE karşılanır.
 *
 * Bir satırda İKİ kaynak birden olabilir (önce doğrudan verilmiş, sonra rol de
 * vermeye başlamış). Bu durumda ikisi de gösterilir; yalnızca birini göstermek,
 * fazlalık kaydı kaldırmak isteyen yöneticiden onun varlığını gizlerdi.
 */
export function sourceNotes(item) {
  const notes = []

  if (item.inheritedFromRoles.length > 0) {
    notes.push(`${item.inheritedFromRoles.join(' + ')} rolünden`)
  }

  if (item.directAssigned) {
    notes.push(item.inheritedFromRoles.length > 0 ? 'Kullanıcıya özel kayıt mevcut' : 'Kullanıcıya özel')
  }

  return notes
}

/**
 * Satırın onay kutusunun değiştirilebilir olup olmadığı.
 *
 * Karar tamamen SUNUCUNUN bayraklarına dayanır; rol adına bakılmaz. Ayrım
 * temeldeki duruma göre yapılır:
 *
 * - satır zaten doğrudan atanmışsa soru "kaldırılabilir mi" (`canRemoveDirect`),
 * - atanmamışsa soru "atanabilir mi" (`canAssignDirect`).
 *
 * İkinci kural, yöneticinin henüz kaydetmediği kendi eklemesini geri almasını da
 * doğal olarak kapsar: ekleyebiliyorsa geri de alabilir.
 *
 * Rolden gelen ve doğrudan atanmamış bir satır için sunucu `canAssignDirect`'i
 * false verir, dolayısıyla kilitli kalır — arayüz kuralı backend'in kuralını
 * TEKRARLAMAZ, ondan okur.
 */
export function isToggleable(item, baseline, editable) {
  if (!editable || !item.isActive) return false
  return baseline.has(item.code) ? item.canRemoveDirect : item.canAssignDirect
}
