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
import {
  JOIN_ROUTE_METHOD,
  LEAVE_ROUTE_METHOD,
  SIMULATION_UPDATED_EVENT,
  createTransportSimulationClient,
} from '../../src/services/transportSimulationClient.js'

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

  /* AKTİF KÜME de TÜRETİLİR, ikinci bir depoya kopyalanmaz. Faz 4A'nın aktif
     keşfi kanonik sözlüğün üstünde durur: aynı gerçeğin iki sahibi olsaydı,
     canlı bir terminal olay birini güncelleyip diğerini güncellemeyebilirdi. */
  assert.match(HOOK, /const activeRouteIds = useMemo\(\(\) => activeRouteIdsOf\(byRoute\), \[byRoute\]\)/)
  assert.ok(!/const \[activeRouteIds/.test(HOOK), 'aktif küme ikinci bir depoya kopyalanmış')

  /* YASAK OLAN, TEKİL BİR ÇALIŞTIRMA OTORİTESİDİR — "aktif" SÖZCÜĞÜ DEĞİL.

     Faz 4A meşru ÇOĞUL kavramlar getirdi: `activeSimulations.js` modülü,
     `activeRouteIds`, `fetchActiveTransportSimulations`. Bunlar koleksiyon,
     türetilmiş küme ve API adlarıdır; tek bir çalıştırma kutusu değildir.

     Düz alt dize araması bu ayrımı yapamaz ve YANLIŞ ALARM üretir: eski
     `includes('activeSimulation')` denetimi, kancanın kendi İTHALAT
     YOLUNDAKİ `'../map/activeSimulations.js'` dizesine takılıyordu — yani
     mimari bir kusuru değil, bir dosya adını yakalıyordu.

     Denetim bu yüzden KİMLİK SINIRINA (`\b`) ve TANIMLAMAYA bakar: aranan
     şey, çalıştırma durumunu tutan tekil bir yuva ya da onun yazıcısıdır. */
  for (const forbidden of [
    'activeSimulation',
    'currentSimulation',
    'globalSimulation',
    'selectedSimulation',
  ]) {
    const setter = `set${forbidden[0].toUpperCase()}${forbidden.slice(1)}`
    const singularAuthority = new RegExp(`\\b${forbidden}\\b|\\b${setter}\\b`)

    assert.ok(
      !singularAuthority.test(HOOK),
      `kanca küresel bir çalıştırma tutuyor (${forbidden})`,
    )
  }

  /* Ve kural GERÇEKTEN ayırt ediyor: çoğul/koleksiyon adları serbesttir,
     tekil otorite değildir. Aksi hâlde yukarıdaki döngü "hiçbir şeyi
     yakalamayan" bir denetime dönüşmüş olurdu. */
  assert.ok(!/\bactiveSimulation\b/.test("from '../map/activeSimulations.js'"))
  assert.ok(/\bactiveSimulation\b/.test('const [activeSimulation, setActiveSimulation] = useState(null)'))
})

/* ==============================================================================
   GERÇEK TARAYICI ARIZASI: YENİDEN BAŞLATILAN HAT OPERATÖRDE DONUYORDU
   ==============================================================================

   Kabul sırasında görülen tablo: operatör aynı hattı defalarca Başlat/Sıfırla
   yaptıktan sonra seçili hat kartı "Çalışıyor · %0"da DONUYOR; aynı anda
   sıradan bir izleyici aynı çalıştırmanın ilerlemesini canlı almaya devam
   ediyordu. Duraklat/Devam Ettir ekranı bir kez güncel değere SIÇRATIP yine
   donduruyordu — yani REST yanıtları geliyor, ROTA YAYINI gelmiyordu.

   Kök neden abonelik DEFTERİYDİ: bir sahibin "R'yi istiyorum" İDDİASI, başka
   bir sahibin katılım KANITI sayılıyordu. Katılım başarısız olduğunda (ya da
   yeniden bağlanmada kaybolduğunda) iddia yerinde kalıyor, sonraki her
   katılım "zaten katıldım" diye atlanıyor ve ayrışma ASLA onarılamıyordu.

   Bu yüzden aşağıdaki sahte bağlantı SUNUCUYU modeller: yayın YALNIZCA
   gerçekten katılınmış gruba ulaşır. İstemcinin neye inandığı değil, sunucunun
   ne yaptığı ölçülür. */

/** Grup üyeliğini gerçekten tutan sahte hub. */
function fakeHub() {
  const groups = new Set()
  const handlers = new Map()
  const calls = []
  let joinGate = null

  const connection = {
    groups,
    calls,
    started: 0,
    reconnected: null,
    on(event, handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
    },
    off(event, handler) {
      handlers.set(event, (handlers.get(event) ?? []).filter((item) => item !== handler))
    },
    onreconnected(callback) {
      connection.reconnected = callback
    },
    async start() {
      connection.started += 1
    },
    async stop() {
      groups.clear()
    },
    async invoke(method, ...args) {
      calls.push([method, ...args])

      if (method === JOIN_ROUTE_METHOD) {
        const routeId = args[0]
        if (joinGate && joinGate.routeId === routeId) {
          const gate = joinGate
          joinGate = null
          // Reddedilirse katılım GERÇEKTEN başarısız olur: gruba girilmez.
          await gate.promise
        }
        groups.add(routeId)
        return null
      }

      if (method === LEAVE_ROUTE_METHOD) groups.delete(args[0])
      return null
    },
    /** SIRADAKİ JoinRoute(routeId) çağrısını verilen söze bağlar. */
    gateJoin(routeId, promise) {
      joinGate = { routeId, promise }
    },
    /** SUNUCU yayını: yalnızca gerçekten üye olunan gruba ulaşır. */
    broadcast(payload) {
      if (!groups.has(payload.routeId)) return false
      for (const handler of handlers.get(SIMULATION_UPDATED_EVENT) ?? []) handler(payload)
      return true
    },
  }

  return connection
}

const joinsOf = (connection, routeId) =>
  connection.calls.filter(([method, id]) => method === JOIN_ROUTE_METHOD && id === routeId)

const leavesOf = (connection, routeId) =>
  connection.calls.filter(([method, id]) => method === LEAVE_ROUTE_METHOD && id === routeId)

/** Kanca gibi davranan minimal kanonik yazıcı: TEK birleştirme kuralı. */
function canonicalSink() {
  const sink = {
    byRoute: {},
    apply(payload) {
      const next = normalizeLiveUpdate(payload)
      if (!next) return
      sink.byRoute = {
        ...sink.byRoute,
        [next.routeId]: mergeSimulationState(sink.byRoute[next.routeId] ?? null, next),
      }
    },
  }
  return sink
}

const RUN_A1 = 'aaaa0001-0000-0000-0000-000000000001'
const RUN_B1 = 'bbbb0001-0000-0000-0000-000000000001'
const RUN_C1 = 'cccc0001-0000-0000-0000-000000000001'

test('a route restarted again and again keeps streaming to the operator', async () => {
  const connection = fakeHub()
  const sink = canonicalSink()
  const client = createTransportSimulationClient({
    createConnection: () => connection,
    onUpdate: sink.apply,
    onError: () => {},
  })

  let second = 0
  const tick = (simulationId, progressPercent, status = SIMULATION_STATUS.RUNNING, routeId = ROUTE_R) => {
    second += 1
    return connection.broadcast({
      simulationId,
      routeId,
      status,
      progressPercent,
      longitude: 30,
      latitude: 40,
      updatedAtUtc: new Date(Date.UTC(2026, 8, 2, 10, 0, second)).toISOString(),
    })
  }

  /* 1/2. Operatör R'yi seçmiş; R ve G aktif. Aktif küme her ikisine katılır,
     seçili gözlem R'yi GERÇEK üyelik üzerinden devralır. */
  await client.setActiveLiveRoutes([ROUTE_R, ROUTE_G])
  await client.observe(ROUTE_R)

  assert.deepEqual([...client.joinedRouteIds].sort((a, b) => a - b), [ROUTE_G, ROUTE_R])
  assert.ok(connection.groups.has(ROUTE_R))

  assert.equal(tick(RUN_A1, 20), true)
  assert.equal(sink.byRoute[ROUTE_R].progressPercent, 20)

  /* 3/4/5. A sıfırlanır: aktif küme R'yi bırakır ama SEÇİLİ GÖZLEM hâlâ
     istiyor — gruptan ÇIKILMAZ. Çıkılsaydı yerine geçecek B'nin ilk yayını
     hiç ulaşmazdı. */
  tick(RUN_A1, 40, SIMULATION_STATUS.CANCELLED)
  await client.setActiveLiveRoutes([ROUTE_G])

  assert.ok(client.joinedRouteIds.includes(ROUTE_R), 'gözlem sahibi varken gruptan çıkılmış')
  assert.deepEqual(leavesOf(connection, ROUTE_R), [])
  assert.ok(connection.groups.has(ROUTE_R))

  /* 6/7/8. AYNI hatta YENİ kimlikli B başlar. */
  await client.setActiveLiveRoutes([ROUTE_G, ROUTE_R])
  assert.ok(connection.groups.has(ROUTE_R))

  /* 9/10/11. ARDIŞIK tick'ler uygulanır — tek bir Başlat yanıtı değil,
     SÜREKLİ akış. Arızada tam olarak burası ölüydü. */
  for (const progress of [5, 18, 33]) {
    assert.equal(tick(RUN_B1, progress), true, `B %${progress} yayını ulaşmadı`)
    assert.equal(sink.byRoute[ROUTE_R].simulationId, RUN_B1)
    assert.equal(sink.byRoute[ROUTE_R].progressPercent, progress)
  }

  /* 12/13/14/15. Duraklat → dondur, Devam Ettir → AYNI kimlik, sonra akış
     KESİNTİSİZ sürer. */
  tick(RUN_B1, 33, SIMULATION_STATUS.PAUSED)
  assert.equal(sink.byRoute[ROUTE_R].status, SIMULATION_STATUS.PAUSED)

  tick(RUN_B1, 33, SIMULATION_STATUS.RUNNING)
  assert.equal(sink.byRoute[ROUTE_R].status, SIMULATION_STATUS.RUNNING)
  assert.equal(sink.byRoute[ROUTE_R].simulationId, RUN_B1)

  for (const progress of [41, 55]) {
    assert.equal(tick(RUN_B1, progress), true)
    assert.equal(sink.byRoute[ROUTE_R].progressPercent, progress)
  }

  /* 16. Aynı döngü TEKRAR: B sıfırlanır, C başlar, akış yine sürer. */
  tick(RUN_B1, 55, SIMULATION_STATUS.CANCELLED)
  await client.setActiveLiveRoutes([ROUTE_G])
  await client.setActiveLiveRoutes([ROUTE_G, ROUTE_R])

  for (const progress of [7, 19]) {
    assert.equal(tick(RUN_C1, progress), true, `C %${progress} yayını ulaşmadı`)
    assert.equal(sink.byRoute[ROUTE_R].simulationId, RUN_C1)
    assert.equal(sink.byRoute[ROUTE_R].progressPercent, progress)
  }

  // 17. Eşzamanlı diğer hat hiç etkilenmedi.
  assert.equal(tick(RUN_G, 66, SIMULATION_STATUS.RUNNING, ROUTE_G), true)
  assert.equal(sink.byRoute[ROUTE_G].progressPercent, 66)
  assert.equal(sink.byRoute[ROUTE_R].simulationId, RUN_C1)

  /* 18/20. Tüm bu döngü boyunca R grubuna TEK bir kez katılındı ve TEK bir
     bağlantı kuruldu: onarım, körü körüne yeniden katılmakla değil,
     defterin doğru tutulmasıyla sağlanır. */
  assert.equal(joinsOf(connection, ROUTE_R).length, 1)
  assert.equal(joinsOf(connection, ROUTE_G).length, 1)
  assert.equal(connection.started, 1)
})

test('a claim is never proof of membership: a failed join is retried, not latched', async () => {
  const connection = fakeHub()
  const sink = canonicalSink()
  const client = createTransportSimulationClient({
    createConnection: () => connection,
    onUpdate: sink.apply,
    onError: () => {},
  })

  /* ARIZANIN TAM ANI: aktif kümenin R katılımı UÇUŞTAYKEN seçili rota gözlemi
     de R'yi ister. Eski kural burada "aktif küme zaten istiyor" deyip
     KATILMADAN kendini abone sayıyordu; ardından o katılım başarısız olunca
     geride hiçbir zaman var olmamış bir üyelik iddiası kalıyordu. */
  let rejectJoin
  connection.gateJoin(ROUTE_R, new Promise((resolve, reject) => { rejectJoin = reject }))

  const activeLivePending = client.setActiveLiveRoutes([ROUTE_R])
  await client.observe(ROUTE_R)

  rejectJoin(new Error('katılım reddedildi'))
  await activeLivePending

  /* Gözlem kendi katılımını yapmıştır: defter ile sunucu AYNI şeyi söyler. */
  assert.ok(client.joinedRouteIds.includes(ROUTE_R), 'defter var olmayan bir üyelik iddia ediyor')
  assert.ok(connection.groups.has(ROUTE_R), 'sunucu bu bağlantıyı gruba almamış')

  // Ve yayın GERÇEKTEN ulaşır — arızada ulaşmıyordu.
  assert.equal(
    connection.broadcast({
      simulationId: RUN_B1,
      routeId: ROUTE_R,
      status: SIMULATION_STATUS.RUNNING,
      progressPercent: 12,
      longitude: 30,
      latitude: 40,
      updatedAtUtc: '2026-09-02T10:00:10Z',
    }),
    true,
  )
  assert.equal(sink.byRoute[ROUTE_R].progressPercent, 12)

  /* Sonraki sahiplik geçişi (B başladı) FAZLADAN katılım üretmez: üyelik
     zaten gerçek. Uzlaştırma idempotenttir. */
  const joinsBefore = joinsOf(connection, ROUTE_R).length
  await client.setActiveLiveRoutes([ROUTE_R])
  assert.equal(joinsOf(connection, ROUTE_R).length, joinsBefore)
  assert.equal(connection.started, 1)
})

test('the subscription layer introduces no polling and no second connection', () => {
  const client = stripComments(read('../../src/services/transportSimulationClient.js'))

  for (const forbidden of ['setInterval', 'setTimeout', 'requestAnimationFrame', 'location.reload']) {
    assert.ok(!client.includes(forbidden), `abonelik katmanı yoklama taşıyor: ${forbidden}`)
  }

  // Bağlantı TEK bir yerde kurulur ve yeniden kullanılır.
  assert.equal((client.match(/createConnection\(\)/g) ?? []).length, 1)
  assert.match(client, /if \(!connection\) \{/)
})
