import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  SIMULATION_STATUS,
  mergeSimulationState,
  normalizeLiveUpdate,
  transportSimulationControls,
} from '../../src/map/transportSimulationState.js'
import { VEHICLE_OWNERSHIP, transportVehiclePresentation } from '../../src/map/transportVehicle.js'
import {
  JOIN_ROUTE_METHOD,
  LEAVE_ROUTE_METHOD,
  createTransportSimulationClient,
} from '../../src/services/transportSimulationClient.js'

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

/**
 * Gerçek istemciyi SAHTE bir bağlantıyla sürer.
 *
 * Grup üyeliği kararı (`JoinRoute`/`LeaveRoute`) istemcinin KENDİ kuralıdır;
 * onu kaynak metinden okumak yerine gerçekten çalıştırmak, "takibi bırakmak
 * gruptan çıkarmaz" iddiasını DAVRANIŞ olarak kanıtlar.
 */
function fakeClient() {
  const calls = []
  const connection = {
    on() {},
    onreconnected() {},
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
    invoke: (method, routeId) => {
      calls.push(`${method}(${routeId})`)
      // JoinRoute canlı anlık görüntü döner; burada gerekmiyor.
      return Promise.resolve(null)
    },
  }

  const client = createTransportSimulationClient({
    createConnection: () => connection,
    onUpdate: () => {},
    onError: () => {},
  })

  return { client, calls }
}

/* --- 1/2/3/4. SEÇİLİ ROTA gözlemin sahibidir --------------------------------- */

test('the selected route owns passive observation and Follow may coexist with it', async () => {
  const { client, calls } = fakeClient()

  // 1. Rota seçilir: PASİF gözlem kurulur, kamera talep edilmez.
  await client.observe(ROUTE_R)
  assert.equal(client.observedRouteId, ROUTE_R)
  assert.equal(client.followingRouteId, null)
  assert.deepEqual(calls, [`${JOIN_ROUTE_METHOD}(${ROUTE_R})`])

  /* 2. Takip Et: İKİ yuva da AYNI rotayı gösterebilir ve fiziksel üyelik
     TEKİLLEŞTİRİLİR — ikinci bir JoinRoute oluşmaz. */
  await client.follow(ROUTE_R)
  assert.equal(client.followingRouteId, ROUTE_R)
  assert.equal(client.observedRouteId, ROUTE_R)
  assert.deepEqual(calls, [`${JOIN_ROUTE_METHOD}(${ROUTE_R})`])
  assert.deepEqual(client.subscribedRouteIds, [ROUTE_R])
})

test('manual Unfollow releases only the camera and never leaves the route group', async () => {
  const { client, calls } = fakeClient()

  await client.observe(ROUTE_R)
  await client.follow(ROUTE_R)
  calls.length = 0

  // 3/4. Takibi Bırak: gözlem yuvası hâlâ rotayı istiyor → ayrılma YOK.
  await client.unfollow()

  assert.equal(client.followingRouteId, null, 'kamera sahipliği bırakılmadı')
  assert.equal(client.observedRouteId, ROUTE_R, 'gözlem yuvası da boşaltılmış')
  assert.deepEqual(client.subscribedRouteIds, [ROUTE_R], 'rota grubundan çıkılmış')
  assert.deepEqual(calls, [], `Takibi Bırak ${LEAVE_ROUTE_METHOD} çağırdı`)
})

test('the hook establishes observation from the SELECTED route, not from Follow', () => {
  /* ASIL KUSUR BUYDU: gözlem yuvası yalnızca kullanıcı simülasyonu KENDİ
     başlattığında ya da terminal devrinde doluyordu. Sıradan bir gözlemci
     için gruba katılmanın tek yolu "Takip Et"ti, dolayısıyla "Takibi Bırak"
     son isteyen yuvayı boşaltıyor ve istemci gruptan çıkıyordu. */
  const effect = HOOK.slice(
    HOOK.indexOf('if (!canView || routeId == null) return'),
    HOOK.length,
  )
  assert.ok(effect.length > 0, 'seçili rota gözlem etkisi bulunamadı')
  assert.ok(effect.includes('observe(routeId)'), 'seçili rota gözlemi kurmuyor')

  // Gözlem takibin YOKLUĞUNA bağlanmaz: iki yuva aynı rotayı gösterebilir.
  assert.ok(!effect.includes('!isFollowing'))
  assert.ok(!effect.includes('followingRouteId !== routeId'))

  // Ve elle bırakma yolunda gözlem yuvasına DOKUNULMAZ.
  const unfollow = HOOK.slice(HOOK.indexOf('const unfollow = useCallback'), HOOK.indexOf('const observe = useCallback'))
  assert.ok(unfollow.includes('clientRef.current.unfollow()'))
  assert.ok(!unfollow.includes('stopObserving'))
})

/* --- 5/6/7. Bırakma sonrası canlı akış SÜRER --------------------------------- */

test('after manual Unfollow a later same-run update is still accepted', () => {
  /* Bağlantı korunduğu için sonraki tick'ler gelir ve birleştirme kuralı
     onları kabul eder: ilerleme İLERLER, donmaz. */
  const at42 = update({ progressPercent: 42, updatedAtUtc: '2026-09-02T10:00:00Z' })
  const at43 = update({ progressPercent: 43, updatedAtUtc: '2026-09-02T10:00:01Z' })
  const at44 = update({ progressPercent: 44, updatedAtUtc: '2026-09-02T10:00:02Z' })

  const merged = mergeSimulationState(mergeSimulationState(at42, at43), at44)
  assert.equal(merged.progressPercent, 44)
  assert.equal(merged.simulationId, RUN_A)
})

test('the vehicle keeps moving after manual Unfollow, only the camera stops', () => {
  const base = {
    followingRouteId: null,      // kamera BIRAKILDI
    observedRouteId: ROUTE_R,    // ama rota HÂLÂ izleniyor
    selectedRouteId: ROUTE_R,
    startedSimulationId: null,
    routes: [{ id: ROUTE_R, name: 'R', colorHex: '#123456' }],
  }

  const first = transportVehiclePresentation({ ...base, simulation: update({ progressPercent: 42, longitude: 30 }) })

  // 6. Araç EKRANDA kalır ve pasif gözlem sahipliğini taşır.
  assert.notEqual(first, null, 'takibi bırakınca araç haritadan silindi')
  assert.equal(first.ownership, VEHICLE_OWNERSHIP.OBSERVE)
  assert.equal(first.isLive, true)

  // 7. Kamera artık onu izlemez.
  assert.equal(first.followCamera, false)

  // Ve sonraki anlık görüntüyle HAREKET etmeye devam eder.
  const later = transportVehiclePresentation({
    ...base,
    simulation: update({ progressPercent: 60, longitude: 31, updatedAtUtc: '2026-09-02T10:00:30Z' }),
  })
  assert.equal(later.progressPercent, 60)
  assert.equal(later.longitude, 31)
  assert.equal(later.followCamera, false)
})

test('passive observation renders only a LIVE run and retires a finished one', () => {
  /* GÖZLEM ÖMRÜ ile ARAÇ ÖMRÜ aynı şey DEĞİLDİR. Rota seçili kaldığı sürece
     abonelik sürer (yerine geçecek B'yi almak için), ama biten bir
     çalıştırmanın aracı sonsuza dek haritada durmamalıdır. */
  const observing = (status) => transportVehiclePresentation({
    simulation: update({ status }),
    followingRouteId: null,       // kamera bırakılmış
    observedRouteId: ROUTE_R,     // rota hâlâ izleniyor
    selectedRouteId: ROUTE_R,
    startedSimulationId: null,
    routes: [{ id: ROUTE_R, name: 'R', colorHex: '#123456' }],
  })

  // CANLI çalıştırmalar çizilir…
  assert.equal(observing(SIMULATION_STATUS.RUNNING).ownership, VEHICLE_OWNERSHIP.OBSERVE)
  // …DURAKLATMA TERMİNAL DEĞİLDİR: donmuş koordinatında görünmeye devam eder.
  assert.equal(observing(SIMULATION_STATUS.PAUSED).ownership, VEHICLE_OWNERSHIP.OBSERVE)

  // …BİTEN çalıştırmalar çizilmez.
  assert.equal(observing(SIMULATION_STATUS.CANCELLED), null)
  assert.equal(observing(SIMULATION_STATUS.COMPLETED), null)
})

test('the START owner keeps its accepted terminal final-position behaviour', () => {
  /* Yeni GÖZLEM kısıtı yalnızca gözlem sahipliğine uygulanır: genel bir
     "terminal ise gizle" kuralı YOKTUR. Çalıştırmayı BAŞLATAN kullanıcının
     son konumu görmesi mevcut ve kabul edilmiş davranıştır. */
  for (const status of [SIMULATION_STATUS.COMPLETED, SIMULATION_STATUS.CANCELLED]) {
    const started = transportVehiclePresentation({
      simulation: update({ status }),
      followingRouteId: null,
      observedRouteId: null,
      selectedRouteId: ROUTE_R,
      startedSimulationId: RUN_A,
      routes: [{ id: ROUTE_R, name: 'R' }],
    })

    assert.notEqual(started, null, `${status} durumunda başlatanın aracı kayboldu`)
    assert.equal(started.ownership, VEHICLE_OWNERSHIP.START)
    assert.equal(started.isTerminal, true)
    assert.equal(started.followCamera, false)
  }
})

test('a replacement run is renderable through observation and inherits no Follow', () => {
  const replacement = transportVehiclePresentation({
    simulation: update({ simulationId: RUN_B, progressPercent: 3 }),
    followingRouteId: null,
    observedRouteId: ROUTE_R,
    selectedRouteId: ROUTE_R,
    startedSimulationId: null,
    routes: [{ id: ROUTE_R, name: 'R' }],
  })

  assert.equal(replacement.simulationId, RUN_B)
  assert.equal(replacement.ownership, VEHICLE_OWNERSHIP.OBSERVE)
  assert.equal(replacement.isLive, true)
  // Takip DEVRALINMAZ: kamera sahipliği yoktur.
  assert.equal(replacement.followCamera, false)
})

test('a passively observed vehicle needs the route to still be selected', () => {
  /* Bakılmayan bir hattın aracını haritada bırakmak yanıltıcı olurdu. */
  assert.equal(
    transportVehiclePresentation({
      simulation: update(),
      followingRouteId: null,
      observedRouteId: ROUTE_R,
      selectedRouteId: ROUTE_S,
      routes: [{ id: ROUTE_R, name: 'R' }],
    }),
    null,
  )
})

/* --- 8/9. Duraklat / Devam Ettir bırakma ile karışmaz ------------------------ */

test('manual Unfollow while Paused keeps observation and Resume needs no re-Follow', async () => {
  const { client, calls } = fakeClient()
  await client.observe(ROUTE_R)
  await client.follow(ROUTE_R)
  calls.length = 0

  // Duraklatılmışken takibi bırakmak da yalnızca kamerayı bırakır.
  await client.unfollow()
  assert.deepEqual(client.subscribedRouteIds, [ROUTE_R])
  assert.deepEqual(calls, [])

  /* İlerleme donuk görünür çünkü SUNUCU duraklattı — bağlantı koptuğu için
     değil. Devam ettirme olayı, takip yeniden açılmadan kabul edilir. */
  const paused = update({ status: SIMULATION_STATUS.PAUSED, progressPercent: 42, updatedAtUtc: '2026-09-02T10:00:05Z' })
  const resumed = update({ status: SIMULATION_STATUS.RUNNING, progressPercent: 42, updatedAtUtc: '2026-09-02T10:00:09Z' })
  const moving = update({ progressPercent: 45, updatedAtUtc: '2026-09-02T10:00:12Z' })

  const afterResume = mergeSimulationState(paused, resumed)
  assert.equal(afterResume.status, SIMULATION_STATUS.RUNNING)
  assert.equal(mergeSimulationState(afterResume, moving).progressPercent, 45)
})

/* --- 10/11/12. Sıfırlama ve yerine geçen çalıştırma --------------------------- */

test('Reset releases Follow but keeps observation, and B arrives without re-Follow', async () => {
  const { client, calls } = fakeClient()
  await client.observe(ROUTE_R)
  await client.follow(ROUTE_R)
  calls.length = 0

  // Terminal devir: önce gözlem, sonra takip bırakılır — gruptan ÇIKILMAZ.
  await client.observe(ROUTE_R)
  await client.unfollow()
  assert.deepEqual(client.subscribedRouteIds, [ROUTE_R])
  assert.deepEqual(calls, [])

  // Yerine geçen B kabul edilir ve takibi DEVRALMAZ.
  const cancelledA = update({ status: SIMULATION_STATUS.CANCELLED, progressPercent: 42 })
  const runningB = update({
    simulationId: RUN_B,
    progressPercent: 0,
    updatedAtUtc: '2026-09-02T10:01:00Z',
  })
  assert.equal(mergeSimulationState(cancelledA, runningB).simulationId, RUN_B)

  const controls = transportSimulationControls({
    routeId: ROUTE_R,
    simulation: runningB,
    followingRouteId: null,
  })
  assert.equal(controls.showFollow, true)
  assert.equal(controls.showUnfollow, false)
})

/* --- 13. Rota değişimi gözlemi TAŞIR ----------------------------------------- */

test('changing the selected route releases the old group and joins the new one', async () => {
  const { client, calls } = fakeClient()

  await client.observe(ROUTE_R)
  calls.length = 0

  await client.observe(ROUTE_S)

  assert.equal(client.observedRouteId, ROUTE_S)
  assert.deepEqual(client.subscribedRouteIds, [ROUTE_S])
  assert.deepEqual(calls, [`${LEAVE_ROUTE_METHOD}(${ROUTE_R})`, `${JOIN_ROUTE_METHOD}(${ROUTE_S})`])
})

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

test('the client only leaves a group when no owner still wants it', async () => {
  /* Devrin gruptan çıkmadan çalışabilmesinin YAPISAL nedeni: istemci
     "başka bir sahip de istiyorsa ayrılma" kuralını uygular.

     İddia artık KAYNAK METİNDEN değil DAVRANIŞTAN okunur: kural hangi satırla
     yazıldığından bağımsız olarak doğru kalmalıdır. */
  const { client, calls } = fakeClient()

  // İKİ sahip (aktif küme + gözlem) AYNI rotayı ister → TEK fiziksel üyelik.
  await client.setActiveLiveRoutes([ROUTE_R])
  await client.observe(ROUTE_R)

  assert.deepEqual(calls, [`${JOIN_ROUTE_METHOD}(${ROUTE_R})`], 'çift üyelik üretildi')
  assert.deepEqual(client.joinedRouteIds, [ROUTE_R])
  assert.deepEqual(client.subscribedRouteIds, [ROUTE_R])

  /* Aktif küme rotayı bırakır (çalıştırma bitti) ama SEÇİLİ GÖZLEM hâlâ
     istiyor → gruptan ÇIKILMAZ. Çıkılsaydı aynı hatta başlayacak yeni
     çalıştırmanın ilk yayını sayfaya hiç ulaşmazdı. */
  calls.length = 0
  await client.setActiveLiveRoutes([])

  assert.deepEqual(calls, [], `sahip varken ${LEAVE_ROUTE_METHOD} çağrıldı`)
  assert.deepEqual(client.joinedRouteIds, [ROUTE_R], 'üyelik sahibi varken düşürüldü')
  assert.deepEqual(client.subscribedRouteIds, [ROUTE_R])

  // SON sahip de bırakınca TAM OLARAK bir kez çıkılır.
  await client.stopObserving()

  assert.deepEqual(calls, [`${LEAVE_ROUTE_METHOD}(${ROUTE_R})`])
  assert.deepEqual(client.joinedRouteIds, [])
  assert.deepEqual(client.subscribedRouteIds, [])

  // Ve ikinci bir bırakma boş bir çağrı üretmez: geçişler idempotenttir.
  calls.length = 0
  await client.stopObserving()
  assert.deepEqual(calls, [])
})

test('logical ownership decides WANT; a separate ledger proves the JOIN', () => {
  /* Bu ayrım GERÇEK bir tarayıcı arızasından doğdu: bir sahibin "R'yi
     istiyorum" İDDİASI, başka bir sahibin katılım KANITI sayılıyordu. Katılım
     başarısız olduğunda (ya da yeniden bağlanmada kaybolduğunda) iddia
     yerinde kalıyor, sonraki her katılım "zaten katıldım" diye atlanıyor ve
     hat sessizce donuyordu — ekranı yalnızca REST yanıtları güncelliyordu. */

  // AYRILMA kararı hâlâ MANTIKSAL sahipliğe bakar: "başka isteyen var mı?"
  assert.ok(CLIENT.includes('if (!isSubscribed(previous)) await leaveQuietly(previous)'))

  // KATILMA kararı ise FİZİKSEL deftere bakar: "gerçekten girdik mi?"
  assert.ok(CLIENT.includes('const joinedRoutes = new Set()'), 'fiziksel üyelik defteri yok')
  assert.match(CLIENT, /if \(joinedRoutes\.has\(target\)\) \{/)
  assert.match(CLIENT, /const alreadyJoined = joinedRoutes\.has\(routeId\)/)

  // Defter ANCAK sunucu onayladıktan SONRA yazılır.
  assert.ok(CLIENT.includes('const joinRouteOnce'), 'katılım ilkeli yok')
  assert.ok(CLIENT.includes('const reconcileMemberships'), 'uzlaştırma yok')
  const joinOnce = CLIENT.slice(
    CLIENT.indexOf('const joinRouteOnce'),
    CLIENT.indexOf('const reconcileMemberships'),
  )
  assert.ok(
    joinOnce.indexOf('await connection.invoke(JOIN_ROUTE_METHOD, routeId)')
      < joinOnce.indexOf('joinedRoutes.add(routeId)'),
    'üyelik, katılım çözülmeden deftere yazılıyor',
  )

  /* GERİLEME KORUMASI: bir İDDİA bir daha katılım kanıtı sayılamaz. */
  assert.ok(!CLIENT.includes('if (isSubscribed(target))'), 'iddia yeniden katılım kanıtı olmuş')
  assert.ok(!CLIENT.includes('const alreadyJoined = isSubscribed(routeId)'))

  /* Yeniden bağlanmada sunucu tüm grupları düşürür: defter ÖNCE sıfırlanır,
     SONRA istenen her rota yeniden kurulur. Ters sıra, artık var olmayan
     üyelikleri doğru sanmak olurdu. */
  const reconnect = CLIENT.slice(
    CLIENT.indexOf('connection.onreconnected'),
    CLIENT.indexOf('if (!startPromise)'),
  )
  assert.ok(
    reconnect.indexOf('joinedRoutes.clear()') < reconnect.indexOf('reconcileMemberships()'),
    'yeniden bağlanmada defter sıfırlanmadan yeniden katılınıyor',
  )
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
