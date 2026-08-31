import assert from 'node:assert/strict'
import test from 'node:test'
import VectorSource from 'ol/source/Vector.js'
import { fromLonLat, toLonLat } from 'ol/proj.js'
import {
  TRANSPORT_ROUTE_KIND,
  TRANSPORT_ROUTE_PATH_KIND,
  TRANSPORT_STOP_KIND,
  transportFeatures,
} from '../../src/map/transport.js'
import {
  TRANSPORT_VEHICLE_KIND,
  TRANSPORT_VEHICLE_LAYER_CLASSNAME,
  VEHICLE_OWNERSHIP,
  createTransportVehicleLayer,
  syncTransportVehicleFeature,
  transportVehiclePopupModel,
  transportVehiclePresentation,
  vehicleCameraTarget,
  vehicleFeatureId,
} from '../../src/map/transportVehicle.js'
import { SIMULATION_STATUS } from '../../src/map/transportSimulationState.js'

const ROUTE_A = 7
const ROUTE_B = 8
const RUN_1 = '11111111-1111-1111-1111-111111111111'
const RUN_2 = '22222222-2222-2222-2222-222222222222'

const routes = [
  { id: ROUTE_A, name: 'Merkez Hattı', colorHex: '#E11D48', isActive: true },
  { id: ROUTE_B, name: 'Sahil Hattı', colorHex: '#0284C7', isActive: true },
]

const simulationState = ({
  simulationId = RUN_1,
  routeId = ROUTE_A,
  status = SIMULATION_STATUS.RUNNING,
  longitude = 30,
  latitude = 40,
  progressPercent = 25,
  updatedAtUtc = '2026-08-31T10:00:00Z',
} = {}) => ({ simulationId, routeId, status, longitude, latitude, progressPercent, updatedAtUtc })

const presentationFor = (overrides = {}) => transportVehiclePresentation({
  simulation: simulationState(),
  followingRouteId: ROUTE_A,
  selectedRouteId: ROUTE_A,
  routes,
  ...overrides,
})

/* --- Sahiplik: followingRouteId, selectedRouteId DEĞİL ----------------------- */

test('the followed route owns the vehicle even while another route is selected', () => {
  const presentation = transportVehiclePresentation({
    simulation: simulationState({ routeId: ROUTE_A }),
    followingRouteId: ROUTE_A,
    // Kullanıcı B'yi inceliyor: araç yine de A'ya aittir ve kaybolmaz.
    selectedRouteId: ROUTE_B,
    routes,
  })

  assert.equal(presentation.routeId, ROUTE_A)
  assert.equal(presentation.ownership, VEHICLE_OWNERSHIP.FOLLOW)
  assert.equal(presentation.isLive, true)
  assert.equal(presentation.followCamera, true)
})

test('selecting a route alone never produces a vehicle', () => {
  /* Rota seçmek canlı takip DEĞİLDİR: bayat bir REST anlık görüntüsünü
     haritada canlıymış gibi göstermek kullanıcıyı yanıltırdı. */
  const presentation = transportVehiclePresentation({
    simulation: simulationState(),
    followingRouteId: null,
    selectedRouteId: ROUTE_A,
    routes,
  })

  assert.equal(presentation, null)
})

test('the started run is live but never claims the camera', () => {
  /* ASIL AYRIM: canlı gözlem ≠ kamera takibi. Başlatan kullanıcı aracın
     hareketini görür; görünümü hareket ettiren tek şey açık "Takip Et"tir. */
  const presentation = transportVehiclePresentation({
    simulation: simulationState({ progressPercent: 0 }),
    followingRouteId: null,
    observedRouteId: ROUTE_A,
    selectedRouteId: ROUTE_A,
    startedSimulationId: RUN_1,
    routes,
  })

  assert.equal(presentation.ownership, VEHICLE_OWNERSHIP.START)
  assert.equal(presentation.progressPercent, 0)
  assert.equal(presentation.isLive, true)
  assert.equal(presentation.followCamera, false)
})

test('the started vehicle advances from the 0% snapshot as live updates arrive', () => {
  const source = new VectorSource()
  const started = transportVehiclePresentation({
    simulation: simulationState({ progressPercent: 0, longitude: 30 }),
    observedRouteId: ROUTE_A,
    selectedRouteId: ROUTE_A,
    startedSimulationId: RUN_1,
    routes,
  })
  const first = syncTransportVehicleFeature(source, started)

  // Sunucudan gelen yeni konum: AYNI feature ilerler, ikinci bir araç doğmaz.
  const moved = transportVehiclePresentation({
    simulation: simulationState({ progressPercent: 45, longitude: 31 }),
    observedRouteId: ROUTE_A,
    selectedRouteId: ROUTE_A,
    startedSimulationId: RUN_1,
    routes,
  })
  const second = syncTransportVehicleFeature(source, moved)

  assert.equal(first, second)
  assert.equal(source.getFeatures().length, 1)
  assert.deepEqual(second.getGeometry().getCoordinates(), fromLonLat([31, 40]))
  assert.equal(moved.progressPercent, 45)
  assert.equal(moved.isLive, true)
  assert.equal(moved.followCamera, false)
})

test('without a live subscription the starter snapshot is not presented as live', () => {
  const presentation = transportVehiclePresentation({
    simulation: simulationState({ progressPercent: 0 }),
    followingRouteId: null,
    observedRouteId: null,
    selectedRouteId: ROUTE_A,
    startedSimulationId: RUN_1,
    routes,
  })

  assert.equal(presentation.isLive, false)
  assert.equal(presentation.followCamera, false)
})

test('explicit follow adds the camera claim on top of the live stream', () => {
  const observedOnly = transportVehiclePresentation({
    simulation: simulationState(),
    observedRouteId: ROUTE_A,
    selectedRouteId: ROUTE_A,
    startedSimulationId: RUN_1,
    routes,
  })
  const followed = transportVehiclePresentation({
    simulation: simulationState(),
    followingRouteId: ROUTE_A,
    observedRouteId: ROUTE_A,
    selectedRouteId: ROUTE_A,
    startedSimulationId: RUN_1,
    routes,
  })

  assert.equal(observedOnly.followCamera, false)
  assert.equal(followed.ownership, VEHICLE_OWNERSHIP.FOLLOW)
  assert.equal(followed.followCamera, true)
  assert.equal(followed.isLive, true)
})

test('observing another route never renders a vehicle for it', () => {
  /* İzleme yalnızca CANLILIK sorusunu yanıtlar; aracın var olup olmadığını
     sahiplik belirler. Sahipliği olmayan bir rota izlense bile çizilmez. */
  assert.equal(transportVehiclePresentation({
    simulation: simulationState({ routeId: ROUTE_B }),
    followingRouteId: null,
    observedRouteId: ROUTE_B,
    selectedRouteId: ROUTE_A,
    startedSimulationId: RUN_1,
    routes,
  }), null)
})

test('a starter snapshot from a different run or route is not shown', () => {
  assert.equal(transportVehiclePresentation({
    simulation: simulationState({ simulationId: RUN_2 }),
    selectedRouteId: ROUTE_A,
    startedSimulationId: RUN_1,
    routes,
  }), null)

  assert.equal(transportVehiclePresentation({
    simulation: simulationState({ routeId: ROUTE_B }),
    selectedRouteId: ROUTE_A,
    startedSimulationId: RUN_1,
    routes,
  }), null)
})

test('route identity comes from already loaded routes, without a new fetch', () => {
  const presentation = presentationFor()

  assert.equal(presentation.routeName, 'Merkez Hattı')
  assert.equal(presentation.colorHex, '#E11D48')

  // Rota listede yoksa isim uydurulmaz.
  const unknown = transportVehiclePresentation({
    simulation: simulationState(),
    followingRouteId: ROUTE_A,
    routes: [],
  })
  assert.equal(unknown.routeName, null)
})

test('a missing or unusable position produces no vehicle', () => {
  assert.equal(transportVehiclePresentation({ simulation: null, followingRouteId: ROUTE_A }), null)
  assert.equal(transportVehiclePresentation({
    simulation: simulationState({ longitude: null }),
    followingRouteId: ROUTE_A,
    routes,
  }), null)
})

/* --- 4326 -> harita projeksiyonu --------------------------------------------- */

test('the server 4326 coordinate is transformed only for presentation', () => {
  const source = new VectorSource()

  const feature = syncTransportVehicleFeature(source, presentationFor())
  const coordinate = feature.getGeometry().getCoordinates()

  // Harita projeksiyonundadır (3857), ham derece değil…
  assert.ok(Math.abs(coordinate[0]) > 1000)
  assert.deepEqual(coordinate, fromLonLat([30, 40]))

  // …ve geri çevrildiğinde sunucunun verdiği değerdir.
  const lonLat = toLonLat(coordinate)
  assert.ok(Math.abs(lonLat[0] - 30) < 1e-9)
  assert.ok(Math.abs(lonLat[1] - 40) < 1e-9)
})

/* --- Tek feature ve canlı güncelleme ----------------------------------------- */

test('exactly one vehicle feature exists and it is updated in place', () => {
  const source = new VectorSource()

  const first = syncTransportVehicleFeature(source, presentationFor())
  const second = syncTransportVehicleFeature(source, presentationFor({
    simulation: simulationState({ longitude: 31, latitude: 41, progressPercent: 60 }),
  }))

  assert.equal(source.getFeatures().length, 1)
  // Aynı çalıştırma: feature yeniden YARATILMAZ, yalnızca hareket eder.
  assert.equal(first, second)
  assert.deepEqual(second.getGeometry().getCoordinates(), fromLonLat([31, 41]))
  assert.equal(second.get('transportVehicle').progressPercent, 60)
})

test('a new simulationId replaces the feature instead of adding a second one', () => {
  const source = new VectorSource()
  const first = syncTransportVehicleFeature(source, presentationFor())

  const second = syncTransportVehicleFeature(source, presentationFor({
    simulation: simulationState({ simulationId: RUN_2, longitude: 32 }),
  }))

  assert.equal(source.getFeatures().length, 1)
  assert.notEqual(first, second)
  assert.equal(second.getId(), vehicleFeatureId(RUN_2))
  assert.equal(source.getFeatureById(vehicleFeatureId(RUN_1)), null)
})

test('switching the followed route leaves no stale vehicle behind', () => {
  const source = new VectorSource()
  syncTransportVehicleFeature(source, presentationFor())

  syncTransportVehicleFeature(source, transportVehiclePresentation({
    simulation: simulationState({ simulationId: RUN_2, routeId: ROUTE_B, longitude: 29 }),
    followingRouteId: ROUTE_B,
    routes,
  }))

  const features = source.getFeatures()
  assert.equal(features.length, 1)
  assert.equal(features[0].get('routeId'), ROUTE_B)
})

test('unfollowing clears the vehicle', () => {
  const source = new VectorSource()
  syncTransportVehicleFeature(source, presentationFor())

  // Takip bırakıldı → sunum yok → kaynak boş.
  const cleared = syncTransportVehicleFeature(source, null)

  assert.equal(cleared, null)
  assert.equal(source.getFeatures().length, 0)
})

/* --- Terminal durum ----------------------------------------------------------- */

test('a completed run keeps its final position but stops being live', () => {
  /* Tek ve deterministik kural: bitmiş çalıştırma SON konumunda kalır; ekrandan
     silinmesi takibin bırakılmasına, rota değişmesine ya da yeni bir
     çalıştırmaya bağlıdır. */
  const presentation = presentationFor({
    observedRouteId: ROUTE_A,
    simulation: simulationState({
      status: SIMULATION_STATUS.COMPLETED,
      progressPercent: 100,
      longitude: 32,
    }),
  })

  assert.equal(presentation.isTerminal, true)
  assert.equal(presentation.isLive, false)
  assert.equal(presentation.followCamera, false)
  assert.equal(presentation.progressPercent, 100)

  const source = new VectorSource()
  const feature = syncTransportVehicleFeature(source, presentation)
  assert.deepEqual(feature.getGeometry().getCoordinates(), fromLonLat([32, 40]))
  assert.equal(source.getFeatures().length, 1)
})

test('a cancelled run behaves the same way and is reported as cancelled', () => {
  const presentation = presentationFor({
    simulation: simulationState({ status: SIMULATION_STATUS.CANCELLED, progressPercent: 42 }),
  })

  assert.equal(presentation.isTerminal, true)
  assert.equal(presentation.followCamera, false)
  assert.equal(transportVehiclePopupModel(presentation).statusLabel, 'İptal edildi')
})

/* --- İsabet kimliği ve katman ------------------------------------------------- */

test('the vehicle feature carries its own kind and identity for hit detection', () => {
  const source = new VectorSource()
  const feature = syncTransportVehicleFeature(source, presentationFor())

  assert.equal(feature.get('featureKind'), TRANSPORT_VEHICLE_KIND)
  assert.equal(feature.get('simulationId'), RUN_1)
  assert.equal(feature.get('routeId'), ROUTE_A)
  assert.equal(feature.getId(), vehicleFeatureId(RUN_1))

  // Durak ve rota türlerinden AYRIDIR; mevcut isabet dalları etkilenmez.
  assert.notEqual(TRANSPORT_VEHICLE_KIND, TRANSPORT_STOP_KIND)
  assert.notEqual(TRANSPORT_VEHICLE_KIND, TRANSPORT_ROUTE_KIND)
  assert.notEqual(TRANSPORT_VEHICLE_KIND, TRANSPORT_ROUTE_PATH_KIND)
})

test('the vehicle layer is separate and sits above the stop and route layers', () => {
  const { layer, source } = createTransportVehicleLayer()

  assert.equal(layer.getClassName().includes(TRANSPORT_VEHICLE_LAYER_CLASSNAME), true)
  assert.equal(layer.getZIndex(), 60)
  assert.equal(layer.getSource(), source)

  // Kendi kaynağı olduğu için durak/rota yeniden yüklemeleri aracı silmez.
  syncTransportVehicleFeature(source, presentationFor())
  assert.equal(source.getFeatures().length, 1)
})

test('existing route and stop feature building is untouched', () => {
  const stops = [
    { id: 71, routeId: ROUTE_A, name: 'Batı', longitude: 29, latitude: 41, sequenceOrder: 1 },
    { id: 72, routeId: ROUTE_A, name: 'Doğu', longitude: 30, latitude: 41, sequenceOrder: 2 },
  ]
  const { routeFeatures, pathFeatures, stopFeatures } = transportFeatures(routes, stops, [])

  assert.equal(stopFeatures.length, 2)
  assert.equal(routeFeatures.length, 1)
  assert.equal(pathFeatures.length, 0)
  assert.equal(stopFeatures.every((feature) => feature.get('featureKind') === TRANSPORT_STOP_KIND), true)
  assert.equal(routeFeatures[0].get('featureKind'), TRANSPORT_ROUTE_KIND)
})

/* --- Popup modeli ------------------------------------------------------------- */

test('the popup exposes the server progress and nothing internal', () => {
  const model = transportVehiclePopupModel(presentationFor({
    simulation: simulationState({ progressPercent: 63.4 }),
  }))

  assert.equal(model.routeName, 'Merkez Hattı')
  assert.equal(model.statusLabel, 'Çalışıyor')
  // Yüzde SUNUCUDAN gelir; tarayıcı yeniden hesaplamaz.
  assert.equal(model.progressPercent, 63.4)
  assert.equal(model.progressLabel, '%63')
  assert.equal(model.liveLabel, 'Canlı takip ediliyor')

  // Ham geometri / altyapı ayrıntısı / OSRM adresi taşınmaz.
  assert.deepEqual(Object.keys(model).sort(), [
    'colorHex', 'isLive', 'latitude', 'liveLabel', 'longitude', 'progressLabel',
    'progressPercent', 'routeId', 'routeName', 'simulationId', 'status', 'statusLabel',
  ])
  assert.equal('geometryWkt' in model, false)
  assert.equal('startedByUserId' in model, false)
})

test('the popup model follows newer live state while it stays open', () => {
  const first = transportVehiclePopupModel(presentationFor({
    simulation: simulationState({ progressPercent: 10, longitude: 30 }),
  }))
  const later = transportVehiclePopupModel(presentationFor({
    simulation: simulationState({ progressPercent: 90, longitude: 31.5 }),
  }))

  assert.equal(first.progressLabel, '%10')
  assert.equal(later.progressLabel, '%90')
  assert.equal(later.longitude, 31.5)
  // Aynı çalıştırma: balon kapanmaz, içeriği tazelenir.
  assert.equal(first.simulationId, later.simulationId)
})

test('a route without a name falls back to a neutral label, not an empty popup', () => {
  const model = transportVehiclePopupModel(transportVehiclePresentation({
    simulation: simulationState(),
    followingRouteId: ROUTE_A,
    routes: [],
  }))

  assert.equal(model.routeName, `Güzergah #${ROUTE_A}`)
})

test('there is no popup model without a vehicle', () => {
  assert.equal(transportVehiclePopupModel(null), null)
})

/* --- Kamera ------------------------------------------------------------------- */

const view = { center: [0, 0], resolution: 10, size: [800, 600] }

test('the camera stays put while the vehicle is inside the safe box', () => {
  /* Her tick'te merkeze almak animasyon kuyruğu ve titreme üretirdi. */
  const target = vehicleCameraTarget({ coordinate: [500, 400], ...view })

  assert.equal(target, null)
})

test('the camera recenters when the vehicle leaves the safe box', () => {
  const target = vehicleCameraTarget({ coordinate: [3000, 0], ...view })

  assert.deepEqual(target, [3000, 0])
})

test('the camera never returns a zoom, so the user zoom is never reset', () => {
  const target = vehicleCameraTarget({ coordinate: [0, 2000], ...view })

  assert.ok(Array.isArray(target))
  assert.equal(target.length, 2)
  assert.equal(typeof target.zoom, 'undefined')
})

test('an unknown viewport falls back to centring instead of guessing', () => {
  assert.deepEqual(
    vehicleCameraTarget({ coordinate: [10, 10], center: [0, 0], resolution: null, size: null }),
    [10, 10],
  )
})

test('camera follow is refused when there is nothing to follow', () => {
  assert.equal(vehicleCameraTarget({ coordinate: null, ...view }), null)
  assert.equal(vehicleCameraTarget({ coordinate: [1, 1], center: null, resolution: 10, size: [800, 600] }), null)
})

test('unfollowing removes the camera claim with the presentation', () => {
  // Takip bırakıldığında sunum null olur; kanca da kamerayı serbest bırakır.
  assert.equal(transportVehiclePresentation({
    simulation: simulationState(),
    followingRouteId: null,
    selectedRouteId: ROUTE_A,
    routes,
  }), null)
})
