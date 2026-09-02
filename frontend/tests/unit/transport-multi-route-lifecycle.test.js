import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  SIMULATION_STATUS,
  mergeSimulationState,
  normalizeLiveUpdate,
  normalizeStatusSnapshot,
  transportSimulationControls,
} from '../../src/map/transportSimulationState.js'

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

/** Yorumlar ayıklanır: bir kavramı ANLATMAK onu uygulamak değildir. */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

const HOOK = stripComments(read('../../src/hooks/useTransportSimulation.js'))
const MAP_PAGE = stripComments(read('../../src/pages/MapPage.jsx'))
const STATE = stripComments(read('../../src/map/transportSimulationState.js'))

/* İKİ hat AYNI ANDA çalışır. Renk/ad yalnızca sunumdur; yaşam döngüsünün
   hiçbir kararı onlara bakmaz. */
const ROUTE_G = 3
const ROUTE_R = 7
const RUN_G = 'ggggggg1-0000-0000-0000-000000000001'
const RUN_R = 'rrrrrrr1-0000-0000-0000-000000000001'

const live = ({ routeId, simulationId, status = SIMULATION_STATUS.RUNNING, progressPercent = 20, t = '2026-09-02T10:00:00Z' }) =>
  normalizeLiveUpdate({
    simulationId, routeId, status, progressPercent, updatedAtUtc: t, longitude: 30, latitude: 40,
  })

/** Kancanın rota BAŞINA sözlüğü: gerçek birleştirme kuralıyla yazılır. */
const applyAll = (events) => events.reduce((byRoute, event) => ({
  ...byRoute,
  [event.routeId]: mergeSimulationState(byRoute[event.routeId] ?? null, event),
}), {})

/** Seçili rotanın KANONİK çalıştırmasından denetimleri türetir. */
const controlsForSelected = (byRoute, selectedRouteId, options = {}) =>
  transportSimulationControls({
    routeId: selectedRouteId,
    simulation: byRoute[selectedRouteId] ?? null,
    canStop: true,
    ...options,
  })

/* --- 1/2/3. İki hat bir arada, denetimler SEÇİLİ hattan türer -------------- */

test('two shared routes coexist and each derives its controls from itself alone', () => {
  const byRoute = applyAll([
    live({ routeId: ROUTE_G, simulationId: RUN_G, progressPercent: 55 }),
    live({ routeId: ROUTE_R, simulationId: RUN_R, progressPercent: 12 }),
  ])

  assert.equal(byRoute[ROUTE_G].simulationId, RUN_G)
  assert.equal(byRoute[ROUTE_R].simulationId, RUN_R)

  const g = controlsForSelected(byRoute, ROUTE_G)
  const r = controlsForSelected(byRoute, ROUTE_R)

  assert.equal(g.stoppableSimulationId, RUN_G)
  assert.equal(r.stoppableSimulationId, RUN_R)
  assert.equal(g.progressPercent, 55)
  assert.equal(r.progressPercent, 12)
})

/* --- 4/5/6. G Duraklatıldı + R Çalışıyor ----------------------------------- */

test('a paused route offers Devam Ettir while the other running route offers Duraklat', () => {
  const byRoute = applyAll([
    live({ routeId: ROUTE_G, simulationId: RUN_G, progressPercent: 55 }),
    live({ routeId: ROUTE_R, simulationId: RUN_R, progressPercent: 12 }),
    live({ routeId: ROUTE_G, simulationId: RUN_G, status: SIMULATION_STATUS.PAUSED, progressPercent: 55, t: '2026-09-02T10:00:05Z' }),
  ])

  // Seçili G → DURAKLATILDI + Devam Ettir.
  const g = controlsForSelected(byRoute, ROUTE_G)
  assert.equal(g.isPaused, true)
  assert.equal(g.showResume, true)
  assert.equal(g.showPause, false)
  assert.equal(g.showStop, true)
  assert.equal(g.statusLabel, 'Duraklatıldı')

  // Seçili R → ÇALIŞIYOR + Duraklat. G'nin duraklatılması R'ye BULAŞMAZ.
  const r = controlsForSelected(byRoute, ROUTE_R)
  assert.equal(r.isPaused, false)
  assert.equal(r.showPause, true)
  assert.equal(r.showResume, false)
  assert.equal(r.statusLabel, 'Çalışıyor')
})

test('switching G to R and back restores the paused presentation of G', () => {
  /* ASIL KUSUR BURADAYDI. Rota yeniden seçildiğinde REST okuması devreye
     girer; eski davranışta o okuma durumu UYDURUYOR (koşulsuz `Running`) ve
     ham bir üzerine yazmayla duraklatılmış durumu siliyordu. Panel bu yüzden
     "Devam Ettir" yerine "Duraklat" gösteriyordu. */
  let byRoute = applyAll([
    live({ routeId: ROUTE_G, simulationId: RUN_G, progressPercent: 55 }),
    live({ routeId: ROUTE_G, simulationId: RUN_G, status: SIMULATION_STATUS.PAUSED, progressPercent: 55, t: '2026-09-02T10:00:05Z' }),
    live({ routeId: ROUTE_R, simulationId: RUN_R, progressPercent: 12 }),
  ])

  assert.equal(controlsForSelected(byRoute, ROUTE_R).showPause, true)

  /* G'ye geri dönüş: REST okuması AYNI birleştirme kuralından geçer. Yükün
     zaman damgası duraklatma anıdır (sunucu geçişte damgayı tazeler), yani
     KESİN OLARAK daha yeni değildir — duraklatılmış durum korunur. */
  const restRead = normalizeStatusSnapshot({
    simulationId: RUN_G,
    routeId: ROUTE_G,
    longitude: 30,
    latitude: 40,
    progressRatio: 0.55,
    capturedAt: '2026-09-02T10:00:05Z',
  })
  byRoute = { ...byRoute, [ROUTE_G]: mergeSimulationState(byRoute[ROUTE_G], restRead) }

  const g = controlsForSelected(byRoute, ROUTE_G)
  assert.equal(g.isPaused, true, 'rota yeniden seçilince duraklatılmış durum kayboldu')
  assert.equal(g.showResume, true)
  assert.equal(g.showPause, false)
  assert.equal(g.progressPercent, 55)
})

test('the REST read never fabricates a status and reports the canonical one', () => {
  /* Backend artık okuma yolunda da kanonik durumu taşır. SERT YENİLEME
     SÖZLEŞMESİ: panel, HİÇBİR SignalR olayı gelmeden yalnızca bu yükten
     doğru yaşam döngüsünü çizebilmelidir. */
  const restPaused = normalizeStatusSnapshot({
    simulationId: RUN_G,
    routeId: ROUTE_G,
    status: 'Paused',
    longitude: 30,
    latitude: 40,
    progressRatio: 0.37,
    capturedAt: '2026-09-02T10:00:05Z',
  })

  assert.equal(restPaused.status, SIMULATION_STATUS.PAUSED)
  assert.equal(restPaused.progressPercent, 37)
  assert.equal(restPaused.simulationId, RUN_G)

  /* Ve panel bunu TEK BAŞINA doğru çizer: Duraklatıldı · %37 →
     [ Devam Ettir ] [ Sıfırla ]. */
  const controls = transportSimulationControls({
    routeId: ROUTE_G,
    simulation: restPaused,
    canStop: true,
  })
  assert.equal(controls.statusLabel, 'Duraklatıldı')
  assert.equal(controls.progressPercent, 37)
  assert.equal(controls.showResume, true)
  assert.equal(controls.showPause, false)
  assert.equal(controls.showStop, true)

  // Çalışan hat da doğru bildirilir; her yanıt duraklatılmış sayılmaz.
  assert.equal(
    normalizeStatusSnapshot({
      simulationId: RUN_R, routeId: ROUTE_R, status: 'Running',
      longitude: 30, latitude: 40, progressRatio: 0.12, capturedAt: '2026-09-02T10:00:05Z',
    }).status,
    SIMULATION_STATUS.RUNNING,
  )

  // Durum kodda SABİT yazılmaz.
  assert.ok(!STATE.includes('status: SIMULATION_STATUS.RUNNING,'))
  assert.ok(STATE.includes('status: snapshot.status ?? SIMULATION_STATUS.RUNNING'))

  // Ve REST okuması TEK yazma kuralından geçer; ham üzerine yazma değildir.
  const load = HOOK.slice(HOOK.indexOf('const loadStatus'), HOOK.indexOf('const start = useCallback'))
  assert.ok(load.includes('applyState(snapshot)'), 'REST okuması birleştirme kuralını atlıyor')
  assert.ok(!/setRouteState\(targetRouteId, snapshot\)/.test(load), 'REST okuması hâlâ ham üzerine yazıyor')
})

/* --- 7/8. Başlatma sırası ve BAŞLATAN durumu ------------------------------- */

test('starting a second route never erases the first route paused state', () => {
  let byRoute = applyAll([
    live({ routeId: ROUTE_G, simulationId: RUN_G, progressPercent: 55 }),
    live({ routeId: ROUTE_G, simulationId: RUN_G, status: SIMULATION_STATUS.PAUSED, progressPercent: 55, t: '2026-09-02T10:00:05Z' }),
  ])

  // R sonradan başlatılır: yalnızca R'nin yuvasına yazar.
  byRoute = { ...byRoute, [ROUTE_R]: mergeSimulationState(byRoute[ROUTE_R] ?? null, live({ routeId: ROUTE_R, simulationId: RUN_R, progressPercent: 0, t: '2026-09-02T10:00:30Z' })) }

  assert.equal(byRoute[ROUTE_G].status, SIMULATION_STATUS.PAUSED)
  assert.equal(controlsForSelected(byRoute, ROUTE_G).showResume, true)
  assert.equal(controlsForSelected(byRoute, ROUTE_R).showPause, true)
})

test('lifecycle controls never consult starter ownership, follow, colour or name', () => {
  const byRoute = applyAll([
    live({ routeId: ROUTE_G, simulationId: RUN_G, status: SIMULATION_STATUS.PAUSED, progressPercent: 55 }),
  ])

  /* BAŞLATAN durumu bir SUNUM sahipliğidir (araç işaretçisi), yaşam döngüsü
     otoritesi DEĞİLDİR: denetim fonksiyonu onu hiç almaz. */
  const controls = transportSimulationControls({
    routeId: ROUTE_G,
    simulation: byRoute[ROUTE_G],
    canStop: true,
    followingRouteId: ROUTE_R,   // BAŞKA hattı takip ediyor olabilir
  })
  assert.equal(controls.showResume, true)
  assert.equal(controls.isPaused, true)

  // 13/14. Takip/gözlem sahipliği Devam Ettir görünürlüğünü DEĞİŞTİRMEZ.
  const following = transportSimulationControls({
    routeId: ROUTE_G,
    simulation: byRoute[ROUTE_G],
    canStop: true,
    followingRouteId: ROUTE_G,
  })
  assert.equal(following.showResume, true)

  // 15. Renk/ad denetim fonksiyonuna hiç GİRMEZ.
  const signature = STATE.slice(
    STATE.indexOf('export function transportSimulationControls('),
    STATE.indexOf('const route = finiteNumber(routeId)'),
  )
  for (const forbidden of ['colorHex', 'routeName', 'color', 'startedSimulationId', 'isStartedByCurrentUser']) {
    assert.ok(!signature.includes(forbidden), `denetim kararı ${forbidden} okuyor`)
  }
})

/* --- 9/10/11/12. Komut kimliği ve rotalar arası bulaşma yokluğu ------------ */

test('pause and resume commands carry the SELECTED route identity pair', () => {
  const byRoute = applyAll([
    live({ routeId: ROUTE_G, simulationId: RUN_G, status: SIMULATION_STATUS.PAUSED }),
    live({ routeId: ROUTE_R, simulationId: RUN_R }),
  ])

  // Seçili hattın kanonik çalıştırma kimliği komuta girer.
  assert.equal(controlsForSelected(byRoute, ROUTE_G).stoppableSimulationId, RUN_G)
  assert.equal(controlsForSelected(byRoute, ROUTE_R).stoppableSimulationId, RUN_R)

  // MapPage komutu SEÇİLİ rota + o rotanın kimliğiyle kurar.
  assert.ok(MAP_PAGE.includes('simulation.pause(selectedTransportRouteId, simulationControls.stoppableSimulationId)'))
  assert.ok(MAP_PAGE.includes('simulation.resume(selectedTransportRouteId, simulationControls.stoppableSimulationId)'))
  // Denetimler de seçili rotadan türer; küresel bir "aktif çalıştırma" yoktur.
  assert.ok(MAP_PAGE.includes('routeId: selectedTransportRouteId'))
  assert.ok(MAP_PAGE.includes('simulation: simulation.simulation'))
})

test('a command completing for one route cannot mutate another route state', () => {
  let byRoute = applyAll([
    live({ routeId: ROUTE_G, simulationId: RUN_G, status: SIMULATION_STATUS.PAUSED, progressPercent: 55, t: '2026-09-02T10:00:05Z' }),
    live({ routeId: ROUTE_R, simulationId: RUN_R, progressPercent: 12, t: '2026-09-02T10:00:05Z' }),
  ])

  /* G için verilen bir komutun geç gelen cevabı, R seçiliyken bile YALNIZCA
     G'nin yuvasına yazar: birleştirme rota anahtarlıdır. */
  const staleG = live({ routeId: ROUTE_G, simulationId: RUN_G, progressPercent: 60, t: '2026-09-02T10:00:09Z' })
  byRoute = { ...byRoute, [staleG.routeId]: mergeSimulationState(byRoute[staleG.routeId], staleG) }

  assert.equal(byRoute[ROUTE_R].status, SIMULATION_STATUS.RUNNING)
  assert.equal(byRoute[ROUTE_R].progressPercent, 12)
  assert.equal(byRoute[ROUTE_R].simulationId, RUN_R)

  // Ve başka bir rotanın olayı yanlış yuvaya YAZILAMAZ.
  const crossed = mergeSimulationState(byRoute[ROUTE_R], live({ routeId: ROUTE_G, simulationId: RUN_G, progressPercent: 99 }))
  assert.equal(crossed.simulationId, RUN_R)
  assert.equal(crossed.progressPercent, 12)
})

test('the in-flight lifecycle flags only disable buttons and never change rendered state', () => {
  const byRoute = applyAll([
    live({ routeId: ROUTE_G, simulationId: RUN_G, status: SIMULATION_STATUS.PAUSED }),
  ])

  const busy = controlsForSelected(byRoute, ROUTE_G, { pausing: true, resuming: true })

  // Durum ve hangi düğmenin görüneceği DEĞİŞMEZ; yalnızca kilitlenir.
  assert.equal(busy.isPaused, true)
  assert.equal(busy.showResume, true)
  assert.equal(busy.showPause, false)
  assert.equal(busy.pauseDisabled, true)

  // Ve kancadaki bayraklar durumu değil yalnızca isteği temsil eder.
  assert.ok(HOOK.includes('const [pausing, setPausing] = useState(false)'))
  assert.ok(HOOK.includes('const [resuming, setResuming] = useState(false)'))
  assert.ok(!HOOK.includes('setByRoute') || HOOK.includes('mergeSimulationState'))
})

/* --- Rota BAŞINA durum: küresel tek çalıştırma YOKTUR ---------------------- */

test('the hook keeps simulation state per route, never as one global run', () => {
  assert.ok(HOOK.includes('const [byRoute, setByRoute] = useState({})'))
  assert.match(HOOK, /\[next\.routeId\]: mergeSimulationState\(current\[next\.routeId\] \?\? null, next\)/)
  // Seçili rotanın durumu sözlükten OKUNUR; ayrı bir "aktif" kutusu yoktur.
  assert.ok(HOOK.includes('const simulation = routeId == null ? null : byRoute[routeId] ?? null'))

  for (const forbidden of ['activeSimulation', 'currentSimulation', 'globalSimulation']) {
    assert.ok(!HOOK.includes(forbidden), `kanca küresel bir çalıştırma tutuyor (${forbidden})`)
  }
})
