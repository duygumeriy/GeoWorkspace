import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  SIMULATION_STATUS,
  mergeSimulationState,
  normalizeLiveUpdate,
  transportSimulationControls,
} from '../../src/map/transportSimulationState.js'
import { transportVehiclePresentation } from '../../src/map/transportVehicle.js'

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

/** Yorumlar ayıklanır: bir kavramı ANLATMAK onu uygulamak değildir. */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

const HOOK = stripComments(read('../../src/hooks/useTransportSimulation.js'))
const CLIENT = stripComments(read('../../src/services/transportSimulationClient.js'))

const ROUTE_R = 7
const ROUTE_S = 9
const RUN_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const RUN_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

const update = ({
  simulationId = RUN_A,
  routeId = ROUTE_R,
  status = SIMULATION_STATUS.RUNNING,
  progressPercent = 40,
  updatedAtUtc = '2026-09-01T10:00:00Z',
  longitude = 30,
  latitude = 40,
} = {}) => normalizeLiveUpdate({
  simulationId, routeId, status, progressPercent, updatedAtUtc, longitude, latitude,
})

const controlsFor = (options) => transportSimulationControls({ routeId: ROUTE_R, ...options })

/* --- 8/9/10. Terminal kilidi ÇALIŞTIRMAYA özeldir ----------------------------- */

test('a terminal run can never be revived by a late event of the SAME run', () => {
  /* Terminal anlık görüntü, son Running tick'iyle AYNI zaman damgasını taşır
     (sunucu son bilinen konumu yayınlar). Bu yüzden "daha eski mi" sorusu tek
     başına yetmez: sırası bozulmuş bir Running olayı eşit damgayla gelir ve
     eski kural onu kabul ederdi — bitmiş çalıştırma yeniden yürüyor
     görünürdü. */
  const cancelled = update({ status: SIMULATION_STATUS.CANCELLED, progressPercent: 42 })
  const lateRunningSameStamp = update({ status: SIMULATION_STATUS.RUNNING, progressPercent: 42 })
  const lateRunningNewerStamp = update({
    status: SIMULATION_STATUS.RUNNING,
    progressPercent: 55,
    updatedAtUtc: '2026-09-01T10:00:05Z',
  })

  assert.equal(mergeSimulationState(cancelled, lateRunningSameStamp).status, SIMULATION_STATUS.CANCELLED)
  assert.equal(mergeSimulationState(cancelled, lateRunningNewerStamp).status, SIMULATION_STATUS.CANCELLED)

  // Tamamlanma için de aynı kilit geçerlidir.
  const completed = update({ status: SIMULATION_STATUS.COMPLETED, progressPercent: 100 })
  assert.equal(mergeSimulationState(completed, lateRunningSameStamp).status, SIMULATION_STATUS.COMPLETED)
})

test('a terminal run NEVER blocks a replacement run on the same route', () => {
  /* Kilit ÇALIŞTIRMAYA özeldir. A bittikten sonra AYNI hatta başlayan B, yeni
     bir çalıştırmadır ve kabul EDİLMELİDİR — aksi hâlde kullanıcı B'yi ancak
     sayfayı yenileyerek görürdü. */
  const cancelledA = update({ status: SIMULATION_STATUS.CANCELLED, progressPercent: 42 })
  const runningB = update({
    simulationId: RUN_B,
    status: SIMULATION_STATUS.RUNNING,
    progressPercent: 0,
    updatedAtUtc: '2026-09-01T10:01:00Z',
  })

  const merged = mergeSimulationState(cancelledA, runningB)

  assert.equal(merged.simulationId, RUN_B)
  assert.equal(merged.status, SIMULATION_STATUS.RUNNING)
  // B'nin ilerlemesi A'nınkinden DÜŞÜK olsa bile kabul edilir: yeni çalıştırma.
  assert.equal(merged.progressPercent, 0)

  // Tamamlanmış A'dan sonra da aynıdır.
  const completedA = update({ status: SIMULATION_STATUS.COMPLETED, progressPercent: 100 })
  assert.equal(mergeSimulationState(completedA, runningB).simulationId, RUN_B)
})

/* --- 3/4/12/13. Terminal kamerayı bırakır, B onu DEVRALMAZ -------------------- */

test('an inactive route exposes neither Follow nor Unfollow', () => {
  /* Tarayıcıda görülen hata buydu: "Aktif simülasyon yok" ile "Takibi Bırak"
     aynı anda görünüyordu. Üstelik o düğmeye basmak rotanın grubundan
     çıkmaya ve B'yi hiç almamaya yol açıyordu. */
  for (const status of [SIMULATION_STATUS.CANCELLED, SIMULATION_STATUS.COMPLETED]) {
    const controls = controlsFor({ simulation: update({ status }), followingRouteId: ROUTE_R })

    assert.equal(controls.isActive, false)
    assert.equal(controls.showFollow, false)
    assert.equal(controls.showUnfollow, false, `${status} durumunda Takibi Bırak görünüyor`)
    assert.equal(controls.showStop, false)
  }

  // Hiç çalıştırma yokken de aynıdır.
  const empty = controlsFor({ simulation: null, followingRouteId: ROUTE_R })
  assert.equal(empty.showFollow, false)
  assert.equal(empty.showUnfollow, false)
})

test('a replacement run offers Takip Et and never inherits A follow state', () => {
  /* Kamera sahipliği terminal A ile bırakıldığı için (kanca devreder),
     B geldiğinde `followingRouteId` boştur: kullanıcı B'yi AÇIKÇA takip
     etmelidir. */
  const controls = controlsFor({
    simulation: update({ simulationId: RUN_B, status: SIMULATION_STATUS.RUNNING, progressPercent: 5 }),
    followingRouteId: null,
  })

  assert.equal(controls.isActive, true)
  assert.equal(controls.isFollowing, false)
  assert.equal(controls.showFollow, true)
  assert.equal(controls.showUnfollow, false)
  assert.equal(controls.progressPercent, 5)
})

/* --- 5/11. Araç sunumu -------------------------------------------------------- */

test('releasing follow retires the vehicle of the finished run', () => {
  const terminalA = update({ status: SIMULATION_STATUS.CANCELLED })

  /* Kamera sahipliği bırakıldıktan sonra (takip yuvası boş, çalıştırmayı bu
     oturum başlatmadı) A'nın aracı SUNULMAZ — hayalet işaretçi kalmaz. */
  assert.equal(
    transportVehiclePresentation({
      simulation: terminalA,
      followingRouteId: null,
      observedRouteId: ROUTE_R,
      selectedRouteId: ROUTE_R,
      startedSimulationId: null,
      routes: [{ id: ROUTE_R, name: 'R', colorHex: '#123456' }],
    }),
    null,
  )
})

test('the replacement run gets its own live vehicle once followed', () => {
  const runningB = update({ simulationId: RUN_B, progressPercent: 12 })

  const presentation = transportVehiclePresentation({
    simulation: runningB,
    followingRouteId: ROUTE_R,
    observedRouteId: ROUTE_R,
    selectedRouteId: ROUTE_R,
    routes: [{ id: ROUTE_R, name: 'R', colorHex: '#123456' }],
  })

  assert.equal(presentation.simulationId, RUN_B)
  assert.equal(presentation.isTerminal, false)
  assert.equal(presentation.isLive, true)
  assert.equal(presentation.followCamera, true)
})

/* --- 1/2/6/7. Rota gözlemi terminal durumu AŞAR ------------------------------- */

test('route observation is scoped to the SELECTED ROUTE, not the run lifecycle', () => {
  const effect = HOOK.slice(
    HOOK.indexOf('if (observedRouteId == null) return'),
    HOOK.indexOf('return {', HOOK.indexOf('if (observedRouteId == null) return')),
  )
  assert.ok(effect.length > 0, 'gözlem yaşam döngüsü etkisi bulunamadı')

  /* Grup, seçili rota HÂLÂ aynıysa KORUNUR — çalıştırmanın durumuna
     bakılmaksızın. */
  assert.ok(effect.includes('if (observedRouteId === routeId) return'))

  /* ESKİ KURAL GERİ GELEMEZ: terminal durum artık aboneliği bırakmanın
     gerekçesi DEĞİLDİR. */
  assert.ok(!effect.includes('isTerminalSimulationStatus'), 'gözlem hâlâ terminal duruma bakıyor')
  assert.ok(!effect.includes('finished'), 'gözlem hâlâ bitmiş çalıştırmada bırakılıyor')

  // Ve etkinin bağımlılıkları çalıştırma durumunu HİÇ içermez.
  assert.match(HOOK, /\}, \[observedRouteId, followingRouteId, routeId, stopObserving\]\)/)
})

test('terminal follow is transferred to passive observation, never left', () => {
  const transfer = HOOK.slice(
    HOOK.indexOf('const releasedFollowRef'),
    HOOK.indexOf('if (canView) return'),
  )
  assert.ok(transfer.length > 0, 'takip devri etkisi bulunamadı')

  // Yalnızca TERMİNAL olduğunda devreder.
  assert.ok(transfer.includes('isTerminalSimulationStatus(followed.status)'))

  /* SIRA KRİTİKTİR: önce pasif izleme yuvası rotayı devralır, SONRA takip
     yuvası boşaltılır. Ters sıra gruptan çıkıp yeniden katılmak olur ve o
     pencerede B'nin ilk yayını kaçabilirdi. */
  assert.ok(transfer.indexOf('observe(route)') < transfer.indexOf('unfollow()'))

  // Aynı çalıştırma için ikinci kez devretmez (döngü kurulmaz).
  assert.ok(transfer.includes('releasedFollowRef.current === followed.simulationId'))
})

test('the client only leaves a group when no slot still wants it', () => {
  /* Devrin gruptan çıkmadan çalışabilmesinin YAPISAL nedeni: istemci
     "diğer yuva da istiyorsa ayrılma" kuralını uygular. */
  assert.ok(CLIENT.includes('if (!isSubscribed(previous)) await leaveQuietly(previous)'))
  assert.ok(CLIENT.includes('if (isSubscribed(target))'))
})

/* --- 16/17/18. Gerçek gözlem olayları hâlâ grubu bırakır ---------------------- */

test('changing the selected route still leaves the old group', () => {
  const effect = HOOK.slice(
    HOOK.indexOf('if (observedRouteId == null) return'),
    HOOK.indexOf('return {', HOOK.indexOf('if (observedRouteId == null) return')),
  )
  // R → S: izlenen rota artık seçili değilse abonelik bırakılır.
  assert.ok(effect.includes('stopObserving()'))
  assert.ok(effect.includes('if (observedRouteId === followingRouteId) return'))
  assert.notEqual(ROUTE_R, ROUTE_S)
})

test('losing transport.view and unmounting still tear the channel down', () => {
  assert.match(HOOK, /if \(canView\) return\s*clientRef\.current\?\.dispose\(\)/)
  assert.ok(HOOK.includes('setFollowingRouteId(null)'))
  assert.ok(HOOK.includes('setObservedRouteId(null)'))
  assert.match(HOOK, /useEffect\(\(\) => \(\) => \{\s*clientRef\.current\?\.dispose\(\)/)
})

/* --- 14/15/20. Yenileme, yoklama ve ikinci istemci YOKTUR --------------------- */

test('the fix introduces no polling, no refresh and no second client', () => {
  for (const forbidden of ['setInterval', 'setTimeout', 'location.reload', 'window.location']) {
    assert.ok(!HOOK.includes(forbidden), `kanca yoklama/yenileme kuruyor (${forbidden})`)
  }

  // Tek istemci, tek bağlantı, MEVCUT olay adı.
  assert.equal((HOOK.match(/createTransportSimulationHubClient\(/g) ?? []).length, 1)
  assert.ok(!HOOK.includes('@microsoft/signalr'))
  assert.ok(CLIENT.includes("JOIN_ROUTE_METHOD = 'JoinRoute'"))
  assert.ok(CLIENT.includes("LEAVE_ROUTE_METHOD = 'LeaveRoute'"))
  assert.ok(!CLIENT.includes('SimulationStopped'))
})

/* --- 19. Durdurma yarış korumaları DEĞİŞMEDİ ---------------------------------- */

test('the stop lifecycle identity guards are untouched by this correction', () => {
  const MAP_PAGE = stripComments(read('../../src/pages/MapPage.jsx'))
  const ADMIN_PAGE = stripComments(read('../../src/pages/admin/TransportRoutePage.jsx'))

  for (const [name, source] of [['MapPage.jsx', MAP_PAGE], ['TransportRoutePage.jsx', ADMIN_PAGE]]) {
    assert.ok(source.includes('sharedStopIntent({'), `${name} niyet yakalamayı kaybetmiş`)
    assert.ok(source.includes('sharedStopIntentIsCurrent('), `${name} niyet doğrulamasını kaybetmiş`)
    assert.ok(
      source.includes('simulation.stop(intent.routeId, intent.simulationId)'),
      `${name} yakalanmış kimlikleri göndermeyi bırakmış`,
    )
  }
})
