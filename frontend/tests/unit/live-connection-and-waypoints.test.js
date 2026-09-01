import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fromLonLat } from 'ol/proj.js'
import {
  LIVE_CONNECTION_MESSAGE,
  liveConnectionMessage,
} from '../../src/map/liveConnectionMessage.js'
import {
  JOURNEY_WAYPOINT_KIND,
  JOURNEY_WAYPOINT_LAYER_CLASSNAME,
  createJourneyWaypointLayer,
  journeyWaypointLabel,
  journeyWaypointPresentation,
  syncJourneyWaypointFeatures,
} from '../../src/map/journeyWaypoints.js'
import {
  JOURNEY_SIMULATION_HUB_PATH,
  journeySimulationHubUrl,
} from '../../src/services/journeySimulationHub.js'
import {
  TRANSPORT_SIMULATION_HUB_PATH,
  transportSimulationHubUrl,
} from '../../src/services/transportSimulationHub.js'
import { JOURNEY_VEHICLE_LAYER_CLASSNAME } from '../../src/map/journeyVehicle.js'

/**
 * Manuel kabul testinde görülen İKİ gerçek arıza.
 *
 * Birincisi altyapıdır ve her iki canlı ürünü birden öldürüyordu: pazarlık
 * isteği çerezle gidiyordu, sunucunun köken listesi ise çerez vermiyordu.
 * İkincisi sunumdur: yolculuğun geçiş noktaları haritada adlarıyla
 * görünmüyordu.
 */

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

const API = read('../../src/services/api.js')
const TRANSPORT_HUB = stripComments(read('../../src/services/transportSimulationHub.js'))
const JOURNEY_HUB = stripComments(read('../../src/services/journeySimulationHub.js'))
const MAP_PAGE = stripComments(read('../../src/pages/MapPage.jsx'))

/* --- 1/2/3/7/8. TEK kanonik taban adres ------------------------------------------ */

test('REST and both hubs derive from the same canonical API base', () => {
  const base = 'http://localhost:5154'

  assert.equal(transportSimulationHubUrl(base), `${base}/hubs/transport-simulation`)
  assert.equal(journeySimulationHubUrl(base), `${base}/hubs/journey-simulation`)

  // Yol sabitleri sunucu sözleşmesiyle BİREBİR aynıdır.
  assert.equal(TRANSPORT_SIMULATION_HUB_PATH, '/hubs/transport-simulation')
  assert.equal(JOURNEY_SIMULATION_HUB_PATH, '/hubs/journey-simulation')

  // Taban adres tek yerde tanımlıdır ve iki istemci de onu okur.
  assert.match(API, /const API_BASE_URL = import\.meta\.env\?\.VITE_API_BASE_URL \?\? 'http:\/\/localhost:5154'/)
  for (const hub of [TRANSPORT_HUB, JOURNEY_HUB]) {
    assert.match(hub, /apiBaseUrl/)
    // Kendi başına bir adres/port UYDURMAZ.
    assert.ok(!/localhost:\d+/.test(hub), 'hub istemcisi kendi portunu yazıyor')
    assert.ok(!hub.includes('5173'), 'hub adresi Vite portuna düşüyor')
    // `/negotiate` elle EKLENMEZ; istemci onu kendisi üretir.
    assert.ok(!hub.includes('negotiate'))
  }
})

test('a trailing slash in the base cannot produce a double slash', () => {
  assert.equal(transportSimulationHubUrl('http://localhost:5154/'), 'http://localhost:5154/hubs/transport-simulation')
  assert.equal(journeySimulationHubUrl('http://localhost:5154//'), 'http://localhost:5154/hubs/journey-simulation')
})

/* --- Asıl arıza: pazarlık isteği çerezle gidiyordu -------------------------------- */

test('neither hub sends cookie credentials with the negotiation request', () => {
  /* `@microsoft/signalr` varsayılanı `withCredentials: true`'dur; tarayıcı o
     durumda yanıtta `Access-Control-Allow-Credentials` arar. Sunucunun köken
     listesi (yalnızca `WithOrigins`) bunu vermediği için pazarlık BLOKLANIR ve
     kullanıcı "Failed to fetch" görür. Bu üründe oturum bir bearer token'dır:
     çerez göndermeye hiç gerek yoktur. */
  for (const hub of [TRANSPORT_HUB, JOURNEY_HUB]) {
    assert.match(hub, /withCredentials: false/)
    // Token yine `accessTokenFactory` ile HER denemede yeniden sorulur.
    assert.match(hub, /accessTokenFactory: \(\) => getAccessToken\(\) \?\? ''/)
    // Otomatik yeniden bağlanma korunur.
    assert.match(hub, /withAutomaticReconnect\(\)/)
  }
})

test('exactly two SignalR products exist, each with its own connection', () => {
  assert.match(TRANSPORT_HUB, /createTransportSimulationConnection/)
  assert.match(JOURNEY_HUB, /createJourneySimulationConnection/)

  // İki istemci birbirini TANIMAZ: hub'lar, gruplar ve ürünler ayrıdır.
  assert.ok(!TRANSPORT_HUB.includes('journey'))
  assert.ok(!JOURNEY_HUB.includes('transport-simulation'))
})

/* --- Part 16. Ham istisna metni arayüze çıkmaz ------------------------------------ */

test('a negotiation failure becomes a safe Turkish sentence', () => {
  const raw = 'Failed to complete negotiation with the server: TypeError: Failed to fetch'

  assert.equal(liveConnectionMessage(new Error(raw), 'yedek'), LIVE_CONNECTION_MESSAGE)
  assert.equal(LIVE_CONNECTION_MESSAGE, 'Canlı bağlantı kurulamadı. Sunucu bağlantısını kontrol edin.')

  // WebSocket/ağ arızaları da aynı cümleye düşer.
  for (const message of ['WebSocket failed to connect', 'NetworkError when attempting to fetch', 'Load failed']) {
    assert.equal(liveConnectionMessage(new Error(message), 'yedek'), LIVE_CONNECTION_MESSAGE)
  }
})

test('a genuine business error keeps its own message', () => {
  // Bağlantı dışı hatalar GİZLENMEZ: kullanıcının okuması gereken metin odur.
  assert.equal(
    liveConnectionMessage(new Error('Bu işlem için yetkiniz bulunmuyor.'), 'yedek'),
    'Bu işlem için yetkiniz bulunmuyor.',
  )
  assert.equal(liveConnectionMessage(null, 'yedek'), 'yedek')
  assert.equal(liveConnectionMessage({}, 'yedek'), 'yedek')
})

test('both live products route their connection failures through the safe message', () => {
  const transportHook = stripComments(read('../../src/hooks/useTransportSimulation.js'))
  const journeyHook = stripComments(read('../../src/hooks/useJourneySimulation.js'))

  assert.match(transportHook, /liveConnectionMessage\(followError, 'Canlı takip başlatılamadı\.'\)/)
  assert.match(journeyHook, /liveConnectionMessage\(caught, 'Canlı bağlantı kurulamadı\.'\)/)

  // Ham `error.message` doğrudan hata alanına yazılmaz.
  assert.ok(!/setError\((\w+)\?\.message/.test(transportHook))
})

/* --- Geçiş noktası sunumu --------------------------------------------------------- */

const SERVER_WAYPOINTS = [
  { position: 0, source: 'transportStop', referenceId: 71, name: 'Batı Durağı', longitude: 36.30, latitude: 41.20, role: 'origin' },
  { position: 1, source: 'poi', referenceId: 12, name: 'Kütüphane', longitude: 36.32, latitude: 41.22, role: 'via' },
  { position: 2, source: 'poi', referenceId: 13, name: 'Park', longitude: 36.33, latitude: 41.23, role: 'via' },
  { position: 3, source: 'transportStop', referenceId: 72, name: 'Doğu Durağı', longitude: 36.35, latitude: 41.25, role: 'destination' },
]

test('server resolved waypoints keep their names, order and roles', () => {
  const presentation = journeyWaypointPresentation(SERVER_WAYPOINTS)

  assert.deepEqual(presentation.map((item) => item.role), ['origin', 'via', 'via', 'destination'])
  assert.deepEqual(presentation.map((item) => item.name), ['Batı Durağı', 'Kütüphane', 'Park', 'Doğu Durağı'])
  assert.deepEqual(presentation.map((item) => item.roleLabel), ['Başlangıç', 'Ara nokta', 'Ara nokta', 'Hedef'])

  // Durak ve POI birlikte desteklenir.
  assert.deepEqual(presentation.map((item) => item.source), ['transportStop', 'poi', 'poi', 'transportStop'])
})

test('the server order is honoured even when the array arrives shuffled', () => {
  const shuffled = [SERVER_WAYPOINTS[3], SERVER_WAYPOINTS[0], SERVER_WAYPOINTS[2], SERVER_WAYPOINTS[1]]
  const presentation = journeyWaypointPresentation(shuffled)

  assert.deepEqual(presentation.map((item) => item.position), [0, 1, 2, 3])
  assert.equal(presentation[0].name, 'Batı Durağı')
  assert.equal(presentation[3].name, 'Doğu Durağı')
})

test('intermediate stops are numbered while the ends read by role', () => {
  const [origin, firstVia, secondVia, destination] = journeyWaypointPresentation(SERVER_WAYPOINTS)

  assert.equal(journeyWaypointLabel(origin, 0), 'Batı Durağı')
  assert.equal(journeyWaypointLabel(firstVia, 1), '1. Kütüphane')
  assert.equal(journeyWaypointLabel(secondVia, 2), '2. Park')
  assert.equal(journeyWaypointLabel(destination, 0), 'Doğu Durağı')
})

test('a nameless or placeless waypoint never invents data', () => {
  const presentation = journeyWaypointPresentation([
    { position: 0, name: '   ', longitude: 36.3, latitude: 41.2, role: 'origin' },
    { position: 1, name: 'Konumsuz', role: 'via' },
    { position: 2, name: 'Bozuk', longitude: 'x', latitude: null, role: 'destination' },
  ])

  // Adı olmayan nokta ROLÜYLE anılır; kimliği ekrana yazılmaz.
  assert.equal(presentation.length, 1)
  assert.equal(presentation[0].name, 'Başlangıç')

  // Koordinatı olmayan nokta hiç ÇİZİLMEZ: yanlış yerde bir işaret koymaktansa.
  for (const value of [null, undefined, 'waypoints', 42, {}]) {
    assert.deepEqual(journeyWaypointPresentation(value), [])
  }
})

test('an unknown role degrades to the intermediate presentation', () => {
  const [waypoint] = journeyWaypointPresentation([
    { position: 0, name: 'Bilinmeyen', longitude: 36.3, latitude: 41.2, role: 'checkpoint' },
  ])

  assert.equal(waypoint.role, 'via')
  assert.equal(waypoint.roleLabel, 'Ara nokta')
})

test('the layer owns one feature per waypoint and replaces them on every write', () => {
  const { source, layer } = createJourneyWaypointLayer()

  assert.equal(layer.getClassName(), JOURNEY_WAYPOINT_LAYER_CLASSNAME)
  // Araç katmanıyla AYNI katman değildir.
  assert.notEqual(JOURNEY_WAYPOINT_LAYER_CLASSNAME, JOURNEY_VEHICLE_LAYER_CLASSNAME)

  assert.equal(syncJourneyWaypointFeatures(source, SERVER_WAYPOINTS), 4)
  assert.equal(source.getFeatures().length, 4)
  assert.equal(source.getFeatures()[0].get('featureKind'), JOURNEY_WAYPOINT_KIND)
  assert.deepEqual(source.getFeatures()[0].getGeometry().getCoordinates(), fromLonLat([36.30, 41.20]))

  // Yeni bir yolculuk eskisinin noktalarını DEVRALMAZ.
  assert.equal(syncJourneyWaypointFeatures(source, [SERVER_WAYPOINTS[0]]), 1)
  assert.equal(source.getFeatures().length, 1)

  // Bırakma katmanı boşaltır.
  assert.equal(syncJourneyWaypointFeatures(source, null), 0)
  assert.equal(source.getFeatures().length, 0)
})

test('the live map reads adopted server waypoints, never mutable planner state', () => {
  const memo = MAP_PAGE.slice(
    MAP_PAGE.indexOf('const journeyWaypoints = useMemo('),
    MAP_PAGE.indexOf('useJourneyWaypointLayer(mapInstance'),
  )

  /* Benimsenmiş çalıştırma varken SUNUCUNUN noktaları kazanır; yalnızca
     çalıştırma yokken önizleme gösterilir. */
  assert.match(memo, /journeySimulation\.simulation\?\.waypoints \?\? journey\.preview\?\.waypoints \?\? null/)

  // Planlayıcının o anki seçimi (`journey.state`) buraya HİÇ girmez.
  assert.ok(!memo.includes('journey.state'))
  assert.match(MAP_PAGE, /useJourneyWaypointLayer\(mapInstance, \{ waypoints: journeyWaypoints \}\)/)

  // İkinci bir harita ya da POI/durak kopyası üretilmez.
  assert.equal((MAP_PAGE.match(/new Map\(\{/g) ?? []).length, 1)
  const layer = stripComments(read('../../src/map/journeyWaypoints.js'))
  assert.ok(!layer.includes('fetch('))
  assert.ok(!layer.includes('poiLayer'))
})

/* --- Durdurma onayı: görünürlük zinciri ------------------------------------------- */

test('the stop confirmation is reachable and stacks above every map surface', () => {
  // Zincir: düğme → istek → durum → diyalog.
  assert.match(MAP_PAGE, /onStopSimulation=\{requestJourneyStop\}/)
  assert.match(MAP_PAGE, /const requestJourneyStop = useCallback\(\(\) => setJourneyStopPending\(true\), \[\]\)/)
  assert.match(MAP_PAGE, /open=\{journeyStopPending\}/)

  /* Diyalog haritanın HERHANGİ bir yüzeyinin üstündedir: perde z-index 60,
     haritadaki en yüksek yüzey (toast) 45'tir. */
  const scrim = read('../../src/components/map/ConfirmDialog.css')
  const scrimZ = Number(scrim.match(/\.confirm-scrim \{[\s\S]*?z-index: (\d+);/)[1])
  assert.equal(scrimZ, 60)

  for (const css of [
    '../../src/components/map/JourneyPlanner.css',
    '../../src/components/map/MapToasts.css',
    '../../src/components/map/MapSheet.css',
    '../../src/components/map/Sidebar.css',
  ]) {
    for (const [, value] of read(css).matchAll(/z-index: (\d+);/g)) {
      assert.ok(Number(value) < scrimZ, `${css} onay diyaloğunun üstüne çıkıyor (${value})`)
    }
  }
})
