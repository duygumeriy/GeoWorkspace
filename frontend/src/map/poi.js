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
import { markerSizeForResolution } from './poiMarkerScale.js'
import { FALLBACK_PRESENTATION, poiMarkerStyle } from './poiMarkerStyle.js'

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
 * <b>Kalıcı GÖRÜNÜM Faz 4'ten beri GeoServer WMS'tedir</b> (bkz.
 * <c>usePoiPresentationLayer</c>): raster, kategorisine göre simge ve renk
 * taşıyan resmi gösterimdir. Buradaki vektör kaynağı KİMLİĞİN sahibi olarak
 * kalır — tıklama isabet denetimi, seçim ve bilgi paneli bir WMS görüntüsüyle
 * mümkün olmazdı ve bu fazda GetFeatureInfo yoktur. Raster ekrandayken vektör
 * saydam ama tıklanabilir hâle geçer, dolayısıyla aynı POI iki kez çizilmez.
 *
 * <b>Vektör yedeği KATEGORİ FARKINDADIR.</b> Raster ölçek değişimi sırasında
 * çekildiğinde (Faz 5A) POI'ler eskiden sade bir mavi noktaya dönüşüyordu;
 * kullanıcının canlı denemede bildirdiği sorun buydu. Artık aynı kategori
 * rozeti vektör olarak çizilir (<c>poiMarkerStyle</c>), dolayısıyla POI hiçbir
 * durumda kimliğini kaybetmez. Kalıcı POI için genel mavi işaret ARTIK
 * KULLANILMAZ; bekleyen ve taslak noktalar ayrı bir kavramdır ve kendi kesikli
 * dillerini korur.
 */

/** Kendi canvas'ı: koyu tema tile filtresi bu katmana uygulanmaz. */
export const POI_LAYER_CLASSNAME = 'poi-layer'

/** Yerleştirilmiş ama henüz kaydedilmemiş nokta için ayrı canvas. */
export const POI_PENDING_LAYER_CLASSNAME = 'poi-pending-layer'

/** Düzenlenmekte olan POI'nin KAYDEDİLMEMİŞ konumu için ayrı canvas. */
export const POI_DRAFT_LAYER_CLASSNAME = 'poi-draft-layer'

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

/**
 * Düzenleme taslağı işareti <b>16</b>'dadır: geçici bir DÜZENLEME katmanıdır ve
 * bu yüzden kalıcı POI'nin de, envanter analizinin de (15) üstünde durur —
 * kullanıcının sürüklediği nokta hiçbir zaman başka bir şeyin altında
 * kalmamalıdır. Analiz vurgusunun (18) ve ölçümün (20) altında kalır.
 */
export const POI_DRAFT_LAYER_Z_INDEX = 16

/** Kesikli geçici işaretlerin mavisi: mor çizimlerden ve kehribar analizden ayrı. */
const POI_COLOR = '#2563EB'
const POI_SELECTED_COLOR = '#1D4ED8'

/** Feature ayırt edici. Çizim feature'ları `drawingType` taşır, POI bunu. */
export const POI_FEATURE_KIND = 'poi'

/** Bekleyen nokta kesikli halkayla "henüz kaydedilmedi" der. */
const POI_PENDING_STYLE = new Style({
  image: new CircleStyle({
    radius: 8,
    fill: new Fill({ color: 'rgba(37, 99, 235, 0.35)' }),
    stroke: new Stroke({ color: POI_COLOR, width: 2, lineDash: [4, 3] }),
  }),
})

/** Taşınabilir taslak: bekleyen noktayla aynı dil, tutulabilir bir boyut. */
const POI_DRAFT_STYLE = new Style({
  image: new CircleStyle({
    radius: 10,
    fill: new Fill({ color: 'rgba(37, 99, 235, 0.30)' }),
    stroke: new Stroke({ color: POI_SELECTED_COLOR, width: 3, lineDash: [5, 4] }),
  }),
})

/**
 * Düzenlenmekte olan POI'nin taslak konumu.
 *
 * Kalıcı kaynaktan AYRI olması güvenlik ve doğruluk gereğidir: kaydın kendisi
 * sürüklenseydi, reddedilen bir güncellemeden sonra harita veritabanında
 * olmayan bir konumu anlatır, "İptal" ve "Değişiklikleri Geri Al" ise kalıcı
 * kaynağı geri sarmak zorunda kalırdı. Taslak işaret, kaydedilene kadar
 * yalnızca bir NİYETTİR.
 *
 * Kesikli halka bunu görsel olarak da söyler ve yerleştirme işaretiyle aynı
 * dili konuşur: "henüz kaydedilmedi".
 */
export function createPoiDraftLayer() {
  const source = new VectorSource()
  const layer = new VectorLayer({
    source,
    className: POI_DRAFT_LAYER_CLASSNAME,
    zIndex: POI_DRAFT_LAYER_Z_INDEX,
    style: POI_DRAFT_STYLE,
  })

  return { source, layer }
}

/**
 * Kalıcı POI katmanı.
 *
 * Stil bir FONKSİYONDUR: seçili POI'nin kimliği, rasterin durumu ve haritanın
 * yakınlığı React render'ından bağımsız değişir ve katman her seferinde
 * yeniden kurulmadan güncel cevabı okuyabilmelidir. Sabit bir stil verilseydi
 * bu üç şeyden biri her değiştiğinde katmanı yeniden yaratmak gerekirdi.
 *
 * <b>Rozet raster devraldığında ÇİZİLMEZ.</b> WMS görüntüsü ekrandayken vektör
 * de rozet çizseydi aynı POI iki kez görünürdü. Vektör o durumda saydam ama
 * tıklanabilir hâle geçer; kimlik, seçim ve bilgi paneli hâlâ ona aittir.
 *
 * <b>Seçim geri bildirimi her koşulda VEKTÖRDEDİR.</b> Raster kategorisine göre
 * boyanmış sabit bir görüntüdür ve neyin seçili olduğunu bilemez. Ama seçim
 * artık rozetin YERİNE geçmez — çevresine bir halka çizer.
 *
 * <b>Boyut ÖLÇEKTEN gelir.</b> <c>markerSizeForResolution</c> SLD'nin ölçek
 * paydası bantlarını birebir konuşur, dolayısıyla raster gelip gittiğinde
 * işaretçi boyut değiştirmez — kesirli yakınlıklarda bile.
 *
 * @param {() => number|null} getSelectedId
 * @param {() => boolean} [isRasterActive] raster kalıcı görünümü devraldı mı
 * @param {(categoryId: number|null) => ({ iconKey?: string|null, colorHex?: string|null })|null} [getPresentation]
 *   kategori kimliğinden simge/renk çözer; bilinmiyorsa nötr yedeğe düşülür
 * @param {() => number|undefined} [getResolution] görünümün o anki çözünürlüğü
 */
export function createPoiLayer(
  getSelectedId,
  isRasterActive = () => false,
  getPresentation = () => null,
  getResolution = () => undefined,
) {
  const source = new VectorSource()
  const layer = new VectorLayer({
    source,
    className: POI_LAYER_CLASSNAME,
    zIndex: POI_LAYER_Z_INDEX,
    style: (feature) => {
      /* Kategori metadatası HENÜZ gelmemiş ya da hiç gelmeyecek olabilir
         (istek uçuyor, ya da göç öncesinden kalan metadatasız bir kategori).
         O durumda bile POI genel bir noktaya DÜŞMEZ: nötr renkli bir
         MapPin rozeti çizilir — kimliği eksik, ama yine bir rozet. */
      const presentation = getPresentation(feature.get('categoryId')) ?? FALLBACK_PRESENTATION

      return poiMarkerStyle({
        iconKey: presentation.iconKey,
        colorHex: presentation.colorHex,
        size: markerSizeForResolution(getResolution()),
        selected: feature.get('poiId') === getSelectedId(),
        rasterActive: isRasterActive(),
      })
    },
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
  /* Kategori KİMLİĞİ de taşınır: düzenleme formu kaydın mevcut kategorisini
     önceden seçili açabilmelidir. Yalnızca ad/yol taşınırsa form kategorisiz
     açılır ve kullanıcı, yalnızca mesai saatini değiştirmek istese bile
     kategoriyi yeniden seçmek zorunda kalır. Kimlik, harita sözleşmesinin
     zaten döndürdüğü bir alandır (`PoiResponse.categoryId`) ve sahiplik
     bilgisi DEĞİLDİR. */
  feature.set('categoryId', poi.categoryId ?? null)
  feature.set('categoryName', poi.categoryName ?? '')
  feature.set('categoryPath', poi.categoryPath ?? '')
  feature.set('workHours', poi.workHours ?? null)
  feature.set('longitude', poi.longitude)
  feature.set('latitude', poi.latitude)
  /* Yetenek bayrakları SUNUCUDAN gelir ve kaydın yanında taşınır: bilgi paneli
     "Düzenle"/"Sil" düğmelerini bunlara bakarak gösterir. Sahiplik kuralı
     tarayıcıda yeniden hesaplanmaz — kaydın sahibi zaten burada yoktur. */
  feature.set('canUpdate', poi.canUpdate === true)
  feature.set('canDelete', poi.canDelete === true)

  return feature
}

/** Panellerin okuduğu düz, React dostu görüntü. */
export function featureToPoi(feature) {
  return {
    id: feature.get('poiId'),
    name: feature.get('name') ?? '',
    categoryId: feature.get('categoryId') ?? null,
    categoryName: feature.get('categoryName') ?? '',
    categoryPath: feature.get('categoryPath') ?? '',
    workHours: feature.get('workHours') ?? null,
    longitude: feature.get('longitude'),
    latitude: feature.get('latitude'),
    canUpdate: feature.get('canUpdate') === true,
    canDelete: feature.get('canDelete') === true,
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
