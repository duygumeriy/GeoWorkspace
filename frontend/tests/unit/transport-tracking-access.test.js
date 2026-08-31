import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import {
  ADMIN_ENTRY_PERMISSIONS,
  ADMIN_SECTIONS,
  PERMISSIONS,
  TRANSPORT_ROUTE_SECTION_PERMISSIONS,
} from '../../src/auth/permissionCodes.js'
import { transportSimulationControls } from '../../src/map/transportSimulationState.js'

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')
const mapPage = read('../../src/pages/MapPage.jsx')
const adminPage = read('../../src/pages/admin/TransportRoutePage.jsx')
const controls = read('../../src/components/map/TransportTrackingControls.jsx')
const app = read('../../src/App.jsx')

const RUN = '11111111-1111-1111-1111-111111111111'
const activeSimulation = {
  simulationId: RUN,
  routeId: 7,
  status: 'Running',
  longitude: 30,
  latitude: 40,
  progressPercent: 40,
  updatedAtUtc: '2026-08-31T10:00:00Z',
}

/* --- Erişim: yönetim yetkisi OLMADAN takip ---------------------------------- */

test('the management gate still requires management permissions only', () => {
  /* Boşluk, `transport.view`i yönetim bölümüne EKLEYEREK kapatılmadı: bu,
     salt okuyan bir kullanıcıya yönetim kabuğunun kapısını da açardı. */
  assert.equal(TRANSPORT_ROUTE_SECTION_PERMISSIONS.includes(PERMISSIONS.TRANSPORT_VIEW), false)
  assert.equal(ADMIN_ENTRY_PERMISSIONS.includes(PERMISSIONS.TRANSPORT_VIEW), false)
  assert.equal(
    ADMIN_SECTIONS.some((section) => section.anyOf.includes(PERMISSIONS.TRANSPORT_VIEW)),
    false,
  )

  // Yönetim bölümü ne kazandı ne kaybetti.
  assert.deepEqual([...TRANSPORT_ROUTE_SECTION_PERMISSIONS], [
    PERMISSIONS.TRANSPORT_STOP_CREATE,
    PERMISSIONS.TRANSPORT_STOP_UPDATE,
    PERMISSIONS.TRANSPORT_STOP_DELETE,
    PERMISSIONS.TRANSPORT_STOP_RESTORE,
    PERMISSIONS.TRANSPORT_ROUTE_CREATE,
    PERMISSIONS.TRANSPORT_ROUTE_UPDATE,
    PERMISSIONS.TRANSPORT_ROUTE_DELETE,
    PERMISSIONS.TRANSPORT_ROUTE_REORDER,
  ])
  assert.equal(TRANSPORT_ROUTE_SECTION_PERMISSIONS.includes(PERMISSIONS.TRANSPORT_SIMULATION_START), false)
})

test('the canonical transport viewer role can open the map it is meant to read', () => {
  /* Rolün TANIMI "ulaşım ağı ve POI verisini salt okuyan kullanıcı"dır ve o
     veri yalnızca haritada görünür. Arayüz tarafındaki kanıt: harita rotası
     `map.view` ister, ulaşım katmanı `transport.view`. İkisi birlikte
     olmadan rolün taşıdığı yetkilerin karşılığı yoktur.

     Rol → yetki eşlemesinin SAHİBİ backend'dir (RolePermissionDefaults +
     RolePermissionExpansions); burada yalnızca arayüzün hangi kodları
     aradığı sabitlenir — rol adına bakan hiçbir kural eklenmez. */
  assert.equal(PERMISSIONS.MAP_VIEW, 'map.view')
  assert.equal(PERMISSIONS.TRANSPORT_VIEW, 'transport.view')

  const mapRoute = app.slice(app.indexOf('<MapPage />') - 400, app.indexOf('<MapPage />'))
  assert.match(mapRoute, /PermissionRoute anyOf=\{\[PERMISSIONS\.MAP_VIEW\]\}/)
  assert.match(read('../../src/hooks/useWorkspacePermissions.js'), /canViewTransport = can\(PERMISSIONS\.TRANSPORT_VIEW\)/)

  // Harita erişimi bir YÖNETİM yetkisi değildir: bölüm listesi büyümedi.
  assert.equal(TRANSPORT_ROUTE_SECTION_PERMISSIONS.includes(PERMISSIONS.MAP_VIEW), false)
})

test('the main map exposes tracking behind transport.view alone', () => {
  /* Ana harita `transport.view` ile ulaşılabilir tek yüzeydir; takip kartı da
     aynı kapının arkasındadır. Yönetim ekranına girmeden hattı izlemek bu
     sayede mümkün olur. */
  assert.match(mapPage, /permitted:\s*allowed\.canViewTransport/)
  assert.match(mapPage, /canView:\s*allowed\.canViewTransport/)
  assert.match(mapPage, /\{allowed\.canViewTransport && selectedTransportRouteId != null && \(/)
  assert.match(mapPage, /<TransportTrackingControls/)
  assert.match(read('../../src/hooks/useWorkspacePermissions.js'), /canViewTransport = can\(PERMISSIONS\.TRANSPORT_VIEW\)/)

  /* Ana harita rotası YÖNETİM yetkisiyle korunmuyor: kapı `map.view`dir ve
     ulaşım tarafı orada `transport.view` ile açılır. Yönetim bölümü ise hâlâ
     kendi yetkileriyle kapalıdır. */
  const mapRoute = app.slice(app.indexOf('<MapPage />') - 400, app.indexOf('<MapPage />'))
  assert.match(mapRoute, /PermissionRoute anyOf=\{\[PERMISSIONS\.MAP_VIEW\]\}/)
  assert.ok(!mapRoute.includes('TRANSPORT_ROUTE_SECTION_PERMISSIONS'))
})

/* --- Denetim görünürlüğü ----------------------------------------------------- */

test('follow is offered only when the selected route has an active simulation', () => {
  const idle = transportSimulationControls({ routeId: 7, canStart: false })
  const active = transportSimulationControls({ routeId: 7, canStart: false, simulation: activeSimulation })

  assert.equal(idle.showFollow, false)
  assert.equal(active.showFollow, true)
  assert.equal(active.progressLabel, '%40')
})

test('following exposes unfollow and nothing else changes hands', () => {
  const following = transportSimulationControls({
    routeId: 7,
    canStart: false,
    simulation: activeSimulation,
    followingRouteId: 7,
  })

  assert.equal(following.showUnfollow, true)
  assert.equal(following.showFollow, false)
})

test('start stays bound to transport.simulation.start for the viewer surface', () => {
  const viewer = transportSimulationControls({ routeId: 7, canStart: false })
  const starter = transportSimulationControls({ routeId: 7, canStart: true })

  assert.equal(viewer.showStart, false)
  assert.equal(starter.showStart, true)

  // Haritadaki kart yetkiyi yalnızca kanonik KOD üzerinden sorar.
  assert.match(mapPage, /canStart: can\(PERMISSIONS\.TRANSPORT_SIMULATION_START\)/)
  assert.equal(PERMISSIONS.TRANSPORT_SIMULATION_START, 'transport.simulation.start')
})

/** Ana haritanın YALNIZCA takip ile ilgili bölümleri. */
const section = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.ok(start >= 0 && end > start, `missing section: ${startMarker}`)
  return source.slice(start, end)
}

test('no role-name or admin shortcut is introduced in the tracking path', () => {
  /* Kapsam bilinçli olarak TAKİP koduyla sınırlıdır: ana haritanın çizim
     sahipliği kuralı (canManageDrawing) çok önceden beri `isAdmin` okur ve bu
     fazın konusu değildir. Yeni yüzeyin hiçbir yerinde rol adı yoktur. */
  const trackingWiring = section(mapPage, '/* --- Canlı takip', 'const toggleTransportRoute')
  const trackingMarkup = section(mapPage, '<TransportVehiclePopup', '<LocationAnalysisPanel')

  const sources = [
    ['map tracking wiring', trackingWiring],
    ['map tracking markup', trackingMarkup],
    ['shared controls', controls],
    ['simulation state', read('../../src/map/transportSimulationState.js')],
    ['vehicle presentation', read('../../src/map/transportVehicle.js')],
    ['simulation hook', read('../../src/hooks/useTransportSimulation.js')],
  ]

  for (const [name, source] of sources) {
    assert.ok(!/Administrator|roleName|isAdmin/.test(source), `${name} exposed a role shortcut`)
  }

  // Yetki kararı yalnızca kanonik KODLARDAN gelir.
  assert.match(trackingWiring, /can\(PERMISSIONS\.TRANSPORT_SIMULATION_START\)/)
  assert.match(trackingWiring, /allowed\.canViewTransport/)
})

/* --- Tek mimari: SignalR / araç / popup -------------------------------------- */

test('the map reuses the existing SignalR lifecycle rather than a second client', () => {
  assert.match(mapPage, /import useTransportSimulation from '\.\.\/hooks\/useTransportSimulation\.js'/)
  assert.match(mapPage, /simulation\.follow\(selectedTransportRouteId\)/)
  assert.match(mapPage, /simulation\.unfollow\(\)/)

  // Ne ikinci bir hub istemcisi ne de doğrudan bir SignalR bağımlılığı.
  for (const forbidden of ['@microsoft/signalr', 'createTransportSimulationClient', 'HubConnectionBuilder']) {
    assert.ok(!mapPage.includes(forbidden), `map page built its own SignalR path: ${forbidden}`)
  }
})

test('there are exactly two SignalR products and neither duplicates the other', () => {
  /* Faz 4'te tek bir canlı ürün vardı ve "tek fabrika" iddiası onu korurdu.
     Faz 5D İKİNCİ ve bilinçli olarak AYRI bir ürün ekledi: paylaşılan hat
     simülasyonu ile kişisel yolculuk simülasyonu farklı yetkilendirme ve
     grup anlamlarına sahiptir — hat yayınını transport.view taşıyan herkes
     izler, kişisel yolculuğu YALNIZCA sahibi. İkisini tek bağlantıya
     zorlamak bu ayrımı silerdi.

     Bu yüzden iddia "tek fabrika"dan "ürün başına TEK fabrika ve sıfır
     kopya"ya döner; korunan şey aynıdır: kimse ikinci bir bağlantı
     uygulaması yazamaz. */
  const files = readdirSync(new URL('../../src/services/', import.meta.url))
    .filter((file) => file.endsWith('.js'))
    .map((file) => [file, read(`../../src/services/${file}`)])

  const withSignalR = files.filter(([, source]) => source.includes("from '@microsoft/signalr'"))

  // Tam olarak iki ürün; üçüncü bir bağlantı dosyası fark edilmeden eklenemez.
  assert.deepEqual(
    withSignalR.map(([file]) => file).sort(),
    ['journeySimulationHub.js', 'transportSimulationHub.js'],
  )

  // SABİT HAT: tek istemci fabrikası, tek bağlantı fabrikası.
  assert.equal(
    files.filter(([, source]) => source.includes('export function createTransportSimulationClient')).length,
    1,
  )
  assert.equal(
    files.filter(([, source]) => source.includes('export function createTransportSimulationConnection')).length,
    1,
  )

  // YOLCULUK: tek bağlantı fabrikası.
  assert.equal(
    files.filter(([, source]) => source.includes('export function createJourneySimulationConnection')).length,
    1,
  )
})

test('the two live products keep separate hubs, events and group methods', () => {
  const transportHub = read('../../src/services/transportSimulationHub.js')
  const transportClient = read('../../src/services/transportSimulationClient.js')
  const journeyHub = read('../../src/services/journeySimulationHub.js')
  const journeyHook = read('../../src/hooks/useJourneySimulation.js')

  // Ayrı hub yolları.
  assert.ok(transportHub.includes("'/hubs/transport-simulation'"))
  assert.ok(journeyHub.includes("'/hubs/journey-simulation'"))
  assert.ok(!journeyHub.includes('transport-simulation'))

  // Ayrı olaylar.
  assert.ok(transportClient.includes("SIMULATION_UPDATED_EVENT = 'SimulationUpdated'"))
  assert.ok(journeyHook.includes("JOURNEY_UPDATED_EVENT = 'JourneySimulationUpdated'"))

  /* Ayrı grup metotları: kişisel bir yolculuk, paylaşılan bir hat grubuna
     KATILAMAZ. */
  assert.ok(transportClient.includes("JOIN_ROUTE_METHOD = 'JoinRoute'"))
  assert.ok(transportClient.includes("LEAVE_ROUTE_METHOD = 'LeaveRoute'"))
  assert.ok(journeyHook.includes("JOIN_SIMULATION_METHOD = 'JoinSimulation'"))
  assert.ok(journeyHook.includes("LEAVE_SIMULATION_METHOD = 'LeaveSimulation'"))
  assert.ok(!journeyHook.includes('JoinRoute'))
  assert.ok(!journeyHook.includes('LeaveRoute'))

  // Ve yolculuk ürünü sabit hat istemcisinin YERİNE geçmez.
  assert.ok(!journeyHook.includes('createTransportSimulationClient'))
  assert.ok(!journeyHub.includes('createTransportSimulationConnection'))
})

test('the map reuses the Phase 4 vehicle layer, presentation and popup', () => {
  assert.match(mapPage, /import useTransportVehicleLayer from '\.\.\/hooks\/useTransportVehicleLayer\.js'/)
  assert.match(mapPage, /transportVehiclePresentation\(\{/)
  assert.match(mapPage, /transportVehiclePopupModel\(transportVehicle\)/)
  assert.match(mapPage, /<TransportVehiclePopup/)

  /* İkinci bir araç katmanı kurulmadı: katman yalnızca paylaşılan kancanın
     içinde yaratılır. Harita da tektir — sayfadaki tek `new Map` çağrısı
     zaten var olan çalışma alanı haritasıdır ve ona bir yenisi EKLENMEDİ. */
  assert.ok(!mapPage.includes('createTransportVehicleLayer'))
  assert.equal((mapPage.match(/new Map\(\{/g) ?? []).length, 1)
  assert.match(read('../../src/hooks/useTransportVehicleLayer.js'), /createTransportVehicleLayer\(\)/)
})

test('the tracking control is one shared component, used by both surfaces', () => {
  assert.match(mapPage, /import TransportTrackingControls from '\.\.\/components\/map\/TransportTrackingControls\.jsx'/)
  assert.match(adminPage, /import TransportTrackingControls from '\.\.\/\.\.\/components\/map\/TransportTrackingControls\.jsx'/)

  // Görünürlük kuralı tek yerden gelir; iki ekran kendi kuralını yazmaz.
  for (const source of [mapPage, adminPage]) {
    assert.match(source, /transportSimulationControls\(\{/)
  }
  assert.match(controls, /controls\.showStart/)
  assert.match(controls, /controls\.showFollow/)
  assert.match(controls, /controls\.showUnfollow/)
})

/* --- Mevcut davranış korunur --------------------------------------------------- */

test('existing main-map transport wiring is untouched', () => {
  assert.match(mapPage, /const transport = useTransportLayer\(mapInstance, \{/)
  assert.match(mapPage, /<TransportStopPopup/)
  assert.match(mapPage, /onShowRoute=\{showTransportRoute\}/)
  assert.match(mapPage, /setSelectedTransportRouteId\(Number\(routeId\)\)/)
  assert.match(mapPage, /selectedRouteId:\s*selectedTransportRouteId/)
})

test('the admin surface keeps its own start flow and button language', () => {
  assert.match(adminPage, /simulation\.start\(selectedRoute\.id\)/)
  assert.match(adminPage, /setStartedSimulationId\(snapshot\.simulationId\)/)
  // Yönetim ekranı kendi düğme dilini korur (varsayılan admin-button).
  assert.doesNotMatch(adminPage, /primaryButtonClassName/)
  assert.match(mapPage, /primaryButtonClassName="transport-popup-action"/)
})
