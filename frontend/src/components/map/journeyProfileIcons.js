import { Bike, Car, Footprints } from 'lucide-react'

/**
 * Seyahat profillerinin TEK görsel sözlüğü.
 *
 * <b>Neden tek bir tablo.</b> Panel profesyonel bir ikon dili konuşurken
 * haritadaki işaretçi ayrı bir emoji sözlüğü kullanıyordu: aynı yolculuk,
 * panelde çizgi ikon, haritada işletim sistemine göre değişen renkli bir
 * resimdi. Üç profilin görsel kimliği tek yerde tanımlanır ve iki taraf da
 * buradan okur; ikinci bir eşleme, zamanla ayrışan iki ayrı görünüm demekti.
 *
 * <b>Kimlik KANONİK profil kimliğidir</b> (`driving` / `walking` / `cycling`),
 * bir ara etiket değil. Backend'in bildiği değer neyse tablo onunla anahtarlanır;
 * "car" gibi bir sunum adı üzerinden dolaşmak, sunucudan gelen profili ekranda
 * göstermek için ikinci bir çeviri katmanı gerektirirdi.
 *
 * <b>Otobüs/tramvay/tren YOKTUR.</b> Projede transit grafiği ya da tarife
 * altyapısı yok; desteklenmeyen bir profil için ikon tanımlamak, olmayan bir
 * yeteneği ima etmek olurdu.
 *
 * <b>Yeni bir ikon paketi AÇILMAZ.</b> Uygulamanın halihazırdaki görsel dili
 * lucide-react'tir (kenar çubuğu, araç çubuğu, POI rozetleri); buradaki üç
 * sembol de oradan gelir.
 */

/** Kanonik profil → Lucide bileşeni. Tam olarak üç giriş. */
export const JOURNEY_PROFILE_ICONS = Object.freeze({
  driving: Car,
  walking: Footprints,
  cycling: Bike,
})

/**
 * Bilinmeyen bir profil ÇÖKERTMEZ.
 *
 * Sunucu sözleşmesi üç profille sınırlı olsa da arayüz savunmacı davranır:
 * beklenmedik bir değer, olmayan bir taşıma türü uydurmak yerine sürüş
 * görünümüne düşer.
 */
export const JOURNEY_FALLBACK_PROFILE_ICON = Car

export function journeyProfileIcon(profileId) {
  return JOURNEY_PROFILE_ICONS[profileId] ?? JOURNEY_FALLBACK_PROFILE_ICON
}
