import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  JOURNEY_MODES,
  WAYPOINT_SOURCES,
  buildJourneyPreviewRequest,
} from '../../src/map/journeyPlanning.js'

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

/**
 * Bir modülden alınan İSİMLER.
 *
 * Kesin biçimli bir import satırı beklemek, aynı modülden ikinci bir yardımcı
 * alındığı anda kırılır — ki bu meşru bir değişikliktir. Ölçülen şey neyin
 * ALINDIĞIDIR, satırın nasıl yazıldığı değil.
 */
const namedImports = (source, modulePath) => {
  const pattern = new RegExp(`import \\{([^}]*)\\} from '${modulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`, 's')
  const match = source.match(pattern)
  assert.ok(match, `${modulePath} içe aktarımı bulunamadı`)
  return match[1].split(',').map((name) => name.trim()).filter(Boolean)
}

/**
 * İçinde verilen işareti geçen `useEffect` çağrısının TAMAMI.
 *
 * Sınır, ilk `])` aranarak bulunamaz: gövdedeki sıradan bir dizi kapanışı
 * iddiayı sessizce yarıda keserdi. Parantezler sayılır.
 */
const effectWith = (source, marker) => {
  const bodies = stripComments(source).split('useEffect(').slice(1)
  const found = bodies.find((body) => body.includes(marker))
  assert.ok(found, `${marker} efekti bulunamadı`)

  let depth = 1
  for (let index = 0; index < found.length; index += 1) {
    const char = found[index]
    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return found.slice(0, index + 1)
    }
  }

  return assert.fail(`${marker} efektinin kapanışı bulunamadı`)
}

/** Adı verilen `useCallback` gövdesi (yorumlar ayıklanmış sayfadan). */
const callbackBody = (name) => {
  const code = stripComments(MAP_PAGE)
  const from = code.indexOf(`const ${name} = useCallback(`)
  assert.ok(from > 0, `${name} bulunamadı`)
  return code.slice(from, code.indexOf('}, [', from))
}

/** Bir JSX bileşen çağrısı (öznitelik ifadelerinin içi atlanarak). */
function jsxElement(source, tag) {
  const from = source.indexOf(`<${tag}`)
  assert.ok(from > 0, `<${tag} … /> çağrısı bulunamadı`)

  let depth = 0
  for (let index = from; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    else if (char === '}') depth -= 1
    else if (depth === 0 && char === '/' && source[index + 1] === '>') {
      return source.slice(from, index + 2)
    }
  }

  return assert.fail(`<${tag} … /> kapanışı bulunamadı`)
}

/**
 * Panel sahipliği bir SUNUM işidir: açma/kapama sarmalayıcıları hiçbir yaşam
 * döngüsü ya da sunucu işlemi çalıştırmaz.
 */
const PRESENTATION_ONLY_FORBIDDEN = [
  'journeySimulation.start',
  'journeySimulation.stop',
  'journeySimulation.dismiss',
  'journey.clear',
  'setSimulation',
  'setSnapshot',
  'fetchCurrentJourneySimulation',
  'fetch(',
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

/**
 * Yasak alanlar İSTEK SINIRINDA aranır, kaynak dosyalarda değil.
 *
 * Sunum tarafının önizleme geometrisini okuması meşrudur (harita çizgisinin
 * sahibi kuralı); ölçülen şey sunucuya NE GÖNDERİLDİĞİDİR.
 */
const FORBIDDEN_REQUEST_FIELDS = [
  'planId',
  'previewGeometry',
  'previewGeometryWkt',
  'geometry',
  'geometryWkt',
  'coordinates',
  'longitude',
  'latitude',
  'distanceMeters',
  'durationSeconds',
  'steps',
  'summary',
]

/** Gövdedeki TÜM anahtarlar, iç içe nesneler dâhil. */
function deepKeys(value, found = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) deepKeys(item, found)
    return found
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      found.add(key)
      deepKeys(nested, found)
    }
  }
  return found
}

test('no preview authority is ever sent to the start endpoint', () => {
  /* Gövdenin KENDİSİ çalıştırılarak üretilir: başlatma isteği, önizlemeyle
     AYNI kanonik niyet eşleyicisinden çıkar (`buildIntent` = doğrulanmış
     istek). Böylece iddia bir metin taraması değil, gerçek yük üzerindedir. */
  const intents = [
    buildJourneyPreviewRequest({
      mode: JOURNEY_MODES.ROUTE_FULL,
      profile: 'driving',
      routeId: 7,
      waypoints: [],
    }),
    buildJourneyPreviewRequest({
      mode: JOURNEY_MODES.ROUTE_SEGMENT,
      profile: 'walking',
      routeId: 7,
      fromStopId: 71,
      toStopId: 72,
      waypoints: [],
    }),
    buildJourneyPreviewRequest({
      mode: JOURNEY_MODES.WAYPOINTS,
      profile: 'cycling',
      routeId: null,
      waypoints: [
        { key: 'wp-1', reference: { source: WAYPOINT_SOURCES.STOP, id: 71, label: 'Batı', routeName: 'A' } },
        { key: 'wp-2', reference: { source: WAYPOINT_SOURCES.POI, id: 12, label: 'Kütüphane', routeName: '' } },
      ],
    }),
  ]

  const expectedKeys = [
    ['mode', 'profile', 'routeId'],
    ['mode', 'profile', 'routeId', 'fromStopId', 'toStopId'],
    ['mode', 'profile', 'waypoints'],
  ]

  intents.forEach((validation, index) => {
    assert.ok(validation.ok, `niyet ${index} kurulamadı`)
    const body = JSON.parse(JSON.stringify(validation.request))

    // Gövde YALNIZCA kanonik niyettir.
    assert.deepEqual(Object.keys(body).sort(), [...expectedKeys[index]].sort())

    for (const forbidden of FORBIDDEN_REQUEST_FIELDS) {
      assert.ok(!deepKeys(body).has(forbidden), `başlatma yoluna ${forbidden} sızıyor`)
    }
  })

  /* Geçiş noktaları da yalnızca KAYNAK + KİMLİKTİR: koordinat, etiket ya da
     ölçüm taşımaz — konumu sunucu çözer. */
  const waypoints = intents[2].request.waypoints
  for (const waypoint of waypoints) {
    assert.deepEqual(Object.keys(waypoint).sort(), ['referenceId', 'source'])
  }

  /* İstek sınırının kendisi: gövde niyetin TA KENDİSİDİR, zenginleştirilmez.
     Bu iddia, birisi ileride yüke geometri eklerse KIRILIR. */
  const startRequest = stripComments(TRANSPORT_API).slice(
    stripComments(TRANSPORT_API).indexOf('export function startJourneySimulation'),
    stripComments(TRANSPORT_API).indexOf('export function fetchCurrentJourneySimulation'),
  )
  assert.match(startRequest, /body: JSON\.stringify\(intent\),/)
  for (const forbidden of FORBIDDEN_REQUEST_FIELDS) {
    assert.ok(!startRequest.includes(forbidden), `başlatma isteği ${forbidden} taşıyor`)
  }

  // Ve niyet, kanca ile sayfa arasında DEĞİŞTİRİLMEDEN geçer.
  const startCallback = stripComments(SIM_HOOK).slice(
    stripComments(SIM_HOOK).indexOf('const start = useCallback('),
    stripComments(SIM_HOOK).indexOf('const stop = useCallback('),
  )
  assert.match(startCallback, /await startJourneySimulation\(intent\)/)
  for (const forbidden of FORBIDDEN_REQUEST_FIELDS) {
    assert.ok(!startCallback.includes(`${forbidden}:`), `başlatma çağrısı ${forbidden} ekliyor`)
  }

  const startHandler = stripComments(MAP_PAGE).slice(
    stripComments(MAP_PAGE).indexOf('const startJourney = useCallback('),
    stripComments(MAP_PAGE).indexOf('const toggleJourneyFollow'),
  )
  assert.match(startHandler, /const intent = journey\.buildIntent\(\)/)
  assert.match(startHandler, /await journeySimulation\.start\(intent\)/)
  for (const forbidden of FORBIDDEN_REQUEST_FIELDS) {
    assert.ok(!startHandler.includes(forbidden), `başlatma eylemi ${forbidden} taşıyor`)
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

  /* Sıralama kuralı Faz 5E-B'de saf modüle taşındı ve orada ÇALIŞTIRILARAK
     ölçülür (`journey-terminal-lifecycle.test.js`). Burada denetlenen tek şey
     ENTEGRASYON SINIRIDIR: sayfa kuralı çağırıyor, doğru iki girdiyi veriyor
     ve ikinci bir sıralama kopyası tutmuyor. */
  const stateImports = namedImports(MAP_PAGE, '../map/journeySimulationState.js')
  assert.ok(stateImports.includes('journeyDisplayGeometryWkt'))
  assert.match(
    MAP_PAGE,
    /journeyDisplayGeometryWkt\(\{\s*simulation: journeySimulation\.simulation,\s*previewGeometryWkt: journey\.preview\?\.geometryWkt \?\? null,\s*\}\)/,
  )
  assert.ok(!MAP_PAGE.includes('journeySimulation.simulation?.geometryWkt ?? journey.preview?.geometryWkt'))

  // Ve haritaya giden değer o kuralın sonucudur.
  assert.match(MAP_PAGE, /geometryWkt: journeyGeometryWkt,/)

  /* Panel canlı modda önizleme adımlarını DEĞİL, sunucu adımlarını gösterir.
     Faz 5E-B · Dilim 7A'da bu, adım DURUMLARINI da taşıyan ortak gezinme
     modelinden okunur. */
  assert.match(PANEL, /journeyNavigationModel\(\{\s*steps: live\?\.simulation\?\.steps/)
})

test('a successful start opens the panel automatically', () => {
  /* Davranış aynı: başarılı başlatma paneli kendiliğinden görünür kılar. Faz
     5E-B · Dilim 4'ten beri bunu KANONİK açma sarmalayıcısı yapar; panel
     görünürlüğü artık harita bağlam sahipliğini de taşır. */
  assert.match(callbackBody('startJourney'), /if \(started\) openJourneyPanel\(\)/)

  const open = callbackBody('openJourneyPanel')
  assert.match(open, /journey\.openPanel\(\)/)
  assert.match(open, /mapContext\.activate\(MAP_CONTEXTS\.journey\)/)

  // Açmak yalnızca göstermektir: yeniden başlatmaz, kurtarma isteği atmaz.
  for (const forbidden of PRESENTATION_ONLY_FORBIDDEN) {
    assert.ok(!open.includes(forbidden), `openJourneyPanel ${forbidden} çağırıyor`)
  }
})

test('terminal state releases the group and cannot regress', () => {
  /* Terminal işlemesi TEK bir efekttedir; ne yaptığı o efektin gövdesinden
     okunur — tek satırlık bir yazım biçimi şart değildir. */
  const terminal = effectWith(SIM_HOOK, 'isTerminalJourneyStatus(snapshot.status)')

  // Karar SUNUCUNUN durumundan verilir.
  assert.match(terminal, /isTerminalJourneyStatus\(snapshot\.status\)/)

  /* Biten yolculukta İKİ şey birden bırakılır: hub grubu (zombi abonelik
     kalmaz) ve kamera sahipliği (hareket etmeyen aracı takip etmek yoktur). */
  assert.match(terminal, /leave\(\)/)
  assert.match(terminal, /setFollowing\(false\)/)

  /* Ama SONUÇ kalır: terminal olmak bir bırakma ya da durdurma değildir.
     Bunlar kullanıcının kendi açık eylemleridir (Durdur / Planlamaya Dön /
     Yeni Yolculuk). */
  for (const forbidden of [
    'stopJourneySimulation',
    'journeySimulation.stop',
    'dismiss',
    'setSimulation(null)',
    'setSnapshot(null)',
  ]) {
    assert.ok(!terminal.includes(forbidden), `terminal dalı ${forbidden} çağırıyor`)
  }

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
     yaşıyordu); harita kurtarılan otoriter geometriyi çizmelidir.

     Kural Faz 5E-B'de saf modüle taşındı: sıra orada ÇALIŞTIRILARAK ölçülür
     (`journey-terminal-lifecycle.test.js`), burada yalnızca sayfanın o kuralı
     kullandığı — ve ikinci bir sıralama kopyası tutmadığı — doğrulanır. */
  assert.match(
    MAP_PAGE,
    /const journeyGeometryWkt = journeyDisplayGeometryWkt\(\{\s*simulation: journeySimulation\.simulation,\s*previewGeometryWkt: journey\.preview\?\.geometryWkt \?\? null,\s*\}\)/,
  )
  assert.ok(!MAP_PAGE.includes('journeySimulation.simulation?.geometryWkt ?? journey.preview?.geometryWkt'))

  // Sıra bilinçlidir: benimsenmiş çalıştırma önizlemenin ÖNÜNDE gelir.
  const rule = read('../../src/map/journeySimulationState.js')
  assert.ok(rule.includes('simulation?.geometryWkt ?? previewGeometryWkt ?? null'))
})

test('recovered steps and maneuver feed the live panel directly', () => {
  /* Canlı modda adımlar SUNUCU yanıtından okunur, önizlemeden değil; güncel
     adım da sunucunun sıra numarasına göre çözülür. Kural Dilim 7A'da ortak
     bir modele taşındı ve orada çalıştırılarak ölçülür
     (`journey-navigation-popup.test.js`); burada bağlama denetlenir. */
  assert.match(PANEL, /journeyNavigationModel\(\{\s*steps: live\?\.simulation\?\.steps,\s*currentStepSequence: liveModel\?\.currentStepSequence,\s*\}\)/)
  assert.ok(PANEL.includes('previewSteps'), 'önizleme adımları ayrı okunmalı')

  // Ve anlık manevra alanı hâlâ sunucunun tam sayısıdır.
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

  /* Kutu içindeyse ya da uçan bir animasyon varsa hiç oynamaz. Kilit Faz
     5E-B · Dilim 5'te kuşak taşıyan saf bir nesneye taşındı (bayat geri
     çağrı yarışı); kısma davranışı aynıdır. */
  assert.ok(VEHICLE_HOOK.includes('if (!target || lock.isAnimating) return'))

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
  /* Yeniden açma kısayolu artık haritanın denetim yığınındadır; panel
     KAPALI durumda hiçbir şey çizmez. */
  assert.ok(PANEL.includes('PANEL_STATES.CLOSED'))
  assert.ok(read('../../src/components/map/QuickActions.jsx').includes('journey-trigger'))
  assert.ok(PANEL.includes('journey-collapsed-summary'))

  // Katlanmış canlı özet: ilerleme ve kalan mesafe.
  assert.ok(PANEL.includes('tamamlandı'))

  /* Kapatma yalnızca panel durumudur; simülasyonu DURDURMAZ. Durdurma AYRI
     ve açık bir eylemdir. */
  assert.ok(PANEL.includes('Simülasyonu Durdur'))
  assert.ok(PANEL.includes('onStopSimulation'))
  assert.ok(!/onClose=\{[^}]*onStopSimulation/.test(PANEL))
  /* Kapatma artık koordinatörden geçen kanonik sarmalayıcıdır: panel sahipliği
     bırakılır, çalıştırma DOKUNULMADAN kalır. */
  const usage = jsxElement(stripComments(MAP_PAGE), 'JourneyPlannerPanel')
  assert.match(usage, /onClose=\{closeJourneyPanel\}/)
  assert.match(usage, /onOpen=\{openJourneyPanel\}/)
  assert.match(usage, /onCollapse=\{journey\.collapsePanel\}/)

  const close = callbackBody('closeJourneyPanel')
  assert.match(close, /mapContext\.close\(MAP_CONTEXTS\.journey\)/)
  assert.match(close, /journey\.closePanel\(\)/)
  for (const forbidden of PRESENTATION_ONLY_FORBIDDEN) {
    assert.ok(!close.includes(forbidden), `closeJourneyPanel ${forbidden} çağırıyor`)
  }
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
  assert.ok(PANEL.includes('Bu güzergâh için adım adım yönlendirme bulunmuyor.'))
  assert.match(PANEL, /className="journey-note">\s*Bu güzergâh için adım adım/)

  /* Önizleme tarafındaki kardeş not da NOT olarak kalır: kalıcı güzergah
     kullanıldığında manevra bulunmaması beklenen bir sonuçtur. */
  assert.match(PANEL, /className="journey-note">\s*Bu hat için kayıtlı güzergah kullanıldı/)
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
