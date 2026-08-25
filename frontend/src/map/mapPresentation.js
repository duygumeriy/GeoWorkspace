/**
 * The normal (persisted) drawing presentation raster.
 *
 * Phase 5 moves the *general display* of saved drawings to WMS: the browser
 * asks the application's own authenticated endpoint for a PNG per geometry
 * type and stacks the three images over the basemap. The WFS-backed vector
 * features stay loaded and keep owning interaction — selection, the popup,
 * Modify, Translate and the analysis links all still work on real features.
 *
 * `heatmap.js` deliberately keeps its own copy of the size/bbox helpers: the
 * heatmap is a finished, separately-tested Phase 3/4 path and Phase 5 does not
 * touch it. The two share the backend's limits, not a module.
 */

/* Render order. The geographic-scope overlay sits at 4 and the heatmap at 6;
   the interaction vectors stay at 10 and the pending shape at 12.
   The three presentation rasters therefore live in 7–9, which keeps the
   heatmap BELOW the drawings exactly as it is today — placing them under the
   heatmap would have inverted the existing stack and let the density blobs
   paint over the user's own shapes. Points draw last so a point is never
   buried under a polygon it sits inside. */
export const PRESENTATION_Z_INDEX = Object.freeze({
  polygon: 7,
  line: 8,
  point: 9,
})

/**
 * POI sunum rasteri.
 *
 * <b>11</b>: çizim sunum rasterlarının (7–9) ve çizim etkileşim vektörlerinin
 * (10) ÜSTÜNDE, bekleyen çizim şeklinin (12), POI etkileşim katmanının (13),
 * POI yerleştirme işaretinin (14) ve tüm geçici düzenleme katmanlarının
 * ALTINDA.
 *
 * Üstte olmasının sebebi POI'nin küçük bir nokta olmasıdır: büyük bir poligonun
 * altında kalan bir POI görünmez olurdu. Geçici düzenleme katmanlarının altında
 * kalmasının sebebi ise tersidir — kullanıcının az önce koyduğu ya da
 * sürüklediği işaret hiçbir zaman kalıcı bir görüntünün altında kaybolmamalıdır.
 *
 * Mevcut hiçbir katmanın numarası DEĞİŞTİRİLMEDİ: 11 zaten boştu.
 */
export const POI_PRESENTATION_Z_INDEX = 11

/** Same debounce as the heatmap: one request per settled viewport, not per frame. */
export const PRESENTATION_REQUEST_DEBOUNCE_MS = 180

/** Mirrors WmsRenderContract on the backend; the server re-checks all of it. */
export const PRESENTATION_IMAGE_LIMITS = Object.freeze({
  minSide: 64,
  maxSide: 2048,
  maxPixels: 4_194_304,
})

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

/** Backend `WmsRenderContract.MinimumPixelRatio`/`MaximumPixelRatio` ile aynı. */
export const PRESENTATION_PIXEL_RATIO_LIMITS = Object.freeze({ min: 1, max: 3 })

/**
 * A sharp request size that never exceeds the backend contract. The aspect
 * ratio is preserved while the max-side and total-pixel limits are applied;
 * very small viewports still satisfy the 64px minimum.
 *
 * <b>İSTENEN yoğunluk ile ELDE EDİLEN yoğunluk aynı şey değildir</b> ve fark
 * önemlidir. Boyutlar kırpılabilir: geniş bir pencerede 1600 CSS pikseli, oran
 * 2 ile 3200 ister, 2048'e kırpılır ve gerçekte elde edilen yoğunluk 1.28
 * olur. Sunucuya İSTENEN oran bildirilseydi, GeoServer sembolleri 2 katıyla
 * çizer ama görüntü yalnızca 1.28 katı yoğun olurdu — simgeler bu kez ters
 * yönde, %56 büyük görünürdü.
 *
 * Bu yüzden dönen `pixelRatio` her zaman ÖLÇÜLEN orandır: son genişliğin CSS
 * genişliğine bölümü. Ölçü DPI'ı yalnızca bundan türer.
 */
export function presentationImageSize(mapSize, devicePixelRatio = 1) {
  const [cssWidth = 0, cssHeight = 0] = mapSize ?? []
  const ratio = clamp(
    Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1,
    PRESENTATION_PIXEL_RATIO_LIMITS.min,
    PRESENTATION_PIXEL_RATIO_LIMITS.max,
  )
  let width = Math.max(PRESENTATION_IMAGE_LIMITS.minSide, Math.round(cssWidth * ratio))
  let height = Math.max(PRESENTATION_IMAGE_LIMITS.minSide, Math.round(cssHeight * ratio))

  const scale = Math.min(
    1,
    PRESENTATION_IMAGE_LIMITS.maxSide / width,
    PRESENTATION_IMAGE_LIMITS.maxSide / height,
    Math.sqrt(PRESENTATION_IMAGE_LIMITS.maxPixels / (width * height)),
  )

  width = clamp(Math.floor(width * scale), PRESENTATION_IMAGE_LIMITS.minSide, PRESENTATION_IMAGE_LIMITS.maxSide)
  height = clamp(Math.floor(height * scale), PRESENTATION_IMAGE_LIMITS.minSide, PRESENTATION_IMAGE_LIMITS.maxSide)

  /* Boyutlar BURADA da yalnızca BİR KEZ çarpılır. Ölçülen oran hesaplanan
     genişlikten OKUNUR, yeniden çarpılarak değil — ikinci bir çarpım piksel
     bütçesini sessizce dört katına çıkarırdı. */
  const measured = cssWidth > 0 ? width / cssWidth : ratio

  return {
    width,
    height,
    pixelRatio: clamp(
      Number.isFinite(measured) ? measured : 1,
      PRESENTATION_PIXEL_RATIO_LIMITS.min,
      PRESENTATION_PIXEL_RATIO_LIMITS.max,
    ),
  }
}

export function presentationBbox(extent) {
  if (!Array.isArray(extent) || extent.length !== 4 || !extent.every(Number.isFinite)) return null
  if (extent[0] >= extent[2] || extent[1] >= extent[3]) return null
  return extent.join(',')
}
