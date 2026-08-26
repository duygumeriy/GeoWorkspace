import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LOCATION_ANALYSIS_AREA_Z_INDEX,
  LOCATION_ANALYSIS_RASTER_Z_INDEX,
  LOCATION_ANALYSIS_STOPS,
  MAX_CRITERIA,
  MIN_CRITERIA,
  REQUIRED_WEIGHT_TOTAL,
  ANALYSIS_IMAGE_LIMITS,
  LOCATION_ANALYSIS_HEATMAP_LODS,
  LOCATION_ANALYSIS_LABEL_DECLUTTER,
  HIT_TEST_TOLERANCE_LIMITS,
  hitTestToleranceMeters,
  analysisAreaEnvelope,
  analysisAreaImageSize,
  analysisPoiLabelText,
  analysisPoisForCriterion,
  analysisBbox4326,
  categoryIndex,
  emptyCriterion,
  heatmapLodForZoom,
  heatmapLodSpec,
  isDescendantOf,
  overlaps,
  provinceAreaWkts,
  selectableCategories,
  serializeBbox,
  toRequestCriteria,
  validateAnalysis,
  weightTotal,
} from '../../src/map/locationAnalysis.js'
import { HEATMAP_LAYER_Z_INDEX, HEATMAP_STOPS } from '../../src/map/heatmap.js'

/* --- Taksonomi fixture ---------------------------------------------------------
   Gerçek taksonominin şekli: iki kök, biri iki torunlu, biri bir torunlu. */

const CATEGORIES = [
  { id: 1, name: 'Yeme İçme', path: 'Yeme İçme', slug: 'yeme-icme', parentId: null },
  { id: 2, name: 'Kafe', path: 'Yeme İçme / Kafe', slug: 'kafe', parentId: 1 },
  { id: 3, name: 'Restoran', path: 'Yeme İçme / Restoran', slug: 'restoran', parentId: 1 },
  { id: 4, name: 'Sağlık Kurumları', path: 'Sağlık Kurumları', slug: 'saglik-kurumlari', parentId: null },
  { id: 5, name: 'Eczane', path: 'Sağlık Kurumları / Eczane', slug: 'eczane', parentId: 4 },
  { id: 6, name: 'Okullar', path: 'Okullar', slug: 'okullar', parentId: null },
  { id: 7, name: 'Banka ve ATM', path: 'Banka ve ATM', slug: 'banka-ve-atm', parentId: null },
  { id: 8, name: 'Dini Tesisler', path: 'Dini Tesisler', slug: 'dini-tesisler', parentId: null },
]

const ANKARA_AREA =
  'POLYGON ((32.742849147289974 39.84548205, 32.950206181106694 39.84548205, ' +
  '32.950206181106694 40.00215400000004, 32.742849147289974 40.00215400000004, ' +
  '32.742849147289974 39.84548205))'

const criteria = (...pairs) => pairs.map(([categoryId, weight]) => ({ categoryId, weight }))

const check = (rows, areaWkts = [ANKARA_AREA]) =>
  validateAnalysis({ areaWkts, criteria: rows, categories: CATEGORIES })

/* --- Katman sırası -------------------------------------------------------------- */

test('layer order keeps the raster under the existing heatmap and the boundary above it', () => {
  // Coğrafi kapsam 4'tedir; mevcut ısı haritası 6.
  assert.ok(LOCATION_ANALYSIS_RASTER_Z_INDEX > 4)
  assert.ok(LOCATION_ANALYSIS_RASTER_Z_INDEX < HEATMAP_LAYER_Z_INDEX)

  // Sınır rasterin üstünde ama POI'nin (13) altında: küçük bir POI işareti
  // büyük bir analiz poligonunun altında kalıp tıklanamaz hâle gelmemelidir.
  assert.ok(LOCATION_ANALYSIS_AREA_Z_INDEX > LOCATION_ANALYSIS_RASTER_Z_INDEX)
  assert.ok(LOCATION_ANALYSIS_AREA_Z_INDEX < 13)
})

test('legend stops are the server style stops, not a second copy', () => {
  // İkinci bir sabit tanımlansaydı biri değiştiğinde diğeri sessizce yanlış kalırdı.
  assert.equal(LOCATION_ANALYSIS_STOPS, HEATMAP_STOPS)
  assert.deepEqual(
    LOCATION_ANALYSIS_STOPS.map(({ value, color }) => [value, color]),
    [
      [0, 'transparent'],
      [0.25, '#2C7BB6'],
      [0.5, '#00A6CA'],
      [0.75, '#F9D057'],
      [1, '#D7191C'],
    ],
  )
})

/* --- BBOX / CRS — Phase 4C regresyonu ------------------------------------------- */

test('the viewport reaches the image endpoint as EPSG:4326, never as raw Web Mercator', () => {
  /* Ankara çevresindeki gerçek görünüm, EPSG:3857 metre cinsinden. Ham hâliyle
     gönderilseydi sunucu onu boylam/enlem sanar ve Gine Körfezi'ni çizerdi —
     Phase 4C'de ölçülen hata tam olarak buydu. */
  const extent3857 = [3644917.294197291, 4843513.492692719, 3668000.1736141723, 4866255.297850193]

  const bbox = analysisBbox4326(extent3857)

  assert.ok(bbox, 'geçerli bir kapsam null dönmemeli')

  // Sayısal davranış sabitlenir; yalnızca "transformExtent çağrıldı" DEĞİL.
  assert.ok(Math.abs(bbox[0] - 32.742849147289974) < 1e-6, `minLon ${bbox[0]}`)
  assert.ok(Math.abs(bbox[1] - 39.84548205) < 1e-6, `minLat ${bbox[1]}`)
  assert.ok(Math.abs(bbox[2] - 32.950206181106694) < 1e-6, `maxLon ${bbox[2]}`)
  assert.ok(Math.abs(bbox[3] - 40.00215400000004) < 1e-6, `maxLat ${bbox[3]}`)

  // Metrelerin hiçbiri geçmemeli.
  for (const value of bbox) assert.ok(Math.abs(value) < 200, `bbox hâlâ metre taşıyor: ${value}`)
})

test('the serialized bbox is canonical lon/lat — the WMS latitude-first swap is the backend\'s job', () => {
  const bbox = analysisBbox4326([3644917.294197291, 4843513.492692719, 3668000.1736141723, 4866255.297850193])
  const text = serializeBbox(bbox)
  const parts = text.split(',').map(Number)

  // İlk değer BOYLAM olmalıdır. Enlemle başlamak, sunucudaki takasla birleşip
  // aynı dönüşümü iki kez uygulardı.
  assert.ok(parts[0] > 32 && parts[0] < 33, `ilk değer boylam olmalı: ${parts[0]}`)
  assert.ok(parts[1] > 39 && parts[1] < 40, `ikinci değer enlem olmalı: ${parts[1]}`)
  assert.ok(parts[0] < parts[2])
  assert.ok(parts[1] < parts[3])
})

test('an unusable extent produces no request at all', () => {
  assert.equal(analysisBbox4326(null), null)
  assert.equal(analysisBbox4326([1, 2, 3]), null)
  assert.equal(analysisBbox4326([3, 2, 1, 4]), null)
  assert.equal(analysisBbox4326([1, 2, Number.NaN, 4]), null)
  assert.equal(serializeBbox(null), null)
})

test('latitudes are clamped into the EPSG:4326 range', () => {
  // Web Mercator ±85,05°'de doyar; sınırı aşan bir değer doğrulamadan düşerdi.
  const bbox = analysisBbox4326([-20037508, -20037508, 20037508, 20037508])

  assert.ok(bbox[1] >= -90 && bbox[3] <= 90)
  assert.ok(bbox[0] >= -180 && bbox[2] <= 180)
})

/* --- Ölçüt sayısı --------------------------------------------------------------- */

test('two criteria are valid and one is not', () => {
  assert.equal(check(criteria([5, 50], [6, 50])).valid, true)

  const single = check(criteria([5, 100]))
  assert.equal(single.valid, false)
  assert.match(single.reason, /en az 2/i)
})

test('five criteria are valid and the sixth is refused by the contract', () => {
  assert.equal(check(criteria([5, 20], [6, 20], [2, 20], [3, 20], [7, 20])).valid, true)

  const six = check(criteria([5, 20], [6, 20], [2, 20], [3, 20], [7, 10], [8, 10]))
  assert.equal(six.valid, false)
  assert.match(six.reason, /en fazla 5/i)

  assert.equal(MIN_CRITERIA, 2)
  assert.equal(MAX_CRITERIA, 5)
})

/* --- Ağırlıklar ----------------------------------------------------------------- */

test('the total must be exactly 100 — 99 and 101 are both refused', () => {
  assert.equal(check(criteria([5, 50], [6, 49])).valid, false)
  assert.equal(check(criteria([5, 50], [6, 50])).valid, true)
  assert.equal(check(criteria([5, 50], [6, 51])).valid, false)
  assert.equal(REQUIRED_WEIGHT_TOTAL, 100)
})

test('weights are never silently normalized', () => {
  /* 40 + 40 gönderen birine 50 + 50 uygulamak, ödevin kuralını kullanıcıya
     sormadan yeniden yorumlamak olurdu. */
  const result = check(criteria([5, 40], [6, 40]))

  assert.equal(result.valid, false)
  assert.match(result.reason, /100/)
  assert.match(result.reason, /80/)
  assert.equal(weightTotal(criteria([5, 40], [6, 40])), 80)
})

test('zero, negative and fractional weights are invalid', () => {
  for (const weight of [0, -5, 12.5]) {
    assert.equal(check(criteria([5, weight], [6, 100 - weight])).valid, false, `weight ${weight}`)
  }
})

test('a single weight may not exceed the total', () => {
  assert.equal(check(criteria([5, 120], [6, -20])).valid, false)
})

test('a blank weight while typing does not poison the running total', () => {
  // Kullanıcı yazarken alan geçici olarak boş kalır; NaN toplamı yutardı.
  assert.equal(weightTotal([{ categoryId: 5, weight: 40 }, { categoryId: 6, weight: Number.NaN }]), 40)
  assert.equal(weightTotal([]), 0)
  assert.equal(weightTotal(emptyCriterion() ? [emptyCriterion()] : []), 0)
})

/* --- Kategori seçimi ------------------------------------------------------------ */

test('the same category cannot be weighted twice', () => {
  const result = check(criteria([5, 50], [5, 50]))

  assert.equal(result.valid, false)
  assert.match(result.reason, /birden çok kez/i)
})

test('an ancestor and its descendant cannot be selected together', () => {
  /* "Yeme İçme" seçmek kafe ve restoranı zaten kapsar; ikisini birlikte
     ağırlıklandırmak aynı POI'yi iki kez saymak olurdu. Sunucu da reddeder. */
  const parentFirst = check(criteria([1, 60], [2, 40]))
  assert.equal(parentFirst.valid, false)
  assert.match(parentFirst.reason, /Yeme İçme/)

  const childFirst = check(criteria([2, 40], [1, 60]))
  assert.equal(childFirst.valid, false)
  assert.match(childFirst.reason, /Yeme İçme/)

  // Kardeşler serbesttir.
  assert.equal(check(criteria([2, 40], [3, 60])).valid, true)
  // İlgisiz kökler serbesttir — ödevin C senaryosu.
  assert.equal(check(criteria([1, 60], [4, 40])).valid, true)
})

test('combined marker view keeps every analysed criterion row', () => {
  const rows = [
    { featureId: 'osm:1', categoryId: 2, categorySlug: 'kafe' },
    { featureId: 'app:2', categoryId: 5, categorySlug: 'eczane' },
  ]

  assert.equal(analysisPoisForCriterion(rows, CATEGORIES, ''), rows)
})

test('focused marker view keeps only the selected criterion hierarchy', () => {
  const rows = [
    { featureId: 'osm:1', categoryId: 1, categorySlug: 'yeme-icme' },
    { featureId: 'osm:2', categoryId: 2, categorySlug: 'kafe' },
    { featureId: 'app:3', categoryId: 3, categorySlug: 'restoran' },
    { featureId: 'osm:4', categoryId: 5, categorySlug: 'eczane' },
  ]

  assert.deepEqual(
    analysisPoisForCriterion(rows, CATEGORIES, 'yeme-icme').map((row) => row.featureId),
    ['osm:1', 'osm:2', 'app:3'],
  )
  assert.deepEqual(
    analysisPoisForCriterion(rows, CATEGORIES, 'eczane').map((row) => row.featureId),
    ['osm:4'],
  )
})

test('hierarchy helpers walk the parent chain without looping forever', () => {
  const byId = categoryIndex(CATEGORIES)

  assert.equal(isDescendantOf(byId, 2, 1), true)
  assert.equal(isDescendantOf(byId, 1, 2), false)
  assert.equal(isDescendantOf(byId, 2, 2), false)
  assert.equal(isDescendantOf(byId, 2, 4), false)
  assert.equal(overlaps(byId, 1, 2), true)
  assert.equal(overlaps(byId, 2, 3), false)

  // Bozuk veri arayüzü kilitlememelidir.
  const cyclic = categoryIndex([
    { id: 10, parentId: 11 },
    { id: 11, parentId: 10 },
  ])
  assert.equal(isDescendantOf(cyclic, 10, 99), false)
})

test('a selected branch is removed from the other rows options', () => {
  const rows = criteria([1, 60], [null, 0])
  const options = selectableCategories(CATEGORIES, rows, 1).map((category) => category.id)

  // Seçilen kök de, torunları da elenir.
  assert.ok(!options.includes(1))
  assert.ok(!options.includes(2))
  assert.ok(!options.includes(3))
  // İlgisiz dallar durur.
  assert.ok(options.includes(4))
  assert.ok(options.includes(6))

  // Satırın KENDİ seçimi kendi listesinde durur, yoksa seçili değer kaybolurdu.
  assert.ok(selectableCategories(CATEGORIES, rows, 0).some((category) => category.id === 1))
})

test('a criterion without a category blocks the analysis', () => {
  const result = check([{ categoryId: null, weight: 50 }, { categoryId: 6, weight: 50 }])

  assert.equal(result.valid, false)
  assert.match(result.reason, /kategori seçin/i)
})

/* --- Sunucuya giden gövde -------------------------------------------------------- */

test('the request carries slugs, not environment-specific numeric ids', () => {
  /* Sayısal kimlik identity kolonundan üretilir ve ortamdan ortama değişir;
     slug bir kez üretilir ve değişmez. */
  assert.deepEqual(toRequestCriteria(criteria([5, 10], [6, 90]), CATEGORIES), [
    { categorySlug: 'eczane', weight: 10 },
    { categorySlug: 'okullar', weight: 90 },
  ])
})

test('the hierarchy scenario from the assignment maps to two root slugs', () => {
  // Yeme İçme 60 / Sağlık Kurumları 40 — alt ağaç genişletmesi SUNUCUNUN işi.
  assert.deepEqual(toRequestCriteria(criteria([1, 60], [4, 40]), CATEGORIES), [
    { categorySlug: 'yeme-icme', weight: 60 },
    { categorySlug: 'saglik-kurumlari', weight: 40 },
  ])
})

/* --- Hedef alan ------------------------------------------------------------------ */

test('no area means no analysis', () => {
  const result = check(criteria([5, 50], [6, 50]), [])

  assert.equal(result.valid, false)
  assert.match(result.reason, /hedef alan/i)
})

test('a province becomes one EPSG:4326 polygon per part', () => {
  const ankara = provinceAreaWkts('TR-06')

  assert.ok(ankara.length >= 1)
  for (const wkt of ankara) {
    assert.match(wkt, /^POLYGON \(/)
    // Koordinatlar boylam/enlem: Ankara ~32-34 doğu, ~39-40 kuzey.
    const [lon, lat] = wkt.replace(/^POLYGON \(+/, '').split(',')[0].trim().split(/\s+/).map(Number)
    assert.ok(lon > 25 && lon < 45, `boylam beklenen aralıkta değil: ${lon}`)
    assert.ok(lat > 35 && lat < 43, `enlem beklenen aralıkta değil: ${lat}`)
  }

  assert.deepEqual(provinceAreaWkts('TR-YOK'), [])
})

test('a multipart province keeps every part', () => {
  /* Adaları olan bir il birden çok poligon üretir. Yalnızca en büyüğünü almak
     ya da hepsini tek bir sahte poligona sıkıştırmak, o adaları sessizce
     analiz dışında bırakmak olurdu. */
  const multipart = ['TR-10', 'TR-35', 'TR-17', 'TR-34', 'TR-48']
    .map((code) => provinceAreaWkts(code))
    .find((parts) => parts.length > 1)

  assert.ok(multipart, 'veri kümesinde çok parçalı bir il bulunmalı')
  assert.ok(multipart.length > 1)
  for (const wkt of multipart) assert.match(wkt, /^POLYGON \(/)
})


/* --- Sabit analiz penceresi: COĞRAFİ KARARLILIK -----------------------------------

   Bildirilen gerçek hata: gönderilen analiz değişmediği hâlde, harita
   kaydırılıp yakınlaştırıldıkça ısı lekesi başka bir coğrafyaya taşınıyordu.
   Bunun iki ayrı sebebi vardı ve ikisi de burada sabitlenir:

   1. Pencere GÖRÜNÜMDEN türetiliyordu; her hareket başka bir zarf, başka bir
      normalleştirme ve başka bir raster üretiyordu.
   2. Pencere WMS 1.3.0 + EPSG:4326 ile enlem-önce gönderiliyordu; GeoServer
      onu `wms_bbox`'a aynı sırayla koyuyor, stil de `vec:Heatmap`'in
      `outputBBOX`'u yapıyordu — süreç zarfın X'ini doğu-batı sanıp rasteri
      DEVİRİYORDU. (İkincisinin karşılığı sunucudadır: CRS:84.)

   Buradaki sözleşme birincisidir: pencere yalnızca `areaWkts`'in bir
   fonksiyonudur. */

test('the analysis window is a pure function of the area, never of the viewport', () => {
  const wkts = provinceAreaWkts('TR-06')
  const first = analysisAreaEnvelope(wkts)

  // Aynı alan → BİREBİR aynı pencere. Görünümün girebileceği bir yer yoktur.
  assert.deepEqual(analysisAreaEnvelope(wkts), first)
  assert.deepEqual(analysisAreaImageSize(first), analysisAreaImageSize(first))

  // Pencere gerçekten Ankara'yı kapsar.
  assert.ok(first[0] < 32.85 && first[2] > 32.85, 'boylam Ankara merkezini kapsamalı')
  assert.ok(first[1] < 39.93 && first[3] > 39.93, 'enlem Ankara merkezini kapsamalı')
})

test('the envelope covers every part of a multipart area', () => {
  /* Zarf bir GÖRÜNTÜ penceresidir ve tüm parçaları kapsamalıdır; adaları
     dışarıda bırakmak, o parçaların rasterini hiç üretmemek olurdu.
     Parçalar sahte bir bağlayıcı poligonla BİRLEŞTİRİLMEZ — zarf yalnızca
     ikisini de içine alır. */
  const west = 'POLYGON((26 36,27 36,27 37,26 37,26 36))'
  const east = 'POLYGON((44 41,45 41,45 42,44 42,44 41))'
  const envelope = analysisAreaEnvelope([west, east])

  assert.ok(envelope[0] <= 26 && envelope[2] >= 45, 'boylamda her iki parça')
  assert.ok(envelope[1] <= 36 && envelope[3] >= 42, 'enlemde her iki parça')

  // Tek parça, iki parçalı zarfın tamamını kaplamaz.
  const only = analysisAreaEnvelope([west])
  assert.ok(only[2] < envelope[2])
})

test('the envelope survives one unreadable part', () => {
  const good = 'POLYGON((32 39,33 39,33 40,32 40,32 39))'
  const envelope = analysisAreaEnvelope([good, 'BU BİR WKT DEĞİL'])

  assert.ok(envelope, 'okunabilir parça yine de kapsanmalı')
  assert.ok(envelope[0] <= 32 && envelope[2] >= 33)

  assert.equal(analysisAreaEnvelope([]), null)
  assert.equal(analysisAreaEnvelope(null), null)
  assert.equal(analysisAreaEnvelope(['BOZUK']), null)
})

test('the envelope stays inside valid geographic bounds', () => {
  /* Pay eklemek pencereyi ±180/±90 dışına taşıyabilirdi; sunucu böyle bir
     pencereyi reddeder ve kullanıcı sebebini göremezdi. */
  const envelope = analysisAreaEnvelope(['POLYGON((-179.9 -89.9,179.9 -89.9,179.9 89.9,-179.9 89.9,-179.9 -89.9))'])

  assert.ok(envelope[0] >= -180 && envelope[2] <= 180)
  assert.ok(envelope[1] >= -90 && envelope[3] <= 90)
})

test('image size follows the envelope aspect ratio inside the server limits', () => {
  // Geniş alan → uzun kenar yatay.
  const wide = analysisAreaImageSize([30, 39, 34, 40])
  assert.equal(wide.width, ANALYSIS_IMAGE_LIMITS.longEdge)
  assert.ok(wide.height < wide.width)

  // Yüksek alan → uzun kenar düşey.
  const tall = analysisAreaImageSize([32, 36, 33, 42])
  assert.equal(tall.height, ANALYSIS_IMAGE_LIMITS.longEdge)
  assert.ok(tall.width < tall.height)

  // Kare alan → kare görüntü.
  const square = analysisAreaImageSize([32, 39, 33, 40])
  assert.equal(square.width, square.height)

  for (const size of [wide, tall, square]) {
    assert.ok(size.width >= ANALYSIS_IMAGE_LIMITS.minSide)
    assert.ok(size.height >= ANALYSIS_IMAGE_LIMITS.minSide)
    assert.ok(size.width <= ANALYSIS_IMAGE_LIMITS.maxSide)
    assert.ok(size.height <= ANALYSIS_IMAGE_LIMITS.maxSide)
    assert.ok(size.width * size.height <= ANALYSIS_IMAGE_LIMITS.maxPixels)
  }

  assert.equal(analysisAreaImageSize(null), null)
  assert.equal(analysisAreaImageSize([33, 40, 32, 39]), null)
})

test('an extreme aspect ratio never falls below the server minimum', () => {
  /* Çok ince bir şerit, oranı körü körüne uygulayınca 64'ün altında bir kenar
     üretirdi ve sunucu isteği reddederdi. */
  const sliver = analysisAreaImageSize([32, 39, 42, 39.001])

  assert.ok(sliver.height >= ANALYSIS_IMAGE_LIMITS.minSide)
  assert.ok(sliver.width <= ANALYSIS_IMAGE_LIMITS.maxSide)
})

test('four deterministic heatmap LOD bands select the requested raster sizes', () => {
  assert.equal(heatmapLodForZoom(8.99), 'far')
  assert.equal(heatmapLodForZoom(9), 'medium')
  assert.equal(heatmapLodForZoom(11.99), 'medium')
  assert.equal(heatmapLodForZoom(12), 'near')
  assert.equal(heatmapLodForZoom(14.99), 'near')
  assert.equal(heatmapLodForZoom(15), 'very_near')

  assert.equal(heatmapLodSpec('far').longEdge, 768)
  assert.equal(heatmapLodSpec('medium').longEdge, 1024)
  assert.equal(heatmapLodSpec('near').longEdge, 1536)
  assert.equal(heatmapLodSpec('very_near').longEdge, 2048)

  assert.equal(Object.values(LOCATION_ANALYSIS_HEATMAP_LODS).length, 4)
})

test('analysis POI labels are deterministic, close-only and decluttered', () => {
  assert.equal(analysisPoiLabelText('Eczane', 'far'), null)
  assert.equal(analysisPoiLabelText('Eczane', 'medium'), null)
  assert.equal(analysisPoiLabelText('Eczane', 'near'), 'Eczane')
  assert.equal(analysisPoiLabelText('Eczane', 'very_near'), 'Eczane')
  assert.equal(analysisPoiLabelText(null, 'very_near'), null)
  assert.equal(analysisPoiLabelText('   ', 'very_near'), null)
  assert.equal(LOCATION_ANALYSIS_LABEL_DECLUTTER, true)
})


/* --- İsabet testi hoşgörüsü -------------------------------------------------------

   <b>Görünüm çözünürlüğü YER METRESİ DEĞİLDİR.</b> OpenLayers EPSG:3857
   çözünürlüğünü Web Mercator metresi/piksel verir ve Web Mercator enlemle
   1/cos(enlem) oranında şişer. Ham değeri metre diye sunucuya göndermek, arama
   yarıçapını Ankara'da sessizce ~%30 büyütürdü — projenin daha önce
   derece/metre karışıklığında ödediği bedelin aynısı. */

test('screen pixels become real ground metres, not Web Mercator metres', () => {
  const resolution = 38 // ~z12
  const raw = resolution * 10

  const ankara = hitTestToleranceMeters(resolution, 39.93)
  const equator = hitTestToleranceMeters(resolution, 0)

  // Ekvatorda Web Mercator şişmesi yoktur: ham değere eşit.
  assert.ok(Math.abs(equator - raw) < 0.5, `ekvatorda ${equator} ≈ ${raw} olmalı`)

  // Ankara enleminde GERÇEK mesafe daha kısadır.
  assert.ok(ankara < equator, 'enlem arttıkça yer metresi azalmalı')
  assert.ok(Math.abs(ankara - raw * Math.cos((39.93 * Math.PI) / 180)) < 0.5)

  // Ham çözünürlüğü metre sanmak yarıçapı belirgin biçimde büyütürdü.
  assert.ok(raw / ankara > 1.25, 'düzeltilmemiş değer ~%30 büyük olurdu')
})

test('the tolerance never escapes the bounds the server also enforces', () => {
  /* İstemci kendi kendini sınırlar ama SUNUCU da kırpar: tarayıcıdan gelen bir
     sayı sorgunun kapsamını belirleyemez. */
  const coarse = hitTestToleranceMeters(150_000, 39.93)
  assert.equal(coarse, HIT_TEST_TOLERANCE_LIMITS.max)

  const tiny = hitTestToleranceMeters(0.0001, 39.93)
  assert.equal(tiny, HIT_TEST_TOLERANCE_LIMITS.min)

  for (const broken of [NaN, 0, -1, Infinity, null, undefined]) {
    assert.equal(hitTestToleranceMeters(broken, 39.93), HIT_TEST_TOLERANCE_LIMITS.min)
  }

  for (const badLatitude of [NaN, 91, -91, null]) {
    assert.equal(hitTestToleranceMeters(38, badLatitude), HIT_TEST_TOLERANCE_LIMITS.min)
  }
})
