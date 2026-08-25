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
 * Bir POI'ye kasıtlı olarak gidildiğinde YERLEŞİLEN yakınlık.
 *
 * <b>Bu bir alt sınır DEĞİL, bir HEDEFTİR</b> ve fark bilinçlidir.
 * <see cref="focusZoomFor"/>'un "gerekiyorsa yaklaş, asla geri çekme" kuralı
 * genel harita gezinmesi için doğrudur — bir listeden satır seçen kişi
 * kurduğu bağlamı kaybetmemelidir. Bir POI'ye GİTMEK ise farklı bir eylemdir:
 * kullanıcı bilerek başka bir yere gider ve nereye varacağını önceden
 * bilmelidir.
 *
 * Alt sınır olarak uygulansaydı, 19. seviyede çalışan biri başka bir POI
 * arattığında oraya 19'da giderdi: hedefin çevresini göremediği, kullanışsız
 * derecede yakın bir görünüm. Hedef olarak uygulandığında varış her zaman
 * aynı, öngörülebilir POI inceleme ölçeğindedir — gerekirse UZAKLAŞARAK.
 *
 * 16 seçilir çünkü SLD'nin etiket eşiğinin (1:25000 ≈ z15) bir kademe
 * içindedir: varışta POI'nin hem simgesi hem adı görünür. Ayrıca yakın
 * işaretçi bandının (z12 ve içi) rahatça içindedir, dolayısıyla rozet en
 * belirgin boyutundadır.
 *
 * <b>TEK sözleşmedir.</b> Arama sonucuna tıklamak da POI Bilgisi panelindeki
 * "Zoom Yap" da buraya gelir; ikinci bir kamera kuralı, aynı eylemin iki
 * farklı yerde bitmesi demek olurdu.
 */
export const POI_FOCUS_TARGET_ZOOM = 16

/**
 * POI odağının animasyon süresi (ms).
 *
 * Genel <c>duration()</c> 500 ms'dir; POI odağı biraz daha uzun sürer çünkü
 * hareket genelde daha büyüktür (ülke ölçeğinden sokak ölçeğine) ve aynı
 * mesafeyi daha kısa sürede almak sıçrama gibi görünürdü.
 */
export const POI_FOCUS_ANIMATION_MS = 550

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
