/**
 * Kamera KARARLARI — hareketin kendisi değil.
 *
 * <b>Bağımlılıksızdır ve öyle kalmalıdır:</b> React yoktur, OpenLayers yoktur,
 * DOM yoktur. Buradaki her şey saf sayı hesabıdır ve tek başına okunabilir,
 * tek başına ölçülebilir. Hareketin kendisi (animasyon, süre, görünüm nesnesi)
 * <c>hooks/useMapView.js</c>'dedir ve bu modülü oradan kullanır.
 *
 * <b>Neden ayrı bir dosya.</b> Yakınlık kuralı bir tarayıcı yeteneği değil, bir
 * iş kuralıdır: "gerekiyorsa yaklaş, ama asla geri çekme". Onu haritayı kuran
 * kancanın içinde bırakmak, kuralı okumak ya da doğrulamak isteyen her yerin
 * OpenLayers'ın tamamını yanında taşıması demek olurdu. Aynı ayrım
 * <c>map/drawingFilters.js</c> ve <c>map/poiFilters.js</c>'de de vardır.
 */

/**
 * Tek bir noktanın "işe yarar" yakınlık düzeyi: sokak ölçeği.
 *
 * Tek yerde tanımlıdır ve hem nokta benzeri bir extent'e sığdırma hem de
 * <see cref="focusZoomFor"/> tarafından okunur; ikinci bir sabit, aynı sorunun
 * iki farklı yanıtı olurdu.
 */
export const POINT_ZOOM = 15

/**
 * Bir noktaya odaklanırken kullanılacak yakınlık.
 *
 * Kural tek cümledir: <b>gerekiyorsa yaklaş, ama asla geri çekme.</b> Ülke
 * ölçeğinden bir POI satırına tıklayan biri noktayı görebilmeli, sokak
 * ölçeğinde çalışan biri de bir satıra tıkladı diye kurduğu bağlamı
 * kaybetmemelidir. Sabit bir yakınlık ikincisini her seferinde geri çekerdi.
 *
 * Görünüm henüz bir yakınlık bildirmemişse (sonlu olmayan değer) taban 0 kabul
 * edilir, dolayısıyla sonuç <c>minZoom</c> olur — "bilinmiyor" durumu kullanıcıyı
 * rastgele bir yere götürmez.
 */
export function focusZoomFor(currentZoom, minZoom = POINT_ZOOM) {
  return Math.max(Number.isFinite(currentZoom) ? currentZoom : 0, minZoom)
}
