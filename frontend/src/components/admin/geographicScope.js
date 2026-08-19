import { geometryToWkt4326, wkt4326ToFeature } from '../../map/drawing.js'

/**
 * Sunucudan gelen WKT'yi OpenLayers'ın yazdığı biçime getirir.
 *
 * "Kaydedilmemiş değişiklik var mı" sorusu iki dizgenin karşılaştırılmasıyla
 * cevaplanır. Biri sunucunun (NetTopologySuite), diğeri tarayıcının
 * (OpenLayers) biçimlendirmesiyle yazılırsa — ondalık basamak sayısı, boşluk,
 * kapanış köşesi — hiç dokunulmamış bir alan bile "değişmiş" görünürdü ve
 * yönetici her kapatışta gereksiz bir onay penceresiyle karşılaşırdı.
 *
 * Bu yüzden temel değer de ekrandaki geometriyle AYNI yoldan geçirilir:
 * 4326 → 3857 → 4326. Dokunulmamış bir alanda iki dizge birebir eşleşir.
 *
 * Topolojik denklik hesaplanmaz ve hesaplanmamalıdır: aynı alanı farklı köşe
 * sırasıyla yeniden çizmek "değişiklik yok" saymak, JS tarafında bir geometri
 * denklik kütüphanesi kurmak demekti. Kaydetmeye izin vermek zaten zararsızdır;
 * sunucu aynı alanı ikinci kez yazar.
 *
 * @param {string|null|undefined} wkt
 * @returns {string|null}
 */
export function normalizeScopeWkt(wkt) {
  if (!wkt) return null
  const feature = wkt4326ToFeature(wkt)
  if (!feature) return null
  const geometry = feature.getGeometry()
  return geometry ? geometryToWkt4326(geometry) : null
}

/**
 * Kullanıcıya rollerinden gelen ve buradan DÜZENLENEMEYEN alan.
 *
 * Yalnızca kullanıcı hedefinde ve yalnızca kullanıcının kendi alanı YOKKEN
 * anlamlıdır: doğrudan alan varken Phase 8A kuralı gereği roller hiç okunmaz,
 * dolayısıyla yürürlükteki alan zaten doğrudan alanın kendisidir. Rol
 * hedefinde miras diye bir şey yoktur.
 *
 * @param {'user'|'role'} targetType
 * @param {{ hasDirectAuthorization?: boolean, isRestricted?: boolean, effectiveWkt?: string|null }|null} data
 * @returns {string|null}
 */
export function inheritedScopeWkt(targetType, data) {
  if (targetType !== 'user' || !data) return null
  if (data.hasDirectAuthorization) return null
  return data.isRestricted ? (data.effectiveWkt ?? null) : null
}
