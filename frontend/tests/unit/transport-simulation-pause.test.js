import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { PERMISSIONS } from '../../src/auth/permissionCodes.js'
import {
  SIMULATION_STATUS,
  isPausedSimulationStatus,
  isTerminalSimulationStatus,
  mergeSimulationState,
  normalizeLiveUpdate,
  simulationStatusLabel,
  transportSimulationControls,
} from '../../src/map/transportSimulationState.js'
import { sharedJourneyPresentation } from '../../src/map/journeyWorkspace.js'
import { transportVehiclePresentation } from '../../src/map/transportVehicle.js'

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

/** Yorumlar ayıklanır: bir kavramı ANLATMAK onu uygulamak değildir. */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

const MAP_PAGE = stripComments(read('../../src/pages/MapPage.jsx'))
const ADMIN_PAGE = stripComments(read('../../src/pages/admin/TransportRoutePage.jsx'))
const SHARED = stripComments(read('../../src/components/map/SharedTransportJourneyContent.jsx'))
const CONTROLS = stripComments(read('../../src/components/map/TransportTrackingControls.jsx'))
const HOOK = stripComments(read('../../src/hooks/useTransportSimulation.js'))
const API = stripComments(read('../../src/services/transportApi.js'))
const PANEL = stripComments(read('../../src/components/map/JourneyPlannerPanel.jsx'))

const ROUTE_R = 7
const RUN_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const RUN_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

const update = ({
  simulationId = RUN_A,
  routeId = ROUTE_R,
  status = SIMULATION_STATUS.RUNNING,
  progressPercent = 40,
  updatedAtUtc = '2026-09-02T10:00:00Z',
  longitude = 30,
  latitude = 40,
} = {}) => normalizeLiveUpdate({
  simulationId, routeId, status, progressPercent, updatedAtUtc, longitude, latitude,
})

const controlsFor = (options) => transportSimulationControls({ routeId: ROUTE_R, ...options })

/* --- 1. Paused terminal DEĞİLDİR --------------------------------------------- */

test('Paused is a first-class non-terminal status', () => {
  assert.equal(SIMULATION_STATUS.PAUSED, 'Paused')
  assert.equal(isPausedSimulationStatus(SIMULATION_STATUS.PAUSED), true)

  /* TERMİNAL KÜME BÜYÜMEDİ. Duraklatma terminal sayılsaydı gözlem bırakılır,
     takip düşer ve panel hattı boş sanardı. */
  assert.equal(isTerminalSimulationStatus(SIMULATION_STATUS.PAUSED), false)
  assert.equal(isTerminalSimulationStatus(SIMULATION_STATUS.COMPLETED), true)
  assert.equal(isTerminalSimulationStatus(SIMULATION_STATUS.CANCELLED), true)

  // 28. Kullanıcıya gösterilen ad "Duraklatıldı"dır — "durduruldu" değil.
  assert.equal(simulationStatusLabel(SIMULATION_STATUS.PAUSED), 'Duraklatıldı')
})

/* --- 2/3/4/5/6. Birleştirme kuralı ------------------------------------------- */

test('Running to Paused for the same run is accepted even with identical progress', () => {
  /* Duraklatma aracı OYNATMAZ: aynı yüzdeyle gelir. Sıkı "ilerleme artmalı"
     kuralı bu geçişi sessizce düşürürdü. */
  const running = update({ progressPercent: 40, updatedAtUtc: '2026-09-02T10:00:00Z' })
  const paused = update({
    status: SIMULATION_STATUS.PAUSED,
    progressPercent: 40,
    updatedAtUtc: '2026-09-02T10:00:05Z',
  })

  const merged = mergeSimulationState(running, paused)
  assert.equal(merged.status, SIMULATION_STATUS.PAUSED)
  assert.equal(merged.progressPercent, 40)
  assert.equal(merged.simulationId, RUN_A)
})

test('a newer Resume is accepted while a stale Running can never undo Paused', () => {
  const paused = update({
    status: SIMULATION_STATUS.PAUSED,
    progressPercent: 40,
    updatedAtUtc: '2026-09-02T10:00:05Z',
  })

  // DEVAM ETTİR: sunucu damgayı tazeler, bu yüzden KESİN OLARAK daha yenidir.
  const resumed = update({
    status: SIMULATION_STATUS.RUNNING,
    progressPercent: 40,
    updatedAtUtc: '2026-09-02T10:00:09Z',
  })
  assert.equal(mergeSimulationState(paused, resumed).status, SIMULATION_STATUS.RUNNING)

  /* Yolda kalmış bir tick ise eşit ya da eski damga taşır ve duraklatmayı
     geri ALAMAZ. */
  const sameStamp = update({ progressPercent: 55, updatedAtUtc: '2026-09-02T10:00:05Z' })
  const older = update({ progressPercent: 55, updatedAtUtc: '2026-09-02T10:00:01Z' })
  assert.equal(mergeSimulationState(paused, sameStamp).status, SIMULATION_STATUS.PAUSED)
  assert.equal(mergeSimulationState(paused, older).status, SIMULATION_STATUS.PAUSED)
})

test('terminal locks and replacement-run acceptance are untouched', () => {
  const cancelled = update({ status: SIMULATION_STATUS.CANCELLED, progressPercent: 40 })

  // 5. Terminal → aynı kimlikle Running: HÂLÂ reddedilir.
  assert.equal(
    mergeSimulationState(cancelled, update({ progressPercent: 60, updatedAtUtc: '2026-09-02T10:00:09Z' })).status,
    SIMULATION_STATUS.CANCELLED,
  )

  // 6. Sıfırlamadan sonra YENİ kimlikli B kabul edilir ve %0'dan başlar.
  const runB = update({
    simulationId: RUN_B,
    progressPercent: 0,
    updatedAtUtc: '2026-09-02T10:01:00Z',
  })
  const merged = mergeSimulationState(cancelled, runB)
  assert.equal(merged.simulationId, RUN_B)
  assert.equal(merged.progressPercent, 0)
})

/* --- 7/8/9/10/11. Denetim görünürlüğü ---------------------------------------- */

test('a running run with lifecycle permission offers Duraklat and Sıfırla', () => {
  const controls = controlsFor({ simulation: update(), canStop: true })

  assert.equal(controls.isActive, true)
  assert.equal(controls.isPaused, false)
  assert.equal(controls.showPause, true)
  assert.equal(controls.showResume, false)
  assert.equal(controls.showStop, true)
  assert.equal(controls.stoppableSimulationId, RUN_A)
})

test('a paused run with lifecycle permission offers Devam Ettir and Sıfırla', () => {
  const controls = controlsFor({
    simulation: update({ status: SIMULATION_STATUS.PAUSED }),
    canStop: true,
  })

  // DURAKLATILMIŞ da AKTİFTİR: hat boş değildir.
  assert.equal(controls.isActive, true)
  assert.equal(controls.isPaused, true)
  assert.equal(controls.showResume, true)
  assert.equal(controls.showPause, false)
  assert.equal(controls.showStop, true)

  // Başlatma sunulmaz: hattın yuvası hâlâ dolu.
  assert.equal(controlsFor({
    simulation: update({ status: SIMULATION_STATUS.PAUSED }),
    canStop: true,
    canStart: true,
  }).showStart, false)
})

test('without the lifecycle permission no mutation control is offered at all', () => {
  for (const status of [SIMULATION_STATUS.RUNNING, SIMULATION_STATUS.PAUSED]) {
    const controls = controlsFor({ simulation: update({ status }), canStop: false })

    assert.equal(controls.showPause, false)
    assert.equal(controls.showResume, false)
    assert.equal(controls.showStop, false)
    // Ama gözlem/takip sürer: okuma yeteneği ayrıdır.
    assert.equal(controls.isActive, true)
    assert.equal(controls.showFollow, true)
  }
})

test('start and lifecycle permissions never imply one another', () => {
  // start=true, stop=false → başlatır, mutasyon YAPAMAZ.
  const starter = controlsFor({ simulation: update(), canStart: true, canStop: false })
  assert.equal(starter.showPause, false)
  assert.equal(starter.showResume, false)
  assert.equal(starter.showStop, false)

  // start=false, stop=true → başlatamaz ama duraklat/sürdür/sıfırla YAPAR.
  const paused = controlsFor({
    simulation: update({ status: SIMULATION_STATUS.PAUSED }),
    canStart: false,
    canStop: true,
  })
  assert.equal(paused.showResume, true)
  assert.equal(paused.showStop, true)

  const inactive = controlsFor({ simulation: null, canStart: false, canStop: true })
  assert.equal(inactive.showStart, false)
})

/* --- 12/13/15/16. Komut kimliği ve uçuş-halinde kilidi ----------------------- */

test('pause and resume carry both the route id and the exact simulation id', () => {
  assert.match(API, /export function pauseTransportSimulation\(routeId, simulationId, \{ signal \} = \{\}\)/)
  assert.match(API, /export function resumeTransportSimulation\(routeId, simulationId, \{ signal \} = \{\}\)/)
  assert.ok(API.includes('`/api/transport/simulations/routes/${routeId}/${simulationId}/pause`'))
  assert.ok(API.includes('`/api/transport/simulations/routes/${routeId}/${simulationId}/resume`'))

  // Kanca kimliksiz bir komutu yola ÇIKARMAZ.
  assert.ok(HOOK.includes('if (!targetRouteId || !simulationId || inFlight) return null'))

  // İki yüzey de KANONİK rota + çalıştırma kimliğini geçirir.
  assert.ok(MAP_PAGE.includes('simulation.pause(selectedTransportRouteId, simulationControls.stoppableSimulationId)'))
  assert.ok(MAP_PAGE.includes('simulation.resume(selectedTransportRouteId, simulationControls.stoppableSimulationId)'))
  assert.ok(ADMIN_PAGE.includes('simulation.pause(selectedId, simulationControls.stoppableSimulationId)'))
  assert.ok(ADMIN_PAGE.includes('simulation.resume(selectedId, simulationControls.stoppableSimulationId)'))

  // "Yalnızca rota" biçimi hiçbir yerde yoktur.
  for (const [name, source] of [['MapPage.jsx', MAP_PAGE], ['TransportRoutePage.jsx', ADMIN_PAGE]]) {
    assert.ok(!/simulation\.(pause|resume)\(\s*\w+\s*\)/.test(source), `${name} rota-tek komut kuruyor`)
  }
})

test('double pause and double resume are blocked by the in-flight model', () => {
  assert.ok(HOOK.includes('const [pausing, setPausing] = useState(false)'))
  assert.ok(HOOK.includes('const [resuming, setResuming] = useState(false)'))
  assert.ok(HOOK.includes('inFlight: pausing'))
  assert.ok(HOOK.includes('inFlight: resuming'))

  // Düğme de kilitlenir; iki geçiş tek bayrağı paylaşır.
  assert.equal(controlsFor({ simulation: update(), canStop: true, pausing: true }).pauseDisabled, true)
  assert.equal(
    controlsFor({ simulation: update({ status: SIMULATION_STATUS.PAUSED }), canStop: true, resuming: true }).pauseDisabled,
    true,
  )
  assert.equal(controlsFor({ simulation: update(), canStop: true }).pauseDisabled, false)
})

/* --- 14. Sıfırla yakalanmış-niyet güvenliğini KORUR --------------------------- */

test('reset keeps the captured-intent race safety from the stop phase', () => {
  for (const [name, source] of [['MapPage.jsx', MAP_PAGE], ['TransportRoutePage.jsx', ADMIN_PAGE]]) {
    assert.ok(source.includes('sharedStopIntent({'), `${name} niyet yakalamayı kaybetmiş`)
    assert.ok(source.includes('sharedStopIntentIsCurrent('), `${name} niyet doğrulamasını kaybetmiş`)
    assert.ok(
      source.includes('simulation.stop(intent.routeId, intent.simulationId)'),
      `${name} yakalanmış kimlikleri göndermeyi bırakmış`,
    )
  }

  /* Duraklat/Devam Ettir ONAY GEREKTİRMEZ (yıkıcı değildirler), bu yüzden
     bekleyen niyet kurmazlar. */
  const pause = MAP_PAGE.slice(
    MAP_PAGE.indexOf('const pauseSharedSimulation'),
    MAP_PAGE.indexOf('const followSharedSimulation'),
  )
  assert.ok(!pause.includes('sharedStopIntent('))
  assert.ok(!pause.includes('setPendingSharedStop'))
})

/* --- 17/18/19. Duraklatılmış araç ve ilerleme -------------------------------- */

test('a paused vehicle stays at the authoritative snapshot and never moves locally', () => {
  const paused = update({ status: SIMULATION_STATUS.PAUSED, progressPercent: 40, longitude: 31 })

  const presentation = transportVehiclePresentation({
    simulation: paused,
    followingRouteId: ROUTE_R,
    observedRouteId: ROUTE_R,
    selectedRouteId: ROUTE_R,
    routes: [{ id: ROUTE_R, name: 'R', colorHex: '#123456' }],
  })

  // Araç GÖRÜNÜR kalır ve tam olarak sunucunun bildirdiği yerdedir.
  assert.equal(presentation.longitude, 31)
  assert.equal(presentation.progressPercent, 40)
  assert.equal(presentation.isTerminal, false)
  assert.equal(presentation.statusLabel, 'Duraklatıldı')

  // İlerleme SUNUCUNUN değeridir; istemcide zamanlayıcı ile tahmin edilmez.
  for (const forbidden of ['setInterval', 'setTimeout', 'Date.now()', 'performance.now']) {
    assert.ok(!HOOK.includes(forbidden), `kanca ilerlemeyi yerel olarak tahmin ediyor (${forbidden})`)
  }
})

/* --- 20/21/22. Takip semantiği ------------------------------------------------ */

test('Follow survives Running to Paused to Running for the SAME run', () => {
  /* Duraklatma terminal DEĞİLDİR: kamera sahipliği aynı çalıştırmada kalır ve
     kullanıcıdan yeniden "Takip Et" istenmez. */
  const paused = transportVehiclePresentation({
    simulation: update({ status: SIMULATION_STATUS.PAUSED }),
    followingRouteId: ROUTE_R,
    selectedRouteId: ROUTE_R,
    routes: [{ id: ROUTE_R, name: 'R' }],
  })
  assert.equal(paused.followCamera, true)

  const controls = controlsFor({
    simulation: update({ status: SIMULATION_STATUS.PAUSED }),
    followingRouteId: ROUTE_R,
    canStop: true,
  })
  assert.equal(controls.isFollowing, true)
  assert.equal(controls.showUnfollow, true)
  assert.equal(controls.showFollow, false)

  // Ve kanca duraklatmada takibi BIRAKMAZ: devir yalnızca terminalde olur.
  assert.ok(HOOK.includes('isTerminalSimulationStatus(followed.status)'))
  assert.ok(!HOOK.includes('isPausedSimulationStatus'))
})

test('Reset releases Follow and the replacement run does not inherit it', () => {
  const cancelled = transportVehiclePresentation({
    simulation: update({ status: SIMULATION_STATUS.CANCELLED }),
    followingRouteId: ROUTE_R,
    selectedRouteId: ROUTE_R,
    routes: [{ id: ROUTE_R, name: 'R' }],
  })
  assert.equal(cancelled.followCamera, false)

  // Yeni çalıştırma B, takibi DEVRALMAZ: "Takip Et" yeniden sunulur.
  const fresh = controlsFor({ simulation: update({ simulationId: RUN_B }), followingRouteId: null, canStop: true })
  assert.equal(fresh.showFollow, true)
  assert.equal(fresh.showUnfollow, false)
})

/* --- 23/24/25. Gözlem, yoklama ve tek istemci --------------------------------- */

test('route observation survives every status transition and adds no polling', () => {
  const i = HOOK.indexOf('if (observedRouteId == null) return')
  const effect = HOOK.slice(i, HOOK.indexOf('return {', i))

  // Gözlem SEÇİLİ ROTAYA bağlıdır; duruma DEĞİL.
  assert.ok(effect.includes('if (observedRouteId === routeId) return'))
  assert.ok(!effect.includes('isTerminalSimulationStatus'))
  assert.ok(!effect.includes('isPausedSimulationStatus'))

  for (const forbidden of ['setInterval', 'location.reload', '@microsoft/signalr']) {
    assert.ok(!HOOK.includes(forbidden), `kanca ${forbidden} kullanıyor`)
  }
  assert.equal((HOOK.match(/createTransportSimulationHubClient\(/g) ?? []).length, 1)

  // Yeni bir olay adı ya da kanal AÇILMADI.
  const client = stripComments(read('../../src/services/transportSimulationClient.js'))
  assert.ok(!client.includes('SimulationPaused'))
  assert.ok(!client.includes('SimulationResumed'))
})

/* --- 26/27. İki yüzey AYNI komutları çağırır ---------------------------------- */

test('admin and the journey workspace share the same hook commands', () => {
  for (const [name, source] of [['MapPage.jsx', MAP_PAGE], ['TransportRoutePage.jsx', ADMIN_PAGE]]) {
    assert.equal((source.match(/useTransportSimulation\(/g) ?? []).length, 1, `${name} ikinci kanca kuruyor`)
    // Sayfalar kendi API çağrısını KURMAZ.
    assert.ok(!source.includes('pauseTransportSimulation'), `${name} kendi API çağrısını kuruyor`)
    assert.ok(!source.includes('resumeTransportSimulation'), `${name} kendi API çağrısını kuruyor`)
  }

  // Ortak bileşen ve çalışma alanı bölümü AYNI saf karardan çizer.
  for (const [name, source] of [['SharedTransportJourneyContent.jsx', SHARED], ['TransportTrackingControls.jsx', CONTROLS]]) {
    assert.ok(/showPause/.test(source), `${name} duraklatmayı çizmiyor`)
    assert.ok(/showResume/.test(source), `${name} sürdürmeyi çizmiyor`)
    assert.ok(!source.includes('PERMISSIONS.'), `${name} yetki kararının sahibi olmuş`)
  }

  // Yetenek yine TEK kod üzerinden okunur.
  assert.equal(PERMISSIONS.TRANSPORT_SIMULATION_STOP, 'transport.simulation.stop')
})

/* --- 28/29. Sözcükler ---------------------------------------------------------- */

test('the shared surfaces say Duraklat, Devam Ettir and Sıfırla', () => {
  for (const [name, source] of [['SharedTransportJourneyContent.jsx', SHARED], ['TransportTrackingControls.jsx', CONTROLS]]) {
    assert.ok(source.includes('Duraklat'), `${name} Duraklat demiyor`)
    assert.ok(source.includes('Devam Ettir'), `${name} Devam Ettir demiyor`)
    assert.ok(source.includes('Sıfırla'), `${name} Sıfırla demiyor`)
    /* Terminal eylem artık "Simülasyonu Durdur" DEĞİLDİR: o ad duraklatma ile
       karışıyordu. */
    assert.ok(!source.includes('Simülasyonu Durdur'), `${name} eski terminal sözcüğünü koruyor`)
  }

  // Onay metni ürün anlamını OLDUĞU GİBİ söyler.
  assert.ok(MAP_PAGE.includes('%0\'dan yeni bir simülasyon oluşturulur'))
  assert.ok(ADMIN_PAGE.includes('%0\'dan yeni bir simülasyon oluşturulur'))
  assert.ok(MAP_PAGE.includes('confirmLabel="Sıfırla"'))

  // Durum adı: "Duraklatıldı" — durdurulmuş/iptal DEĞİL.
  const shared = sharedJourneyPresentation({
    routeId: ROUTE_R,
    routes: [{ id: ROUTE_R, name: 'R' }],
    controls: controlsFor({ simulation: update({ status: SIMULATION_STATUS.PAUSED }), canStop: true }),
  })
  assert.equal(shared.statusLabel, 'Duraklatıldı')
  assert.equal(shared.isActive, true)
  assert.equal(shared.isPaused, true)
})

/* --- 30/31/32. Bu fazda OLMAYANLAR ------------------------------------------- */

test('no shared navigation is fabricated and the personal journey is untouched', () => {
  for (const [name, source] of [['SharedTransportJourneyContent.jsx', SHARED], ['TransportTrackingControls.jsx', CONTROLS]]) {
    for (const forbidden of ['journeyNavigationModel', 'journeyStepList', 'currentStepSequence', 'Yol Tarifi']) {
      assert.ok(!source.includes(forbidden), `${name} paylaşılan yönlendirme uyduruyor (${forbidden})`)
    }
  }

  /* KİŞİSEL yolculuk kendi sözcüğünü ve kendi yaşam döngüsünü korur: bu faz
     ona hiç dokunmadı. */
  assert.ok(PANEL.includes('Simülasyonu Durdur'))
  assert.ok(!PANEL.includes('Duraklat'))
  assert.ok(MAP_PAGE.includes('onStopSimulation={requestJourneyStop}'))
  assert.ok(MAP_PAGE.includes('onConfirm={confirmJourneyStop}'))

  const personalHook = stripComments(read('../../src/hooks/useJourneySimulation.js'))
  assert.ok(!personalHook.includes('pause'))
  assert.ok(!personalHook.includes('resume'))
})

test('no role-name shortcut gates the lifecycle', () => {
  const PATTERNS = [
    /\b(currentUser|user|auth|session|account|identity|principal|claims|me)\s*\??\.\s*roles?\b/i,
    /\broles\s*\??\.\s*(includes|some|indexOf|find)\s*\(/i,
    /\brole\w*\s*[=!]==?\s*['"`]\s*(admin|administrator|operat|viewer|editor|superuser|ulaşım)/i,
    /\bis_?admin\b/i,
    /\bis_?operator\b/i,
    /\busername\s*[=!]==?/i,
  ]

  for (const [name, source] of [
    ['transportSimulationState.js', stripComments(read('../../src/map/transportSimulationState.js'))],
    ['SharedTransportJourneyContent.jsx', SHARED],
    ['TransportTrackingControls.jsx', CONTROLS],
    ['useTransportSimulation.js', HOOK],
    ['transportApi.js', API],
  ]) {
    for (const pattern of PATTERNS) {
      assert.ok(!pattern.test(source), `${name} rol/kimlik kestirmesi taşıyor: ${pattern}`)
    }
  }
})
