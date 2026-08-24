import { buildWorkHoursPayload, workHoursEqual, workHoursToDraft } from './workHours.js'
import { coordinatesEqual } from './poiCoordinates.js'

/**
 * POI düzenleme taslağının "kirli mi" kararının TEK tanımı.
 *
 * Haritadaki form ve yönetim panelindeki diyalog aynı kaydı aynı sözleşmeyle
 * düzenler; kuralın iki kopyası, ilk değişiklikte birinin diğerinden sapması
 * demek olurdu.
 *
 * <b>Kural VEYA'dır, VE değil.</b> Kullanıcının her alanı değiştirmesi
 * beklenmez: yalnızca adı, yalnızca kategoriyi, yalnızca tek bir mesai gününü
 * ya da yalnızca konumu değiştirmek kaydetmeyi açmaya yeter.
 *
 * <b>Karşılaştırma ANLAMCADIR.</b> Bir alanı değiştirip tam olarak eski hâline
 * döndürmek kirli DEĞİLDİR — mesai programı için de öyle (bkz.
 * <c>workHoursEqual</c>). Ad, kaydedilen değerle aynı ölçüde kırpılarak
 * kıyaslanır; başına boşluk eklemek bir değişiklik sayılmaz.
 */

/**
 * Formun düzenlediği alanların anlık hâli.
 *
 * Konum artık bu listededir: POI taşınabilir bir kayıttır ve "değişti mi"
 * sorusunun kapsamı dışında kalsaydı, yalnızca noktayı sürükleyen bir kullanıcı
 * "Güncelle"yi kapalı bulurdu.
 */
export function poiDraftSnapshot(poi) {
  return {
    name: poi?.name ?? '',
    categoryId: poi?.categoryId ?? null,
    workHours: workHoursToDraft(poi?.workHours),
    longitude: poi?.longitude,
    latitude: poi?.latitude,
  }
}

/** Taslak, açılıştaki hâlinden farklı mı. */
export function isPoiDraftDirty(original, draft) {
  if (!original) return true

  if ((draft?.name ?? '').trim() !== (original.name ?? '').trim()) return true
  if ((draft?.categoryId ?? null) !== (original.categoryId ?? null)) return true

  /* Program kanonik gövdeye çevrilip karşılaştırılır: taslak biçimi (enabled /
     closed / open / close) doğrudan kıyaslansaydı, dokunulup eski hâline
     döndürülen bir gün "değişti" görünürdü. */
  if (!workHoursEqual(
    buildWorkHoursPayload(draft?.workHours) ?? {},
    buildWorkHoursPayload(original.workHours) ?? {},
  )) {
    return true
  }

  /* Konumu HİÇ düzenlemeyen bir çağıran (alanları sunmayan bir ekran) bu
     eksende kirlilik üretmez: alan yoksa karşılaştırılacak bir şey de yoktur.
     `undefined` ile bir sayıyı kıyaslamak, formu açar açmaz kirli gösterirdi. */
  if (draft?.longitude === undefined && draft?.latitude === undefined) return false

  /* Kıyas EŞİKLİDİR: haritadaki işaret EPSG:3857'de yaşar ve 4326'ya geri
     çevrilirken son basamaklarda gürültü doğar. Ham eşitlik, işarete yalnızca
     dokunmayı bile "taşındı" sayardı; gerçek bir taşıma ise eşiğin çok
     üstündedir. */
  return !coordinatesEqual(
    { longitude: draft?.longitude, latitude: draft?.latitude },
    { longitude: original.longitude, latitude: original.latitude },
  )
}
