import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { PERMISSIONS } from '../../src/auth/permissionCodes.js'
import {
  sharedStopIntent,
  sharedStopIntentIsCurrent,
  transportSimulationControls,
} from '../../src/map/transportSimulationState.js'
import { sharedJourneyPresentation } from '../../src/map/journeyWorkspace.js'

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

const ROUTE_ID = 7
const RUN_ID = '11111111-1111-1111-1111-111111111111'

const running = (overrides = {}) => ({
  simulationId: RUN_ID,
  routeId: ROUTE_ID,
  status: 'Running',
  longitude: 30,
  latitude: 40,
  progressPercent: 40,
  updatedAtUtc: '2026-09-01T10:00:00Z',
  ...overrides,
})

const controlsFor = (options) => transportSimulationControls({ routeId: ROUTE_ID, ...options })

/**
 * Bir sayfanın kanonik durdurma yetkisini HANGİ ADA okuduğunu bulur.
 *
 * <b>Neden desen, sabit metin değil.</b> Okuma bir yerel değişkene alınabilir,
 * satır sarabilir ya da adı değişebilir; ölçülen şey SÖZDİZİMİ değil,
 * "sayfa yeteneği etkin yetki kodundan türetiyor ve tek bir ada bağlıyor"
 * OLGUSUDUR. Ad bulunduktan sonra o adın nerelerde tüketildiği sınanır.
 */
const capabilityNameFor = (source) => {
  const match = source.match(
    /const\s+([A-Za-z0-9_]+)\s*=\s*can\(\s*PERMISSIONS\.TRANSPORT_SIMULATION_STOP\s*\)/,
  )
  assert.ok(match, 'durdurma yeteneği etkin yetki kodundan türetilmiyor')
  return match[1]
}

/**
 * Bekleyen durdurma durumunun ADINI bulur ve KİMLİK TAŞIDIĞINI kanıtlar.
 *
 * <b>Bayrak modeli geri gelemez.</b> Bekleyen durum yalnızca "onay açık mı"
 * bilgisini tutsaydı, onay anında o anki kimlik okunur ve kullanıcının A için
 * verdiği karar sessizce B'yi durdururdu (sunucu bunu yakalayamaz: kendisine
 * B için geçerli ve yetkili bir istek ulaşır). Bu yüzden ölçülen şey
 * SÖZDİZİMİ değil MODELDİR: durum `null` ile başlar, bir NİYET ile dolar ve
 * `null` ile temizlenir — asla `true`/`false` almaz.
 */
const pendingStopStateFor = (source, label) => {
  /* Durum, YAKALANMIŞ NİYETİN yazıldığı yerden bulunur — adından değil.
     Sayfalarda başka `pending*` durumlar da vardır (çizim silme, POI silme…);
     ada göre aramak yanlış durumu ölçerdi. Bizi ilgilendiren tek şey
     "niyetin yazıldığı" durumdur. */
  const setterMatch = source.match(/(set[A-Za-z0-9_]+)\(\s*intent\s*\)/)
  assert.ok(setterMatch, `${label} bekleyen duruma yakalanmış niyeti yazmıyor`)

  const setterName = setterMatch[1]
  const declaration = source.match(
    new RegExp(`const \\[([A-Za-z0-9_]+)\\s*,\\s*${setterName}\\]\\s*=\\s*useState\\(null\\)`),
  )
  assert.ok(declaration, `${label} kimlik taşıyan bekleyen durdurma durumu tutmuyor`)

  const stateName = declaration[1]

  // Temizleme YALNIZCA null ile olur.
  assert.ok(
    new RegExp(`${setterName}\\(\\s*null\\s*\\)`).test(source),
    `${label} bekleyen durumu null ile temizlemiyor`,
  )

  // BAYRAK REGRESYONU: boolean bir bekleyen durum asla kabul edilmez.
  assert.ok(
    !new RegExp(`${setterName}\\(\\s*(true|false)\\s*\\)`).test(source),
    `${label} bekleyen durumu bayrağa döndürmüş`,
  )

  return { stateName, setterName }
}

/* --- 1. Kanonik yetki kodu ---------------------------------------------------- */

test('the feature consumes the canonical shared stop permission code', () => {
  assert.equal(PERMISSIONS.TRANSPORT_SIMULATION_STOP, 'transport.simulation.stop')

  /* İki yüzey de AYNI kodu okur ve her biri onu TEK bir yetenek adına
     bağlar; ikinci bir durdurma yetkisi uydurulmadı. */
  const mapCapability = capabilityNameFor(MAP_PAGE)
  const adminCapability = capabilityNameFor(ADMIN_PAGE)

  /* Kod HER SAYFADA yalnızca BİR kez okunur: iki ayrı okuma, zamanla
     birbirinden sapabilen iki kural kitabı demekti. */
  const reads = (source) =>
    (source.match(/can\(\s*PERMISSIONS\.TRANSPORT_SIMULATION_STOP\s*\)/g) ?? []).length
  assert.equal(reads(MAP_PAGE), 1)
  assert.equal(reads(ADMIN_PAGE), 1)

  // Ve o ad GÖRÜNÜRLÜK kuralına `canStop` olarak verilir.
  assert.ok(new RegExp(`canStop:\\s*${mapCapability}\\b`).test(MAP_PAGE))
  assert.ok(new RegExp(`canStop:\\s*${adminCapability}\\b`).test(ADMIN_PAGE))

  /* BAŞLATMA ayrı kalır: durdurma yeteneği başlatma kodundan türetilmez. */
  assert.ok(!new RegExp(`${mapCapability}[^\\n]*TRANSPORT_SIMULATION_START`).test(MAP_PAGE))
  assert.ok(MAP_PAGE.includes('canStart: can(PERMISSIONS.TRANSPORT_SIMULATION_START)'))

  /* Karar SAYFADA verilir; çizen, kural üreten ve gönderen katmanlar yetki
     kodunu HİÇ okumaz — yoksa arayüzde ikinci bir yetkilendirme sahibi
     doğardı. */
  for (const [name, source] of [
    ['SharedTransportJourneyContent.jsx', SHARED],
    ['TransportTrackingControls.jsx', CONTROLS],
    ['JourneyPlannerPanel.jsx', PANEL],
    ['transportSimulationState.js', stripComments(read('../../src/map/transportSimulationState.js'))],
    ['transportApi.js', API],
    ['useTransportSimulation.js', HOOK],
  ]) {
    assert.ok(!source.includes('TRANSPORT_SIMULATION_STOP'), `${name} yetki kararının sahibi olmuş`)
    assert.ok(!source.includes('PERMISSIONS.'), `${name} yetki kodu okuyor`)
  }
})

/* --- 2/3/4. Durdurma düğmesinin görünürlüğü ----------------------------------- */

test('an inactive route never offers stop', () => {
  const inactive = controlsFor({ simulation: null, canStop: true })

  assert.equal(inactive.isActive, false)
  assert.equal(inactive.showStop, false)
  assert.equal(inactive.stoppableSimulationId, null)

  // Biten bir çalıştırma da aktif DEĞİLDİR.
  for (const status of ['Completed', 'Cancelled']) {
    const terminal = controlsFor({ simulation: running({ status }), canStop: true })
    assert.equal(terminal.showStop, false, `${status} durumunda durdurma sunuluyor`)
    assert.equal(terminal.stoppableSimulationId, null)
  }
})

test('an active route without the stop permission never offers stop', () => {
  const controls = controlsFor({ simulation: running(), canStop: false })

  assert.equal(controls.isActive, true)
  assert.equal(controls.showStop, false)
})

test('an active route with the stop permission offers stop', () => {
  const controls = controlsFor({ simulation: running(), canStop: true })

  assert.equal(controls.showStop, true)
  assert.equal(controls.stoppableSimulationId, RUN_ID)
})

/* --- 5/6. İki yetki birbirini İMA ETMEZ --------------------------------------- */

test('start permission alone can start but can never stop', () => {
  const inactive = controlsFor({ simulation: null, canStart: true, canStop: false })
  assert.equal(inactive.showStart, true)
  assert.equal(inactive.showStop, false)

  const active = controlsFor({ simulation: running(), canStart: true, canStop: false })
  assert.equal(active.showStart, false)
  assert.equal(active.showStop, false)
})

test('stop permission alone can stop an active run but can never start', () => {
  const inactive = controlsFor({ simulation: null, canStart: false, canStop: true })
  assert.equal(inactive.showStart, false)
  assert.equal(inactive.showStop, false)

  const active = controlsFor({ simulation: running(), canStart: false, canStop: true })
  assert.equal(active.showStop, true)
  assert.equal(active.showStart, false)
})

/* --- 7/8. Komut İKİ kimlik taşır ---------------------------------------------- */

test('the stop request carries both the route id and the exact simulation id', () => {
  /* İstemci fonksiyonu iki kimliği de yola koyar; rota tek başına gönderilen
     bir durdurma yolu YOKTUR. */
  assert.match(
    API,
    /export function stopTransportSimulation\(routeId, simulationId, \{ signal \} = \{\}\)/,
  )
  assert.ok(API.includes('`/api/transport/simulations/routes/${routeId}/${simulationId}/stop`'))
  assert.ok(API.includes("method: 'POST'"))

  /* İki yüzey de aynı fonksiyonu aynı İKİ kimlikle çağırır. Kimlik komut
     anında yerel bir değişkene okunur (fail-closed kapısı onu orada
     denetler), ama çağrı hâlâ rota + çalıştırma çiftini taşır. */
  for (const [name, source] of [['MapPage.jsx', MAP_PAGE], ['TransportRoutePage.jsx', ADMIN_PAGE]]) {
    assert.ok(
      source.includes('simulation.stop(intent.routeId, intent.simulationId)'),
      `${name} komutu yakalanmış kimliklerle göndermiyor`,
    )
    // Ve niyet, TETİKLEME anında kanonik seçim + kanonik çalıştırmadan kurulur.
    assert.match(source, /sharedStopIntent\(\{[^}]*routeId:[^}]*simulationId:[^}]*\}\)/s)
    assert.ok(source.includes('simulationControls.stoppableSimulationId'))
  }
})

test('a stale UI cannot issue a route-only stop', () => {
  /* Kimlik bir GÖRÜNÜRLÜK koşuludur: bilinmiyorsa düğme hiç çıkmaz. Böylece
     "rotada ne çalışıyorsa durdur" isteği kurulamaz. */
  const withoutId = controlsFor({ simulation: running({ simulationId: null }), canStop: true })
  assert.equal(withoutId.showStop, false)
  assert.equal(withoutId.stoppableSimulationId, null)

  // Kanca da kimliksiz bir isteği yola çıkarmaz.
  assert.match(HOOK, /if \(!targetRouteId \|\| !simulationId \|\| stopping\) return null/)

  // Ve hiçbir yerde yalnızca rota taşıyan bir durdurma çağrısı yoktur.
  assert.ok(!/stopTransportSimulation\(\s*\w+\s*\)/.test(HOOK))
  assert.ok(!/simulation\.stop\(\s*\w+\s*\)/.test(MAP_PAGE))
  assert.ok(!/simulation\.stop\(\s*\w+\s*\)/.test(ADMIN_PAGE))
})

/* --- 9/10/11/12. Onay akışı --------------------------------------------------- */

test('the first click only opens confirmation and sends nothing', () => {
  // Panel düğmesi yalnızca haber verir.
  assert.ok(SHARED.includes('onClick={onStop}'))
  assert.ok(!SHARED.includes('stopTransportSimulation'))
  assert.ok(!SHARED.includes('simulation.stop('))

  /* MapPage o haberi ONAYA çevirir: kimliği YAKALAR, istek göndermez. */
  assert.ok(MAP_PAGE.includes('onStopShared={requestSharedStop}'))

  const mapPending = pendingStopStateFor(MAP_PAGE, 'MapPage.jsx')
  const mapCapability = capabilityNameFor(MAP_PAGE)

  const request = MAP_PAGE.slice(
    MAP_PAGE.indexOf('const requestSharedStop'),
    MAP_PAGE.indexOf('const confirmSharedStop'),
  )

  // Yetenek kapısı, kimlik yakalama, boş niyette reddetme, komut YOK.
  assert.ok(new RegExp(`if \\(!${mapCapability}\\)`).test(request), 'tetikleyici yeteneği denetlemiyor')
  assert.match(request, /sharedStopIntent\(\{[^}]*routeId:[^}]*simulationId:[^}]*\}\)/s)
  assert.ok(request.includes('if (!intent) return'), 'eksik kimlikte niyet reddedilmiyor')
  assert.ok(new RegExp(`${mapPending.setterName}\\(intent\\)`).test(request))
  assert.ok(!request.includes('simulation.stop('), 'ilk tıklama komut gönderiyor')

  /* Yönetim ekranı da aynı ayrımı korur ve tetikleyici KENDİ kapısını
     taşır: görünürlük bir denetim değildir. */
  const adminCapability = capabilityNameFor(ADMIN_PAGE)
  const adminPending = pendingStopStateFor(ADMIN_PAGE, 'TransportRoutePage.jsx')
  const trigger = ADMIN_PAGE.slice(ADMIN_PAGE.indexOf('onStop={'), ADMIN_PAGE.indexOf('onFollow={'))

  assert.ok(trigger.length > 0, 'yönetim ekranı durdurma tetikleyicisi bulunamadı')
  assert.ok(new RegExp(`\\b${adminCapability}\\b`).test(trigger), 'tetikleyici yeteneği denetlemiyor')
  assert.match(trigger, /sharedStopIntent\(\{[^}]*routeId:[^}]*simulationId:[^}]*\}\)/s)
  assert.ok(new RegExp(`${adminPending.setterName}\\(intent\\)`).test(trigger))
  // İlk tıklama YALNIZCA onayı açar; komut göndermez.
  assert.ok(!trigger.includes('simulation.stop('))

  /* ESKİ BAYRAK ADLARI TAMAMEN GİTMİŞTİR: bir regresyon onları geri
     getirirse burada düşer. */
  for (const [name, source] of [['MapPage.jsx', MAP_PAGE], ['TransportRoutePage.jsx', ADMIN_PAGE]]) {
    assert.ok(!source.includes('setSharedStopPending'), `${name} boolean bekleyen duruma dönmüş`)
    assert.ok(!source.includes('setSimulationStopPending'), `${name} boolean bekleyen duruma dönmüş`)
  }
})

test('cancelling the confirmation sends no request', () => {
  const dialog = MAP_PAGE.slice(
    MAP_PAGE.indexOf('open={pendingSharedStop'),
    MAP_PAGE.indexOf('open={journeyStopPending}'),
  )
  assert.ok(dialog.length > 0, 'paylaşılan durdurma onayı bulunamadı')

  /* Vazgeçmek bekleyen NİYETİ temizler — bir bayrağı `false` yapmaz. */
  const mapPending = pendingStopStateFor(MAP_PAGE, 'MapPage.jsx')
  assert.ok(new RegExp(`onCancel=\\{\\(\\) => ${mapPending.setterName}\\(null\\)\\}`).test(dialog))
  assert.ok(!/onCancel=\{\(\) => set\w+\((true|false)\)\}/.test(dialog), 'bayrak modeli geri gelmiş')

  // Kutu, bekleyen niyet VARLIĞINDAN açılır; ayrı bir boolean yoktur.
  assert.ok(new RegExp(`open=\\{${mapPending.stateName}`).test(dialog))

  /* Vazgeçmek kişisel ürüne dokunmaz ve çalışma alanını kapatmaz. */
  for (const forbidden of ['journeySimulation', 'closeJourneyPanel', 'closePanel', 'setProduct']) {
    assert.ok(!dialog.includes(forbidden), `vazgeçme ${forbidden} çağırıyor`)
  }
  /* Çağrı BİÇİMİ aranır (`simulation.stop(`), çıplak ad değil: diyalog
     meşru biçimde `simulation.stopping` bayrağını okur ve alt dize eşleşmesi
     onu yanlışlıkla bir komut sanardı. */
  assert.ok(!dialog.includes('simulation.stop('))
  assert.ok(dialog.includes('busy={simulation.stopping}'))
  assert.ok(dialog.includes('onConfirm={confirmSharedStop}'))
})

test('confirming sends exactly one command and an in-flight guard blocks duplicates', () => {
  const confirm = MAP_PAGE.slice(
    MAP_PAGE.indexOf('const confirmSharedStop'),
    MAP_PAGE.indexOf('const followSharedSimulation'),
  )

  // TEK çağrı.
  assert.equal((confirm.match(/simulation\.stop\(/g) ?? []).length, 1)

  /* Çift gönderim koruması ref ile yapılır: state güncellemesini beklemek,
     hızlı iki tıklamada ikinci isteğin yola çıkmasına izin verirdi. */
  assert.ok(confirm.includes('if (sharedStopInFlight.current) return'))
  assert.ok(confirm.includes('sharedStopInFlight.current = true'))
  assert.ok(confirm.includes('sharedStopInFlight.current = false'))

  // Kanca da kendi uçuş-halinde bayrağını taşır ve düğme onunla kapanır.
  assert.ok(HOOK.includes('setStopping(true)'))
  assert.ok(HOOK.includes('setStopping(false)'))
  assert.equal(controlsFor({ simulation: running(), canStop: true, stopping: true }).stopDisabled, true)
  assert.equal(controlsFor({ simulation: running(), canStop: true, stopping: false }).stopDisabled, false)
})

/* --- 13/14/15. Durdurmanın YAPMADIKLARI --------------------------------------- */

test('a successful stop does not close the workspace or drop the selected route', () => {
  const confirm = MAP_PAGE.slice(
    MAP_PAGE.indexOf('const confirmSharedStop'),
    MAP_PAGE.indexOf('const followSharedSimulation'),
  )

  for (const forbidden of ['closeJourneyPanel', 'closePanel', 'setSelectedTransportRouteId', 'setProduct']) {
    assert.ok(!confirm.includes(forbidden), `durdurma ${forbidden} çağırıyor`)
  }
})

test('shared stop never calls the personal journey stop', () => {
  const confirm = MAP_PAGE.slice(
    MAP_PAGE.indexOf('const confirmSharedStop'),
    MAP_PAGE.indexOf('const followSharedSimulation'),
  )

  /* İKİ ÜRÜN, İKİ YAŞAM DÖNGÜSÜ. Paylaşılan durdurma kişisel yolculuğa
     dokunmaz ve kişisel onay durumunu kullanmaz. */
  for (const forbidden of ['journeySimulation', 'journeyStopPending', 'confirmJourneyStop', 'stopJourneySimulation']) {
    assert.ok(!confirm.includes(forbidden), `paylaşılan durdurma kişisel ürüne dokunuyor (${forbidden})`)
  }

  // Ve kişisel akış hâlâ kendi ayrı onayını ve kendi eylemini kullanır.
  assert.ok(MAP_PAGE.includes('onConfirm={confirmJourneyStop}'))
  assert.ok(MAP_PAGE.includes('onStopSimulation={requestJourneyStop}'))
})

test('the client never fabricates terminal state before the server confirms', () => {
  const stop = HOOK.slice(HOOK.indexOf('const stop = useCallback'), HOOK.indexOf('const follow = useCallback'))
  assert.ok(stop.length > 0, 'durdurma kancası bulunamadı')

  /* Ekran YALNIZCA sunucunun döndürdüğü otoriter terminal güncellemeyle
     değişir; yerel bir "Cancelled" yazılmaz. */
  assert.ok(stop.includes('normalizeLiveUpdate(await response.json())'))
  assert.ok(stop.includes('applyState(terminal)'))
  assert.ok(!stop.includes("'Cancelled'"))
  assert.ok(!stop.includes('SIMULATION_STATUS.CANCELLED'))
  assert.ok(!stop.includes('setRouteState'))

  // Başarısız yanıt hiçbir durum yazmaz.
  assert.ok(stop.includes('throw new Error(await readApiError(response'))
})

/* --- 16. Terminal durum kamerayı MEVCUT yaşam döngüsüyle bırakır -------------- */

test('terminal shared state releases the camera through the existing lifecycle', () => {
  const vehicle = stripComments(read('../../src/map/transportVehicle.js'))

  /* Durdurma kamerayı ELLE bırakmaz: terminal durumu gören mevcut kural
     zaten bırakır. Basmak "önce Takibi Bırak"a eşit DEĞİLDİR. */
  assert.ok(vehicle.includes('followCamera: ownership === VEHICLE_OWNERSHIP.FOLLOW && !terminal'))

  const stop = HOOK.slice(HOOK.indexOf('const stop = useCallback'), HOOK.indexOf('const follow = useCallback'))
  assert.ok(!stop.includes('unfollow'))
  assert.ok(!stop.includes('setFollowingRouteId'))

  const confirm = MAP_PAGE.slice(
    MAP_PAGE.indexOf('const confirmSharedStop'),
    MAP_PAGE.indexOf('const followSharedSimulation'),
  )
  assert.ok(!confirm.includes('unfollow'))
})

/* --- 17. Yönetim ekranı AYNI komutu çağırır ----------------------------------- */

test('the admin surface calls the same shared stop client command', () => {
  const adminCapability = capabilityNameFor(ADMIN_PAGE)

  /* İKİNCİ bir durdurma yolu YOKTUR: aynı kanca, aynı istemci fonksiyonu.
     Yönetim ekranı ne kendi API çağrısını kurar ne de kendi ucunu bilir. */
  assert.ok(ADMIN_PAGE.includes('useTransportSimulation('))
  assert.equal((ADMIN_PAGE.match(/useTransportSimulation\(/g) ?? []).length, 1)
  assert.ok(!ADMIN_PAGE.includes('stopTransportSimulation'))
  assert.ok(!ADMIN_PAGE.includes('/stop'))

  /* Komut TAM OLARAK bir kez ve İKİ kimlikle çağrılır. Değişken ADLARI
     serbesttir (yerel bir değişkene alınmış olabilir); ölçülen şey iki
     bağımsız argümanın geçirilmesi ve "yalnızca rota" biçiminin hiç
     bulunmamasıdır. */
  const calls = ADMIN_PAGE.match(/simulation\.stop\(([^)]*)\)/g) ?? []
  assert.equal(calls.length, 1, 'yönetim ekranında tam olarak bir durdurma çağrısı olmalı')

  const args = calls[0]
    .replace(/^simulation\.stop\(/, '')
    .replace(/\)$/, '')
    .split(',')
    .map((argument) => argument.trim())
    .filter(Boolean)
  assert.equal(args.length, 2, 'durdurma komutu rota + çalıştırma kimliğini birlikte taşımalı')

  /* HER İKİ kimlik de YAKALANMIŞ niyetten gelir — onay anındaki CANLI
     durumdan değil. Bu, fazın çekirdek güvenlik kuralıdır: kullanıcı A için
     karar verdi; onay beklerken A bitip B başlasa bile komut hâlâ A'yı
     taşımalı ve o mismatch komutu iptal etmelidir. Canlı bir kimliği buraya
     koymak, kararı sessizce B'ye kaydırırdı. */
  assert.equal(args[0], 'intent.routeId', 'komut yakalanmış rotayı taşımıyor')
  assert.equal(args[1], 'intent.simulationId', 'komut yakalanmış çalıştırmayı taşımıyor')

  /* NEGATİF: canlı/güncel kimlikler komuta İKAME EDİLMEZ. Aşağıdaki
     biçimlerin hiçbiri bulunmamalıdır. */
  for (const substitution of [
    /simulation\.stop\(\s*selectedId/,
    /simulation\.stop\(\s*selectedRoute/,
    /simulation\.stop\(\s*selectedTransportRouteId/,
    /simulation\.stop\([^)]*simulationControls\.stoppableSimulationId/,
    /simulation\.stop\([^)]*\bstoppableSimulationId\s*\)/,
  ]) {
    for (const [name, source] of [['MapPage.jsx', MAP_PAGE], ['TransportRoutePage.jsx', ADMIN_PAGE]]) {
      assert.ok(!substitution.test(source), `${name} komuta canlı kimlik ikame ediyor: ${substitution}`)
    }
  }

  /* Canlı seçim/kimlik YALNIZCA niyetin HÂLÂ GÜNCEL olduğunu DOĞRULAMAK için
     okunur — komuta girmek için değil. */
  assert.match(
    ADMIN_PAGE,
    /sharedStopIntentIsCurrent\(intent, \{[^}]*routeId: selectedId[^}]*stoppableSimulationId: simulationControls\.stoppableSimulationId[^}]*\}\)/s,
  )
  assert.match(
    MAP_PAGE,
    /sharedStopIntentIsCurrent\(intent, \{[^}]*routeId: selectedTransportRouteId[^}]*stoppableSimulationId: simulationControls\.stoppableSimulationId[^}]*\}\)/s,
  )

  // Ve İKİ yüzey de AYNI kancanın AYNI metodunu çağırır.
  assert.equal((MAP_PAGE.match(/simulation\.stop\(/g) ?? []).length, 1)
  assert.equal((ADMIN_PAGE.match(/simulation\.stop\(/g) ?? []).length, 1)
  /* ONAY ANINDA yeniden denetim: yetenek VE yakalanmış kimlik. Kutu açıkken
     yetki geri alınmış, çalıştırma bitmiş ya da yerine yenisi geçmiş
     olabilir. */
  const confirm = ADMIN_PAGE.slice(
    ADMIN_PAGE.indexOf('const intent = pendingSimulationStop'),
    ADMIN_PAGE.indexOf('simulation.stop('),
  )
  assert.ok(confirm.length > 0, 'yönetim onay yolu bulunamadı')
  assert.ok(new RegExp(`\\b${adminCapability}\\b`).test(confirm), 'onay yeteneği yeniden denetlemiyor')
  assert.ok(confirm.includes('sharedStopIntentIsCurrent('), 'onay kimliği yeniden doğrulamıyor')

  // Açık kalan kutu da yetenek kaybolunca kapanır.
  assert.ok(new RegExp(`pendingSimulationStop && ${adminCapability}\\b`).test(ADMIN_PAGE))

  // Görünürlük kuralı paylaşılır; yönetim ekranı kendi kuralını yazmaz.
  assert.ok(new RegExp(`canStop:\\s*${adminCapability}\\b`).test(ADMIN_PAGE))
  assert.ok(CONTROLS.includes('controls.showStop'))
  assert.ok(!ADMIN_PAGE.includes('transportSimulationControls = ('))
})

/* --- 18/19. Yetkisiz kullanıcı ve kestirme yokluğu ---------------------------- */

test('a main-map user without the stop permission never sees the button', () => {
  const shared = sharedJourneyPresentation({
    routeId: ROUTE_ID,
    routes: [{ id: ROUTE_ID, name: '7 Numaralı Hat' }],
    controls: controlsFor({ simulation: running(), canStop: false }),
  })

  // Gözlem SÜRER: kullanıcı hattı ve çalışan simülasyonu görmeye devam eder.
  assert.equal(shared.isActive, true)

  // YETENEK yoktur: düğme çizilmez.
  assert.equal(shared.showStop, false)

  /* KİMLİK GİZLENMEZ ve bu bilinçlidir. `stoppableSimulationId` çalışan
     ÇALIŞTIRMANIN kimliğidir; `transport.view` taşıyan bir kullanıcı onu
     zaten paylaşılan durum/yayın sözleşmesinden bilir (REST anlık görüntüsü
     ve SignalR olayları ikisi de `simulationId` taşır) ve takip/araç balonu
     onu okur. Kimliği saklamak bir YETKİLENDİRME MEKANİZMASI DEĞİLDİR —
     "hangi çalıştırma aktif" ile "durdurabilir mi" iki ayrı sorudur ve
     ikincisinin cevabı `showStop` ile komut yolundaki kapıdır. */
  assert.equal(shared.stoppableSimulationId, RUN_ID)

  // Yetkili kullanıcıda AYNI kimlikle birlikte düğme de görünür.
  const permitted = sharedJourneyPresentation({
    routeId: ROUTE_ID,
    routes: [{ id: ROUTE_ID, name: '7 Numaralı Hat' }],
    controls: controlsFor({ simulation: running(), canStop: true }),
  })
  assert.equal(permitted.showStop, true)
  assert.equal(permitted.stoppableSimulationId, RUN_ID)

  /* İKİ kullanıcı arasındaki TEK fark yetenektir; gözlem verisi aynıdır. */
  assert.equal(shared.stoppableSimulationId, permitted.stoppableSimulationId)
  assert.notEqual(shared.showStop, permitted.showStop)
})

test('knowing the active simulation id never grants the stop capability', () => {
  /* Kimlik BİLİNİYOR olsa bile yetenek yoksa hiçbir yüzey durdurma sunmaz.
     Bu, "kimliği gizlemek" ile "eylemi kapatmak" ayrımının testidir. */
  for (const canStart of [true, false]) {
    const controls = controlsFor({ simulation: running(), canStart, canStop: false })
    assert.equal(controls.stoppableSimulationId, RUN_ID)
    assert.equal(controls.showStop, false)
  }

  // Düğme YALNIZCA showStop ile çizilir; kimliğin varlığı onu açmaz.
  assert.ok(SHARED.includes('{shared.showStop && ('))
  assert.ok(!SHARED.includes('{shared.stoppableSimulationId && ('))
  assert.ok(CONTROLS.includes('{controls.showStop && ('))
})

/* --- YAKALANMIŞ NİYET: onay gecikmesi boyunca kimlik donar ------------------- */

const RUN_B = '22222222-2222-2222-2222-222222222222'

test('a pending stop intent is impossible without BOTH identities', () => {
  /* "Şu hatta ne çalışıyorsa durdur" biçiminde bir bekleyen niyet
     KURULAMAZ: rota tek başına yetmez, çalıştırma kimliği tek başına da. */
  assert.equal(sharedStopIntent({ routeId: ROUTE_ID, simulationId: null }), null)
  assert.equal(sharedStopIntent({ routeId: ROUTE_ID, simulationId: '' }), null)
  assert.equal(sharedStopIntent({ routeId: null, simulationId: RUN_ID }), null)
  assert.equal(sharedStopIntent({}), null)
  assert.equal(sharedStopIntent(), null)

  const intent = sharedStopIntent({ routeId: ROUTE_ID, simulationId: RUN_ID })
  assert.deepEqual(intent, { routeId: ROUTE_ID, simulationId: RUN_ID })
  // Dondurulmuştur: yakalandıktan sonra kimse içeriğini değiştiremez.
  assert.ok(Object.isFrozen(intent))
})

test('a captured intent stays valid only while it still points at the same run', () => {
  const captured = sharedStopIntent({ routeId: ROUTE_ID, simulationId: RUN_ID })

  // Dünya değişmediyse niyet geçerlidir.
  assert.equal(
    sharedStopIntentIsCurrent(captured, { routeId: ROUTE_ID, stoppableSimulationId: RUN_ID }),
    true,
  )

  /* FAZ 3'ÜN ASIL YARIŞI: A yakalandı, onay beklerken A bitti ve AYNI rotada
     B başladı. Niyet artık geçerli DEĞİLDİR. */
  assert.equal(
    sharedStopIntentIsCurrent(captured, { routeId: ROUTE_ID, stoppableSimulationId: RUN_B }),
    false,
  )

  // Çalıştırma tamamen bittiyse de geçersizdir.
  assert.equal(
    sharedStopIntentIsCurrent(captured, { routeId: ROUTE_ID, stoppableSimulationId: null }),
    false,
  )

  // Başka bir hatta geçildiyse de geçersizdir.
  assert.equal(
    sharedStopIntentIsCurrent(captured, { routeId: 99, stoppableSimulationId: RUN_ID }),
    false,
  )

  // Niyet hiç yoksa hiçbir şey geçerli değildir (fail-closed).
  assert.equal(sharedStopIntentIsCurrent(null, { routeId: ROUTE_ID, stoppableSimulationId: RUN_ID }), false)
})

test('a stale confirmation can never stop the replacement run', () => {
  /* Senaryonun UÇTAN UCA modeli. Kullanıcı A için Durdur'a bastı; onay
     kutusu açıkken A bitip B başladı. Onay anında sorulan soru "şu an ne
     çalışıyor" DEĞİL, "yakaladığım çalıştırma hâlâ bu mu"dur. */
  const activeA = controlsFor({ simulation: running({ simulationId: RUN_ID }), canStop: true })
  const captured = sharedStopIntent({
    routeId: ROUTE_ID,
    simulationId: activeA.stoppableSimulationId,
  })

  assert.equal(captured.simulationId, RUN_ID)

  // …A bitti, yerine B geçti.
  const activeB = controlsFor({ simulation: running({ simulationId: RUN_B }), canStop: true })
  assert.equal(activeB.stoppableSimulationId, RUN_B)

  const stillCurrent = sharedStopIntentIsCurrent(captured, {
    routeId: ROUTE_ID,
    stoppableSimulationId: activeB.stoppableSimulationId,
  })

  // Komut GÖNDERİLMEZ.
  assert.equal(stillCurrent, false)

  /* Ve yakalanan kimlik B'ye DÖNÜŞMEZ: niyet değişmez bir kayıttır, o anki
     kimlikle güncellenmez. */
  assert.equal(captured.simulationId, RUN_ID)
  assert.notEqual(captured.simulationId, activeB.stoppableSimulationId)
})

test('both surfaces capture the identity at trigger time and send it at confirm time', () => {
  /* Kural SAF modüldedir ve İKİ yüzey de onu ÇAĞIRIR; ikinci bir
     karşılaştırma kopyası yazılmaz. */
  for (const [name, source] of [['MapPage.jsx', MAP_PAGE], ['TransportRoutePage.jsx', ADMIN_PAGE]]) {
    assert.ok(source.includes('sharedStopIntent({'), `${name} niyeti yakalamıyor`)
    assert.ok(source.includes('sharedStopIntentIsCurrent('), `${name} niyeti yeniden doğrulamıyor`)

    /* Bekleyen durum bir BAYRAK değildir: boolean bir kapı, onay anında o
       anki kimliğin okunmasına ve A→B kaymasına izin verirdi. */
    assert.ok(!/setSharedStopPending\(true\)|setSimulationStopPending\(true\)/.test(source),
      `${name} bekleyen durumu hâlâ bayrak olarak tutuyor`)

    /* Komut YAKALANMIŞ kimlikleri taşır: `intent.routeId` +
       `intent.simulationId`. O anki `stoppableSimulationId` doğrudan
       gönderilmez. */
    const call = source.match(/simulation\.stop\(([^)]*)\)/)
    assert.ok(call, `${name} durdurma komutunu çağırmıyor`)
    const args = call[1].split(',').map((argument) => argument.trim()).filter(Boolean)
    assert.equal(args.length, 2, `${name} komutu iki kimlik taşımıyor`)
    assert.equal(args[0], 'intent.routeId', `${name} yakalanmış rotayı göndermiyor`)
    assert.equal(args[1], 'intent.simulationId', `${name} yakalanmış çalıştırmayı göndermiyor`)
  }
})

test('the stop command path re-checks the capability instead of trusting visibility', () => {
  /* GÖRÜNÜRLÜK BİR DENETİM DEĞİLDİR. Yetkiler oturum içinde tazelenebilir
     (`refreshPermissions`): onay kutusu AÇIKKEN yetki geri alınırsa düğme
     kaybolur ama açık kalan kutu hâlâ tıklanabilirdi. Komut yolu bu yüzden
     kendi kapısını taşır ve FAIL-CLOSED davranır.

     Bu, sunucunun yetkisinin yerine GEÇMEZ — backend aynı isteğe 403
     döndürmeye devam eder; buradaki kapı yalnızca yetkisiz bir komutun hiç
     gönderilmemesini sağlar. */
  /* Yetenek TEK yerden okunur ve HEM görünürlüğe HEM komut yoluna gider;
     iki ayrı kural kitabı doğmaz. Ad DESENDEN bulunur: ölçülen şey
     sözdizimi değil, kapının gerçekten orada olmasıdır. */
  const capability = capabilityNameFor(MAP_PAGE)
  assert.ok(new RegExp(`canStop:\\s*${capability}\\b`).test(MAP_PAGE))

  // TETİKLEYİCİ kapısı: yetenek yoksa onay kutusu hiç açılmaz.
  const request = MAP_PAGE.slice(
    MAP_PAGE.indexOf('const requestSharedStop'),
    MAP_PAGE.indexOf('const confirmSharedStop'),
  )
  const pending = pendingStopStateFor(MAP_PAGE, 'MapPage.jsx')

  assert.ok(new RegExp(`if \\(!${capability}\\)`).test(request), 'tetikleyici yeteneği denetlemiyor')
  // TETİKLEME ANI: kimlik burada YAKALANIR ve komut gönderilmez.
  assert.match(request, /sharedStopIntent\(\{[^}]*routeId:[^}]*simulationId:[^}]*\}\)/s)
  assert.ok(request.includes('if (!intent) return'))
  assert.ok(new RegExp(`${pending.setterName}\\(intent\\)`).test(request))
  assert.ok(!request.includes('simulation.stop('))

  /* ONAY kapısı: yetenek VE yakalanmış niyet komut anında yeniden denetlenir.
     Niyet artık o anki çalıştırmaya işaret etmiyorsa (A bitti, B başladı ya
     da rota değişti) istek gönderilmez ve kutu kapanır. */
  const confirm = MAP_PAGE.slice(
    MAP_PAGE.indexOf('const confirmSharedStop'),
    MAP_PAGE.indexOf('const followSharedSimulation'),
  )
  assert.ok(new RegExp(`\\b${capability}\\b`).test(confirm), 'onay yeteneği yeniden denetlemiyor')
  assert.ok(confirm.includes('const intent = pendingSharedStop'), 'onay yakalanmış niyeti okumuyor')
  assert.ok(confirm.includes('sharedStopIntentIsCurrent('), 'onay niyeti yeniden doğrulamıyor')
  assert.ok(new RegExp(`${pending.setterName}\\(null\\)`).test(confirm), 'reddedilen yol niyeti temizlemiyor')
  // Komut YAKALANMIŞ kimlikleri taşır; canlı kimlik ikame edilmez.
  assert.ok(confirm.includes('simulation.stop(intent.routeId, intent.simulationId)'))

  /* Reddedilen yol komut GÖNDERMEZ: erken çıkış, tek `simulation.stop`
     çağrısından ÖNCE gelir. */
  assert.ok(confirm.indexOf('return') < confirm.indexOf('simulation.stop('))

  // Yönetim ekranı da AYNI üç kapıyı taşır: tetikleyici, kutu ve onay.
  const adminCapability = capabilityNameFor(ADMIN_PAGE)
  const adminTrigger = ADMIN_PAGE.slice(ADMIN_PAGE.indexOf('onStop={'), ADMIN_PAGE.indexOf('onFollow={'))
  assert.ok(new RegExp(`\\b${adminCapability}\\b`).test(adminTrigger))
  assert.ok(new RegExp(`pendingSimulationStop && ${adminCapability}\\b`).test(ADMIN_PAGE))
  assert.ok(new RegExp(`${adminCapability}\\s*\\n?\\s*&& sharedStopIntentIsCurrent\\(`).test(ADMIN_PAGE))
})

test('no role-name or admin shortcut gates the shared stop', () => {
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

/* --- 20. İkinci bir paylaşılan çalışma zamanı AÇILMADI ------------------------ */

test('no second shared SignalR client, hook or store was introduced', () => {
  // Durdurma MEVCUT kancaya ve MEVCUT kanala eklendi.
  assert.equal((MAP_PAGE.match(/useTransportSimulation\(/g) ?? []).length, 1)
  assert.equal((ADMIN_PAGE.match(/useTransportSimulation\(/g) ?? []).length, 1)

  for (const [name, source] of [['MapPage.jsx', MAP_PAGE], ['TransportRoutePage.jsx', ADMIN_PAGE]]) {
    for (const forbidden of ['@microsoft/signalr', 'createTransportSimulationHubClient', 'UnifiedSimulation']) {
      assert.ok(!source.includes(forbidden), `${name} ikinci bir çalışma zamanı kuruyor (${forbidden})`)
    }
  }

  // Tek istemci hâlâ tek yerde kurulur ve durdurma için yeni bir olay eklenmedi.
  const hubClient = stripComments(read('../../src/services/transportSimulationHub.js'))
  assert.equal((HOOK.match(/createTransportSimulationHubClient\(/g) ?? []).length, 1)
  assert.ok(!hubClient.includes('SimulationStopped'))
  assert.ok(!/on\(\s*['"`]Simulation(?!Updated)/.test(hubClient))
})

/* --- Panel kabuğu ------------------------------------------------------------- */

test('the workspace shell forwards stop without owning the lifecycle', () => {
  assert.ok(PANEL.includes('onStopShared,'))
  assert.ok(PANEL.includes('onStop={onStopShared}'))

  // Panel komutu KENDİ göndermez ve yetki okumaz.
  assert.ok(!PANEL.includes('stopTransportSimulation'))
  assert.ok(!PANEL.includes('TRANSPORT_SIMULATION_STOP'))
})
