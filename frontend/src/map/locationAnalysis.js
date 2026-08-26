import Feature from 'ol/Feature.js'
import Point from 'ol/geom/Point.js'
import Polygon from 'ol/geom/Polygon.js'
import WKT from 'ol/format/WKT.js'
import { createEmpty, extend, isEmpty } from 'ol/extent.js'
import { fromLonLat, transformExtent } from 'ol/proj.js'
import { isGeometryInsideScope } from './geographicScope.js'
import { HEATMAP_STOPS } from './heatmap.js'
import { provinceAreas, regionAreas } from './turkeyGeography.js'

/**
 * Konum analizinin SAF çekirdeği: ölçüt kuralları, alan üretimi ve görüntü
 * penceresi sözleşmesi.
 *
 * <b>Neden ayrı ve React'siz.</b> Depodaki birim testleri `node:test` ile saf
 * modülleri sınar (bkz. `heatmap.js`, `poiCategorySearch.js`, `mapContexts.js`);
 * bir bileşen ağacı kurmadan sınanabilen her kural buraya konur. Panel yalnızca
 * bu kuralların sonucunu gösterir, kendi kopyasını yazmaz.
 *
 * <b>Backend YİNE DE yetkilidir.</b> Buradaki her denetimin sunucuda birebir
 * karşılığı vardır (`LocationAnalysisValidator`); bu katman yalnızca garanti
 * 400 alacak bir isteğin hiç açılmamasını sağlar.
 */

/* --- Katman sırası ------------------------------------------------------------

   Mevcut kayıt: temel harita 0–1, coğrafi kapsam 4, ısı haritası 6, sunum
   rasterları 7–9, çizimler 10, bekleyen çizim 12, POI 13/14, envanter analizi
   15, POI taslağı 16, analiz vurgusu 18, ölçüm/vertex 20, konum işareti 30. */

/**
 * Ağırlıklı raster <b>5</b>'tedir: coğrafi kapsamın (4) üstünde ama mevcut ısı
 * haritasının (6) ALTINDA. İki ısı haritası aynı anda açık olabilir ve
 * sıralamanın sabit olması, hangisinin üstte olduğunun rastlantıya
 * bırakılmamasıdır.
 */
export const LOCATION_ANALYSIS_RASTER_Z_INDEX = 5

/**
 * Analiz alanının sınırı <b>11</b>'dedir: rasterin ve çizimlerin (10) üstünde,
 * POI'nin (13) ALTINDA.
 *
 * Envanter analizi alanı 15'tedir ve POI'nin üstüne çıkar; burada bilinçli
 * olarak farklı davranılır. O katman bir SONUÇ listesinin karşılığıdır ve
 * kullanıcı satırlarıyla etkileşir; bu ise bir rasterin BAĞLAM sınırıdır ve
 * yalnızca "analiz burada çalıştı" der. POI'nin üstüne çıkmak, `poi.js`'in
 * açıkça korumaya çalıştığı şeyi — küçük bir noktanın büyük bir poligonun
 * altında kalıp tıklanamaz hâle gelmesini — geri getirirdi.
 */
export const LOCATION_ANALYSIS_AREA_Z_INDEX = 11

/**
 * Analiz POI örtüsü <b>12</b>'dedir: analiz sınırının (11) ÜSTÜNDE — noktalar
 * kendi alanlarının çizgisine gömülmemelidir — ama normal proje POI'lerinin
 * (13/14) ALTINDA. Kullanıcının kendi POI'leri hiçbir koşulda 7853 satırlık
 * analiz kümesinin altında kalmaz.
 *
 * <b>Bekleyen çizim katmanıyla aynı sayıdadır ve bu bilinçlidir.</b> İkisi ayrı
 * özelliklere aittir ve `useWorkspaceMode` aynı anda etkin olmalarını zaten
 * engeller; aralarında tanımlı bir sıraya İHTİYAÇ YOKTUR. Kayıtta zaten böyle
 * bir eşleşme var (analiz sınırı ile POI sunum rasteri de 11'i paylaşır).
 */
export const LOCATION_ANALYSIS_POI_Z_INDEX = 12

/** Analiz POI feature'larının ayırt edicisi; normal POI `poi` taşır. */
export const LOCATION_ANALYSIS_POI_FEATURE_KIND = 'analysis-poi'

/**
 * Analiz POI vektör katmanının kendi tuvali.
 *
 * <b>Ad, normal POI katmanının adını İÇERMEZ ve bu bilinçlidir.</b> İsabet
 * denetimleri katman sınıfını `includes` ile arar (bkz. `usePoiInteraction`);
 * `location-analysis-poi-layer` gibi bir ad `poi-layer`'ı alt dizge olarak
 * taşır ve analiz katmanını normal POI denetiminden GEÇİRİRDİ. Bugün ikinci
 * bir koşul (`featureKind`) bunu yakalıyor olurdu, ama iki bağımsız katmanın
 * birbirinin denetimine takılması gizli bir tuzaktır.
 */
export const LOCATION_ANALYSIS_POI_CLASSNAME = 'location-analysis-points-layer'

/** Yalnızca declutter edilen metinlerin çizildiği ikinci vektör katmanı. */
export const LOCATION_ANALYSIS_POI_LABEL_CLASSNAME = 'location-analysis-labels-layer'

/** Kehribar: mor coğrafi kapsamdan ve mavi POI işaretlerinden ayrı. */
export const LOCATION_ANALYSIS_AREA_COLOR = '#F59E0B'

export const LOCATION_ANALYSIS_DEFAULT_OPACITY = 0.75

export const LOCATION_ANALYSIS_DEBOUNCE_MS = 180

/**
 * Renk durakları sunucudaki rampayla aynıdır
 * (`LocationAnalysisHeatmapRenderer.Ramp`, o da mevcut
 * `point_density_heatmap` ile aynı duraklar).
 *
 * <b>İkinci bir sabit tanımlanmaz.</b> Mevcut ısı haritasının durakları zaten
 * birebir aynı değerlerdir; ayrı bir kopya, biri değiştiğinde diğerinin sessizce
 * yanlış kalması demek olurdu.
 *
 * Efsanenin ANLATTIĞI şey rampanın kendisi değil, ölçeğin göreliliğidir:
 * sunucu her ölçütü önce kendi en yoğun yerine göre 0–1'e çeker, ağırlıklar
 * sonra uygulanır.
 */
export const LOCATION_ANALYSIS_STOPS = HEATMAP_STOPS

/* --- Ölçüt kuralları ----------------------------------------------------------- */

export const MIN_CRITERIA = 2
export const MAX_CRITERIA = 5
export const REQUIRED_WEIGHT_TOTAL = 100

/** Boş bir ölçüt satırı; kategori henüz seçilmemiştir. */
export function emptyCriterion() {
  return { categoryId: null, weight: 0 }
}

/**
 * Ağırlıkların toplamı.
 *
 * Yalnızca TAM SAYI ağırlıklar toplanır: kullanıcı yazarken alan geçici olarak
 * boş kalabilir ve `NaN` bir toplamı bütünüyle yutardı.
 */
export function weightTotal(criteria) {
  return (criteria ?? []).reduce((total, criterion) => {
    const weight = Number(criterion?.weight)
    return Number.isInteger(weight) ? total + weight : total
  }, 0)
}

/**
 * `candidateId`, `ancestorId` kategorisinin altında mı.
 *
 * <b>Taksonomi motoru YENİDEN YAZILMAZ.</b> Sunucudan gelen kategori kaydı
 * zaten `parentId` taşır; tek gereken ata zincirini yürümektir. Döngü koruması
 * yine de vardır — bozuk bir veri kümesi arayüzü kilitlememelidir.
 */
export function isDescendantOf(categoriesById, candidateId, ancestorId) {
  if (candidateId == null || ancestorId == null || candidateId === ancestorId) return false

  let current = categoriesById.get(candidateId)
  let guard = 0

  while (current?.parentId != null && guard++ < 64) {
    if (current.parentId === ancestorId) return true
    current = categoriesById.get(current.parentId)
  }

  return false
}

/** İki kategori aynı dalda mı (biri diğerinin atası). */
export function overlaps(categoriesById, a, b) {
  return isDescendantOf(categoriesById, a, b) || isDescendantOf(categoriesById, b, a)
}

/**
 * Bir ölçüt satırına seçilebilecek kategoriler.
 *
 * Zaten seçilmiş bir kategori, onun ataları ve torunları elenir: üst kategori
 * seçmek alt ağacın tamamını kapsar, dolayısıyla ikisini birlikte
 * ağırlıklandırmak aynı POI'yi iki kez saymak olurdu (sunucu da reddeder).
 */
export function selectableCategories(categories, criteria, rowIndex) {
  const byId = categoryIndex(categories)
  const taken = (criteria ?? [])
    .map((criterion, index) => (index === rowIndex ? null : criterion?.categoryId))
    .filter((id) => id != null)

  return (categories ?? []).filter(
    (category) =>
      !taken.some((id) => id === category.id || overlaps(byId, category.id, id)),
  )
}

export function categoryIndex(categories) {
  return new Map((categories ?? []).map((category) => [category.id, category]))
}

/**
 * "ANALİZİ BAŞLAT" basılabilir mi ve basılamıyorsa NEDEN.
 *
 * Gerekçe metni döner çünkü yalnızca devre dışı bir düğme, kullanıcıya neyin
 * eksik olduğunu söylemez (bkz. erişilebilirlik: durum yalnızca renkle
 * anlatılmaz).
 *
 * @returns {{ valid: boolean, reason: string }}
 */
export function validateAnalysis({ areaWkts, criteria, categories }) {
  if (!Array.isArray(areaWkts) || areaWkts.length === 0) {
    return { valid: false, reason: 'Önce bir hedef alan seçin: il listesinden seçin ya da haritada çizin.' }
  }

  const rows = criteria ?? []

  if (rows.length < MIN_CRITERIA) {
    return { valid: false, reason: `En az ${MIN_CRITERIA} kriter seçmelisiniz.` }
  }

  if (rows.length > MAX_CRITERIA) {
    return { valid: false, reason: `En fazla ${MAX_CRITERIA} kriter seçebilirsiniz.` }
  }

  if (rows.some((criterion) => criterion?.categoryId == null)) {
    return { valid: false, reason: 'Her kriter için bir kategori seçin.' }
  }

  const ids = rows.map((criterion) => criterion.categoryId)

  if (new Set(ids).size !== ids.length) {
    return { valid: false, reason: 'Aynı kategoriyi birden çok kez seçemezsiniz.' }
  }

  const byId = categoryIndex(categories)

  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      if (overlaps(byId, ids[i], ids[j])) {
        const parent = isDescendantOf(byId, ids[j], ids[i]) ? ids[i] : ids[j]
        const name = byId.get(parent)?.name ?? 'Üst kategori'

        return {
          valid: false,
          reason: `"${name}" alt kategorilerini zaten kapsıyor; ikisini birlikte seçemezsiniz.`,
        }
      }
    }
  }

  if (rows.some((criterion) => !Number.isInteger(Number(criterion.weight)) || Number(criterion.weight) <= 0)) {
    return { valid: false, reason: 'Her ağırlık 0’dan büyük bir tam sayı olmalıdır.' }
  }

  if (rows.some((criterion) => Number(criterion.weight) > REQUIRED_WEIGHT_TOTAL)) {
    return { valid: false, reason: `Tek bir ağırlık ${REQUIRED_WEIGHT_TOTAL} değerini aşamaz.` }
  }

  const total = weightTotal(rows)

  if (total !== REQUIRED_WEIGHT_TOTAL) {
    /* Ağırlıklar SESSİZCE ölçeklenmez. 40 + 40 gönderen birine 50 + 50
       uygulamak, ödevin "toplam tam olarak 100 olmalı" kuralını kullanıcıya
       sormadan yeniden yorumlamak olurdu. */
    return { valid: false, reason: `Ağırlıkların toplamı ${REQUIRED_WEIGHT_TOTAL} olmalıdır. Şu an: ${total}.` }
  }

  return { valid: true, reason: '' }
}

/**
 * Doğrulanmış formdan sunucuya gidecek ölçüt listesi.
 *
 * Gönderilen kimlik `categorySlug`'dır, sayısal `id` DEĞİL: sayısal kimlik
 * identity kolonundan üretilir ve ortamdan ortama değişir; slug bir kez üretilir
 * ve değişmez.
 */
export function toRequestCriteria(criteria, categories) {
  const byId = categoryIndex(categories)

  return (criteria ?? []).map((criterion) => ({
    categorySlug: byId.get(criterion.categoryId)?.slug ?? '',
    weight: Number(criterion.weight),
  }))
}

/* --- Hedef alan ---------------------------------------------------------------- */

/**
 * Bir ilin analiz alanları.
 *
 * <b>Parçalar KORUNUR.</b> Adaları olan bir il birden çok poligon üretir ve
 * sunucu sözleşmesi zaten bir liste alır (`AreaWkts`); yalnızca en büyük parçayı
 * almak ya da hepsini tek bir sahte poligona sıkıştırmak, o ilin adalarını
 * sessizce analiz dışında bırakmak olurdu.
 */
export function provinceAreaWkts(code) {
  return provinceAreas(code).map((area) => area.wkt)
}

/**
 * Bir bölgenin analiz alanları.
 *
 * <b>Bölge, ilin ALTI değil ÜSTÜdür.</b> Veri kümesinde hiyerarşi
 * Bölge(7) → İl(81) şeklindedir; ilin altında bir birim (ilçe) YOKTUR.
 * Bölge kapsamı il sınırlarının birleşiminden üretilen bir YAKLAŞIKLIKTIR
 * (bkz. `REGION_APPROXIMATION_NOTE`) ve panel bunu söyler.
 */
export function regionAreaWkts(key) {
  return regionAreas(key).map((area) => area.wkt)
}

/** Yetki alanına göre süzülmüş bölge listesi; kısıtsızsa liste aynen döner. */
export function regionsWithinScope(scope, regions) {
  if (!scope) return regions
  return (regions ?? []).filter((region) =>
    region.polygons.every((rings) => {
      const geometry = new Polygon(rings.map((ring) => ring.map((point) => fromLonLat(point))))
      return isGeometryInsideScope(scope, geometry)
    }))
}

/* --- Sabit analiz penceresi ------------------------------------------------------

   <b>Görüntü artık GÖRÜNÜME değil ALANA aittir.</b> Phase 5'te her `moveend`
   yeni bir raster istiyordu; bu üç ayrı soruna yol açıyordu:

   1. `vec:Heatmap` yoğunluğu ÜRETİLEN GÖRÜNTÜNÜN kendi en yükseğine göre
      normalleştirir. Pencere her değiştiğinde 1.0'ın ANLAMI değişiyordu:
      efsanedeki "göreli yoğunluk" kullanıcının baktığı ekrana göre yeniden
      tanımlanıyordu.
   2. Kaydırma/yakınlaştırma bir ANALİZ girdisi değildir; her hareket bir
      GeoServer isteği açmak, sorulmamış bir soruyu tekrar sormaktı.
   3. Her yanıt kendi penceresine yerleşiyordu; geç gelen bir yanıtın yanlış
      kapsama oturma ihtimali sürekli açıktı.

   Bunun yerine gönderilen analizin KENDİ zarfı hesaplanır. Kaydırma ve aynı
   LOD içindeki yakınlaştırma saf gezinmedir; yalnızca dört LOD sınırından
   biri geçilince aynı zarfa yeni bir raster istenir. */

/**
 * Raster çözünürlüğü sınırları — sunucudaki `WmsRenderContract` ile AYNI
 * değerler (64–2048, en çok 4.194.304 piksel).
 *
 * `longEdge` istenen uzun kenardır; alanın en-boy oranı kısa kenarı belirler.
 * Keyfî 8K/16K görüntü İSTENMEZ: dört LOD bandı uzun kenarı 768 ile
 * 2048 arasında seçer ve sunucunun ortak piksel bütçesine uyar.
 */
export const ANALYSIS_IMAGE_LIMITS = Object.freeze({
  minSide: 64,
  maxSide: 2048,
  maxPixels: 4_194_304,
  longEdge: 1536,
})

/** Dört deterministik raster LOD bandı; sınırlar OpenLayers zoom değeridir. */
export const LOCATION_ANALYSIS_HEATMAP_LODS = Object.freeze({
  far: Object.freeze({ name: 'far', minZoom: Number.NEGATIVE_INFINITY, longEdge: 768 }),
  medium: Object.freeze({ name: 'medium', minZoom: 9, longEdge: 1024 }),
  near: Object.freeze({ name: 'near', minZoom: 12, longEdge: 1536 }),
  veryNear: Object.freeze({ name: 'very_near', minZoom: 15, longEdge: 2048 }),
})

export function heatmapLodForZoom(zoom) {
  if (!Number.isFinite(zoom)) return LOCATION_ANALYSIS_HEATMAP_LODS.far.name
  if (zoom >= LOCATION_ANALYSIS_HEATMAP_LODS.veryNear.minZoom) return LOCATION_ANALYSIS_HEATMAP_LODS.veryNear.name
  if (zoom >= LOCATION_ANALYSIS_HEATMAP_LODS.near.minZoom) return LOCATION_ANALYSIS_HEATMAP_LODS.near.name
  if (zoom >= LOCATION_ANALYSIS_HEATMAP_LODS.medium.minZoom) return LOCATION_ANALYSIS_HEATMAP_LODS.medium.name
  return LOCATION_ANALYSIS_HEATMAP_LODS.far.name
}

export function heatmapLodSpec(lod) {
  const spec = Object.values(LOCATION_ANALYSIS_HEATMAP_LODS).find((candidate) => candidate.name === lod)
    ?? LOCATION_ANALYSIS_HEATMAP_LODS.far

  return { ...ANALYSIS_IMAGE_LIMITS, longEdge: spec.longEdge }
}

/** Harita adları yalnızca yerel grupların ayrıştığı iki yakın bantta çizilir. */
export function analysisPoiLabelsVisible(lod) {
  return lod === LOCATION_ANALYSIS_HEATMAP_LODS.near.name
    || lod === LOCATION_ANALYSIS_HEATMAP_LODS.veryNear.name
}

export const LOCATION_ANALYSIS_LABEL_DECLUTTER = true

export function analysisPoiLabelText(name, lod) {
  const text = typeof name === 'string' ? name.trim() : ''
  return text && analysisPoiLabelsVisible(lod) ? text : null
}

/**
 * Zarfa oranla eklenen pay.
 *
 * Isı çekirdeği kaynak noktanın ÖTESİNE taşar; zarfı noktalara tam
 * oturtmak, sınırdaki lekeleri rasterin kenarında keserdi. Pay GÖRECEdir
 * (sabit derece değil): bir il ile elle çizilmiş küçük bir poligon aynı
 * mutlak payı paylaşamaz.
 */
const ENVELOPE_PADDING_RATIO = 0.04

const wktFormat = new WKT()

/**
 * Analiz alanının TAMAMINI kapsayan EPSG:4326 zarfı.
 *
 * <b>Parçalar BİRLEŞTİRİLİR, atılmaz.</b> Çok parçalı bir il için zarf tüm
 * parçaları kapsar; yalnızca en büyük parçayı almak, o ilin adalarını
 * rasterin dışında bırakırdı. Zarf bir GÖRÜNTÜ PENCERESİdir — analizin
 * kendisi hâlâ gerçek poligonlarla süzülür (sunucudaki `INTERSECTS`) ve
 * ekranda gerçek poligonlarla kırpılır.
 *
 * @returns {number[]|null} `[minLon, minLat, maxLon, maxLat]`
 */
export function analysisAreaEnvelope(areaWkts) {
  const extent = createEmpty()

  for (const wkt of areaWkts ?? []) {
    try {
      const geometry = wktFormat.readGeometry(wkt)
      if (geometry) extend(extent, geometry.getExtent())
    } catch {
      /* Tek bir bozuk parça zarfı bütünüyle düşürmez; kalanlar yine
         kapsanır. */
    }
  }

  if (isEmpty(extent) || !extent.every(Number.isFinite)) return null

  const width = extent[2] - extent[0]
  const height = extent[3] - extent[1]
  if (width <= 0 || height <= 0) return null

  const padX = width * ENVELOPE_PADDING_RATIO
  const padY = height * ENVELOPE_PADDING_RATIO

  /* Kırpma sunucunun sınırlarına göre yapılır: taşan bir pencere
     doğrulamadan düşerdi. */
  return [
    Math.max(-180, extent[0] - padX),
    Math.max(-90, extent[1] - padY),
    Math.min(180, extent[2] + padX),
    Math.min(90, extent[3] + padY),
  ]
}

/**
 * Zarfın en-boy oranından raster boyutu.
 *
 * Oran ZARFTAN gelir, ekrandan değil: görüntü artık görünüme ait olmadığı
 * için pencerenin şekli tek belirleyicidir. Sonuç sunucunun kabul ettiği
 * aralığa kırpılır.
 */
export function analysisAreaImageSize(bbox, limits = ANALYSIS_IMAGE_LIMITS) {
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)) return null

  const spanX = bbox[2] - bbox[0]
  const spanY = bbox[3] - bbox[1]
  if (spanX <= 0 || spanY <= 0) return null

  const clamp = (value) =>
    Math.min(limits.maxSide, Math.max(limits.minSide, Math.round(value)))

  let width
  let height

  if (spanX >= spanY) {
    width = limits.longEdge
    height = limits.longEdge * (spanY / spanX)
  } else {
    height = limits.longEdge
    width = limits.longEdge * (spanX / spanY)
  }

  width = clamp(width)
  height = clamp(height)

  /* Toplam piksel tavanı ayrıca uygulanır: iki kenar da tek başına sınırda
     olsa bile çarpımları tavanı aşabilir. */
  const total = width * height
  if (total > limits.maxPixels) {
    const scale = Math.sqrt(limits.maxPixels / total)
    width = clamp(width * scale)
    height = clamp(height * scale)
  }

  return { width, height }
}

/* --- İsabet testi (tıklanan noktayı çözme) ---------------------------------------

   Nokta örtüsü sunucuda çizilmiş bir PNG'dir ve pikselin arkasında bir kayıt
   kimliği YOKTUR. Tıklanan noktanın kimliği bu yüzden veritabanından çözülür;
   raster bir SUNUMDUR ve öyle kalır. */

/** Tıklamanın kaç ekran pikseli kadar hoşgörüsü olsun. */
export const HIT_TEST_PIXELS = 10

/** Sunucudaki `LocationAnalysisHitTest` ile AYNI sınırlar. */
export const HIT_TEST_TOLERANCE_LIMITS = Object.freeze({ min: 5, max: 5000 })

/**
 * Ekran pikselini <b>gerçek</b> metreye çevirir.
 *
 * <b>Görünüm çözünürlüğü YER METRESİ DEĞİLDİR.</b> OpenLayers EPSG:3857
 * çözünürlüğünü "Web Mercator metresi / piksel" olarak verir; Web Mercator ise
 * enlemle birlikte 1/cos(enlem) oranında şişer. Ankara enleminde (~40°) bu
 * fark yaklaşık %30'dur: 10 pikselin karşılığı 380 m sanılırken gerçekte
 * 291 m'dir. Ham çözünürlüğü metre diye sunucuya göndermek, arama yarıçapını
 * sessizce büyütürdü — projenin daha önce derece/metre karışıklığında ödediği
 * bedelin aynısı.
 *
 * Sonuç sunucunun sınırlarına çekilir; sunucu ayrıca KENDİ kırpmasını yapar
 * (istemciden gelen bir sayı sorgunun kapsamını belirleyemez).
 */
export function hitTestToleranceMeters(resolution, latitude, pixels = HIT_TEST_PIXELS) {
  if (!Number.isFinite(resolution) || resolution <= 0) return HIT_TEST_TOLERANCE_LIMITS.min
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) return HIT_TEST_TOLERANCE_LIMITS.min

  const groundMetres = resolution * Math.cos((latitude * Math.PI) / 180) * pixels

  return Math.min(
    HIT_TEST_TOLERANCE_LIMITS.max,
    Math.max(HIT_TEST_TOLERANCE_LIMITS.min, groundMetres),
  )
}

/* --- Görüntü penceresi ---------------------------------------------------------- */

export const MAP_PROJECTION = 'EPSG:3857'
export const DATA_PROJECTION = 'EPSG:4326'

/**
 * Harita kapsamı (EPSG:3857) → görüntü ucunun beklediği bbox (EPSG:4326).
 *
 * <b>Bu dönüşüm ZORUNLUDUR ve atlanamaz.</b> Görüntü ucu EPSG:4326 bir pencere
 * bekler; ham Web Mercator metreleri göndermek, doğrulamayı GEÇEN ama dünyanın
 * başka bir yerini çizen bir istek üretirdi. Phase 4C'de ölçülen hata tam
 * olarak buydu: 32,74 gibi bir sayı hem geçerli bir boylam hem geçerli bir Web
 * Mercator metresidir, dolayısıyla hiçbir denetim onu yakalayamaz.
 *
 * <b>Eksen SIRASI burada DEĞİŞTİRİLMEZ.</b> Gönderilen düzen kanonik
 * `minBoylam,minEnlem,maxBoylam,maxEnlem`'dir — OpenLayers, NetTopologySuite ve
 * uygulamanın geri kalanıyla aynı. WMS 1.3.0'ın EPSG:4326'yı enlem/boylam
 * okuması bir TAŞIMA ayrıntısıdır ve sunucuya aittir (`WmsBboxFormatter`);
 * tarayıcının onu da çevirmesi, aynı takası iki kez uygulamak olurdu.
 */
export function analysisBbox4326(extent3857) {
  if (!Array.isArray(extent3857) || extent3857.length !== 4 || !extent3857.every(Number.isFinite)) {
    return null
  }

  if (extent3857[0] >= extent3857[2] || extent3857[1] >= extent3857[3]) return null

  const [minLon, minLat, maxLon, maxLat] = transformExtent(extent3857, MAP_PROJECTION, DATA_PROJECTION)

  if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) return null

  /* Kutup yakınında Web Mercator enlemi ±85,05°'de doyar; sunucunun EPSG:4326
     sınırı ise ±90'dır. Yine de kırpılır: doyan bir değer sınırı aşarsa istek
     doğrulamadan düşerdi. */
  const clampLat = (value) => Math.min(90, Math.max(-90, value))
  const clampLon = (value) => Math.min(180, Math.max(-180, value))

  const bbox = [clampLon(minLon), clampLat(minLat), clampLon(maxLon), clampLat(maxLat)]

  if (bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) return null

  return bbox
}

/** Sunucuya gidecek metin: `minLon,minLat,maxLon,maxLat`. */
export function serializeBbox(bbox) {
  return Array.isArray(bbox) && bbox.length === 4 ? bbox.join(',') : null
}

/* --- Analiz POI feature'ları ------------------------------------------------------

   Saf dönüşümler burada durur, hook'ta DEĞİL: depodaki birim testleri
   `node:test` ile saf modülleri sınar ve bir hook `services/api.js` üzerinden
   Vite'a bağımlıdır. Aynı ayrım normal POI'de de var (`map/poi.js`).*/

/**
 * Birleşik analiz listesini seçili ısı ölçütünün kategori kapanışına süzer.
 * Boş ölçüt birleşik görünüm demektir ve listeyi aynen korur.
 */
export function analysisPoisForCriterion(pois, categories, criterionSlug) {
  const rows = Array.isArray(pois) ? pois : []
  if (!criterionSlug) return rows

  const root = (categories ?? []).find((category) => category.slug === criterionSlug)
  if (!root) return []

  const byId = categoryIndex(categories)
  const covered = (categories ?? []).filter(
    (category) => category.id === root.id || isDescendantOf(byId, category.id, root.id),
  )
  const coveredIds = new Set(covered.map((category) => category.id))
  const coveredSlugs = new Set(covered.map((category) => category.slug))

  return rows.filter(
    (poi) => coveredIds.has(poi?.categoryId) || coveredSlugs.has(poi?.categorySlug),
  )
}

/**
 * API kaydı → harita feature'ı.
 *
 * Projeksiyon dönüşümü OpenLayers'ın `fromLonLat`'ine bırakılır; Mercator
 * matematiği elle yazılmaz. Kayıt EPSG:4326'dır, harita EPSG:3857 — bu sıradan
 * bir dönüşümdür ve WMS eksen sırası sözleşmesiyle İLGİSİ YOKTUR.
 */
export function analysisPoiToFeature(poi) {
  if (!Number.isFinite(poi?.longitude) || !Number.isFinite(poi?.latitude)) return null

  const feature = new Feature({
    geometry: new Point(fromLonLat([poi.longitude, poi.latitude], MAP_PROJECTION)),
  })

  feature.setId(poi.featureId)
  /* Ayırt edici: normal POI'nin bilgi paneliyle karışmaması için isabet
     denetimi hem katman sınıfını hem bu alanı arar. */
  feature.set('featureKind', LOCATION_ANALYSIS_POI_FEATURE_KIND)
  feature.set('analysisPoiId', poi.id)
  feature.set('featureId', poi.featureId ?? '')
  feature.set('name', poi.name ?? '')
  feature.set('categoryId', poi.categoryId ?? null)
  feature.set('categorySlug', poi.categorySlug ?? '')
  feature.set('categoryName', poi.categoryName ?? '')
  feature.set('categoryPath', poi.categoryPath ?? '')
  feature.set('longitude', poi.longitude)
  feature.set('latitude', poi.latitude)
  feature.set('source', poi.source ?? '')

  return feature
}

/** Feature → kartın gösterdiği düz kayıt. */
export function featureToAnalysisPoi(feature) {
  if (!feature) return null

  return {
    id: feature.get('analysisPoiId'),
    featureId: feature.get('featureId'),
    name: feature.get('name') || null,
    categoryId: feature.get('categoryId'),
    categorySlug: feature.get('categorySlug'),
    categoryName: feature.get('categoryName'),
    categoryPath: feature.get('categoryPath'),
    longitude: feature.get('longitude'),
    latitude: feature.get('latitude'),
    source: feature.get('source'),
  }
}

/* --- Coğrafi yetki: hedef alan sınırı --------------------------------------------

   <b>Bu, projede coğrafi yetkinin OKUMA yolunda uygulandığı ilk yerdir.</b>
   Kural sunucuda kesindir; buradaki iş yalnızca kullanıcıyı YÖNLENDİRMEKTİR —
   seçemeyeceği bir ili listede gösterip sonra 403 ile karşılamak, kullanıcıya
   nedenini anlamadığı bir hata göstermek olurdu. */

/**
 * İl, kullanıcının yetki alanının TAMAMEN içinde mi.
 *
 * <b>Yüklem "kapsıyor mu"dur, "kesişiyor mu" değil</b> — sunucu da
 * <c>Covers</c> kullanır. Yetki alanı Ankara'nın yalnızca bir ilçesiyse
 * kullanıcı "Ankara" ilini analiz EDEMEZ; o ilin tamamı yetkisinin dışına
 * taşar. Böyle bir kullanıcı için doğru yol haritada kendi alanını
 * çizmektir ve panel bunu söyler.
 */
export function isProvinceWithinScope(scope, province) {
  if (!scope) return true
  if (!province?.polygons?.length) return false

  return province.polygons.every((rings) => {
    const geometry = new Polygon(rings.map((ring) => ring.map((point) => fromLonLat(point))))
    return isGeometryInsideScope(scope, geometry)
  })
}

/**
 * Yetki alanına göre süzülmüş il listesi.
 *
 * Kısıtsız kullanıcı için liste AYNEN döner: kural değişikliği, coğrafi alanı
 * tanımlı olmayan mevcut kurulumları etkilemez.
 */
export function provincesWithinScope(scope, provinces) {
  if (!scope) return provinces
  return (provinces ?? []).filter((province) => isProvinceWithinScope(scope, province))
}
