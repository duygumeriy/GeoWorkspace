import assert from 'node:assert/strict'
import test from 'node:test'
import {
  JOURNEY_SIMULATION_STATUS,
  applyJourneySnapshot,
  isTerminalJourneyStatus,
  journeyLiveModel,
  shouldApplyJourneySnapshot,
} from '../../src/map/journeySimulationState.js'
import {
  JOURNEY_VEHICLE_KIND,
  JOURNEY_VEHICLE_LAYER_CLASSNAME,
  createJourneyVehicleLayer,
  journeyVehicleBadgeDataUri,
  syncJourneyVehicleFeature,
} from '../../src/map/journeyVehicle.js'
import { TRANSPORT_VEHICLE_LAYER_CLASSNAME } from '../../src/map/transportVehicle.js'
import { fromLonLat } from 'ol/proj.js'

const SIM = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'

const snapshot = (overrides = {}) => ({
  simulationId: SIM,
  status: JOURNEY_SIMULATION_STATUS.RUNNING,
  longitude: 30,
  latitude: 40,
  progressPercent: 50,
  distanceCoveredMeters: 500,
  currentStepSequence: 1,
  updatedAtUtc: '2026-01-01T10:00:10.000Z',
  ...overrides,
})

/* --- Sıra ve terminal kilidi -------------------------------------------------- */

test('a newer snapshot for the same run is applied', () => {
  const current = snapshot()
  const next = snapshot({ progressPercent: 60, updatedAtUtc: '2026-01-01T10:00:11.000Z' })

  assert.equal(shouldApplyJourneySnapshot(current, next), true)
  assert.equal(applyJourneySnapshot(current, next), next)
})

test('an out-of-order Running event never rewinds the marker', () => {
  const current = snapshot({ progressPercent: 60, updatedAtUtc: '2026-01-01T10:00:11.000Z' })
  const stale = snapshot({ progressPercent: 50, updatedAtUtc: '2026-01-01T10:00:10.000Z' })

  assert.equal(shouldApplyJourneySnapshot(current, stale), false)
  // Aynı REFERANS döner: React yeniden çizmez ve düşürülen olay yan etki üretmez.
  assert.equal(applyJourneySnapshot(current, stale), current)
})

test('progress guards the order when timestamps are unusable', () => {
  const current = snapshot({ progressPercent: 60, updatedAtUtc: 'not-a-date' })
  const stale = snapshot({ progressPercent: 40, updatedAtUtc: 'also-not-a-date' })

  assert.equal(shouldApplyJourneySnapshot(current, stale), false)
  assert.equal(shouldApplyJourneySnapshot(current, snapshot({ progressPercent: 80, updatedAtUtc: 'x' })), true)
})

test('a terminal status is locked and a late Running event cannot revive it', () => {
  for (const terminal of [JOURNEY_SIMULATION_STATUS.COMPLETED, JOURNEY_SIMULATION_STATUS.CANCELLED]) {
    const finished = snapshot({ status: terminal, progressPercent: 100, updatedAtUtc: '2026-01-01T10:00:20.000Z' })

    /* SignalR sırayı garanti etmez; geç gelen bir Running olayı biten bir
       yolculuğu yeniden hareket ettirirdi. */
    const late = snapshot({ progressPercent: 90, updatedAtUtc: '2026-01-01T10:00:30.000Z' })
    assert.equal(shouldApplyJourneySnapshot(finished, late), false)
    assert.equal(applyJourneySnapshot(finished, late), finished)
  }
})

test('a terminal event is always accepted over a running one', () => {
  const running = snapshot()
  const completed = snapshot({
    status: JOURNEY_SIMULATION_STATUS.COMPLETED,
    progressPercent: 100,
    updatedAtUtc: '2026-01-01T10:00:09.000Z',
  })

  // Zaman geri gitse bile yolculuğun bittiğini kaçırmamalıyız.
  assert.equal(shouldApplyJourneySnapshot(running, completed), true)
})

test('an event for another simulation is never applied', () => {
  const current = snapshot()
  const foreign = snapshot({ simulationId: OTHER, progressPercent: 99, updatedAtUtc: '2026-01-01T10:00:59.000Z' })

  assert.equal(shouldApplyJourneySnapshot(current, foreign), false)
  assert.equal(shouldApplyJourneySnapshot(null, { simulationId: null }), false)
  assert.equal(shouldApplyJourneySnapshot(null, snapshot()), true)
})

test('terminal detection covers exactly the two end states', () => {
  assert.equal(isTerminalJourneyStatus('Completed'), true)
  assert.equal(isTerminalJourneyStatus('Cancelled'), true)
  assert.equal(isTerminalJourneyStatus('Running'), false)
  assert.equal(isTerminalJourneyStatus(undefined), false)
})

/* --- Canlı sunum modeli ------------------------------------------------------ */

const simulation = (overrides = {}) => ({
  simulationId: SIM,
  mode: 'waypoints',
  requestedProfile: 'walking',
  effectiveProfile: 'walking',
  geometryWkt: 'LINESTRING(30 40,31 41)',
  totalDistanceMeters: 2000,
  totalDurationSeconds: 1800,
  steps: [],
  ...overrides,
})

test('the live model reports only server figures and never estimates', () => {
  const model = journeyLiveModel({ simulation: simulation(), snapshot: snapshot() })

  assert.equal(model.progressPercent, 50)
  assert.equal(model.totalDistanceMeters, 2000)
  assert.equal(model.totalDurationSeconds, 1800)
  // Kalan = sunucunun toplamı − sunucunun kat edileni. Hız tahmini YOK.
  assert.equal(model.remainingDistanceMeters, 1500)
  assert.equal(model.profileId, 'walking')
  assert.equal(model.currentStepSequence, 1)
})

test('progress is clamped and a missing step sequence stays null', () => {
  const wild = journeyLiveModel({
    simulation: simulation(),
    snapshot: snapshot({ progressPercent: 140, currentStepSequence: null }),
  })
  assert.equal(wild.progressPercent, 100)

  /* Manevra yokluğu GEÇERLİDİR: kalıcı güzergahı yeniden kullanan tam-hat
     yolculuğunda adım verisi bulunmaz ve uydurulmaz. */
  assert.equal(wild.currentStepSequence, null)

  const negative = journeyLiveModel({ simulation: simulation(), snapshot: snapshot({ progressPercent: -5 }) })
  assert.equal(negative.progressPercent, 0)
})

test('no live model exists without both a simulation and a snapshot', () => {
  assert.equal(journeyLiveModel({ simulation: null, snapshot: snapshot() }), null)
  assert.equal(journeyLiveModel({ simulation: simulation(), snapshot: null }), null)
  assert.equal(journeyLiveModel({}), null)
})

/* --- Yenilemeden sonra kurtarma ---------------------------------------------- */

test('a recovered simulation drives the live model exactly like a fresh start', () => {
  /* Sunucu iki uçtan AYNI gövdeyi döndürür; dolayısıyla kurtarılmış bir
     çalıştırma paneli yeni başlatılmış biri kadar eksiksiz besler. */
  const recovered = simulation({
    routeId: 7,
    routeName: 'Hat 1',
    waypoints: [
      { position: 0, name: 'A', role: 'origin', source: 'transportStop', referenceId: 11 },
      { position: 1, name: 'B', role: 'destination', source: 'transportStop', referenceId: 12 },
    ],
    steps: [
      { sequence: 0, maneuverType: 'depart', distanceMeters: 100, durationSeconds: 20 },
      { sequence: 1, maneuverType: 'turn', maneuverModifier: 'left', distanceMeters: 200, durationSeconds: 40 },
    ],
  })

  const model = journeyLiveModel({
    simulation: recovered,
    snapshot: snapshot({ currentStepSequence: 1, progressPercent: 35 }),
  })

  assert.equal(model.progressPercent, 35)
  assert.equal(model.profileId, 'walking')
  assert.equal(model.totalDistanceMeters, 2000)

  // Anlık manevra kurtarılan adımlara karşı ÇÖZÜLÜR.
  assert.equal(model.currentStepSequence, 1)
  assert.equal(recovered.steps[model.currentStepSequence].maneuverModifier, 'left')

  // Etiketler ve hat adı yenilemeden sonra da elimizdedir.
  assert.equal(recovered.routeName, 'Hat 1')
  assert.deepEqual(recovered.waypoints.map((waypoint) => waypoint.name), ['A', 'B'])
})

test('a recovered route-full journey without maneuvers stays valid', () => {
  const recovered = simulation({ routeName: 'Hat 2', steps: [] })

  const model = journeyLiveModel({
    simulation: recovered,
    snapshot: snapshot({ currentStepSequence: null }),
  })

  // Manevra yokluğu bir hata DEĞİLDİR; panel yine de canlı moddadır.
  assert.equal(model.currentStepSequence, null)
  assert.equal(model.isTerminal, false)
  assert.equal(model.progressPercent, 50)
  assert.deepEqual(recovered.steps, [])
})

/* --- İşaretçi ---------------------------------------------------------------- */

test('each supported profile has its own visual semantic and bus has none', () => {
  /* İşaretçi Faz 5E-B · Dilim 6'dan beri EMOJİ DEĞİL, panelin okuduğu aynı
     sözlükten üretilen bir rozettir. Ayrıntılı görsel sözleşme
     `journey-profile-marker.test.js` içinde ölçülür; buradaki iddia ürünün
     değişmeyen kuralıdır: üç profil, üç ayrı görünüm, otobüs yok. */
  const driving = journeyVehicleBadgeDataUri('driving')
  const walking = journeyVehicleBadgeDataUri('walking')
  const cycling = journeyVehicleBadgeDataUri('cycling')

  assert.equal(new Set([driving, walking, cycling]).size, 3)

  // Otobüs/transit bir profil DEĞİLDİR; bilinmeyen değer güvenli varsayılana düşer.
  assert.equal(journeyVehicleBadgeDataUri('bus'), driving)
  assert.equal(journeyVehicleBadgeDataUri(undefined), driving)
})

test('the journey marker owns its own layer, distinct from the shared vehicle', () => {
  const { layer } = createJourneyVehicleLayer()

  assert.equal(layer.getClassName(), JOURNEY_VEHICLE_LAYER_CLASSNAME)
  assert.notEqual(JOURNEY_VEHICLE_LAYER_CLASSNAME, TRANSPORT_VEHICLE_LAYER_CLASSNAME)
})

test('the feature is updated in place across snapshots rather than recreated', () => {
  const { source } = createJourneyVehicleLayer()

  const first = syncJourneyVehicleFeature(source, {
    simulationId: SIM, profileId: 'cycling', longitude: 30, latitude: 40,
  })
  assert.equal(source.getFeatures().length, 1)
  assert.equal(first.get('featureKind'), JOURNEY_VEHICLE_KIND)
  assert.equal(first.get('profileId'), 'cycling')

  const second = syncJourneyVehicleFeature(source, {
    simulationId: SIM, profileId: 'cycling', longitude: 31, latitude: 41,
  })

  // AYNI feature; saniyede bir yeni nesne üretilmez.
  assert.equal(second, first)
  assert.equal(source.getFeatures().length, 1)
  assert.deepEqual(second.getGeometry().getCoordinates(), fromLonLat([31, 41]))
})

test('a terminal snapshot leaves the marker on its final coordinate', () => {
  const { source } = createJourneyVehicleLayer()
  syncJourneyVehicleFeature(source, { simulationId: SIM, profileId: 'driving', longitude: 30, latitude: 40 })

  const final = syncJourneyVehicleFeature(source, {
    simulationId: SIM, profileId: 'driving', longitude: 31, latitude: 41,
  })

  assert.deepEqual(final.getGeometry().getCoordinates(), fromLonLat([31, 41]))
  assert.equal(source.getFeatures().length, 1)
})

test('a null presentation clears the marker instead of leaving a ghost', () => {
  const { source } = createJourneyVehicleLayer()
  syncJourneyVehicleFeature(source, { simulationId: SIM, profileId: 'driving', longitude: 30, latitude: 40 })

  assert.equal(syncJourneyVehicleFeature(source, null), null)
  assert.equal(source.getFeatures().length, 0)

  // Bozuk koordinat da aynı güvenli yolu izler.
  syncJourneyVehicleFeature(source, { simulationId: SIM, profileId: 'driving', longitude: 30, latitude: 40 })
  syncJourneyVehicleFeature(source, { simulationId: SIM, profileId: 'driving', longitude: NaN, latitude: 40 })
  assert.equal(source.getFeatures().length, 0)
})
