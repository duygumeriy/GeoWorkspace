import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

/** Yorumlar ayıklanır: bir kavramı ANLATMAK onu uygulamak değildir. */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

const SIM_HOOK = read('../../src/hooks/useJourneySimulation.js')
const VEHICLE_HOOK = read('../../src/hooks/useJourneyVehicleLayer.js')
const PLANNER_HOOK = read('../../src/hooks/useJourneyPlanner.js')
const PANEL = read('../../src/components/map/JourneyPlannerPanel.jsx')
const MAP_PAGE = read('../../src/pages/MapPage.jsx')
const TRANSPORT_API = read('../../src/services/transportApi.js')
const HUB = read('../../src/services/journeySimulationHub.js')
const LIVE_STATE = read('../../src/map/journeySimulationState.js')
const VEHICLE = read('../../src/map/journeyVehicle.js')

const JOURNEY_LIVE_SOURCES = [
  ['useJourneySimulation.js', SIM_HOOK],
  ['useJourneyVehicleLayer.js', VEHICLE_HOOK],
  ['journeySimulationState.js', LIVE_STATE],
  ['journeyVehicle.js', VEHICLE],
  ['journeySimulationHub.js', HUB],
]

/* --- BAŞLATMA GÜVEN SINIRI --------------------------------------------------- */

test('the start request carries the journey intent and nothing else', () => {
  // Niyet planlayıcının kanonik istek eşleyicisinden gelir.
  assert.ok(PLANNER_HOOK.includes('const buildIntent'))
  assert.ok(PLANNER_HOOK.includes('validation.ok ? validation.request : null'))
  assert.ok(MAP_PAGE.includes('const intent = journey.buildIntent()'))
  assert.ok(MAP_PAGE.includes('journeySimulation.start(intent)'))

  // Gövde doğrudan niyettir; zenginleştirilmez.
  assert.ok(TRANSPORT_API.includes('body: JSON.stringify(intent)'))
})

test('no preview authority is ever sent to the start endpoint', () => {
  const code = stripComments(SIM_HOOK) + stripComments(MAP_PAGE) + stripComments(TRANSPORT_API)

  /* Önizlemenin planId'si, geometrisi ya da ölçümleri başlatma yoluna HİÇ
     girmez: sunucu yolculuğu niyetten yeniden planlar. */
  for (const forbidden of ['planId', 'previewGeometry', 'preview.geometryWkt,']) {
    assert.ok(!code.includes(forbidden), `başlatma yoluna ${forbidden} sızıyor`)
  }

  // Başlatma çağrısının çevresinde geometri/ölçüm ataması yoktur.
  const startCall = stripComments(SIM_HOOK).slice(stripComments(SIM_HOOK).indexOf('startJourneySimulation'))
  for (const forbidden of ['geometryWkt:', 'distanceMeters:', 'durationSeconds:', 'longitude:', 'latitude:']) {
    assert.ok(!startCall.includes(forbidden), `başlatma isteği ${forbidden} taşıyor`)
  }
})

test('the browser never contacts a routing engine and keeps one auth pipeline', () => {
  for (const [name, source] of JOURNEY_LIVE_SOURCES) {
    const code = stripComments(source).toLowerCase()
    for (const forbidden of ['osrm', 'route/v1', 'localhost:5000']) {
      assert.ok(!code.includes(forbidden), `${name} motora doğrudan gidiyor (${forbidden})`)
    }
  }

  // Token TEK yerden okunur; ikinci bir kimlik deposu açılmaz.
  assert.ok(HUB.includes('getAccessToken'))
  assert.ok(HUB.includes('accessTokenFactory'))
  assert.ok(!stripComments(HUB).includes('localStorage'))
})

test('no simulation authority is kept in browser storage', () => {
  /* Sunucu aktif çalıştırmanın TEK gerçeğidir; yenileme kurtarması "mevcut"
     ucundan gelir, tarayıcı deposundan değil. */
  for (const [name, source] of JOURNEY_LIVE_SOURCES.concat([['JourneyPlannerPanel.jsx', PANEL]])) {
    const code = stripComments(source)
    assert.ok(!code.includes('localStorage'), `${name} tarayıcı deposunu otorite sayıyor`)
    assert.ok(!code.includes('sessionStorage.setItem'), `${name} oturum durumu yazıyor`)
  }

  assert.ok(SIM_HOOK.includes('fetchCurrentJourneySimulation'))
})

/* --- CANLI DURUM ------------------------------------------------------------- */

test('the start response replaces the preview as route truth', () => {
  // Yanıt doğrudan duruma yazılır ve harita ondan çizer.
  assert.ok(SIM_HOOK.includes('setSimulation(body)'))
  assert.ok(MAP_PAGE.includes('journeySimulation.simulation?.geometryWkt ?? journey.preview?.geometryWkt'))

  // Panel canlı modda önizleme adımlarını DEĞİL, sunucu adımlarını gösterir.
  assert.ok(PANEL.includes('isLive ? live?.simulation?.steps : preview?.steps'))
})

test('a successful start opens the panel automatically', () => {
  assert.ok(MAP_PAGE.includes('if (started) journey.openPanel()'))
})

test('terminal state releases the group and cannot regress', () => {
  assert.ok(SIM_HOOK.includes('isTerminalJourneyStatus(snapshot.status)) leave()'))
  assert.ok(SIM_HOOK.includes('applyJourneySnapshot'))
  // Kilit kuralı saf modüldedir ve orada sınanır.
  assert.ok(LIVE_STATE.includes('if (isTerminalJourneyStatus(current.status)) return false'))
})

/* --- YENİLEME / KURTARMA ----------------------------------------------------- */

test('a refresh recovers the active journey from the server, not from the browser', () => {
  /* Otorite SUNUCUDUR: kurtarma "mevcut çalıştırma" ucundan gelir. Tarayıcı
     deposu ya da eski önizleme bir kaynak DEĞİLDİR. */
  assert.ok(SIM_HOOK.includes('fetchCurrentJourneySimulation'))

  const code = stripComments(SIM_HOOK)

  // Yanıtın TAMAMI gerçek olarak kurulur; parçası seçilmez.
  assert.match(code, /const body = await response\.json\(\)[\s\S]{0,200}setSimulation\(body\)/)
  assert.match(code, /setSnapshot\(body\.snapshot \?\? null\)/)

  // Ve YALNIZCA sahip olunan çalıştırmaya katılınır.
  assert.match(code, /setSnapshot\(body\.snapshot[\s\S]{0,120}join\(body\.simulationId\)/)

  // Kurtarma yetkisiz kullanıcıya hiç sorulmaz.
  assert.ok(code.includes('if (!permitted) return undefined'))
})

test('recovered geometry replaces any absent or stale preview truth', () => {
  /* Yenilemeden sonra önizleme durumu YOKTUR (Faz 5C durumu bellekte
     yaşıyordu); harita kurtarılan otoriter geometriyi çizmelidir. */
  assert.ok(MAP_PAGE.includes('journeySimulation.simulation?.geometryWkt ?? journey.preview?.geometryWkt'))

  // Sıra bilinçlidir: canlı çalıştırma önizlemenin ÖNÜNDE gelir.
  const line = MAP_PAGE.split('\n').find((row) => row.includes('journeySimulation.simulation?.geometryWkt'))
  assert.ok(line.indexOf('journeySimulation.simulation') < line.indexOf('journey.preview'))
})

test('recovered steps and maneuver feed the live panel directly', () => {
  // Canlı modda adımlar SUNUCU yanıtından okunur, önizlemeden değil.
  assert.ok(PANEL.includes('isLive ? live?.simulation?.steps : preview?.steps'))

  // Anlık manevra kurtarılan adım dizisine karşı çözülür.
  assert.ok(PANEL.includes('step.sequence === liveModel.currentStepSequence'))
  assert.ok(LIVE_STATE.includes('Number.isInteger(snapshot.currentStepSequence)'))
})

test('recovery does not add browser storage or plan id authority', () => {
  const code = stripComments(SIM_HOOK)
  assert.ok(!code.includes('localStorage'))
  assert.ok(!code.includes('sessionStorage'))
  assert.ok(!code.includes('planId'))
})

/* --- SIGNALR ----------------------------------------------------------------- */

test('the journey channel is separate from the shared route channel', () => {
  assert.ok(HUB.includes("'/hubs/journey-simulation'"))
  assert.ok(!HUB.includes('transport-simulation'))

  // Kanca hat kancasına ya da hat gruplarına HİÇ dokunmaz.
  const code = stripComments(SIM_HOOK)
  assert.ok(!code.includes('useTransportSimulation'))
  assert.ok(!code.includes('JoinRoute'))
  assert.ok(!code.includes('LeaveRoute'))
  assert.ok(!code.includes('followingRouteId'))
})

test('one controlled connection with a single event handler', () => {
  // Bağlantı ilk ihtiyaçta kurulur ve YENİDEN KULLANILIR.
  assert.ok(SIM_HOOK.includes('if (connectionRef.current)'))
  // Dinleyici ömür boyu TEK kez kaydedilir; aynı olay iki kez işlenmez.
  assert.equal((stripComments(SIM_HOOK).match(/connection\.on\(JOURNEY_UPDATED_EVENT/g) ?? []).length, 1)
  // Yeniden bağlanma işleyicisi de tek kez kaydedilir.
  assert.equal((stripComments(SIM_HOOK).match(/connection\.onreconnected\(/g) ?? []).length, 1)

  /* Bağlantı son sökülmede GERÇEKTEN durdurulur. İddia davranışa bakar,
     tek bir yazım biçimine değil: erişim isteğe bağlı zincirleme ile de
     yapılabilir ve bu test onu bir kusur saymamalıdır. */
  const code = stripComments(SIM_HOOK)
  assert.match(code, /connectionRef\.current\??\.\s*stop\??\.\s*\(/)
  assert.match(code, /disposedRef\.current = true/)
  assert.match(code, /connectionRef\.current = null/)

  // Ve sökülmüş bir bağlantıdan gelen olay duruma YAZMAZ.
  assert.match(code, /if \(disposedRef\.current\) return/)
})

test('reconnecting rejoins the owned simulation', () => {
  /* Yeniden bağlanma sunucu tarafında grup üyeliğini kaybettirir; yeniden
     katılmazsak araç sessizce donardı. */
  assert.ok(SIM_HOOK.includes('connection.onreconnected'))
  assert.ok(SIM_HOOK.includes('joinedRef.current'))
  assert.ok(SIM_HOOK.includes('JOIN_SIMULATION_METHOD'))
})

/* --- KAMERA ------------------------------------------------------------------ */

test('the camera reuses the proven safe-box primitive and never resets zoom', () => {
  // İkinci bir takip algoritması yazılmaz.
  assert.ok(VEHICLE_HOOK.includes('vehicleCameraTarget'))
  assert.ok(VEHICLE_HOOK.includes("from '../map/transportVehicle.js'"))

  // Kutu içindeyse hiç oynamaz.
  assert.ok(VEHICLE_HOOK.includes('if (!target || animatingRef.current) return'))

  /* Animasyonda ZUM verilmez: kullanıcının yakınlaştırmasıyla güreşilmez. */
  const animate = stripComments(VEHICLE_HOOK).slice(stripComments(VEHICLE_HOOK).indexOf('view.animate'))
  assert.ok(!animate.includes('zoom'))
})

test('unfollowing stops the camera while movement continues', () => {
  assert.ok(VEHICLE_HOOK.includes('if (!map || !following || !presentation) return'))
  assert.ok(MAP_PAGE.includes('toggleJourneyFollow'))

  // Takip durumu hat takibinden AYRIDIR.
  assert.ok(MAP_PAGE.includes('journeySimulation.setFollowing'))
  assert.ok(!stripComments(VEHICLE_HOOK).includes('followingRouteId'))
})

/* --- PANEL ------------------------------------------------------------------- */

test('the three panel states survive live mode and closing does not stop it', () => {
  assert.ok(PANEL.includes('journey-reopen'))
  assert.ok(PANEL.includes('journey-collapsed-summary'))

  // Katlanmış canlı özet: ilerleme ve kalan mesafe.
  assert.ok(PANEL.includes('tamamlandı'))

  /* Kapatma yalnızca panel durumudur; simülasyonu DURDURMAZ. Durdurma AYRI
     ve açık bir eylemdir. */
  assert.ok(PANEL.includes('Simülasyonu Durdur'))
  assert.ok(PANEL.includes('onStopSimulation'))
  assert.ok(!/onClose=\{[^}]*onStopSimulation/.test(PANEL))
  assert.ok(MAP_PAGE.includes('onClose={journey.closePanel}'))
})

test('the start action appears only after a valid preview', () => {
  assert.ok(PANEL.includes('Simülasyonu Başlat'))
  // Seçim geçersizse ya da başlatma sürüyorsa düğme kapalıdır.
  assert.ok(PANEL.includes('disabled={!canRequest || live?.starting}'))
})

test('a missing maneuver list is presented as normal, not as an error', () => {
  /* Kalıcı güzergahı yeniden kullanan tam-hat yolculuğunda manevra yoktur.
     Bu bir NOT'tur, bir uyarı değil: hata sunumu (role="alert") yalnızca
     gerçek hatalara ayrılmıştır. */
  assert.ok(PANEL.includes('Bu yolculuk için adım adım yol tarifi bulunmuyor.'))
  assert.match(PANEL, /className="journey-note">\s*Bu yolculuk için adım adım/)
})

/* --- MEVCUT SİSTEMLE BİR ARADA ----------------------------------------------- */

test('the shared route simulation wiring is untouched', () => {
  // Faz 1-4 aynen yerinde.
  assert.ok(MAP_PAGE.includes('useTransportSimulation({'))
  assert.ok(MAP_PAGE.includes('useTransportVehicleLayer(mapInstance, {'))
  assert.ok(MAP_PAGE.includes('TransportTrackingControls'))

  // Ve yeni ürün onlardan ayrı çağrılır.
  assert.ok(MAP_PAGE.includes('useJourneySimulation({ permitted: allowed.canViewTransport })'))
  assert.ok(MAP_PAGE.includes('useJourneyVehicleLayer(mapInstance, {'))
})

test('the personal journey never joins a shared transport group', () => {
  const code = stripComments(SIM_HOOK) + stripComments(VEHICLE_HOOK)
  assert.ok(!code.includes('transport-simulation'))
  assert.ok(!code.includes('startTransportSimulation'))
  assert.ok(!code.includes('fetchTransportSimulation'))
})

test('no role-name or admin shortcut gates the live journey', () => {
  const AUTH_SHORTCUTS = [
    /\b(currentUser|user|auth|session|account|identity|principal|claims|me)\s*\??\.\s*roles?\b/i,
    /\broles\s*\??\.\s*(includes|some|indexOf|find)\s*\(/i,
    /\brole\w*\s*[=!]==?\s*['"`]\s*(admin|administrator|operator|viewer)/i,
    /\bis_?admin\b/i,
  ]

  for (const [name, source] of JOURNEY_LIVE_SOURCES) {
    const code = stripComments(source)
    for (const pattern of AUTH_SHORTCUTS) {
      assert.ok(!pattern.test(code), `${name} rol kestirmesi içeriyor (${pattern})`)
    }
  }

  // Gate mevcut etkin yetki modelidir.
  assert.ok(MAP_PAGE.includes('permitted: allowed.canViewTransport'))
})

test('no second OpenLayers map and no client-side duration estimate', () => {
  for (const [name, source] of JOURNEY_LIVE_SOURCES) {
    const code = stripComments(source)
    assert.ok(!/from 'ol\/Map/.test(code), `${name} ikinci bir harita kuruyor`)
    for (const forbidden of ['multiplier', 'speedKph', 'estimateDuration', 'WALKING_SPEED']) {
      assert.ok(!code.includes(forbidden), `${name} istemci tahmini içeriyor (${forbidden})`)
    }
  }

  // Kalan mesafe SUNUCU alanlarının farkıdır, bir hız hesabı değil.
  assert.ok(LIVE_STATE.includes('Math.max(0, total - covered)'))
})
