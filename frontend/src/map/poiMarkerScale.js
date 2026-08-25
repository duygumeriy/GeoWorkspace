/**
 * POI işaretçisinin ÖLÇEĞE göre boyutu — çizimin kendisi değil, kararı.
 *
 * <b>Bağımlılıksızdır:</b> React yoktur, OpenLayers yoktur, DOM yoktur.
 * <c>map/mapView.js</c> ile aynı gerekçe — bir görsel kural, onu uygulayan
 * teknolojiden bağımsız okunabilmeli ve ölçülebilmelidir.
 *
 * <b>GeoServer ile AYNI sayıları, aynı birimde konuşur.</b> Kalıcı gösterim WMS
 * rasteridir ve <c>poi_all</c> stili işaretçiyi ölçek paydası bantlarında çizer.
 * Vektör yedeği raster çekildiği anda devreye girer; farklı bir eşik kullansaydı
 * geçiş anında simge bir de BOYUT değiştirir ve Faz 5A'da çözülen titremenin
 * başka bir biçimi geri gelirdi.
 *
 * <b>Yakınlık kademesi DEĞİL, ölçek paydası.</b> Önceki uygulama tamsayı zoom
 * eşikleri (10, 12) kullanıyordu; bu, SLD eşiklerinin bir YAKLAŞIKLIĞIydı ve
 * kesirli yakınlıklarda (yakınlaşma animasyonu, kaydırma çubuğu, dokunmatik
 * kıstırma) yanlış bandı seçebiliyordu. Artık dönüşüm doğrudan yapılır ve
 * eşiklerin tek kaynağı <see cref="MARKER_SCALE_BANDS"/>'dir.
 */

/**
 * EPSG:3857 çözünürlüğünden (metre/piksel) OGC ölçek paydası.
 *
 * 0.00028 m, OGC'nin kanonik piksel boyutudur (0.28 mm) ve GeoServer'ın
 * varsayılan hesabıyla aynıdır. Web Mercator'da birim zaten metredir
 * (<c>metersPerUnit = 1</c>), dolayısıyla başka bir çarpan gerekmez — ve enlem
 * düzeltmesi YAPILMAZ, çünkü GeoServer da varsayılan olarak yapmaz. İki taraf
 * aynı sayıyı görmelidir.
 */
export const OGC_PIXEL_SIZE_METRES = 0.00028

export function scaleDenominatorFor(resolution) {
  if (!Number.isFinite(resolution) || resolution <= 0) return Number.POSITIVE_INFINITY
  return resolution / OGC_PIXEL_SIZE_METRES
}

/** Bant adları; stil önbelleğinin anahtarı ve yeniden çizim kararı bunlardır. */
export const MARKER_BANDS = Object.freeze({
  veryFar: 'very-far',
  medium: 'medium',
  near: 'near',
})

/**
 * Bantların TEK tanımı: alt ölçek sınırı ve piksel boyutu.
 *
 * Sayılar <c>PoiStyleTemplates</c>'teki <c>VeryFarScaleThreshold</c>,
 * <c>MarkerScaleSplit</c> ve üç işaretçi boyutuyla birebir aynıdır; bir test
 * bunu üretilmiş <c>poi_all.sld</c>'ye karşı doğrular.
 */
export const MARKER_SCALE_BANDS = Object.freeze([
  { band: MARKER_BANDS.veryFar, minScale: 1_000_000, size: 20 },
  { band: MARKER_BANDS.medium, minScale: 150_000, size: 24 },
  { band: MARKER_BANDS.near, minScale: 0, size: 30 },
])

/** Bant → piksel; önbellek ısıtması ve testler için düz bir görünüm. */
export const MARKER_SIZES = Object.freeze(
  Object.fromEntries(MARKER_SCALE_BANDS.map((entry) => [entry.band, entry.size])),
)

/**
 * Ölçek paydasının düştüğü bant.
 *
 * Ölçek bilinmiyorsa (görünüm henüz bir çözünürlük bildirmemişse) EN UZAK bant
 * seçilir: bilinmeyen bir durumda en küçük işaretçiyi çizmek, haritayı devasa
 * rozetlerle açmaktan daha az rahatsız edicidir.
 */
export function markerBandForScale(scaleDenominator) {
  if (!Number.isFinite(scaleDenominator)) return MARKER_BANDS.veryFar
  return MARKER_SCALE_BANDS.find((entry) => scaleDenominator >= entry.minScale).band
}

/** Görünüm çözünürlüğünün (metre/piksel) düştüğü bant. */
export function markerBandForResolution(resolution) {
  return markerBandForScale(scaleDenominatorFor(resolution))
}

/** Görünüm çözünürlüğünün karşılık geldiği işaretçi boyutu (piksel). */
export function markerSizeForResolution(resolution) {
  return MARKER_SIZES[markerBandForResolution(resolution)]
}
