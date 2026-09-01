/**
 * Yolculuk planlayıcısının KAPLADIĞI alan — tek bir yerde.
 *
 * <b>Neden ayrı bir modül.</b> Panelin genişliği daha önce İKİ yerde yaşıyordu:
 * CSS'te bir sayı, kamera dolgusunda elle yazılmış başka bir sayı. İkisi
 * ayrıştığı anda harita, güzergahın bir kısmını panelin altına iterek
 * "sığdırdığını" sanıyordu. Ölçüler burada TANIMLANIR; CSS onları özel
 * değişken olarak tüketir (bileşen değerleri satır içi stil olarak yazar),
 * kamera ise aynı sayılardan dolgu üretir.
 *
 * <b>İşaretçi yeteneği bir DÜZEN ÖLÇÜSÜ DEĞİLDİR.</b> Dokunmatik bir dizüstü
 * geniş ekranlıdır, dar bir masaüstü penceresi ise fare kullanır. Düzenin tek
 * ölçütü görüntü alanı genişliğidir ve o ölçüt <code>JOURNEY_COMPACT_QUERY</code>
 * ile CSS'teki kesme noktasının BİREBİR aynısıdır.
 */

/** Uygulamanın dar-ekran kesme noktası (640/641 ailesi). CSS ile aynıdır. */
export const JOURNEY_COMPACT_BREAKPOINT = 640

/** `useMediaQuery` için hazır sorgu: CSS `@media (max-width: 640px)` ile eş. */
export const JOURNEY_COMPACT_QUERY = `(max-width: ${JOURNEY_COMPACT_BREAKPOINT}px)`

/** Geniş ekranda panelin genişliği (px). CSS bunu değişken olarak alır. */
export const JOURNEY_PANEL_WIDTH = 340

/** Panelin sol kenar boşluğu: kısayol yığınının sağında durur (4.25rem). */
export const JOURNEY_PANEL_LEFT = 68

/** Dar ekranda alt sayfanın kapladığı şerit (px). CSS bunu değişken olarak alır. */
export const JOURNEY_SHEET_HEIGHT = 240

/** Kameranın her kenarda bıraktığı nefes payı. */
export const JOURNEY_FIT_EDGE = 48
export const JOURNEY_FIT_EDGE_COMPACT = 32

/**
 * Panelin haritadan çaldığı alan.
 *
 * Panel görünmüyorsa (kapalı ya da başka bir bağlam devraldı) hiçbir şey
 * ayrılmaz: harita tamamı kullanılabilir olduğunda güzergahı ortada göstermek
 * doğrudur.
 *
 * @returns {{ left: number, bottom: number }} piksel cinsinden güvenli alan
 */
export function journeyMapInset({ compact = false, panelVisible = false } = {}) {
  if (!panelVisible) return { left: 0, bottom: 0 }

  /* Dar ekranda panel SOLU değil ALTI kapatır; geniş ekranda tam tersi.
     Aynı anda ikisini birden ayırmak, haritanın kullanılabilir alanını
     gereksiz yere küçültürdü. */
  return compact
    ? { left: 0, bottom: JOURNEY_SHEET_HEIGHT }
    : { left: JOURNEY_PANEL_LEFT + JOURNEY_PANEL_WIDTH, bottom: 0 }
}

/**
 * Önizleme/uyum kamerasının dolgusu.
 *
 * <b>Kamera algoritması DEĞİŞMEZ</b>: uyum yine `previewToken` başına bir kez
 * çalışır, zum verilmez. Burada yalnızca "hangi kenarda ne kadar yer kapalı"
 * sorusu cevaplanır.
 *
 * @returns {[number, number, number, number]} OpenLayers `[üst, sağ, alt, sol]`
 */
export function journeyFitPadding({ compact = false, panelVisible = false } = {}) {
  const edge = compact ? JOURNEY_FIT_EDGE_COMPACT : JOURNEY_FIT_EDGE
  const inset = journeyMapInset({ compact, panelVisible })

  return [edge, edge, edge + inset.bottom, edge + inset.left]
}

/**
 * Panelin kendi ölçülerini CSS'e taşıyan özel değişkenler.
 *
 * Sayı JS'te tanımlıdır ve CSS onu tüketir; böylece 340 ya da 240 gibi bir
 * değer iki dosyada birden yaşamaz.
 */
export function journeyPanelStyle() {
  return {
    '--journey-panel-width': `${JOURNEY_PANEL_WIDTH}px`,
    '--journey-panel-left': `${JOURNEY_PANEL_LEFT}px`,
    '--journey-sheet-height': `${JOURNEY_SHEET_HEIGHT}px`,
  }
}
