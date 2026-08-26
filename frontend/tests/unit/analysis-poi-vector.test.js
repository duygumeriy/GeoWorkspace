import assert from 'node:assert/strict'
import test from 'node:test'
import { toLonLat } from 'ol/proj.js'
import {
  LOCATION_ANALYSIS_POI_CLASSNAME,
  LOCATION_ANALYSIS_POI_FEATURE_KIND,
  LOCATION_ANALYSIS_POI_Z_INDEX,
  analysisPoiToFeature as toFeature,
  featureToAnalysisPoi,
} from '../../src/map/locationAnalysis.js'
import { POI_FEATURE_KIND, POI_LAYER_CLASSNAME, POI_LAYER_Z_INDEX } from '../../src/map/poi.js'
import { poiBadgeDataUri, poiMarkerStyle } from '../../src/map/poiMarkerStyle.js'
import { MARKER_SCALE_BANDS, markerSizeForResolution } from '../../src/map/poiMarkerScale.js'
import { isKnownIconKey } from '../../src/components/map/poiIconRegistry.js'

/* --- Projeksiyon ----------------------------------------------------------------

   Kayıt EPSG:4326'dır, harita EPSG:3857. Bu SIRADAN bir dönüşümdür ve
   GeoServer görüntü yollarındaki CRS:84 / enlem-önce sözleşmesiyle İLGİSİ
   YOKTUR — o sözleşme yalnızca WMS taşımasına aittir. */

test('a record is placed at its real geography, via OpenLayers', () => {
  // Gerçek veri kümesinden bir kontrol noktası (Ankara merkez).
  const record = { featureId: 'osm:9', id: 9, longitude: 32.852724, latitude: 39.885072, categoryId: 33 }

  const feature = toFeature(record)
  const [lon, lat] = toLonLat(feature.getGeometry().getCoordinates())

  assert.ok(Math.abs(lon - record.longitude) < 1e-9, `boylam ${lon}`)
  assert.ok(Math.abs(lat - record.latitude) < 1e-9, `enlem ${lat}`)

  /* Eksenler TERS OLSAYDI nokta Suudi Arabistan'a düşerdi; sınır denetimi
     bunu yakalar. */
  assert.ok(lon > 25 && lon < 45, 'boylam Türkiye aralığında')
  assert.ok(lat > 35 && lat < 43, 'enlem Türkiye aralığında')

  // Web Mercator metreleri: derece DEĞİL.
  const [x, y] = feature.getGeometry().getCoordinates()
  assert.ok(Math.abs(x) > 1000, 'harita koordinatı metre olmalı')
  assert.ok(Math.abs(y) > 1000)
})

test('an unusable record becomes no feature at all', () => {
  /* Bozuk bir satır katmanı düşürmez; yalnızca kendisi çizilmez. */
  for (const bad of [null, {}, { longitude: 32, latitude: null }, { longitude: NaN, latitude: 39 }]) {
    assert.equal(toFeature(bad), null)
  }
})

/* --- Feature sözleşmesi ---------------------------------------------------------- */

test('an analysis feature is distinguishable from a normal POI feature', () => {
  /* İsabet denetimi hem katman sınıfını hem bu ayırt ediciyi arar: tek başına
     piksel araması, normal bir POI'yi analiz kaydı sanmaya açık kapı
     bırakırdı. */
  const feature = toFeature({ featureId: 'osm:1', id: 1, longitude: 32.85, latitude: 39.92, categoryId: 33 })

  assert.equal(feature.get('featureKind'), LOCATION_ANALYSIS_POI_FEATURE_KIND)
  assert.notEqual(LOCATION_ANALYSIS_POI_FEATURE_KIND, POI_FEATURE_KIND)
  assert.equal(feature.getId(), 'osm:1')
})

test('a feature round-trips to the record the popup shows', () => {
  const record = {
    id: 4171,
    featureId: 'osm:4171',
    name: 'Halide Edip Adıvar İlköğretim Okulu',
    categoryId: 35,
    categorySlug: 'okullar',
    categoryName: 'Okullar',
    categoryPath: 'Eğitim Kurumları / Okullar',
    longitude: 32.853219,
    latitude: 39.885648,
    source: 'OpenStreetMap',
  }

  assert.deepEqual(featureToAnalysisPoi(toFeature(record)), record)
  assert.equal(featureToAnalysisPoi(null), null)
})

test('a nameless record round-trips as null, never as the string "null"', () => {
  /* Gerçek Ankara kümesinde 182 adsız kayıt var; kart onları "İsimsiz POI"
     diye gösterebilmek için gerçek bir boşluk görmelidir. */
  const feature = toFeature({ featureId: 'osm:1', id: 1, name: null, longitude: 32.85, latitude: 39.92, categoryId: 33 })

  assert.equal(featureToAnalysisPoi(feature).name, null)
})

test('osm and application rows with the same numeric id keep distinct composite identities', () => {
  const osm = toFeature({ featureId: 'osm:42', id: 42, longitude: 32.85, latitude: 39.92 })
  const app = toFeature({ featureId: 'app:42', id: 42, longitude: 32.85, latitude: 39.92 })

  assert.equal(osm.getId(), 'osm:42')
  assert.equal(app.getId(), 'app:42')
  assert.notEqual(osm.getId(), app.getId())
  assert.equal(featureToAnalysisPoi(osm).featureId, 'osm:42')
  assert.equal(featureToAnalysisPoi(app).featureId, 'app:42')
})

/* --- Rozet: İKİNCİ bir simge sistemi YOK ----------------------------------------- */

test('analysis badges come from the normal POI marker system', () => {
  /* Aynı fonksiyon, aynı önbellek, aynı simge kütüğü. Ayrı bir eşleme
     yazılsaydı, bir yönetici kategorinin simgesini değiştirdiğinde iki katman
     birbirinden ayrılırdı. */
  for (const [iconKey, colorHex] of [
    ['pill', '#EF4444'],          // Eczane
    ['school', '#F59E0B'],        // Okullar
    ['hospital', '#EF4444'],      // Sağlık Kurumları
    ['graduation-cap', '#F59E0B'], // Eğitim Kurumları
  ]) {
    assert.ok(isKnownIconKey(iconKey), `${iconKey} kütükte tanınmalı`)

    const uri = poiBadgeDataUri(iconKey, colorHex, 24)
    assert.ok(uri.startsWith('data:image/svg+xml'), 'rozet gömülü SVG olmalı')
    assert.ok(uri.includes(encodeURIComponent(colorHex)), 'kategori rengi rozette olmalı')

    /* Ağ yok, CDN yok, GeoServer yok: rozet bellekte üretilir.
       `xmlns` bir AD ALANI belirtecidir, indirilen bir adres değildir —
       dolayısıyla ölçülen şey gerçek dış BAŞVURULARDIR. */
    const svg = decodeURIComponent(uri.slice(uri.indexOf(',') + 1))
    assert.ok(!/(?:href|src)\s*=/.test(svg), 'rozet dış bir kaynağa başvurmamalı')
    assert.ok(!svg.includes('geoserver'), 'rozet GeoServer\'a gitmemeli')
    assert.ok(!/url\(/.test(svg), 'rozet uzak bir url() taşımamalı')
  }
})

test('analysis markers use the same zoom size bands as normal POIs', () => {
  /* İki katman yan yana durur; farklı boyut kuralları, aynı yerin iki farklı
     ölçekte çizildiği izlenimi verirdi. */
  const sizes = MARKER_SCALE_BANDS.map((band) => band.size)

  for (const resolution of [1222, 152, 38, 2]) {
    assert.ok(sizes.includes(markerSizeForResolution(resolution)))
  }

  // Uzakta küçük, yakında büyük.
  assert.ok(markerSizeForResolution(1222) < markerSizeForResolution(2))
})

test('an analysis marker always draws a badge, never a bare dot', () => {
  /* Raster dönemi bitti: `rasterActive` her zaman false'tur, dolayısıyla
     rozet HER ZAMAN çizilir. Kimliksiz bir mavi nokta bu katmanda artık
     hiçbir durumda görünmez. */
  const styles = poiMarkerStyle({
    iconKey: 'pill',
    colorHex: '#EF4444',
    size: 24,
    selected: false,
    rasterActive: false,
  })

  // İsabet dairesi + rozet.
  assert.equal(styles.length, 2)
  assert.ok(styles.some((style) => style.getImage()?.getSrc?.()?.startsWith('data:image/svg+xml')))
})

test('a category without metadata still draws a badge, not a generic dot', () => {
  const styles = poiMarkerStyle({
    iconKey: null,
    colorHex: null,
    size: 24,
    selected: false,
    rasterActive: false,
  })

  assert.equal(styles.length, 2)
})

/* --- Katman sırası --------------------------------------------------------------- */

test('analysis POIs stay below the user\'s own POIs', () => {
  /* Kullanıcının kendi POI'leri hiçbir koşulda 7853 satırlık analiz kümesinin
     altında kalmaz. */
  assert.ok(LOCATION_ANALYSIS_POI_Z_INDEX < POI_LAYER_Z_INDEX)
})

test('the two POI layers cannot be mistaken for each other', () => {
  /* İsabet denetimleri katman sınıfını `includes` ile arar. Analiz katmanının
     adı normal POI katmanının adını ALT DİZGE olarak taşısaydı (ör.
     "location-analysis-poi-layer" → "poi-layer"), analiz noktaları normal POI
     denetimini de geçerdi. Bugün ikinci bir koşul bunu yakalar; bu iddia o
     koşula bel bağlamamak içindir. */
  assert.ok(!LOCATION_ANALYSIS_POI_CLASSNAME.includes(POI_LAYER_CLASSNAME))
  assert.ok(!POI_LAYER_CLASSNAME.includes(LOCATION_ANALYSIS_POI_CLASSNAME))
  assert.notEqual(LOCATION_ANALYSIS_POI_FEATURE_KIND, POI_FEATURE_KIND)
})
