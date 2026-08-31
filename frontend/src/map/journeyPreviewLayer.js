import WKT from 'ol/format/WKT.js'
import VectorLayer from 'ol/layer/Vector.js'
import VectorSource from 'ol/source/Vector.js'
import { Stroke, Style } from 'ol/style.js'

/**
 * Yolculuk önizleme geometrisinin KENDİ katmanı.
 *
 * <b>Mevcut ulaşım kaynakları yeniden kullanılmaz.</b> Önizlemeyi
 * <code>useTransportLayer</code>'ın rota/yol kaynağına yazmak üç şeyi birden
 * kırardı: kalıcı güzergahlar bağımsız olarak yenilenemezdi, hatlar arası ya
 * da POI içeren bir yolculuğun "hangi hatta ait olduğu" sorusu cevapsız
 * kalırdı ve sonraki fazın ihtiyaç duyacağı otoriter yolculuk geometrisi
 * kalıcı hat verisiyle karışırdı.
 *
 * <b>Tek bir önizleme yaşar.</b> Kaynak her yazımda temizlenir; React yeniden
 * çizdiğinde ikinci bir çizgi ya da ikinci bir katman oluşmaz.
 */

export const JOURNEY_PREVIEW_LAYER_CLASSNAME = 'journey-preview-layer'
export const JOURNEY_PREVIEW_KIND = 'journey-preview'

/** Ulaşım hatlarının üstünde, canlı aracın altında kalır. */
export const JOURNEY_PREVIEW_Z_INDEX = 12

const wkt = new WKT()

/* Tema farkındalıklı renk: OpenLayers CSS değişkeni okuyamadığı için değer
   burada durur, ama iki tema için de okunaklı seçilmiştir. Dış hat (halo)
   açık zeminde koyu, koyu zeminde açık çizgiyi ayırt edilebilir tutar —
   ulaşım hatlarının kendi renklerinden de görsel olarak ayrışır. */
const PREVIEW_COLOR = '#7C3AED'
const PREVIEW_HALO = 'rgba(255, 255, 255, 0.85)'

const previewStyles = [
  new Style({ stroke: new Stroke({ color: PREVIEW_HALO, width: 9 }), zIndex: 1 }),
  new Style({ stroke: new Stroke({ color: PREVIEW_COLOR, width: 5 }), zIndex: 2 }),
]

export function createJourneyPreviewLayer() {
  const source = new VectorSource()
  const layer = new VectorLayer({
    source,
    className: JOURNEY_PREVIEW_LAYER_CLASSNAME,
    zIndex: JOURNEY_PREVIEW_Z_INDEX,
    style: () => previewStyles,
  })
  return { source, layer }
}

/**
 * Backend WKT'sini harita projeksiyonundaki bir feature'a çevirir.
 *
 * Girdi daima EPSG:4326'dır (backend'in kanonik API biçimi) ve harita
 * EPSG:3857 kullanır; dönüşüm mevcut ulaşım yolu okumasıyla AYNI şekilde
 * yapılır. Bozuk ya da boş bir WKT bir istisna değil <code>null</code>
 * üretir — geç gelen ya da beklenmedik bir gövde haritayı çökertmemelidir.
 */
export function journeyPreviewFeature(geometryWkt) {
  if (typeof geometryWkt !== 'string' || !geometryWkt.trim()) return null
  try {
    const feature = wkt.readFeature(geometryWkt, {
      dataProjection: 'EPSG:4326',
      featureProjection: 'EPSG:3857',
    })
    if (!feature?.getGeometry?.()) return null
    feature.set('featureKind', JOURNEY_PREVIEW_KIND)
    return feature
  } catch {
    return null
  }
}

/**
 * Kaynağı verilen WKT ile eşitler.
 *
 * Her çağrı ÖNCE temizler: eski önizleme deterministik biçimde gider, üst
 * üste binen iki çizgi kalmaz. <code>null</code> geçmek önizlemeyi kaldırır.
 *
 * @returns {import('ol/Feature.js').default | null} yazılan feature
 */
export function syncJourneyPreviewFeature(source, geometryWkt) {
  if (!source) return null
  source.clear()
  const feature = journeyPreviewFeature(geometryWkt)
  if (feature) source.addFeature(feature)
  return feature
}

/**
 * Sol paneli hesaba katan kamera dolgusu.
 *
 * Panel haritanın SOLUNU kapatır; eşit dolgu, yolculuğun bir kısmını panelin
 * altına iterdi. Katlanmış panel daha dardır ve daha az dolgu ister.
 *
 * @returns {[number, number, number, number]} OpenLayers `[üst, sağ, alt, sol]`
 */
export function journeyFitPadding({ panelWidth = 0, compact = false } = {}) {
  const base = compact ? 32 : 48
  // Dar ekranda panel altta durur; soldan itmek yerine alttan yer açılır.
  if (compact) return [base, base, Math.max(base, 220), base]
  return [base, base, base, base + Math.max(0, panelWidth)]
}
