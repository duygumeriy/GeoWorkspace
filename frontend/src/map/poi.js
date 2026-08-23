import VectorLayer from 'ol/layer/Vector.js'
import VectorSource from 'ol/source/Vector.js'
import Feature from 'ol/Feature.js'
import Point from 'ol/geom/Point.js'
import { fromLonLat, toLonLat } from 'ol/proj.js'
import Style from 'ol/style/Style.js'
import Fill from 'ol/style/Fill.js'
import Stroke from 'ol/style/Stroke.js'
import CircleStyle from 'ol/style/Circle.js'
import { DATA_PROJECTION, MAP_PROJECTION } from './drawing.js'

/**
 * Haritadaki POI katmanı: kaynak, stil, projeksiyon dönüşümü ve feature
 * eşlemesi.
 *
 * <b>POI bir ÇİZİM DEĞİLDİR.</b> Kendi kaynağı, kendi katmanı ve kendi
 * className'i vardır; çizim kaynağına hiçbir koşulda girmez. Girseydi POI'ler
 * çizim listesine, toplu seçime, toplu silmeye ve stil düzenleyicisine
 * kendiliğinden karışır ve <c>/api/drawings/*</c> uçlarına gönderilebilir hâle
 * gelirdi.
 *
 * <b>GeoServer kullanılmaz.</b> POI verisi REST'ten gelir ve istemci tarafı bir
 * vektör kaynağında yaşar: tıklama isabet denetimi ve bilgi paneli, sunucuda
 * üretilmiş bir WMS görüntüsüyle mümkün olmazdı.
 */

/** Kendi canvas'ı: koyu tema tile filtresi bu katmana uygulanmaz. */
export const POI_LAYER_CLASSNAME = 'poi-layer'

/** Yerleştirilmiş ama henüz kaydedilmemiş nokta için ayrı canvas. */
export const POI_PENDING_LAYER_CLASSNAME = 'poi-pending-layer'

/**
 * Katman sırası.
 *
 * Mevcut yığın: temel harita 0–1, coğrafi kapsam 4, ısı haritası 6, sunum
 * rasterları 7–9, çizimler 10, bekleyen çizim 12, envanter analizi 15, analiz
 * vurgusu 18, ölçüm/vertex 20, konum işareti 30.
 *
 * POI kalıcı katmanı <b>13</b>'tedir: çizimlerin ve bekleyen şeklin ÜSTÜNDE,
 * çünkü POI küçük bir noktadır ve büyük bir poligonun altında kalırsa
 * tıklanamaz hâle gelir. Geçici yerleştirme işareti <b>14</b> ile onun da
 * üstündedir — kullanıcının az önce koyduğu nokta her zaman görünür olmalıdır.
 * İkisi de envanter analizinin (15) ve tüm geçici düzenleme katmanlarının
 * ALTINDA kalır; harita denetimleri DOM'da olduğu için hiçbir zIndex onları
 * örtmez.
 */
export const POI_LAYER_Z_INDEX = 13
export const POI_PENDING_LAYER_Z_INDEX = 14

/** Mavi: mor çizimlerden, kehribar analizden ve camgöbeği ölçümden ayrı. */
const POI_COLOR = '#2563EB'
const POI_SELECTED_COLOR = '#1D4ED8'

/** Beyaz halka POI'yi hem açık hem koyu temel haritada okunur tutar. */
const HALO = '#FFFFFF'

/** Feature ayırt edici. Çizim feature'ları `drawingType` taşır, POI bunu. */
export const POI_FEATURE_KIND = 'poi'

const basePoi = (selected) =>
  new Style({
    image: new CircleStyle({
      // Seçili POI yalnızca renkle değil BOYUTLA da ayrılır.
      radius: selected ? 9 : 7,
      fill: new Fill({ color: selected ? POI_SELECTED_COLOR : POI_COLOR }),
      stroke: new Stroke({ color: HALO, width: selected ? 3 : 2 }),
    }),
  })

const POI_STYLE = basePoi(false)
const POI_SELECTED_STYLE = basePoi(true)

/** Bekleyen nokta kesikli halkayla "henüz kaydedilmedi" der. */
const POI_PENDING_STYLE = new Style({
  image: new CircleStyle({
    radius: 8,
    fill: new Fill({ color: 'rgba(37, 99, 235, 0.35)' }),
    stroke: new Stroke({ color: POI_COLOR, width: 2, lineDash: [4, 3] }),
  }),
})

/**
 * Kalıcı POI katmanı.
 *
 * Stil bir FONKSİYONDUR: seçili POI'nin kimliği React state'inde yaşar ve
 * katman her render'da yeniden kurulmadan onu okuyabilmelidir. Sabit bir stil
 * verilseydi seçim değiştikçe katmanı yeniden yaratmak gerekirdi.
 *
 * @param {() => number|null} getSelectedId
 */
export function createPoiLayer(getSelectedId) {
  const source = new VectorSource()
  const layer = new VectorLayer({
    source,
    className: POI_LAYER_CLASSNAME,
    zIndex: POI_LAYER_Z_INDEX,
    style: (feature) => (feature.get('poiId') === getSelectedId() ? POI_SELECTED_STYLE : POI_STYLE),
  })

  return { source, layer }
}

/**
 * Yerleştirilmiş ama kaydedilmemiş nokta.
 *
 * Kalıcı kaynaktan AYRI olması bilinçlidir: kaydedilmemiş bir nokta POI
 * listesine girmemeli, tıklandığında bilgi paneli açmamalı ve iptal edildiğinde
 * ortak kaynaktan geri çekilmesi gerekmemelidir. Bekleyen çizim katmanıyla
 * aynı gerekçe.
 */
export function createPoiPendingLayer() {
  const source = new VectorSource()
  const layer = new VectorLayer({
    source,
    className: POI_PENDING_LAYER_CLASSNAME,
    zIndex: POI_PENDING_LAYER_Z_INDEX,
    style: POI_PENDING_STYLE,
  })

  return { source, layer }
}

/**
 * API kaydını harita feature'ına çevirir.
 *
 * Projeksiyon dönüşümü OpenLayers'ın <c>fromLonLat</c>'ine bırakılır; Mercator
 * matematiği elle yazılmaz.
 *
 * Feature YALNIZCA sunum verisi taşır. Harita sözleşmesinde zaten oluşturan
 * bilgisi yoktur; olsaydı bile buraya konmazdı — feature'lar istemci belleğinde
 * serbestçe okunabilir.
 */
export function poiToFeature(poi) {
  if (!Number.isFinite(poi?.longitude) || !Number.isFinite(poi?.latitude)) return null

  const feature = new Feature({
    geometry: new Point(fromLonLat([poi.longitude, poi.latitude], MAP_PROJECTION)),
  })

  feature.setId(`poi-${poi.id}`)
  feature.set('featureKind', POI_FEATURE_KIND)
  feature.set('poiId', poi.id)
  feature.set('name', poi.name ?? '')
  feature.set('categoryName', poi.categoryName ?? '')
  feature.set('categoryPath', poi.categoryPath ?? '')
  feature.set('workHours', poi.workHours ?? null)
  feature.set('longitude', poi.longitude)
  feature.set('latitude', poi.latitude)

  return feature
}

/** Panellerin okuduğu düz, React dostu görüntü. */
export function featureToPoi(feature) {
  return {
    id: feature.get('poiId'),
    name: feature.get('name') ?? '',
    categoryName: feature.get('categoryName') ?? '',
    categoryPath: feature.get('categoryPath') ?? '',
    workHours: feature.get('workHours') ?? null,
    longitude: feature.get('longitude'),
    latitude: feature.get('latitude'),
  }
}

/**
 * Harita/görünüm projeksiyonundaki koordinatı EPSG:4326'ya çevirir.
 *
 * Değer YUVARLANMAZ: gönderilen konumun doğruluğu tam kalmalıdır. Yuvarlama
 * yalnızca ekranda gösterim içindir (<see cref="formatLonLat"/>).
 */
export function toLonLat4326(coordinate) {
  const [longitude, latitude] = toLonLat(coordinate, MAP_PROJECTION)
  return { longitude, latitude }
}

/** Kompakt gösterim: "32.85970, 39.93340" (~1 m çözünürlük). */
export function formatLonLat(longitude, latitude) {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return '—'
  return `${longitude.toFixed(5)}, ${latitude.toFixed(5)}`
}

export { DATA_PROJECTION, MAP_PROJECTION }
