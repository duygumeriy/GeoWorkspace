import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import VectorSource from 'ol/source/Vector.js'
import {
  BASARSOFT_MARK_POLYGONS,
  BASARSOFT_MARK_VIEW_BOX,
} from '../../src/brand/basarsoftMark.js'
import {
  TRANSPORT_VEHICLE_KIND,
  TRANSPORT_VEHICLE_LAYER_CLASSNAME,
  VEHICLE_EMPHASIS,
  createTransportVehicleLayer,
  findTransportVehicleAtPixel,
  syncTransportVehicleFeatures,
  transportVehicleMarkDataUri,
  transportWatchedVehiclePresentations,
  vehicleFeatureId,
} from '../../src/map/transportVehicle.js'
import { SIMULATION_STATUS } from '../../src/map/transportSimulationState.js'

/**
 * Faz 6 — PAYLAŞILAN hattın aracı artık BAŞARSOFT işaretidir.
 *
 * Ölçülen şey GÖRSEL sözleşmedir: sağlanan kurumsal SVG kullanılır, altında
 * yuvarlak rozet yoktur, yönü rota geometrisinden uydurulmaz ve kimlik/tıklama
 * mimarisi (Faz 4A/4B/5) olduğu gibi durur. Kişisel yolculuk işaretçisi bu
 * değişikliğin DIŞINDADIR ve o sınır burada açıkça korunur.
 */

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

/* Kaynak taramaları YORUMSUZ metin üzerinde yapılır: bir açıklama satırında
   geçen sözcük yüzünden testin kırmızıya dönmesi, ölçtüğümüz şeyi ölçmez. */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

const VEHICLE = stripComments(read('../../src/map/transportVehicle.js'))
const JOURNEY_VEHICLE = stripComments(read('../../src/map/journeyVehicle.js'))
const SYMBOL_ASSET = read('../../src/assets/brand/basarsoft-symbol.svg')

const ROUTE_A = 7
const ROUTE_B = 8
const RUN_1 = '11111111-1111-1111-1111-111111111111'
const RUN_2 = '22222222-2222-2222-2222-222222222222'

const routes = [
  { id: ROUTE_A, name: 'Merkez Hattı', colorHex: '#E11D48', isActive: true },
  { id: ROUTE_B, name: 'Sahil Hattı', colorHex: '#0284C7', isActive: true },
]

const simulation = ({
  simulationId = RUN_1,
  routeId = ROUTE_A,
  status = SIMULATION_STATUS.RUNNING,
  longitude = 30,
  latitude = 40,
  progressPercent = 25,
} = {}) => ({ simulationId, routeId, status, longitude, latitude, progressPercent })

/** İşaretin `data:` URI'sini çözüp SVG metnini verir. */
const markSvg = () => {
  const uri = transportVehicleMarkDataUri()
  const prefix = 'data:image/svg+xml;charset=utf-8,'
  assert.ok(uri.startsWith(prefix), 'işaret bir data: URI olmalı')
  return decodeURIComponent(uri.slice(prefix.length))
}

/** Katmanın bir feature için ürettiği stil dizisi. */
const stylesFor = (properties) => {
  const { layer } = createTransportVehicleLayer()
  const feature = { get: (key) => properties[key] }
  return layer.getStyle()(feature, 1)
}

/* --- 1 / 29. Sağlanan kurumsal SVG kullanılır, yaklaşık çizilmez ------------- */

test('the shared marker draws the supplied Başarsoft symbol, polygon for polygon', () => {
  const svg = markSvg()

  for (const { points, fill } of BASARSOFT_MARK_POLYGONS) {
    assert.ok(svg.includes(`points="${points}"`), `işaret ${points} poligonunu taşımalı`)
    assert.ok(svg.includes(`fill="${fill}"`), `işaret ${fill} kurumsal rengini taşımalı`)
  }
})

test('the mark module is the asset file, not an approximation of it', () => {
  /* Tek doğruluk kaynağı: modüldeki geometri ile dosyadaki geometri BİREBİR
     aynıdır. Biri değişip diğeri değişmediğinde bu test düşer. */
  const assetPoints = [...SYMBOL_ASSET.matchAll(/points="([^"]+)"/g)].map((match) => match[1])
  const assetFills = [...SYMBOL_ASSET.matchAll(/fill="(#[0-9A-Fa-f]{6})"/g)].map((match) => match[1])

  assert.deepEqual(assetPoints, BASARSOFT_MARK_POLYGONS.map((polygon) => polygon.points))
  assert.deepEqual(assetFills, BASARSOFT_MARK_POLYGONS.map((polygon) => polygon.fill))

  const viewBox = SYMBOL_ASSET.match(/viewBox="0 0 (\d+) (\d+)"/)
  assert.ok(viewBox, 'asset bir viewBox taşımalı')
  assert.equal(Number(viewBox[1]), BASARSOFT_MARK_VIEW_BOX.width)
  assert.equal(Number(viewBox[2]), BASARSOFT_MARK_VIEW_BOX.height)
})

/* --- 2 / 3. Eski yuvarlak işaret ve her türlü daire zemin GİTTİ -------------- */

test('the old round vehicle symbol is gone from the shared marker', () => {
  assert.equal(/CircleStyle/.test(VEHICLE), false, 'paylaşılan araç artık daire sembolü kullanmaz')
  assert.equal(/from 'ol\/style\.js'/.test(VEHICLE), true)
  assert.equal(/Circle as CircleStyle/.test(VEHICLE), false)
})

test('no circular badge or background wraps the Başarsoft mark', () => {
  const svg = markSvg()

  // Logonun ARKASINA zemin çizilmez: ne daire, ne dikdörtgen, ne elips.
  assert.equal(/<circle/.test(svg), false)
  assert.equal(/<ellipse/.test(svg), false)
  assert.equal(/<rect/.test(svg), false)
  // Çizilen tek şey poligonlardır.
  assert.equal((svg.match(/<polygon/g) ?? []).length, BASARSOFT_MARK_POLYGONS.length)
})

test('the vehicle style is a single icon image, not a stack of shapes', () => {
  const styles = stylesFor({ isLive: true, emphasis: VEHICLE_EMPHASIS.FULL })

  assert.equal(styles.length, 1, 'işaret tek bir görüntü katmanıdır')
  assert.equal(styles[0].getImage().getSrc(), transportVehicleMarkDataUri())
  assert.equal(styles[0].getFill(), null)
  assert.equal(styles[0].getStroke(), null)
})

/* --- 11. Yön ÇIKARILMAZ ------------------------------------------------------ */

test('no heading is inferred from route geometry', () => {
  const styles = stylesFor({ isLive: true, emphasis: VEHICLE_EMPHASIS.FULL })
  const icon = styles[0].getImage()

  assert.equal(icon.getRotation(), 0)
  assert.equal(icon.getRotateWithView(), false)

  // Açı hesabı yapan hiçbir çağrı yoktur.
  for (const forbidden of ['atan2', 'getCoordinateAt', 'bearing', 'heading']) {
    assert.equal(VEHICLE.includes(forbidden), false, `${forbidden} paylaşılan araçta olmamalı`)
  }
})

/* --- 12. Ağ/CDN bağımlılığı yok ---------------------------------------------- */

test('the marker adds no network or CDN icon dependency', () => {
  const uri = transportVehicleMarkDataUri()
  assert.ok(uri.startsWith('data:image/svg+xml'))
  assert.equal(/https?:\/\//.test(markSvg().replace(/xmlns="[^"]*"/g, '')), false)
})

/* --- Ölçek: tek, ölçülü boy -------------------------------------------------- */

test('the marker keeps one restrained size and does not grow with zoom', () => {
  const full = stylesFor({ isLive: true, emphasis: VEHICLE_EMPHASIS.FULL })[0].getImage()
  const muted = stylesFor({ isLive: true, emphasis: VEHICLE_EMPHASIS.MUTED })[0].getImage()

  // Ölçek çözünürlüğe DEĞİL yalnızca vurguya bakar.
  assert.ok(full.getScale() > 0)
  assert.ok(muted.getScale() < full.getScale())
  assert.equal(VEHICLE.includes('getResolution'), false)
})

/* --- 6. Seçim yalnızca VURGUYU değiştirir ------------------------------------ */

test('selection changes only emphasis, never identity or visibility', () => {
  const byRoute = { [ROUTE_A]: simulation(), [ROUTE_B]: simulation({ simulationId: RUN_2, routeId: ROUTE_B }) }
  const watchedRuns = { [ROUTE_A]: RUN_1, [ROUTE_B]: RUN_2 }

  const withA = transportWatchedVehiclePresentations({
    byRoute, watchedRuns, selectedRouteId: ROUTE_A, subscribedRouteIds: [ROUTE_A, ROUTE_B], routes,
  })
  const withB = transportWatchedVehiclePresentations({
    byRoute, watchedRuns, selectedRouteId: ROUTE_B, subscribedRouteIds: [ROUTE_A, ROUTE_B], routes,
  })

  assert.equal(withA.length, 2)
  assert.equal(withB.length, 2)
  assert.deepEqual(
    withA.map((item) => item.emphasis),
    [VEHICLE_EMPHASIS.FULL, VEHICLE_EMPHASIS.MUTED],
  )
  assert.deepEqual(
    withB.map((item) => item.emphasis),
    [VEHICLE_EMPHASIS.MUTED, VEHICLE_EMPHASIS.FULL],
  )

  // Kimlik seçime göre DEĞİŞMEZ.
  assert.deepEqual(
    withA.map((item) => vehicleFeatureId(item.routeId, item.simulationId)),
    withB.map((item) => vehicleFeatureId(item.routeId, item.simulationId)),
  )

  // Vurgu farkı stile YANSIR ama işaret aynı kalır.
  const selected = stylesFor({ isLive: true, emphasis: VEHICLE_EMPHASIS.FULL })[0].getImage()
  const other = stylesFor({ isLive: true, emphasis: VEHICLE_EMPHASIS.MUTED })[0].getImage()
  assert.equal(selected.getSrc(), other.getSrc())
  assert.ok(other.getOpacity() < selected.getOpacity())
})

/* --- 4. Aynı feature YERİNDE güncellenir ------------------------------------- */

test('a live tick moves the same feature instead of recreating it', () => {
  const source = new VectorSource()
  const presentation = transportWatchedVehiclePresentations({
    byRoute: { [ROUTE_A]: simulation() },
    watchedRuns: { [ROUTE_A]: RUN_1 },
    selectedRouteId: ROUTE_A,
    subscribedRouteIds: [ROUTE_A],
    routes,
  })

  const [first] = syncTransportVehicleFeatures(source, presentation)
  const moved = transportWatchedVehiclePresentations({
    byRoute: { [ROUTE_A]: simulation({ longitude: 31, latitude: 41 }) },
    watchedRuns: { [ROUTE_A]: RUN_1 },
    selectedRouteId: ROUTE_A,
    subscribedRouteIds: [ROUTE_A],
    routes,
  })
  const [second] = syncTransportVehicleFeatures(source, moved)

  assert.equal(first, second, 'aynı çalıştırma aynı feature ile devam eder')
  assert.equal(source.getFeatures().length, 1)
})

/* --- 5 / 8. Çoklu izleme ve takip -------------------------------------------- */

test('multi-watch creates exactly one marker per watched run, and Follow adds none', () => {
  const source = new VectorSource()
  const presentations = transportWatchedVehiclePresentations({
    byRoute: { [ROUTE_A]: simulation(), [ROUTE_B]: simulation({ simulationId: RUN_2, routeId: ROUTE_B }) },
    watchedRuns: { [ROUTE_A]: RUN_1, [ROUTE_B]: RUN_2 },
    selectedRouteId: ROUTE_A,
    followingRouteId: ROUTE_A,
    subscribedRouteIds: [ROUTE_A, ROUTE_B],
    routes,
  })

  syncTransportVehicleFeatures(source, presentations)
  assert.equal(source.getFeatures().length, 2)

  // Takip KAMERA kararıdır: ikinci bir işaret doğurmaz.
  assert.equal(presentations.filter((item) => item.followCamera).length, 1)
  assert.deepEqual(
    source.getFeatures().map((feature) => feature.getId()).sort(),
    [vehicleFeatureId(ROUTE_A, RUN_1), vehicleFeatureId(ROUTE_B, RUN_2)].sort(),
  )
})

/* --- 9. Yerine geçen çalıştırma izlemeyi DEVRALMAZ --------------------------- */

test('a replacement run does not inherit Watch from the run it replaced', () => {
  const presentations = transportWatchedVehiclePresentations({
    // Aynı hatta B başladı; kullanıcı onu izlemeye hiç karar vermedi.
    byRoute: { [ROUTE_A]: simulation({ simulationId: RUN_2 }) },
    watchedRuns: { [ROUTE_A]: RUN_1 },
    selectedRouteId: ROUTE_A,
    subscribedRouteIds: [ROUTE_A],
    routes,
  })

  assert.deepEqual(presentations, [])
})

/* --- 7. Tıklama tam olarak rota + çalıştırmayı çözer ------------------------- */

test('clicking a marker still resolves the exact routeId and simulationId', () => {
  const source = new VectorSource()
  const [feature] = syncTransportVehicleFeatures(source, transportWatchedVehiclePresentations({
    byRoute: { [ROUTE_B]: simulation({ simulationId: RUN_2, routeId: ROUTE_B }) },
    watchedRuns: { [ROUTE_B]: RUN_2 },
    selectedRouteId: ROUTE_B,
    subscribedRouteIds: [ROUTE_B],
    routes,
  }))

  const map = {
    forEachFeatureAtPixel(pixel, callback) {
      return callback(feature, { getClassName: () => TRANSPORT_VEHICLE_LAYER_CLASSNAME }) ?? undefined
    },
  }

  const hit = findTransportVehicleAtPixel(map, [10, 10])
  assert.equal(hit, feature)
  assert.equal(hit.get('featureKind'), TRANSPORT_VEHICLE_KIND)
  assert.equal(hit.get('routeId'), ROUTE_B)
  assert.equal(hit.get('simulationId'), RUN_2)
  assert.equal(hit.get('transportVehicle').simulationId, RUN_2)
})

/* --- 10. KİŞİSEL yolculuk işaretçisi bu fazın DIŞINDADIR --------------------- */

test('the personal journey marker was not redirected to the Başarsoft mark', () => {
  // Kişisel işaretçi marka modülünü hiç tanımaz.
  assert.equal(JOURNEY_VEHICLE.includes('basarsoftMark'), false)
  assert.equal(JOURNEY_VEHICLE.includes('BASARSOFT'), false)

  // Kendi profil rozetini (beyaz kılıf + mor disk + sembol) korur.
  assert.ok(JOURNEY_VEHICLE.includes('journeyProfileIcon'))
  assert.ok(JOURNEY_VEHICLE.includes('<circle cx="12" cy="12"'))

  // Paylaşılan araç da kişisel rozeti ödünç almaz: iki dünya ayrı kalır.
  assert.equal(VEHICLE.includes('journeyProfileIcon'), false)
  assert.equal(VEHICLE.includes('journeyVehicle'), false)
})
