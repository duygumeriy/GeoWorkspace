import assert from 'node:assert/strict'
import test from 'node:test'
import { PERMISSIONS } from '../../src/auth/permissionCodes.js'
import {
  SIMULATION_STATUS,
  isTerminalSimulationStatus,
  mergeSimulationState,
  normalizeLiveUpdate,
  normalizeStatusSnapshot,
  simulationStatusLabel,
  transportSimulationControls,
} from '../../src/map/transportSimulationState.js'

const ROUTE_ID = 7
const RUN_A = '11111111-1111-1111-1111-111111111111'
const RUN_B = '22222222-2222-2222-2222-222222222222'

const live = ({
  simulationId = RUN_A,
  routeId = ROUTE_ID,
  status = SIMULATION_STATUS.RUNNING,
  progressPercent = 0,
  updatedAtUtc = '2026-08-31T10:00:00Z',
  longitude = 30,
  latitude = 40,
} = {}) => normalizeLiveUpdate({
  simulationId, routeId, status, progressPercent, updatedAtUtc, longitude, latitude,
})

/* --- Normalleştirme ---------------------------------------------------------- */

test('a live update is normalised into the single client shape', () => {
  const state = live({ progressPercent: 42.5 })

  assert.equal(state.simulationId, RUN_A)
  assert.equal(state.routeId, ROUTE_ID)
  assert.equal(state.status, SIMULATION_STATUS.RUNNING)
  assert.equal(state.progressPercent, 42.5)
  assert.equal(state.updatedAtUtc, '2026-08-31T10:00:00Z')
})

test('the REST snapshot is converted from ratio to percent and read as running', () => {
  /* İki uç aynı gerçeği FARKLI ölçüyle taşır (REST oran, canlı yayın yüzde);
     ikisinin arayüzde karışması ilerlemeyi 100 kat yanlış gösterirdi. */
  const state = normalizeStatusSnapshot({
    simulationId: RUN_A,
    routeId: ROUTE_ID,
    progressRatio: 0.25,
    longitude: 30.5,
    latitude: 40.5,
    capturedAt: '2026-08-31T10:00:30Z',
  })

  assert.equal(state.progressPercent, 25)
  assert.equal(state.status, SIMULATION_STATUS.RUNNING)
  assert.equal(state.updatedAtUtc, '2026-08-31T10:00:30Z')
})

test('unusable payloads are rejected instead of producing NaN state', () => {
  assert.equal(normalizeLiveUpdate(null), null)
  assert.equal(normalizeLiveUpdate({ routeId: ROUTE_ID }), null)
  assert.equal(normalizeLiveUpdate({ simulationId: RUN_A }), null)
  assert.equal(normalizeStatusSnapshot(null), null)

  const clamped = live({ progressPercent: 5000 })
  assert.equal(clamped.progressPercent, 100)
  assert.equal(live({ progressPercent: -20 }).progressPercent, 0)
  assert.equal(live({ progressPercent: 'x' }).progressPercent, 0)
})

test('terminal statuses are recognised and labelled', () => {
  assert.equal(isTerminalSimulationStatus(SIMULATION_STATUS.RUNNING), false)
  assert.equal(isTerminalSimulationStatus(SIMULATION_STATUS.COMPLETED), true)
  assert.equal(isTerminalSimulationStatus(SIMULATION_STATUS.CANCELLED), true)
  assert.equal(simulationStatusLabel(SIMULATION_STATUS.RUNNING), 'Çalışıyor')
  assert.equal(simulationStatusLabel(SIMULATION_STATUS.COMPLETED), 'Tamamlandı')
  assert.equal(simulationStatusLabel(SIMULATION_STATUS.CANCELLED), 'İptal edildi')
})

/* --- Sıralama / eskime güvenliği --------------------------------------------- */

test('a newer event for the same run is applied', () => {
  const current = live({ progressPercent: 10, updatedAtUtc: '2026-08-31T10:00:10Z' })
  const next = live({ progressPercent: 20, updatedAtUtc: '2026-08-31T10:00:20Z' })

  assert.equal(mergeSimulationState(current, next).progressPercent, 20)
})

test('a delayed event cannot rewind the same run', () => {
  const current = live({ progressPercent: 40, updatedAtUtc: '2026-08-31T10:00:40Z' })
  const delayed = live({ progressPercent: 15, updatedAtUtc: '2026-08-31T10:00:15Z' })

  assert.equal(mergeSimulationState(current, delayed).progressPercent, 40)
})

test('progress never regresses for the same run even without a usable timestamp', () => {
  const current = live({ progressPercent: 60, updatedAtUtc: null })
  const regressive = live({ progressPercent: 5, updatedAtUtc: null })

  assert.equal(mergeSimulationState(current, regressive).progressPercent, 60)
})

test('a stale JoinRoute snapshot cannot overwrite newer live state', () => {
  /* Geç katılım cevabı yavaş dönebilir: bu sırada canlı olay ekranı çoktan
     ilerletmiş olur. Eski anlık görüntü uygulanırsa araç geri sıçrardı. */
  const current = live({ progressPercent: 70, updatedAtUtc: '2026-08-31T10:01:10Z' })
  const lateJoinSnapshot = live({ progressPercent: 55, updatedAtUtc: '2026-08-31T10:00:55Z' })

  assert.equal(mergeSimulationState(current, lateJoinSnapshot).progressPercent, 70)
})

test('a different simulationId is a new run and replaces the state', () => {
  const current = live({ simulationId: RUN_A, progressPercent: 90, updatedAtUtc: '2026-08-31T10:01:30Z' })
  const restarted = live({ simulationId: RUN_B, progressPercent: 0, updatedAtUtc: '2026-08-31T10:02:00Z' })

  const merged = mergeSimulationState(current, restarted)

  assert.equal(merged.simulationId, RUN_B)
  assert.equal(merged.progressPercent, 0)
})

test('a delayed event from a previous run does not replace the newer run', () => {
  const current = live({ simulationId: RUN_B, progressPercent: 5, updatedAtUtc: '2026-08-31T10:02:00Z' })
  const leftover = live({ simulationId: RUN_A, progressPercent: 95, updatedAtUtc: '2026-08-31T10:01:50Z' })

  assert.equal(mergeSimulationState(current, leftover).simulationId, RUN_B)
})

test('completion and cancellation end the run when they are not older', () => {
  const current = live({ progressPercent: 80, updatedAtUtc: '2026-08-31T10:01:20Z' })

  const completed = mergeSimulationState(current, live({
    status: SIMULATION_STATUS.COMPLETED, progressPercent: 100, updatedAtUtc: '2026-08-31T10:01:40Z',
  }))
  assert.equal(completed.status, SIMULATION_STATUS.COMPLETED)
  assert.equal(completed.progressPercent, 100)

  const cancelled = mergeSimulationState(current, live({
    status: SIMULATION_STATUS.CANCELLED, progressPercent: 80, updatedAtUtc: '2026-08-31T10:01:25Z',
  }))
  assert.equal(cancelled.status, SIMULATION_STATUS.CANCELLED)

  // Ama gecikmiş bir bitiş olayı daha yeni durumu ezmez.
  const stale = mergeSimulationState(current, live({
    status: SIMULATION_STATUS.COMPLETED, progressPercent: 100, updatedAtUtc: '2026-08-31T10:00:10Z',
  }))
  assert.equal(stale.status, SIMULATION_STATUS.RUNNING)
})

test('an event for another route is ignored', () => {
  const current = live({ progressPercent: 30 })
  const other = live({ routeId: 99, progressPercent: 90 })

  assert.equal(mergeSimulationState(current, other).routeId, ROUTE_ID)
})

test('merging tolerates missing sides', () => {
  const current = live({ progressPercent: 30 })
  assert.equal(mergeSimulationState(current, null), current)
  assert.equal(mergeSimulationState(null, current), current)
  assert.equal(mergeSimulationState(null, null), null)
})

/* --- Denetim görünürlüğü ----------------------------------------------------- */

test('the start button appears only with the effective start permission', () => {
  const withCode = transportSimulationControls({ routeId: ROUTE_ID, canStart: true })
  const withoutCode = transportSimulationControls({ routeId: ROUTE_ID, canStart: false })

  assert.equal(withCode.showStart, true)
  assert.equal(withoutCode.showStart, false)

  // Kod, backend'in kanonik kodudur.
  assert.equal(PERMISSIONS.TRANSPORT_SIMULATION_START, 'transport.simulation.start')
})

test('visibility is decided by the permission code alone, never by role or admin flags', () => {
  /* Rol adı / kullanıcı adı / isAdmin taşıyan bir çağrı bile yetkisiz
     kullanıcıya düğme GÖSTERMEZ: fonksiyon o alanları hiç okumaz. */
  const impersonating = transportSimulationControls({
    routeId: ROUTE_ID,
    canStart: false,
    role: 'Administrator',
    roles: ['Administrator', 'Ulaşım Operatörü'],
    isAdmin: true,
    username: 'admin',
  })

  assert.equal(impersonating.showStart, false)
  assert.equal(impersonating.showFollow, false)
})

test('no route selected means no controls at all', () => {
  const controls = transportSimulationControls({ routeId: null, canStart: true })

  assert.equal(controls.showStart, false)
  assert.equal(controls.showFollow, false)
  assert.equal(controls.showUnfollow, false)
})

test('an active simulation exposes follow and hides start', () => {
  const controls = transportSimulationControls({
    routeId: ROUTE_ID,
    canStart: true,
    simulation: live({ progressPercent: 33.4 }),
  })

  assert.equal(controls.isActive, true)
  assert.equal(controls.showStart, false)
  assert.equal(controls.showFollow, true)
  assert.equal(controls.showUnfollow, false)
  assert.equal(controls.statusLabel, 'Çalışıyor')
  assert.equal(controls.progressLabel, '%33')
  assert.equal(controls.progressPercent, 33.4)
})

test('while following that route only the unfollow control is offered', () => {
  const controls = transportSimulationControls({
    routeId: ROUTE_ID,
    canStart: true,
    simulation: live(),
    followingRouteId: ROUTE_ID,
  })

  assert.equal(controls.isFollowing, true)
  assert.equal(controls.showUnfollow, true)
  assert.equal(controls.showFollow, false)
})

test('following another route does not mark this one as followed', () => {
  const controls = transportSimulationControls({
    routeId: ROUTE_ID,
    canStart: true,
    simulation: live(),
    followingRouteId: 99,
  })

  assert.equal(controls.isFollowing, false)
  assert.equal(controls.showFollow, true)
})

test('a completed run is no longer active and start comes back', () => {
  const controls = transportSimulationControls({
    routeId: ROUTE_ID,
    canStart: true,
    simulation: live({ status: SIMULATION_STATUS.COMPLETED, progressPercent: 100 }),
  })

  assert.equal(controls.isActive, false)
  assert.equal(controls.showFollow, false)
  assert.equal(controls.showStart, true)
  assert.equal(controls.statusLabel, 'Tamamlandı')
})

test('in-flight operations disable the controls without hiding them', () => {
  const starting = transportSimulationControls({ routeId: ROUTE_ID, canStart: true, starting: true })
  assert.equal(starting.showStart, true)
  assert.equal(starting.startDisabled, true)

  const following = transportSimulationControls({
    routeId: ROUTE_ID, canStart: true, simulation: live(), following: true,
  })
  assert.equal(following.showFollow, true)
  assert.equal(following.followDisabled, true)
})
