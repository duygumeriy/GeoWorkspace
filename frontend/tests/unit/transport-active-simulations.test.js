import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import VectorSource from 'ol/source/Vector.js'
import { fromLonLat } from 'ol/proj.js'
import {
  SIMULATION_STATUS,
  isTerminalSimulationStatus,
  mergeSimulationState,
  normalizeLiveUpdate,
  transportSimulationControls,
} from '../../src/map/transportSimulationState.js'
import {
  activeRouteIdsOf,
  activeSimulationsPresentation,
  applyActiveSimulationList,
  clearWatchedRuns,
  ensureWatchedRun,
  filterActiveRows,
  normalizeActiveSimulationList,
  reconcileWatchedRuns,
  toggleWatchedRun,
  watchAllActiveRuns,
  watchedRouteIdsOf,
} from '../../src/map/activeSimulations.js'
import {
  VEHICLE_EMPHASIS,
  VEHICLE_OWNERSHIP,
  mergeVehiclePresentations,
  syncTransportVehicleFeatures,
  transportStarterTerminalPresentation,
  transportVehiclePopupModel,
  transportWatchedVehiclePresentations,
  vehicleFeatureId,
} from '../../src/map/transportVehicle.js'
import {
  ACTIVE_SET_CHANGED_EVENT,
  JOIN_DISCOVERY_METHOD,
  JOIN_ROUTE_METHOD,
  LEAVE_DISCOVERY_METHOD,
  LEAVE_ROUTE_METHOD,
  SIMULATION_UPDATED_EVENT,
  createTransportSimulationClient,
} from '../../src/services/transportSimulationClient.js'

/**
 * AKTİF paylaşılan simülasyonların KEŞFİ ve ÇOKLU İZLEME (Faz 4A).
 *
 * Sınanan asıl ayrım DÖRT kavramın bağımsızlığıdır: AKTİF (sunucu gerçeği),
 * İZLENEN (haritada araç), SEÇİLİ (ayrıntı bağlamı) ve TAKİP EDİLEN (kamera).
 * Bunlardan birinin diğerini sessizce sürüklemesi, kullanıcının hiç vermediği
 * bir kararın uygulanması demektir.
 */

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

/** Yorumlar ayıklanır: bir kavramı ANLATMAK onu uygulamak değildir. */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

const HOOK = stripComments(read('../../src/hooks/useTransportSimulation.js'))
const VEHICLE_HOOK = stripComments(read('../../src/hooks/useTransportVehicleLayer.js'))
const CLIENT = stripComments(read('../../src/services/transportSimulationClient.js'))
const MAP_PAGE = stripComments(read('../../src/pages/MapPage.jsx'))
const LIST = read('../../src/components/map/ActiveSimulationsList.jsx')
const SHARED = read('../../src/components/map/SharedTransportJourneyContent.jsx')
const API = read('../../src/services/transportApi.js')

const ROUTE_A = 3
const ROUTE_B = 7
const ROUTE_C = 11
const ROUTE_D = 15

const RUN_A = 'aaaaaaa1-0000-0000-0000-000000000001'
const RUN_B = 'bbbbbbb1-0000-0000-0000-000000000001'
const RUN_C = 'ccccccc1-0000-0000-0000-000000000001'
const RUN_D = 'ddddddd1-0000-0000-0000-000000000001'
const RUN_A2 = 'aaaaaaa2-0000-0000-0000-000000000002'

const routes = [
  { id: ROUTE_A, name: 'Alibeyköy Hattı', colorHex: '#E11D48' },
  { id: ROUTE_B, name: 'Bakırköy Hattı', colorHex: '#0284C7' },
  { id: ROUTE_C, name: 'Cihangir Hattı', colorHex: '#16A34A' },
  { id: ROUTE_D, name: 'Doğu Hattı', colorHex: '#F59E0B' },
]

/** `GET /api/transport/simulations/active` satırı (REST biçimi: oran + capturedAt). */
const activeRow = ({
  routeId,
  simulationId,
  status = SIMULATION_STATUS.RUNNING,
  progressRatio = 0.2,
  capturedAt = '2026-09-02T10:00:00Z',
  longitude = 30,
  latitude = 40,
}) => ({
  routeId, simulationId, status, progressRatio, capturedAt, longitude, latitude,
})

/** SignalR `SimulationUpdated` yükü (yüzde + updatedAtUtc). */
const live = ({
  routeId,
  simulationId,
  status = SIMULATION_STATUS.RUNNING,
  progressPercent = 20,
  updatedAtUtc = '2026-09-02T10:00:00Z',
  longitude = 30,
  latitude = 40,
}) => normalizeLiveUpdate({
  routeId, simulationId, status, progressPercent, updatedAtUtc, longitude, latitude,
})

const seedAbc = () => applyActiveSimulationList({
  byRoute: {},
  list: [
    activeRow({ routeId: ROUTE_A, simulationId: RUN_A, progressRatio: 0.1 }),
    activeRow({ routeId: ROUTE_B, simulationId: RUN_B, status: SIMULATION_STATUS.PAUSED, progressRatio: 0.5 }),
    activeRow({ routeId: ROUTE_C, simulationId: RUN_C, progressRatio: 0.9 }),
  ],
})

/* --- 1/2/3. İlk okuma: bağımsız hatlar, aktifin tanımı ----------------------- */

test('the initial active response seeds every route independently', () => {
  const { byRoute, activeRouteIds } = seedAbc()

  assert.deepEqual(activeRouteIds, [ROUTE_A, ROUTE_B, ROUTE_C])
  assert.equal(byRoute[ROUTE_A].simulationId, RUN_A)
  assert.equal(byRoute[ROUTE_B].simulationId, RUN_B)
  assert.equal(byRoute[ROUTE_C].simulationId, RUN_C)

  // İlerleme REST'te ORAN, arayüzde YÜZDEDİR; tek biçime indirgenir.
  assert.equal(byRoute[ROUTE_A].progressPercent, 10)
  assert.equal(byRoute[ROUTE_C].progressPercent, 90)
})

test('running and paused both count as active while terminal runs never do', () => {
  const { activeRouteIds } = applyActiveSimulationList({
    byRoute: {},
    list: [
      activeRow({ routeId: ROUTE_A, simulationId: RUN_A }),
      activeRow({ routeId: ROUTE_B, simulationId: RUN_B, status: SIMULATION_STATUS.PAUSED }),
      // Sunucu terminal satır göndermemelidir; istemci ona GÜVENMEK zorunda değildir.
      activeRow({ routeId: ROUTE_C, simulationId: RUN_C, status: SIMULATION_STATUS.COMPLETED }),
      activeRow({ routeId: ROUTE_D, simulationId: RUN_D, status: SIMULATION_STATUS.CANCELLED }),
    ],
  })

  // Çalışıyor VE Duraklatıldı bir arada aktiftir; terminaller hiç girmez.
  assert.deepEqual(activeRouteIds, [ROUTE_A, ROUTE_B])
  assert.equal(normalizeActiveSimulationList(null).length, 0)
})

test('activity is decided by the canonical terminal predicate, one status at a time', () => {
  /* Aktiflik testi TEK bir kanonik yüklemdir: `!isTerminalSimulationStatus`.
     "Running || Paused" biçiminde bir beyaz liste, araya yeni bir canlı durum
     eklendiğinde onu sessizce ölü sayardı. Terminal küme YALNIZCA ikisidir. */
  for (const [status, expected] of [
    [SIMULATION_STATUS.RUNNING, [ROUTE_A]],
    [SIMULATION_STATUS.PAUSED, [ROUTE_A]],
    [SIMULATION_STATUS.COMPLETED, []],
    [SIMULATION_STATUS.CANCELLED, []],
  ]) {
    const { activeRouteIds } = applyActiveSimulationList({
      byRoute: {},
      list: [activeRow({ routeId: ROUTE_A, simulationId: RUN_A, status })],
    })
    assert.deepEqual(activeRouteIds, expected, `${status} yanlış sınıflandırıldı`)
  }

  // Ve Faz 3B sözleşmesi: DURAKLATILDI terminal kümenin DIŞINDADIR.
  assert.equal(isTerminalSimulationStatus(SIMULATION_STATUS.PAUSED), false)
  assert.equal(isTerminalSimulationStatus(SIMULATION_STATUS.RUNNING), false)
  assert.equal(isTerminalSimulationStatus(SIMULATION_STATUS.COMPLETED), true)
  assert.equal(isTerminalSimulationStatus(SIMULATION_STATUS.CANCELLED), true)
})

test('a row without a run identity is rejected, whatever its status says', () => {
  /* KİMLİK ZORUNLUDUR. Bu fazda her komut, her feature anahtarı, her izleme
     kaydı ve her balon `routeId + simulationId` çiftine dayanır; çalıştırma
     kimliği taşımayan bir satırı "aktif" saymak, adreslenemeyen bir
     çalıştırma üretirdi. Reddetme bir kayıp değil, bir değişmezdir.

     Bu iddia bilinçlidir: kimliği unutulmuş bir test fikstürü, aktiflik
     kuralının kendisinde bir arıza varmış gibi görünen bir başarısızlık
     üretiyordu. Kural artık AÇIKÇA yazılı. */
  assert.deepEqual(
    normalizeActiveSimulationList([
      { routeId: ROUTE_A, status: SIMULATION_STATUS.RUNNING, progressRatio: 0.2 },
      { routeId: ROUTE_B, simulationId: '', status: SIMULATION_STATUS.PAUSED, progressRatio: 0.2 },
      // Rota kimliği okunamayan satır da düşer.
      activeRow({ routeId: null, simulationId: RUN_C }),
    ]),
    [],
  )

  // Kimlik verildiği anda aynı satır kabul edilir.
  const accepted = normalizeActiveSimulationList([
    activeRow({ routeId: ROUTE_A, simulationId: RUN_A }),
  ])
  assert.equal(accepted.length, 1)
  assert.equal(accepted[0].simulationId, RUN_A)
})

test('a run that ends is dropped from the active set by the live channel alone', () => {
  const { byRoute } = seedAbc()

  const afterTerminal = {
    ...byRoute,
    [ROUTE_B]: mergeSimulationState(
      byRoute[ROUTE_B],
      live({
        routeId: ROUTE_B,
        simulationId: RUN_B,
        status: SIMULATION_STATUS.CANCELLED,
        progressPercent: 50,
        updatedAtUtc: '2026-09-02T10:00:05Z',
      }),
    ),
  }

  assert.deepEqual(activeRouteIdsOf(afterTerminal), [ROUTE_A, ROUTE_C])
})

/* --- 4. TEK birleştirme kuralı yeniden kullanılır ---------------------------- */

test('the active list reuses the canonical per-route merge rule', () => {
  const { byRoute } = seedAbc()

  // Canlı kanaldan DAHA YENİ bir duraklatma geldi.
  const paused = {
    ...byRoute,
    [ROUTE_A]: mergeSimulationState(byRoute[ROUTE_A], live({
      routeId: ROUTE_A,
      simulationId: RUN_A,
      status: SIMULATION_STATUS.PAUSED,
      progressPercent: 10,
      updatedAtUtc: '2026-09-02T10:00:30Z',
    })),
  }
  assert.equal(paused[ROUTE_A].status, SIMULATION_STATUS.PAUSED)

  /* Yolda kalmış bir aktif liste okuması onu geri SARAMAZ: aktif liste için
     ikinci bir birleştirme yazılsaydı bu garanti kaybolurdu. */
  const stale = applyActiveSimulationList({
    byRoute: paused,
    list: [
      activeRow({ routeId: ROUTE_A, simulationId: RUN_A, progressRatio: 0.1, capturedAt: '2026-09-02T10:00:00Z' }),
      activeRow({ routeId: ROUTE_B, simulationId: RUN_B, status: SIMULATION_STATUS.PAUSED }),
      activeRow({ routeId: ROUTE_C, simulationId: RUN_C }),
    ],
  })

  assert.equal(stale.byRoute[ROUTE_A].status, SIMULATION_STATUS.PAUSED)
})

/* --- 5/6. SEÇİM yalnızca sunumdur ------------------------------------------- */

test('the selected route derives from byRoute and selecting never deletes the others', () => {
  const { byRoute } = seedAbc()

  const forA = transportSimulationControls({ routeId: ROUTE_A, simulation: byRoute[ROUTE_A], canStop: true })
  const forB = transportSimulationControls({ routeId: ROUTE_B, simulation: byRoute[ROUTE_B], canStop: true })

  // Denetimler SEÇİLİ hattın KENDİ durumundan türer.
  assert.equal(forA.showPause, true)
  assert.equal(forA.showResume, false)
  assert.equal(forB.showResume, true)
  assert.equal(forB.showPause, false)

  // Seçim değişse de diğer hatların durumu YERİNDE durur.
  assert.deepEqual(activeRouteIdsOf(byRoute), [ROUTE_A, ROUTE_B, ROUTE_C])
})

/* --- 7. ARAMA yalnızca sunum süzgecidir ------------------------------------- */

test('search filters only what is drawn and touches nothing else', () => {
  const { byRoute } = seedAbc()
  const watchedRuns = watchAllActiveRuns(byRoute)

  const presentation = activeSimulationsPresentation({
    byRoute, routes, watchedRuns, search: 'bakır', loaded: true,
  })

  assert.equal(presentation.visibleCount, 1)
  assert.equal(presentation.rows[0].routeId, ROUTE_B)

  // Aktif küme ve izleme seçimi DEĞİŞMEZ.
  assert.equal(presentation.totalCount, 3)
  assert.deepEqual(watchedRouteIdsOf(watchedRuns), [ROUTE_A, ROUTE_B, ROUTE_C])
  assert.deepEqual(activeRouteIdsOf(byRoute), [ROUTE_A, ROUTE_B, ROUTE_C])

  // Boş arama her şeyi geri verir; süzgeç saf ve yan etkisizdir.
  assert.equal(filterActiveRows(presentation.rows, '').length, presentation.rows.length)
})

test('rows are ordered by route name then id, never by progress', () => {
  const { byRoute } = seedAbc()

  const presentation = activeSimulationsPresentation({ byRoute, routes, loaded: true })

  assert.deepEqual(
    presentation.rows.map((row) => row.routeName),
    ['Alibeyköy Hattı', 'Bakırköy Hattı', 'Cihangir Hattı'],
  )
  // C %90 ilerlemiş olmasına rağmen sona kalır: sıra ilerlemeye bakmaz.
  assert.equal(presentation.rows[2].progressLabel, '%90')

  /* DURAKLATILMIŞ hat listede KALIR ve kendi adıyla anılır. Duraklatmayı
     terminal sayan bir aktiflik kuralı onu satırlardan da düşürürdü. */
  const paused = presentation.rows.find((row) => row.routeId === ROUTE_B)
  assert.equal(paused.statusLabel, 'Duraklatıldı')
  assert.equal(paused.isPaused, true)
  assert.equal(paused.progressLabel, '%50')
})

/* --- 8/9/10/11/12. İZLEME seçimi -------------------------------------------- */

test('watching one route never watches another and supports many at once', () => {
  const { byRoute } = seedAbc()

  const onlyA = toggleWatchedRun({}, { routeId: ROUTE_A, simulationId: RUN_A })
  assert.deepEqual(watchedRouteIdsOf(onlyA), [ROUTE_A])

  const aAndC = toggleWatchedRun(onlyA, { routeId: ROUTE_C, simulationId: RUN_C })
  assert.deepEqual(watchedRouteIdsOf(aAndC), [ROUTE_A, ROUTE_C])

  // Kapatmak yalnızca o hattı kapatır.
  assert.deepEqual(watchedRouteIdsOf(toggleWatchedRun(aAndC, { routeId: ROUTE_A })), [ROUTE_C])

  // İzleme aktif kümeye DOKUNMAZ.
  assert.deepEqual(activeRouteIdsOf(byRoute), [ROUTE_A, ROUTE_B, ROUTE_C])
})

test('watch all covers the current set only and a later run is not auto-watched', () => {
  const { byRoute } = seedAbc()

  const watched = watchAllActiveRuns(byRoute)
  assert.deepEqual(watchedRouteIdsOf(watched), [ROUTE_A, ROUTE_B, ROUTE_C])

  // D SONRADAN başlar: listede belirir ama İZLENMEZ.
  const withD = applyActiveSimulationList({
    byRoute,
    list: [
      activeRow({ routeId: ROUTE_A, simulationId: RUN_A, progressRatio: 0.1 }),
      activeRow({ routeId: ROUTE_B, simulationId: RUN_B, status: SIMULATION_STATUS.PAUSED, progressRatio: 0.5 }),
      activeRow({ routeId: ROUTE_C, simulationId: RUN_C, progressRatio: 0.9 }),
      activeRow({ routeId: ROUTE_D, simulationId: RUN_D }),
    ],
  })

  assert.deepEqual(withD.activeRouteIds, [ROUTE_A, ROUTE_B, ROUTE_C, ROUTE_D])
  assert.deepEqual(
    watchedRouteIdsOf(reconcileWatchedRuns(watched, withD.byRoute)),
    [ROUTE_A, ROUTE_B, ROUTE_C],
  )
})

test('clearing the watch removes markers only', () => {
  const { byRoute } = seedAbc()
  const watched = watchAllActiveRuns(byRoute)

  const cleared = clearWatchedRuns()

  assert.deepEqual(watchedRouteIdsOf(cleared), [])
  // Simülasyonlar, aktif liste ve seçim ETKİLENMEZ.
  assert.deepEqual(activeRouteIdsOf(byRoute), [ROUTE_A, ROUTE_B, ROUTE_C])
  assert.equal(byRoute[ROUTE_A].status, SIMULATION_STATUS.RUNNING)
  assert.deepEqual(watchedRouteIdsOf(watched), [ROUTE_A, ROUTE_B, ROUTE_C])
})

/* --- 13/14/15/16/17. ÇOKLU İŞARETÇİ ----------------------------------------- */

const watchedPresentations = (byRoute, watchedRuns, overrides = {}) =>
  transportWatchedVehiclePresentations({
    byRoute,
    watchedRuns,
    routes,
    subscribedRouteIds: activeRouteIdsOf(byRoute),
    ...overrides,
  })

test('three watched routes produce three distinct vehicle features', () => {
  const { byRoute } = seedAbc()
  const source = new VectorSource()

  const presentations = watchedPresentations(byRoute, watchAllActiveRuns(byRoute))
  assert.equal(presentations.length, 3)

  syncTransportVehicleFeatures(source, presentations)

  assert.equal(source.getFeatures().length, 3)
  for (const [routeId, simulationId] of [[ROUTE_A, RUN_A], [ROUTE_B, RUN_B], [ROUTE_C, RUN_C]]) {
    const feature = source.getFeatureById(vehicleFeatureId(routeId, simulationId))
    assert.ok(feature, `feature yok: ${routeId}`)
    assert.equal(feature.get('routeId'), routeId)
    assert.equal(feature.get('simulationId'), simulationId)
  }
})

test('feature identity carries both the route and the run', () => {
  assert.equal(vehicleFeatureId(ROUTE_A, RUN_A), `transport-vehicle-${ROUTE_A}-${RUN_A}`)
  assert.notEqual(vehicleFeatureId(ROUTE_A, RUN_A), vehicleFeatureId(ROUTE_A, RUN_A2))
  assert.notEqual(vehicleFeatureId(ROUTE_A, RUN_A), vehicleFeatureId(ROUTE_B, RUN_A))
})

test('selection changes emphasis, never visibility', () => {
  const { byRoute } = seedAbc()
  const watchedRuns = watchAllActiveRuns(byRoute)
  const source = new VectorSource()

  const withA = watchedPresentations(byRoute, watchedRuns, { selectedRouteId: ROUTE_A })
  syncTransportVehicleFeatures(source, withA)

  assert.equal(source.getFeatures().length, 3)
  assert.equal(withA.find((item) => item.routeId === ROUTE_A).emphasis, VEHICLE_EMPHASIS.FULL)
  assert.equal(withA.find((item) => item.routeId === ROUTE_B).emphasis, VEHICLE_EMPHASIS.MUTED)
  assert.equal(withA.find((item) => item.routeId === ROUTE_C).emphasis, VEHICLE_EMPHASIS.MUTED)

  const withB = watchedPresentations(byRoute, watchedRuns, { selectedRouteId: ROUTE_B })
  syncTransportVehicleFeatures(source, withB)

  // Hiçbiri KAYBOLMADI; yalnızca vurgu yer değiştirdi.
  assert.equal(source.getFeatures().length, 3)
  assert.equal(withB.find((item) => item.routeId === ROUTE_B).emphasis, VEHICLE_EMPHASIS.FULL)
  assert.equal(withB.find((item) => item.routeId === ROUTE_A).emphasis, VEHICLE_EMPHASIS.MUTED)
})

test('a running watched marker moves while a paused one stays frozen', () => {
  const { byRoute } = seedAbc()
  const watchedRuns = watchAllActiveRuns(byRoute)
  const source = new VectorSource()

  syncTransportVehicleFeatures(source, watchedPresentations(byRoute, watchedRuns))

  const movedA = {
    ...byRoute,
    [ROUTE_A]: mergeSimulationState(byRoute[ROUTE_A], live({
      routeId: ROUTE_A,
      simulationId: RUN_A,
      progressPercent: 35,
      longitude: 31,
      latitude: 41,
      updatedAtUtc: '2026-09-02T10:00:20Z',
    })),
  }

  const features = syncTransportVehicleFeatures(source, watchedPresentations(movedA, watchedRuns))
  const a = source.getFeatureById(vehicleFeatureId(ROUTE_A, RUN_A))
  const b = source.getFeatureById(vehicleFeatureId(ROUTE_B, RUN_B))

  assert.equal(features.length, 3)
  // AYNI çalıştırma: feature yeniden yaratılmaz, taşınır.
  assert.deepEqual(a.getGeometry().getCoordinates(), fromLonLat([31, 41]))
  assert.equal(a.get('transportVehicle').progressPercent, 35)

  // DURAKLATILMIŞ araç görünür ve donmuş koordinatındadır.
  assert.deepEqual(b.getGeometry().getCoordinates(), fromLonLat([30, 40]))
  assert.equal(b.get('transportVehicle').statusLabel, 'Duraklatıldı')
})

test('an active but unwatched route draws no marker', () => {
  const { byRoute } = seedAbc()
  const source = new VectorSource()

  const onlyA = toggleWatchedRun({}, { routeId: ROUTE_A, simulationId: RUN_A })
  syncTransportVehicleFeatures(source, watchedPresentations(byRoute, onlyA))

  assert.equal(source.getFeatures().length, 1)
  assert.equal(source.getFeatureById(vehicleFeatureId(ROUTE_B, RUN_B)), null)
  assert.equal(source.getFeatureById(vehicleFeatureId(ROUTE_C, RUN_C)), null)

  // Ama B ve C AKTİF olmaya devam eder: işaretçi yokluğu "bitti" demek değildir.
  assert.deepEqual(activeRouteIdsOf(byRoute), [ROUTE_A, ROUTE_B, ROUTE_C])
})

test('a terminal watched run loses its marker and its watch selection', () => {
  const { byRoute } = seedAbc()
  const watchedRuns = watchAllActiveRuns(byRoute)
  const source = new VectorSource()
  syncTransportVehicleFeatures(source, watchedPresentations(byRoute, watchedRuns))
  assert.equal(source.getFeatures().length, 3)

  const afterReset = {
    ...byRoute,
    [ROUTE_A]: mergeSimulationState(byRoute[ROUTE_A], live({
      routeId: ROUTE_A,
      simulationId: RUN_A,
      status: SIMULATION_STATUS.CANCELLED,
      progressPercent: 10,
      updatedAtUtc: '2026-09-02T10:00:10Z',
    })),
  }

  const reconciled = reconcileWatchedRuns(watchedRuns, afterReset)
  assert.deepEqual(watchedRouteIdsOf(reconciled), [ROUTE_B, ROUTE_C])

  syncTransportVehicleFeatures(source, watchedPresentations(afterReset, reconciled))
  assert.equal(source.getFeatures().length, 2)
  assert.equal(source.getFeatureById(vehicleFeatureId(ROUTE_A, RUN_A)), null)
})

test('a replacement run on the same route is never watched by inheritance', () => {
  const { byRoute } = seedAbc()
  const watchedRuns = watchAllActiveRuns(byRoute)

  /* A biter ve AYNI hatta B çalıştırması başlar. İzleme kaydı yalnızca rota
     anahtarlı olsaydı, kullanıcının hiç vermediği bir kararla izlenirdi. */
  const replaced = {
    ...byRoute,
    [ROUTE_A]: mergeSimulationState(byRoute[ROUTE_A], live({
      routeId: ROUTE_A,
      simulationId: RUN_A2,
      progressPercent: 0,
      updatedAtUtc: '2026-09-02T10:05:00Z',
    })),
  }

  assert.equal(replaced[ROUTE_A].simulationId, RUN_A2)
  assert.deepEqual(watchedRouteIdsOf(reconcileWatchedRuns(watchedRuns, replaced)), [ROUTE_B, ROUTE_C])

  const source = new VectorSource()
  syncTransportVehicleFeatures(
    source,
    watchedPresentations(replaced, reconcileWatchedRuns(watchedRuns, replaced)),
  )
  assert.equal(source.getFeatureById(vehicleFeatureId(ROUTE_A, RUN_A)), null)
  assert.equal(source.getFeatureById(vehicleFeatureId(ROUTE_A, RUN_A2)), null)
})

/* --- 18/19/20. TAKİP yalnızca kameradır ------------------------------------- */

test('following one watched vehicle hides none of the others', () => {
  const { byRoute } = seedAbc()
  const watchedRuns = watchAllActiveRuns(byRoute)

  const followed = watchedPresentations(byRoute, watchedRuns, {
    followingRouteId: ROUTE_B,
    selectedRouteId: ROUTE_C,
  })

  assert.equal(followed.length, 3)
  assert.equal(followed.filter((item) => item.followCamera).length, 1)
  assert.equal(followed.find((item) => item.routeId === ROUTE_B).followCamera, true)

  // Kamera B'de, vurgu C'de: iki kavram AYRIDIR.
  assert.equal(followed.find((item) => item.routeId === ROUTE_C).emphasis, VEHICLE_EMPHASIS.FULL)
  assert.equal(followed.find((item) => item.routeId === ROUTE_B).emphasis, VEHICLE_EMPHASIS.MUTED)

  // Ve hepsi CANLI kalır.
  assert.ok(followed.every((item) => item.isLive))
})

test('unfollowing removes no marker and freezes no data', () => {
  const { byRoute } = seedAbc()
  const watchedRuns = watchAllActiveRuns(byRoute)
  const source = new VectorSource()

  syncTransportVehicleFeatures(
    source,
    watchedPresentations(byRoute, watchedRuns, { followingRouteId: ROUTE_B }),
  )
  assert.equal(source.getFeatures().length, 3)

  const released = watchedPresentations(byRoute, watchedRuns, { followingRouteId: null })
  syncTransportVehicleFeatures(source, released)

  assert.equal(source.getFeatures().length, 3)
  assert.equal(released.filter((item) => item.followCamera).length, 0)
  // Abonelik sahibi AKTİF KÜMEDİR: takip bırakılınca canlılık düşmez.
  assert.ok(released.every((item) => item.isLive))
})

/* --- 21/22. TIKLAMA ve BALON KİMLİĞİ ---------------------------------------- */

test('the popup is built from the clicked run, not from one global vehicle', () => {
  const { byRoute } = seedAbc()
  const presentations = watchedPresentations(byRoute, watchAllActiveRuns(byRoute), {
    selectedRouteId: ROUTE_A,
  })

  const clicked = presentations.find((item) => item.routeId === ROUTE_C)
  const popup = transportVehiclePopupModel(clicked)

  assert.equal(popup.simulationId, RUN_C)
  assert.equal(popup.routeId, ROUTE_C)
  assert.equal(popup.routeName, 'Cihangir Hattı')
  assert.equal(popup.progressLabel, '%90')

  // Seçili olan A'nın modeliyle KARIŞMAZ.
  assert.notEqual(popup.simulationId, RUN_A)
})

test('clicking a vehicle selects its identity and never takes the camera', () => {
  // Tıklama TIKLANAN feature'ın kendi sunumunu verir.
  assert.match(VEHICLE_HOOK, /onVehicleClick\(feature\.get\('transportVehicle'\) \?\? null, feature\)/)

  const openPopup = MAP_PAGE.slice(
    MAP_PAGE.indexOf('const openVehiclePopup'),
    MAP_PAGE.indexOf('useTransportVehicleLayer(mapInstance, {'),
  )
  assert.match(openPopup, /routeId: vehicle\.routeId/)
  assert.match(openPopup, /simulationId: vehicle\.simulationId/)

  // Tıklama takip ELE GEÇİRMEZ ve hiçbir simülasyonu değiştirmez.
  assert.ok(!openPopup.includes('follow'))
  assert.ok(!openPopup.includes('simulation.pause'))
  assert.ok(!openPopup.includes('simulation.stop'))
})

/* --- 23/24/25/26. ABONELİK SAHİPLİĞİ ---------------------------------------- */

/** Gerçek HubConnection'ın yalnızca kullanılan yüzeyini taklit eder. */
function fakeConnection() {
  const connection = {
    started: 0,
    stopped: 0,
    handlers: new Map(),
    calls: [],
    reconnected: null,
    on(event, handler) {
      const list = connection.handlers.get(event) ?? []
      list.push(handler)
      connection.handlers.set(event, list)
    },
    off(event, handler) {
      const list = (connection.handlers.get(event) ?? []).filter((item) => item !== handler)
      connection.handlers.set(event, list)
    },
    onreconnected(callback) {
      connection.reconnected = callback
    },
    async start() {
      connection.started += 1
    },
    async stop() {
      connection.stopped += 1
    },
    async invoke(method, ...args) {
      connection.calls.push([method, ...args])
      if (method === JOIN_ROUTE_METHOD) {
        return { simulationId: `run-${args[0]}`, routeId: args[0], status: 'Running', progressPercent: 0 }
      }
      return null
    },
    push(event, payload) {
      for (const handler of connection.handlers.get(event) ?? []) handler(payload)
    },
  }
  return connection
}

const joinedRoutes = (connection) =>
  connection.calls.filter(([method]) => method === JOIN_ROUTE_METHOD).map(([, routeId]) => routeId)

const leftRoutes = (connection) =>
  connection.calls.filter(([method]) => method === LEAVE_ROUTE_METHOD).map(([, routeId]) => routeId)

test('the active set owns every active route group; watching owns none', async () => {
  const connection = fakeConnection()
  const client = createTransportSimulationClient({ createConnection: () => connection })

  await client.setActiveLiveRoutes([ROUTE_A, ROUTE_B, ROUTE_C])

  assert.deepEqual(joinedRoutes(connection), [ROUTE_A, ROUTE_B, ROUTE_C])
  assert.deepEqual(client.activeLiveRouteIds, [ROUTE_A, ROUTE_B, ROUTE_C])

  /* İZLEME abonelik sahibi DEĞİLDİR: istemcinin yüzeyinde bir izleme kavramı
     bile yoktur. İzleme sahip olsaydı, izlenmeyen aktif satırlar donardı. */
  assert.equal(typeof client.watch, 'undefined')
  assert.ok(!CLIENT.includes('watchedRuns'))
})

test('follow, observe and the active set dedupe into a single group membership', async () => {
  const connection = fakeConnection()
  const client = createTransportSimulationClient({ createConnection: () => connection })

  await client.setActiveLiveRoutes([ROUTE_A, ROUTE_B])
  await client.observe(ROUTE_A)
  await client.follow(ROUTE_A)

  // A üç sahibin de istediği rota: gruba yalnızca BİR kez katılınmıştır.
  assert.deepEqual(joinedRoutes(connection).filter((routeId) => routeId === ROUTE_A), [ROUTE_A])
  assert.deepEqual(client.subscribedRouteIds.sort((left, right) => left - right), [ROUTE_A, ROUTE_B])
})

test('a route group is left only when no owner wants it any more', async () => {
  const connection = fakeConnection()
  const client = createTransportSimulationClient({ createConnection: () => connection })

  await client.setActiveLiveRoutes([ROUTE_A, ROUTE_B])
  await client.observe(ROUTE_A)

  /* A terminal oldu ve aktif kümeden düştü — ama kullanıcı hâlâ o hattı
     seçili tutuyor. Gruptan çıkmak, aynı hatta başlayacak B çalıştırmasının
     ilk otoriter yayınının sayfaya HİÇ ulaşmaması demekti. */
  await client.setActiveLiveRoutes([ROUTE_B])
  assert.deepEqual(leftRoutes(connection), [])
  assert.deepEqual(client.subscribedRouteIds.sort((left, right) => left - right), [ROUTE_A, ROUTE_B])

  // Gözlem de bırakılınca A gerçekten terk edilir.
  await client.stopObserving()
  assert.deepEqual(leftRoutes(connection), [ROUTE_A])
})

test('re-applying the same active set produces no extra joins', async () => {
  const connection = fakeConnection()
  const client = createTransportSimulationClient({ createConnection: () => connection })

  await client.setActiveLiveRoutes([ROUTE_A, ROUTE_B])
  await client.setActiveLiveRoutes([ROUTE_B, ROUTE_A])

  assert.deepEqual(joinedRoutes(connection), [ROUTE_A, ROUTE_B])
  assert.equal(connection.started, 1)
})

/* --- 27/28. KEŞİF: sinyal → TEK okuma, yoklama yok --------------------------- */

test('the discovery signal reaches the client without any route subscription', async () => {
  const connection = fakeConnection()
  const seen = []
  const client = createTransportSimulationClient({
    createConnection: () => connection,
    onActiveSetChanged: (payload) => seen.push(payload),
  })

  await client.joinDiscovery()
  assert.equal(client.isDiscovering, true)
  assert.ok(connection.calls.some(([method]) => method === JOIN_DISCOVERY_METHOD))

  /* Sinyal ROTA SÜZGECİNDEN geçmez ve geçmemelidir: varlık nedeni, istemcinin
     HENÜZ abone olmadığı bir hattı öğrenmesidir. */
  connection.push(ACTIVE_SET_CHANGED_EVENT, { routeId: ROUTE_D, simulationId: RUN_D, change: 'Started' })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].routeId, ROUTE_D)

  await client.leaveDiscovery()
  assert.equal(client.isDiscovering, false)
  assert.ok(connection.calls.some(([method]) => method === LEAVE_DISCOVERY_METHOD))
})

test('a route update for an unsubscribed route is still filtered out', async () => {
  const connection = fakeConnection()
  const updates = []
  const client = createTransportSimulationClient({
    createConnection: () => connection,
    onUpdate: (payload) => updates.push(payload),
  })

  await client.setActiveLiveRoutes([ROUTE_A])
  updates.length = 0

  connection.push(SIMULATION_UPDATED_EVENT, { routeId: ROUTE_D, simulationId: RUN_D })
  assert.equal(updates.length, 0)

  connection.push(SIMULATION_UPDATED_EVENT, { routeId: ROUTE_A, simulationId: RUN_A })
  assert.equal(updates.length, 1)
})

test('the hook refreshes the active list on the discovery signal and never polls', () => {
  // Sinyal TEK bir okuma tetikler.
  assert.match(HOOK, /onActiveSetChanged: \(\) => requestActiveRefreshRef\.current\?\.\(\)/)
  assert.match(HOOK, /fetchActiveTransportSimulations\(\)/)

  // Ve bu bir YOKLAMA değildir.
  for (const forbidden of ['setInterval', 'setTimeout', 'window.location.reload', 'requestAnimationFrame']) {
    assert.ok(!HOOK.includes(forbidden), `kancada yoklama izi: ${forbidden}`)
  }
  assert.ok(!MAP_PAGE.includes('fetchActiveTransportSimulations'))

  // Uç HİÇBİR süzgeç/sayfalama parametresi taşımaz; arama istemcidedir.
  assert.match(API, /authFetch\('\/api\/transport\/simulations\/active', \{ signal \}\)/)
})

test('exactly one shared transport SignalR client is created', () => {
  // Kanca TEK bir istemci kurar ve onu bir ref'te saklar.
  assert.equal((HOOK.match(/createTransportSimulationHubClient\(\{/g) ?? []).length, 1)
  assert.match(HOOK, /if \(!clientRef\.current\)/)

  // İzleme, keşif ya da araç başına ikinci bir istemci YOKTUR.
  assert.ok(!MAP_PAGE.includes('createTransportSimulationHubClient'))
  assert.ok(!MAP_PAGE.includes('HubConnectionBuilder'))
  assert.equal((CLIENT.match(/createConnection\(\)/g) ?? []).length, 1)
})

/* --- 29. BOOTSTRAP YARIŞI ---------------------------------------------------- */

test('a run that starts during bootstrap is never lost', () => {
  /* Senaryo: istemci keşif kanalına katılır, aktif liste isteği yola çıkar
     (o an A/B çalışıyor), istek YOLDAYKEN D başlar ve keşif sinyaliyle
     öğrenilir. Yanıt D'yi içermez çünkü sunucuda henüz yoktu. */
  let byRoute = {}

  // 1. Katılım sonrası ilk okuma yola çıkar. (canlı olay sayacı = 0)
  const seqAtRequest = 0

  // 2. İstek yoldayken D'nin canlı olayı gelir.
  byRoute = {
    ...byRoute,
    [ROUTE_D]: mergeSimulationState(null, live({ routeId: ROUTE_D, simulationId: RUN_D, progressPercent: 1 })),
  }
  const liveSeen = new Map([[ROUTE_D, seqAtRequest + 1]])

  // 3. A/B taşıyan yanıt döner.
  const protectedRouteIds = [...liveSeen.entries()]
    .filter(([, seq]) => seq > seqAtRequest)
    .map(([routeId]) => routeId)

  const settled = applyActiveSimulationList({
    byRoute,
    list: [
      activeRow({ routeId: ROUTE_A, simulationId: RUN_A }),
      activeRow({ routeId: ROUTE_B, simulationId: RUN_B }),
    ],
    protectedRouteIds,
  })

  // D KAYBOLMAZ.
  assert.deepEqual(settled.activeRouteIds, [ROUTE_A, ROUTE_B, ROUTE_D])

  /* Buna karşılık, istek yolundan ÖNCE öğrenilmiş ve yanıtta bulunmayan bir
     rota gerçekten düşer: yanıt bir ANIN otoriter gerçeğidir ve bayat veri
     güncel diye gösterilmez. */
  const dropped = applyActiveSimulationList({
    byRoute: settled.byRoute,
    list: [activeRow({ routeId: ROUTE_A, simulationId: RUN_A })],
  })
  assert.deepEqual(dropped.activeRouteIds, [ROUTE_A])
})

test('the bootstrap joins discovery before it reads the list', () => {
  const bootstrap = HOOK.slice(
    HOOK.indexOf('if (!canView || !discoverActive) return undefined'),
    HOOK.indexOf('}, [canView, discoverActive, client, requestActiveRefresh, syncSubscriptions])'),
  )

  /* Sıra kritiktir. Ters sıra (önce oku, sonra katıl) tam ortada bir KÖR
     PENCERE bırakırdı: o aralıkta başlayan hat ne yanıtta olurdu ne de
     sinyali duyulurdu. */
  assert.ok(bootstrap.includes('joinDiscovery()'))
  assert.ok(bootstrap.includes('requestActiveRefresh()'))
  assert.ok(bootstrap.indexOf('joinDiscovery()') < bootstrap.indexOf('requestActiveRefresh()'))

  // Eşzamanlı sinyaller TEK bir ek okumaya indirgenir; zamanlayıcı yoktur.
  assert.match(HOOK, /activeRefreshPending\.current = true/)
  assert.match(HOOK, /while \(activeRefreshPending\.current\)/)
})

/* --- 30/31. BAŞLATMA SAHİPLİĞİ İŞARETÇİ OTORİTESİ DEĞİLDİR ------------------- */

test('the starter singleton never decides which vehicles are drawn', () => {
  const { byRoute } = seedAbc()

  /* İzlenen araçlar TAMAMEN aktif küme + izleme seçiminden türer: fonksiyonun
     imzasında bir "başlatan" kavramı yoktur. */
  const presentations = watchedPresentations(byRoute, watchAllActiveRuns(byRoute))
  assert.equal(presentations.length, 3)
  assert.ok(presentations.every((item) => item.ownership === VEHICLE_OWNERSHIP.WATCH))

  const watchedSource = stripComments(read('../../src/map/transportVehicle.js'))
  const watchedFn = watchedSource.slice(
    watchedSource.indexOf('export function transportWatchedVehiclePresentations'),
    watchedSource.indexOf('export function transportStarterTerminalPresentation'),
  )
  assert.ok(!watchedFn.includes('startedSimulationId'))

  // Başlatma sahipliği yalnızca KENDİ dar sunumunu ekler ve tekilleştirilir.
  const owned = { routeId: ROUTE_A, simulationId: RUN_A, emphasis: VEHICLE_EMPHASIS.FULL }
  assert.equal(mergeVehiclePresentations(presentations, owned).length, 3)
  assert.equal(
    mergeVehiclePresentations(presentations, { routeId: ROUTE_D, simulationId: RUN_D }).length,
    4,
  )
  assert.equal(mergeVehiclePresentations(presentations, null).length, 3)
})

/* --- 32/33. YETKİ: liste OKUMADIR, mutasyon değil ---------------------------- */

test('a plain viewer gets the list and the watch controls but no lifecycle buttons', () => {
  const { byRoute } = seedAbc()

  const presentation = activeSimulationsPresentation({
    byRoute, routes, watchedRuns: {}, loaded: true,
  })

  /* Satır yalnızca durum/ilerleme/izleme taşır: hiçbir YAŞAM DÖNGÜSÜ eylemi
     buraya sızmamıştır. (`isPaused` bir DURUM bayrağıdır, bir eylem değil.) */
  const rowKeys = Object.keys(presentation.rows[0])
  for (const forbidden of [
    'showPause', 'showResume', 'showStop', 'showReset', 'showRestart',
    'onPause', 'onResume', 'onStop', 'stoppableSimulationId',
  ]) {
    assert.ok(!rowKeys.includes(forbidden), `satırda yaşam döngüsü eylemi: ${forbidden}`)
  }

  // Yaşam döngüsü denetimleri SEÇİLİ hattın bağlamında ve kendi yetkisinde kalır.
  const viewer = transportSimulationControls({
    routeId: ROUTE_A, simulation: byRoute[ROUTE_A], canStart: false, canStop: false,
  })
  assert.equal(viewer.showPause, false)
  assert.equal(viewer.showStop, false)
  assert.equal(viewer.showStart, false)
  assert.equal(viewer.isActive, true)

  const operator = transportSimulationControls({
    routeId: ROUTE_A, simulation: byRoute[ROUTE_A], canStart: false, canStop: true,
  })
  assert.equal(operator.showPause, true)
  assert.equal(operator.showStop, true)
})

test('the active list carries no role-name checks and keeps batch controls in their own component', () => {
  for (const [label, source] of [
    ['liste bileşeni', LIST],
    ['paylaşılan bölüm', SHARED],
    ['saf modül', read('../../src/map/activeSimulations.js')],
    ['yönetim çubuğu', read('../../src/components/map/ActiveSimulationManagementBar.jsx')],
  ]) {
    for (const forbidden of ['isAdmin', 'isOperator', 'roleName', 'userName', "'Admin'"]) {
      assert.ok(!source.includes(forbidden), `${label} rol adına dayanıyor: ${forbidden}`)
    }
  }

  /* Faz 4B TOPLU yüzeyi listede DEĞİL, kendi bileşenindedir. Ayrım görsel bir
     tercih değil: liste satır satır bir OKUMA yüzeyidir, toplu komutlar ise
     SEÇİMİN tamamına uygulanır ve kendi onayını taşır.

     Satır hiçbir yaşam döngüsü etiketi taşımaz: dar harita panelinde ad,
     durum, ilerleme, izleme ve üç komut aynı genişliği paylaşamıyordu. */
  for (const forbidden of [
    'Duraklat',
    'Devam Ettir',
    'Sıfırla',
    'Yeniden Başlat',
    'managedSelectedRouteIds',
  ]) {
    assert.ok(!LIST.includes(forbidden), `yaşam döngüsü komutu listeye sızmış: ${forbidden}`)
  }

  // Ve komutların gerçek yeri yönetim çubuğudur.
  const bar = read('../../src/components/map/ActiveSimulationManagementBar.jsx')
  assert.match(bar, /management\.actions\.map\(/)

  // Satır: seçim ve izleme AYRI düğmelerdir.
  assert.match(LIST, /className="journey-active-select"/)
  assert.match(LIST, /className=\{`journey-active-watch/)
  assert.match(LIST, /onSelectRoute\?\.\(row\.routeId\)/)
  assert.match(LIST, /onToggleWatch\?\.\(row\.routeId\)/)
})

test('selecting a row changes only the selection', () => {
  const select = MAP_PAGE.slice(
    MAP_PAGE.indexOf('const selectActiveSimulationRow'),
    MAP_PAGE.indexOf('const toggleTransportRoute'),
  )

  assert.match(select, /setSelectedTransportRouteId\(rowRouteId\)/)
  assert.ok(!select.includes('toggleWatch'))
  assert.ok(!select.includes('follow'))
})

/* --- 34. BOŞ / YÜKLENİYOR / HATA -------------------------------------------- */

test('loading, empty and failed discovery are three distinct statements', () => {
  const loading = activeSimulationsPresentation({ loading: true, loaded: false })
  assert.equal(loading.loading, true)
  assert.equal(loading.isEmpty, false)

  const empty = activeSimulationsPresentation({ loaded: true })
  assert.equal(empty.isEmpty, true)
  assert.equal(empty.loading, false)

  /* Hata varken "hiç aktif simülasyon yok" DENMEZ: bilinmeyen bir şey "yok"
     diye sunulamaz. */
  const failed = activeSimulationsPresentation({ loaded: true, error: 'Aktif simülasyonlar okunamadı.' })
  assert.equal(failed.isEmpty, false)
  assert.equal(failed.error, 'Aktif simülasyonlar okunamadı.')

  // Arama sonucu boş olmak, aktif simülasyon olmaması DEĞİLDİR.
  const { byRoute } = seedAbc()
  const filtered = activeSimulationsPresentation({ byRoute, routes, search: 'zzz', loaded: true })
  assert.equal(filtered.isEmpty, false)
  assert.equal(filtered.totalCount, 3)
  assert.equal(filtered.visibleCount, 0)

  assert.ok(LIST.includes('Aktif simülasyonlar yükleniyor…'))
  assert.ok(LIST.includes('Şu anda aktif hat simülasyonu bulunmuyor.'))
})

test('the bulk watch actions are offered only when they mean something', () => {
  const { byRoute } = seedAbc()

  const none = activeSimulationsPresentation({ byRoute, routes, watchedRuns: {}, loaded: true })
  assert.equal(none.canWatchAll, true)
  assert.equal(none.canClearWatch, false)

  const all = activeSimulationsPresentation({
    byRoute, routes, watchedRuns: watchAllActiveRuns(byRoute), loaded: true,
  })
  assert.equal(all.canWatchAll, false)
  assert.equal(all.canClearWatch, true)

  assert.ok(LIST.includes('Tümünü İzle'))
  assert.ok(LIST.includes('İzlemeyi Temizle'))
})

/* --- 35. KİŞİSEL YOLCULUK DOKUNULMAMIŞTIR ----------------------------------- */

test('the personal journey product is untouched by active discovery', () => {
  const journeyHook = read('../../src/hooks/useJourneySimulation.js')
  const journeyState = read('../../src/map/journeySimulationState.js')

  for (const source of [journeyHook, journeyState]) {
    assert.ok(!source.includes('fetchActiveTransportSimulations'))
    assert.ok(!source.includes('activeSimulations'))
    assert.ok(!source.includes('watchedRuns'))
    assert.ok(!source.includes('JoinActiveSimulationDiscovery'))
  }

  // Ve keşif tarafı kişisel ürünün hiçbir parçasını tanımaz.
  const active = read('../../src/map/activeSimulations.js')
  assert.ok(!active.includes('journey'))
  assert.ok(!active.includes('Journey'))
  assert.ok(!LIST.includes('journeySimulation'))
})

/* --- 36. YÖNETİM EKRANI: keşif KAPALIDIR ------------------------------------ */

test('the route management screen keeps a single vehicle and no active discovery', () => {
  const adminPage = stripComments(read('../../src/pages/admin/TransportRoutePage.jsx'))
  const adminMap = stripComments(read('../../src/components/admin/TransportManagementMap.jsx'))

  // Keşif bayrağı yalnızca çalışma alanında açılır.
  assert.ok(!adminPage.includes('discoverActive'))
  assert.match(MAP_PAGE, /discoverActive: allowed\.canViewTransport/)

  // Yönetim haritası tek sunumu bir kalemlik listeye sarar; ikinci bir çizim
  // yolu açılmaz.
  assert.match(adminMap, /useTransportVehicleLayer\(map, \{ presentations: vehiclePresentations \}\)/)
  assert.ok(!adminMap.includes('transportWatchedVehiclePresentations'))
})

/* ==============================================================================
   İZLEME, AKTİF ARAÇ GÖRÜNÜRLÜĞÜNÜN TEK SAHİBİDİR (Faz 4A düzeltmesi)
   ==============================================================================

   Düzeltmeden önce ana harita, izlenen araçların yanına ESKİ tek araçlı
   sunumu da ekliyordu. O sunumun GÖZLEM (observe) sahipliği "seçili + abone"
   koşuluyla canlı bir araç üretiyordu; sonuç olarak AKTİF + SEÇİLİ ama
   İZLENMEYEN bir çalıştırma haritada görünüyordu. Aşağıdaki iddialar o
   sızıntının geri dönmesini engeller.

   Ayrım şudur: GÖZLEM veri sahipliğidir, AKTİF KÜME liste tazeliği
   sahipliğidir, BAŞLATMA eski terminal sunumun sahipliğidir. Hiçbiri
   GÖRÜNÜRLÜK sahibi değildir. */

/* --- 1/2. AKTİF + SEÇİLİ + İZLENMEYEN → İŞARETÇİ YOK ------------------------ */

test('an active selected but unwatched run draws no marker, running or paused', () => {
  const { byRoute } = seedAbc()
  const source = new VectorSource()

  for (const [label, routeId] of [['Çalışıyor', ROUTE_A], ['Duraklatıldı', ROUTE_B]]) {
    const presentations = transportWatchedVehiclePresentations({
      byRoute,
      // Kullanıcı HİÇBİR ŞEYİ izlemiyor…
      watchedRuns: {},
      // …ama hattı SEÇMİŞ ve rotanın yayınına ABONE.
      selectedRouteId: routeId,
      followingRouteId: null,
      subscribedRouteIds: activeRouteIdsOf(byRoute),
      routes,
    })

    assert.deepEqual(presentations, [], `${label}: seçim tek başına aracı çizdi`)

    syncTransportVehicleFeatures(source, presentations)
    assert.equal(source.getFeatures().length, 0, `${label}: haritada araç kaldı`)
  }

  // Ve hat AKTİF olmaya devam eder: işaretçi yokluğu "bitti" demek değildir.
  assert.deepEqual(activeRouteIdsOf(byRoute), [ROUTE_A, ROUTE_B, ROUTE_C])
})

/* --- 3/4. İZLENEN: seçili tam vurgu, seçili değil kısık ---------------------- */

test('watch alone decides visibility while selection decides only emphasis', () => {
  const { byRoute } = seedAbc()
  const watchedRuns = toggleWatchedRun({}, { routeId: ROUTE_A, simulationId: RUN_A })

  const unselected = transportWatchedVehiclePresentations({
    byRoute, watchedRuns, selectedRouteId: ROUTE_B, routes,
    subscribedRouteIds: activeRouteIdsOf(byRoute),
  })
  const selected = transportWatchedVehiclePresentations({
    byRoute, watchedRuns, selectedRouteId: ROUTE_A, routes,
    subscribedRouteIds: activeRouteIdsOf(byRoute),
  })

  // İZLENEN A her iki durumda da GÖRÜNÜR…
  assert.equal(unselected.length, 1)
  assert.equal(selected.length, 1)
  assert.equal(unselected[0].routeId, ROUTE_A)

  // …yalnızca vurgusu değişir.
  assert.equal(unselected[0].emphasis, VEHICLE_EMPHASIS.MUTED)
  assert.equal(selected[0].emphasis, VEHICLE_EMPHASIS.FULL)

  // SEÇİLİ ama izlenmeyen B hiçbir durumda çizilmez.
  assert.equal(unselected.find((item) => item.routeId === ROUTE_B), undefined)
})

/* --- 5/6. İZLENMEYEN SEÇİLİ HAT CANLI VERİ ALMAYA DEVAM EDER ---------------- */

test('an unwatched selected route keeps receiving live state while staying invisible', () => {
  const { byRoute } = seedAbc()

  /* GÖZLEM aboneliği KALDIRILMADI: kaldırılsaydı panel donardı ve aynı hatta
     başlayacak yeni çalıştırma sayfaya hiç ulaşmazdı. Kaldırılan tek şey
     gözlemin GÖRÜNÜRLÜK sahipliğidir. */
  const advanced = {
    ...byRoute,
    [ROUTE_A]: mergeSimulationState(byRoute[ROUTE_A], live({
      routeId: ROUTE_A,
      simulationId: RUN_A,
      progressPercent: 64,
      longitude: 31,
      updatedAtUtc: '2026-09-02T10:00:40Z',
    })),
  }

  // Seçili hattın KANONİK durumu ilerledi…
  assert.equal(advanced[ROUTE_A].progressPercent, 64)
  assert.equal(advanced[ROUTE_A].longitude, 31)

  // …panel de aynı durumdan besleniyor…
  const controls = transportSimulationControls({
    routeId: ROUTE_A, simulation: advanced[ROUTE_A], canStop: true,
  })
  assert.equal(controls.isActive, true)
  assert.equal(controls.progressLabel, '%64')

  // …ama izlenmediği için hâlâ hiçbir işaretçi yok.
  const source = new VectorSource()
  syncTransportVehicleFeatures(source, transportWatchedVehiclePresentations({
    byRoute: advanced, watchedRuns: {}, selectedRouteId: ROUTE_A, routes,
    subscribedRouteIds: activeRouteIdsOf(advanced),
  }))
  assert.equal(source.getFeatures().length, 0)

  // Ve gözlem aboneliği kancada AYNEN duruyor.
  assert.match(HOOK, /if \(observedRouteId === routeId\) return/)
  assert.match(HOOK, /observe\(routeId\)/)
})

/* --- 7/8. TAKİP ⇒ İZLEME; TAKİBİ BIRAK ⇏ İZLEMEYİ BIRAK --------------------- */

test('following an unwatched active run makes it watched, visible and camera-owned', () => {
  const { byRoute } = seedAbc()

  // Kamera GÖRÜNÜR bir araç ister: takip, izlemeyi İMA EDER.
  const watchedRuns = ensureWatchedRun({}, { routeId: ROUTE_C, simulationId: RUN_C })
  assert.deepEqual(watchedRouteIdsOf(watchedRuns), [ROUTE_C])

  const presentations = transportWatchedVehiclePresentations({
    byRoute, watchedRuns, selectedRouteId: null, followingRouteId: ROUTE_C, routes,
    subscribedRouteIds: activeRouteIdsOf(byRoute),
  })

  const vehicle = presentations.find((item) => item.routeId === ROUTE_C)
  assert.ok(vehicle, 'takip edilen araç çizilmiyor')
  assert.equal(vehicle.followCamera, true)
  assert.equal(vehicle.isLive, true)

  // İdempotenttir: aynı çalıştırma iki kez eklenmez.
  assert.equal(ensureWatchedRun(watchedRuns, { routeId: ROUTE_C, simulationId: RUN_C }), watchedRuns)

  // Ve TERSİ doğru değildir: izlemek takip ettirmez.
  const watchedOnly = transportWatchedVehiclePresentations({
    byRoute, watchedRuns, followingRouteId: null, routes,
    subscribedRouteIds: activeRouteIdsOf(byRoute),
  })
  assert.equal(watchedOnly[0].followCamera, false)
})

test('the follow command freezes the run identity into the watch selection', () => {
  const followBody = HOOK.slice(
    HOOK.indexOf('const follow = useCallback'),
    HOOK.indexOf('const unfollow = useCallback'),
  )

  /* Kimlik TETİKLEME anında dondurulur: "bu hatta ne varsa" değil, o an
     ekranda duran çalıştırma izlemeye alınır. */
  assert.match(followBody, /ensureWatchedRun\(current, \{/)
  assert.match(followBody, /simulationId: target\.simulationId/)
  assert.match(followBody, /!isTerminalSimulationStatus\(target\.status\)/)

  // İzleme, takipten ÖNCE yazılır: araç kamera gelmeden çizilebilsin.
  assert.ok(followBody.indexOf('ensureWatchedRun') < followBody.indexOf('client().follow'))
})

test('unfollowing releases only the camera and keeps the watched marker', () => {
  const { byRoute } = seedAbc()
  const watchedRuns = ensureWatchedRun({}, { routeId: ROUTE_C, simulationId: RUN_C })
  const source = new VectorSource()

  syncTransportVehicleFeatures(source, transportWatchedVehiclePresentations({
    byRoute, watchedRuns, followingRouteId: ROUTE_C, routes,
    subscribedRouteIds: activeRouteIdsOf(byRoute),
  }))
  assert.equal(source.getFeatures().length, 1)

  const released = transportWatchedVehiclePresentations({
    byRoute, watchedRuns, followingRouteId: null, routes,
    subscribedRouteIds: activeRouteIdsOf(byRoute),
  })
  syncTransportVehicleFeatures(source, released)

  // İzleme KORUNUR, işaretçi kalır, yalnızca kamera bırakılır.
  assert.deepEqual(watchedRouteIdsOf(watchedRuns), [ROUTE_C])
  assert.equal(source.getFeatures().length, 1)
  assert.equal(released[0].followCamera, false)
  assert.equal(released[0].isLive, true)

  // Ve `unfollow` izleme durumuna HİÇ dokunmaz.
  const unfollowBody = HOOK.slice(
    HOOK.indexOf('const unfollow = useCallback'),
    HOOK.indexOf('const observe = useCallback'),
  )
  assert.ok(!unfollowBody.includes('setWatchedRuns'))
})

/* --- 9/10. SEÇİM DEĞİŞTİRMEK GÖRÜNÜRLÜĞÜ DEĞİŞTİRMEZ ----------------------- */

test('selecting another unwatched active route renders nothing new', () => {
  const { byRoute } = seedAbc()
  const watchedRuns = ensureWatchedRun({}, { routeId: ROUTE_A, simulationId: RUN_A })
  const source = new VectorSource()

  for (const selectedRouteId of [ROUTE_A, ROUTE_B, ROUTE_C, null]) {
    const presentations = transportWatchedVehiclePresentations({
      byRoute, watchedRuns, selectedRouteId, routes,
      subscribedRouteIds: activeRouteIdsOf(byRoute),
    })
    syncTransportVehicleFeatures(source, presentations)

    // Her seçimde TAM OLARAK bir araç: yalnızca izlenen A.
    assert.equal(source.getFeatures().length, 1, `seçim ${selectedRouteId} işaretçi sayısını değiştirdi`)
    assert.equal(presentations[0].routeId, ROUTE_A)
    assert.equal(
      presentations[0].emphasis,
      selectedRouteId === ROUTE_A ? VEHICLE_EMPHASIS.FULL : VEHICLE_EMPHASIS.MUTED,
    )
  }
})

/* --- 11/12. TERMİNAL ve YERİNE GEÇEN ÇALIŞTIRMA ---------------------------- */

test('a followed watched run that ends loses its watch, its marker and the camera', () => {
  const { byRoute } = seedAbc()
  const watchedRuns = ensureWatchedRun({}, { routeId: ROUTE_A, simulationId: RUN_A })
  const source = new VectorSource()

  syncTransportVehicleFeatures(source, transportWatchedVehiclePresentations({
    byRoute, watchedRuns, followingRouteId: ROUTE_A, routes,
    subscribedRouteIds: activeRouteIdsOf(byRoute),
  }))
  assert.equal(source.getFeatures().length, 1)

  const ended = {
    ...byRoute,
    [ROUTE_A]: mergeSimulationState(byRoute[ROUTE_A], live({
      routeId: ROUTE_A,
      simulationId: RUN_A,
      status: SIMULATION_STATUS.CANCELLED,
      progressPercent: 10,
      updatedAtUtc: '2026-09-02T10:00:10Z',
    })),
  }

  const reconciled = reconcileWatchedRuns(watchedRuns, ended)
  assert.deepEqual(watchedRouteIdsOf(reconciled), [])

  const after = transportWatchedVehiclePresentations({
    byRoute: ended, watchedRuns: reconciled, followingRouteId: ROUTE_A, routes,
    subscribedRouteIds: activeRouteIdsOf(ended),
  })
  syncTransportVehicleFeatures(source, after)

  assert.deepEqual(after, [])
  assert.equal(source.getFeatures().length, 0)

  /* Kamera sahipliği MEVCUT yaşam döngüsüyle bırakılır — abonelik
     KORUNARAK. Bu kural bu düzeltmede değişmedi. */
  assert.match(HOOK, /if \(!followed \|\| !isTerminalSimulationStatus\(followed\.status\)\) return/)
  assert.match(HOOK, /await clientRef\.current\?\.unfollow\(\)/)
})

test('a replacement run on the same route is neither watched nor followed nor drawn', () => {
  const { byRoute } = seedAbc()
  const watchedRuns = ensureWatchedRun({}, { routeId: ROUTE_A, simulationId: RUN_A })

  const replaced = {
    ...byRoute,
    [ROUTE_A]: mergeSimulationState(byRoute[ROUTE_A], live({
      routeId: ROUTE_A,
      simulationId: RUN_A2,
      progressPercent: 0,
      updatedAtUtc: '2026-09-02T10:06:00Z',
    })),
  }

  const reconciled = reconcileWatchedRuns(watchedRuns, replaced)
  assert.deepEqual(watchedRouteIdsOf(reconciled), [])

  // B AKTİFTİR (listede görünür) ama çizilmez ve takip edilmez.
  assert.ok(activeRouteIdsOf(replaced).includes(ROUTE_A))

  const source = new VectorSource()
  const presentations = transportWatchedVehiclePresentations({
    byRoute: replaced, watchedRuns: reconciled, selectedRouteId: ROUTE_A, routes,
    subscribedRouteIds: activeRouteIdsOf(replaced),
  })
  syncTransportVehicleFeatures(source, presentations)

  assert.deepEqual(presentations, [])
  assert.equal(source.getFeatures().length, 0)

  /* Rota kimliği TEK BAŞINA devralamaz: eski kaydı zorla korumak bile
     çalışmaz, çünkü sunum kimlik eşleşmesi arar. */
  const inherited = transportWatchedVehiclePresentations({
    byRoute: replaced, watchedRuns, routes,
    subscribedRouteIds: activeRouteIdsOf(replaced),
  })
  assert.deepEqual(inherited, [])
})

/* --- 13/14/15. GÖRÜNÜRLÜK SAHİBİ OLMAYANLAR -------------------------------- */

test('observe, activeLive and the starter are not visibility authorities', () => {
  const { byRoute } = seedAbc()
  const allActive = activeRouteIdsOf(byRoute)

  /* 14. GÖZLEM: sunum fonksiyonunun imzasında bir gözlem kavramı BİLE yoktur —
     sızıntı yeniden yazılmadan geri gelemez. */
  const watchedSource = stripComments(read('../../src/map/transportVehicle.js'))
  const watchedFn = watchedSource.slice(
    watchedSource.indexOf('export function transportWatchedVehiclePresentations'),
    watchedSource.indexOf('export function transportStarterTerminalPresentation'),
  )
  assert.ok(!watchedFn.includes('observedRouteId'))
  assert.ok(!watchedFn.includes('startedSimulationId'))
  assert.ok(!watchedFn.includes('VEHICLE_OWNERSHIP.OBSERVE'))

  /* 15. AKTİF KÜME: üç hat da abone ve aktif; hiçbiri izlenmiyor → hiçbiri
     çizilmiyor. Abonelik listeyi CANLI tutar, aracı ÇİZMEZ. */
  assert.deepEqual(
    transportWatchedVehiclePresentations({
      byRoute, watchedRuns: {}, routes, subscribedRouteIds: allActive,
    }),
    [],
  )

  /* 13. BAŞLATMA: aktif bir çalıştırma için sunum ASLA üretilmez — kullanıcı
     onu kendisi başlatmış ve hattı seçmiş olsa bile. */
  for (const status of [SIMULATION_STATUS.RUNNING, SIMULATION_STATUS.PAUSED]) {
    assert.equal(
      transportStarterTerminalPresentation({
        simulation: { ...byRoute[ROUTE_A], status },
        startedSimulationId: RUN_A,
        selectedRouteId: ROUTE_A,
        routes,
      }),
      null,
      `${status} durumunda başlatan sahipliği aktif aracı görünür kıldı`,
    )
  }

  // Ve ana harita çizim listesi ESKİ tek araçlı sunumdan artık BESLENMİYOR.
  assert.ok(!MAP_PAGE.includes('transportVehiclePresentation('))
  assert.match(MAP_PAGE, /mergeVehiclePresentations\(watchedVehicles, starterTerminalVehicle\)/)
})

/* --- 16. ESKİ START-TERMİNAL DAVRANIŞI KORUNDU ----------------------------- */

test('the starter keeps the final position of the run it started, once terminal', () => {
  const { byRoute } = seedAbc()

  for (const status of [SIMULATION_STATUS.COMPLETED, SIMULATION_STATUS.CANCELLED]) {
    const presentation = transportStarterTerminalPresentation({
      simulation: { ...byRoute[ROUTE_A], status },
      startedSimulationId: RUN_A,
      selectedRouteId: ROUTE_A,
      routes,
    })

    assert.ok(presentation, `${status} durumunda başlatanın son konumu kayboldu`)
    assert.equal(presentation.ownership, VEHICLE_OWNERSHIP.START)
    assert.equal(presentation.simulationId, RUN_A)
    assert.equal(presentation.routeId, ROUTE_A)
    assert.equal(presentation.isTerminal, true)
    // Kayıt CANLI DEĞİLDİR ve kamera TALEP ETMEZ.
    assert.equal(presentation.isLive, false)
    assert.equal(presentation.followCamera, false)
    // Son konum olduğu gibi taşınır.
    assert.equal(presentation.longitude, byRoute[ROUTE_A].longitude)
    assert.equal(presentation.latitude, byRoute[ROUTE_A].latitude)
  }

  // Sahiplik ÇALIŞTIRMA kimliğindedir ve hat SEÇİLİ olmalıdır.
  const terminalA = { ...byRoute[ROUTE_A], status: SIMULATION_STATUS.COMPLETED }
  assert.equal(
    transportStarterTerminalPresentation({
      simulation: terminalA, startedSimulationId: RUN_A2, selectedRouteId: ROUTE_A, routes,
    }),
    null,
  )
  assert.equal(
    transportStarterTerminalPresentation({
      simulation: terminalA, startedSimulationId: RUN_A, selectedRouteId: ROUTE_B, routes,
    }),
    null,
  )

  /* Ve terminal sunum AKTİF koleksiyona KARIŞMAZ: çizim listesinde ayrı bir
     kavram olarak durur, aktif bir aracı görünür kılmaz. */
  const watched = transportWatchedVehiclePresentations({
    byRoute, watchedRuns: {}, selectedRouteId: ROUTE_A, routes,
    subscribedRouteIds: activeRouteIdsOf(byRoute),
  })
  const starter = transportStarterTerminalPresentation({
    simulation: terminalA, startedSimulationId: RUN_A, selectedRouteId: ROUTE_A, routes,
  })

  const drawList = mergeVehiclePresentations(watched, starter)
  assert.equal(drawList.length, 1)
  assert.equal(drawList[0].isTerminal, true)
  assert.equal(drawList[0].isLive, false)
})

/* --- 9. İZLE → işaretçi BELİRİR --------------------------------------------- */

test('watching an active run makes exactly that run appear on the map', () => {
  const { byRoute } = seedAbc()
  const source = new VectorSource()

  // Önce hiçbir şey izlenmiyor: harita boş.
  syncTransportVehicleFeatures(source, transportWatchedVehiclePresentations({
    byRoute, watchedRuns: {}, selectedRouteId: ROUTE_B, routes,
    subscribedRouteIds: activeRouteIdsOf(byRoute),
  }))
  assert.equal(source.getFeatures().length, 0)

  // "İzle B" → tam olarak B'nin ÇALIŞTIRMASI izlemeye alınır.
  const watchedRuns = toggleWatchedRun({}, { routeId: ROUTE_B, simulationId: RUN_B })
  assert.equal(watchedRuns[ROUTE_B], RUN_B)

  const presentations = transportWatchedVehiclePresentations({
    byRoute, watchedRuns, selectedRouteId: ROUTE_B, routes,
    subscribedRouteIds: activeRouteIdsOf(byRoute),
  })
  syncTransportVehicleFeatures(source, presentations)

  // Yalnızca B belirir ve SEÇİLİ olduğu için tam vurguludur.
  assert.equal(source.getFeatures().length, 1)
  assert.ok(source.getFeatureById(vehicleFeatureId(ROUTE_B, RUN_B)))
  assert.equal(presentations[0].emphasis, VEHICLE_EMPHASIS.FULL)

  // "İzlemeyi Bırak B" → yalnızca B'nin işaretçisi kaybolur.
  const unwatched = toggleWatchedRun(watchedRuns, { routeId: ROUTE_B })
  assert.deepEqual(watchedRouteIdsOf(unwatched), [])
  syncTransportVehicleFeatures(source, transportWatchedVehiclePresentations({
    byRoute, watchedRuns: unwatched, selectedRouteId: ROUTE_B, routes,
    subscribedRouteIds: activeRouteIdsOf(byRoute),
  }))
  assert.equal(source.getFeatures().length, 0)

  // Ama B AKTİF ve seçili kalmaya devam eder.
  assert.ok(activeRouteIdsOf(byRoute).includes(ROUTE_B))
})

/* --- 12/13. KAMERA GÖRÜNÜR BİR ARAÇ İSTER ---------------------------------- */

test('unwatching or clearing the followed run releases the camera too', () => {
  /* Takip izlemeyi İMA EDER; tersi yönde tutarlılık borcu doğar. Kullanıcı
     takip ettiği aracı AÇIKÇA gizlerse, kamera görünmeyen bir aracın peşinde
     kayamaz. */
  /* Sınır YORUMDAN değil KODDAN okunur: bir kavramı anlatmak onu uygulamak
     değildir, bu yüzden dosya yorumları zaten ayıklanmış durumda. */
  const guardStart = HOOK.indexOf('if (followed && isTerminalSimulationStatus(followed.status)) return')
  const guardEnd = HOOK.indexOf('}, [followingRouteId, watchedRuns, byRoute, unfollow])')

  assert.ok(guardStart > -1, 'kamera/izleme değişmezi bulunamadı')
  assert.ok(guardEnd > guardStart, 'değişmezin bağımlılıkları beklenen kümede değil')

  const guard = HOOK.slice(guardStart, guardEnd)

  // Kural DEKLARATİFTİR ve TEK yerdedir.
  assert.match(guard, /if \(followed && watchedRuns\[followingRouteId\] === followed\.simulationId\) return/)
  assert.match(guard, /unfollow\(\)/)

  /* Terminal durum bu kuralın KONUSU DEĞİLDİR: onun kendi devir kuralı
     gruptan çıkmamak için ÖNCE pasif gözleme geçer. İkisi aynı anda
     çalışsaydı devir yarıda kalır ve yerine geçecek çalıştırmanın ilk yayını
     kaçabilirdi. */
  assert.match(HOOK, /if \(followed && isTerminalSimulationStatus\(followed\.status\)\) return/)

  /* Ve kural İZLEME KAYDINA yazmaz: yalnızca kamerayı okur. İki düğmeye
     ("İzlemeyi Bırak" ve "İzlemeyi Temizle") ayrı ayrı takip bırakma kodu
     yazılmadı — ikisi de aynı değişmezden geçer. */
  assert.ok(!guard.includes('setWatchedRuns'))

  const toggleBody = HOOK.slice(
    HOOK.indexOf('const toggleWatch = useCallback'),
    HOOK.indexOf('const watchAll = useCallback'),
  )
  const clearBody = HOOK.slice(
    HOOK.indexOf('const clearWatch = useCallback'),
    HOOK.indexOf('const watchedRouteIds = useMemo'),
  )
  for (const [name, body] of [['toggleWatch', toggleBody], ['clearWatch', clearBody]]) {
    assert.ok(!body.includes('unfollow'), `${name} kendi takip bırakma kopyasını taşıyor`)
  }

  // İZLEMEYİ TEMİZLE hiçbir simülasyona ve aktif kümeye dokunmaz.
  assert.match(clearBody, /setWatchedRuns\(clearWatchedRuns\(\)\)/)
  for (const forbidden of ['simulation.stop', 'setByRoute', 'setSelectedTransportRouteId']) {
    assert.ok(!clearBody.includes(forbidden), `İzlemeyi Temizle ${forbidden} çağırıyor`)
  }
})

test('a cleared watch leaves no marker for the run that was being followed', () => {
  const { byRoute } = seedAbc()
  const watchedRuns = watchAllActiveRuns(byRoute)
  const source = new VectorSource()

  syncTransportVehicleFeatures(source, transportWatchedVehiclePresentations({
    byRoute, watchedRuns, followingRouteId: ROUTE_A, routes,
    subscribedRouteIds: activeRouteIdsOf(byRoute),
  }))
  assert.equal(source.getFeatures().length, 3)

  // İzlemeyi Temizle: takip edilen A dahil TÜM işaretçiler gider…
  const cleared = clearWatchedRuns()
  syncTransportVehicleFeatures(source, transportWatchedVehiclePresentations({
    byRoute, watchedRuns: cleared, followingRouteId: ROUTE_A, routes,
    subscribedRouteIds: activeRouteIdsOf(byRoute),
  }))
  assert.equal(source.getFeatures().length, 0)

  // …ama hiçbir simülasyon durmaz ve aktif liste aynı kalır.
  assert.deepEqual(activeRouteIdsOf(byRoute), [ROUTE_A, ROUTE_B, ROUTE_C])
  assert.equal(byRoute[ROUTE_A].status, SIMULATION_STATUS.RUNNING)
  assert.equal(byRoute[ROUTE_B].status, SIMULATION_STATUS.PAUSED)
})

/* --- 3/4/17/22. TAM SENARYO: liste canlı, harita seçici ------------------- */

test('the whole model holds at once: A/C watched, B selected, A followed, D hidden', () => {
  /* Ürün sözleşmesinin kendisi. Dört hat aktif ve HEPSİ abone; kullanıcı
     yalnızca A ve C'yi izliyor, B'yi seçmiş, A'yı takip ediyor. */
  const seeded = applyActiveSimulationList({
    byRoute: {},
    list: [
      activeRow({ routeId: ROUTE_A, simulationId: RUN_A, progressRatio: 0.1 }),
      activeRow({ routeId: ROUTE_B, simulationId: RUN_B, progressRatio: 0.2 }),
      activeRow({ routeId: ROUTE_C, simulationId: RUN_C, status: SIMULATION_STATUS.PAUSED, progressRatio: 0.3 }),
      activeRow({ routeId: ROUTE_D, simulationId: RUN_D, progressRatio: 0.4 }),
    ],
  })

  let byRoute = seeded.byRoute
  const watchedRuns = {
    ...ensureWatchedRun({}, { routeId: ROUTE_A, simulationId: RUN_A }),
    ...ensureWatchedRun({}, { routeId: ROUTE_C, simulationId: RUN_C }),
  }

  const draw = () => transportWatchedVehiclePresentations({
    byRoute,
    watchedRuns,
    selectedRouteId: ROUTE_B,
    followingRouteId: ROUTE_A,
    subscribedRouteIds: activeRouteIdsOf(byRoute),
    routes,
  })

  const source = new VectorSource()
  syncTransportVehicleFeatures(source, draw())

  // Harita: yalnızca A ve C.
  assert.equal(source.getFeatures().length, 2)
  assert.ok(source.getFeatureById(vehicleFeatureId(ROUTE_A, RUN_A)))
  assert.ok(source.getFeatureById(vehicleFeatureId(ROUTE_C, RUN_C)))

  // SEÇİLİ B ve izlenmeyen D çizilmez — B abone ve gözlemde olmasına rağmen.
  assert.equal(source.getFeatureById(vehicleFeatureId(ROUTE_B, RUN_B)), null)
  assert.equal(source.getFeatureById(vehicleFeatureId(ROUTE_D, RUN_D)), null)

  // Seçili hat izlenmediği için HİÇBİR işaretçi tam vurgulu değildir.
  assert.ok(draw().every((item) => item.emphasis === VEHICLE_EMPHASIS.MUTED))
  // Kamera yalnızca A'dadır.
  assert.equal(draw().filter((item) => item.followCamera).length, 1)
  assert.equal(draw().find((item) => item.followCamera).routeId, ROUTE_A)

  /* Liste TÜM aktif hatlar için canlı kalır: B (seçili+gözlem) ve D
     (yalnızca activeLive) işaretçisiz oldukları hâlde ilerlemeye devam eder. */
  byRoute = {
    ...byRoute,
    [ROUTE_B]: mergeSimulationState(byRoute[ROUTE_B], live({
      routeId: ROUTE_B, simulationId: RUN_B, progressPercent: 55, updatedAtUtc: '2026-09-02T10:00:30Z',
    })),
    [ROUTE_D]: mergeSimulationState(byRoute[ROUTE_D], live({
      routeId: ROUTE_D, simulationId: RUN_D, progressPercent: 77, updatedAtUtc: '2026-09-02T10:00:30Z',
    })),
  }

  const rows = activeSimulationsPresentation({ byRoute, routes, watchedRuns, loaded: true }).rows
  assert.equal(rows.length, 4)
  assert.equal(rows.find((row) => row.routeId === ROUTE_B).progressLabel, '%55')
  assert.equal(rows.find((row) => row.routeId === ROUTE_D).progressLabel, '%77')
  assert.deepEqual(
    rows.filter((row) => row.isWatched).map((row) => row.routeId),
    [ROUTE_A, ROUTE_C],
  )

  // Ve harita HÂLÂ yalnızca A ve C'yi taşır.
  syncTransportVehicleFeatures(source, draw())
  assert.equal(source.getFeatures().length, 2)
  assert.equal(source.getFeatureById(vehicleFeatureId(ROUTE_D, RUN_D)), null)
})
