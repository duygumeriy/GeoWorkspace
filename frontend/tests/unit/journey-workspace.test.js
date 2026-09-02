import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  JOURNEY_PRODUCTS,
  canOpenJourneyWorkspace,
  journeyProductLabel,
  journeyProductTabs,
  journeyWorkspaceProducts,
  resolveJourneyProduct,
  sharedJourneyPresentation,
} from '../../src/map/journeyWorkspace.js'
import {
  JOURNEY_MODES,
  PANEL_STATES,
  initialJourneyPlannerState,
  journeyPickingActive,
  journeyPlannerReducer,
} from '../../src/map/journeyPlanning.js'
import { transportSimulationControls } from '../../src/map/transportSimulationState.js'

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

/** Yorumlar ayıklanır: bir kavramı ANLATMAK onu uygulamak değildir. */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

const MAP_PAGE = stripComments(read('../../src/pages/MapPage.jsx'))
const PANEL = stripComments(read('../../src/components/map/JourneyPlannerPanel.jsx'))
const SHARED = stripComments(read('../../src/components/map/SharedTransportJourneyContent.jsx'))
const WORKSPACE = stripComments(read('../../src/map/journeyWorkspace.js'))
const ADMIN_PAGE = read('../../src/pages/admin/TransportRoutePage.jsx')

const BOTH = { canUseJourney: true, canViewTransport: true }
const JOURNEY_ONLY = { canUseJourney: true, canViewTransport: false }
const TRANSPORT_ONLY = { canUseJourney: false, canViewTransport: true }
const NEITHER = { canUseJourney: false, canViewTransport: false }

/* --- 1/2/3. Ürün erişimi ------------------------------------------------------ */

test('the workspace trigger opens for anyone holding at least one journey product', () => {
  /* Paylaşılan hat bu fazda çalışma alanının İÇİNE taşındı; kısayolu yalnızca
     `journey.use`'a bağlamak, `transport.view` taşıyan bir kullanıcının hat
     simülasyonuna hiçbir yerden ulaşamaması demek olurdu. */
  assert.equal(canOpenJourneyWorkspace(BOTH), true)
  assert.equal(canOpenJourneyWorkspace(JOURNEY_ONLY), true)
  assert.equal(canOpenJourneyWorkspace(TRANSPORT_ONLY), true)

  // Hiçbir ürünü olmayana kapı da açılmaz (fail-closed).
  assert.equal(canOpenJourneyWorkspace(NEITHER), false)
  assert.equal(canOpenJourneyWorkspace(), false)
})

test('a journey-only user is offered the personal product and never the shared one', () => {
  assert.deepEqual(journeyWorkspaceProducts(JOURNEY_ONLY), [JOURNEY_PRODUCTS.PERSONAL])

  // Tek ürünü olan kullanıcıya sekme çubuğu gösterilmez.
  assert.deepEqual(journeyProductTabs(JOURNEY_ONLY), [])

  /* Paylaşılan ürün İSTENSE bile açılmaz: kapıyı açmak, ürünü açmak
     değildir ve iki yetki birbirini İMA ETMEZ. */
  assert.equal(
    resolveJourneyProduct({ requested: JOURNEY_PRODUCTS.SHARED, ...JOURNEY_ONLY }),
    JOURNEY_PRODUCTS.PERSONAL,
  )
})

test('a transport-only user is offered the shared product and never the personal one', () => {
  assert.deepEqual(journeyWorkspaceProducts(TRANSPORT_ONLY), [JOURNEY_PRODUCTS.SHARED])
  assert.deepEqual(journeyProductTabs(TRANSPORT_ONLY), [])

  /* Varsayılan istek KİŞİSELDİR (indirgeyicinin başlangıç değeri); erişimi
     olmayan kullanıcı yine de doğrudan paylaşılan ürünü görür — kullanılamayan
     bir sekmeyle karşılaşmaz. */
  assert.equal(
    resolveJourneyProduct({ requested: JOURNEY_PRODUCTS.PERSONAL, ...TRANSPORT_ONLY }),
    JOURNEY_PRODUCTS.SHARED,
  )
  assert.equal(
    resolveJourneyProduct({ requested: null, ...TRANSPORT_ONLY }),
    JOURNEY_PRODUCTS.SHARED,
  )
})

test('a user holding both products gets both tabs in a stable order', () => {
  assert.deepEqual(journeyWorkspaceProducts(BOTH), [JOURNEY_PRODUCTS.PERSONAL, JOURNEY_PRODUCTS.SHARED])

  assert.deepEqual(journeyProductTabs(BOTH), [
    { id: JOURNEY_PRODUCTS.PERSONAL, label: 'Kendi Yolculuğum' },
    { id: JOURNEY_PRODUCTS.SHARED, label: 'Paylaşımlı Ulaşım' },
  ])

  // Etiketler ÜRÜN adlarıdır; kişisel planlama kipleriyle karışmaz.
  assert.equal(journeyProductLabel(JOURNEY_PRODUCTS.PERSONAL), 'Kendi Yolculuğum')
  assert.equal(journeyProductLabel(JOURNEY_PRODUCTS.SHARED), 'Paylaşımlı Ulaşım')
  assert.notEqual(journeyProductLabel(JOURNEY_PRODUCTS.SHARED), 'Hat')
})

test('no product is resolved when the user holds neither capability', () => {
  assert.equal(resolveJourneyProduct({ requested: JOURNEY_PRODUCTS.PERSONAL, ...NEITHER }), null)
  assert.equal(resolveJourneyProduct(), null)
})

/* --- 4/22. Ürün değiştirmek hiçbir ürünü durdurmaz ---------------------------- */

test('switching the presented product is presentation only', () => {
  const personal = { ...initialJourneyPlannerState(), panel: PANEL_STATES.OPEN, routeId: 7 }

  const shared = journeyPlannerReducer(personal, { type: 'setProduct', product: JOURNEY_PRODUCTS.SHARED })
  assert.equal(shared.product, JOURNEY_PRODUCTS.SHARED)

  /* Kişisel PLAN olduğu gibi durur: seçimler, kip, profil ve panel korunur.
     İndirgeyici hiçbir yaşam döngüsü komutu üretmez — durdurma, bırakma ve
     kanal kapatma burada YOKTUR ve olamaz. */
  assert.equal(shared.routeId, 7)
  assert.equal(shared.mode, personal.mode)
  assert.equal(shared.profile, personal.profile)
  assert.equal(shared.panel, PANEL_STATES.OPEN)
  assert.deepEqual(shared.waypoints, personal.waypoints)

  // Geri dönmek de aynı planı bulur.
  const back = journeyPlannerReducer(shared, { type: 'setProduct', product: JOURNEY_PRODUCTS.PERSONAL })
  assert.equal(back.product, JOURNEY_PRODUCTS.PERSONAL)
  assert.equal(back.routeId, 7)
})

test('an unknown or repeated product is ignored by the reducer', () => {
  const state = initialJourneyPlannerState()
  assert.equal(journeyPlannerReducer(state, { type: 'setProduct', product: 'bus' }), state)
  assert.equal(journeyPlannerReducer(state, { type: 'setProduct', product: state.product }), state)
})

/* --- 5. Harita temiz açılır ---------------------------------------------------- */

test('the workspace does not open by itself on first load', () => {
  assert.equal(initialJourneyPlannerState().panel, PANEL_STATES.CLOSED)
  assert.equal(initialJourneyPlannerState({ canUseTransport: false }).panel, PANEL_STATES.CLOSED)

  // Varsayılan ürün kişiseldir; erişime indirgeme ayrı bir karardır.
  assert.equal(initialJourneyPlannerState().product, JOURNEY_PRODUCTS.PERSONAL)

  /* Kurtarma paneli AÇMAZ: canlı yolculuk kancası yalnızca sunucudaki
     çalıştırmayı izlemeye devam eder ve kamerayı istemez. */
  const live = stripComments(read('../../src/hooks/useJourneySimulation.js'))
  assert.ok(!live.includes('openPanel'))
  assert.ok(!live.includes('setPanel'))
  assert.ok(live.includes('adoptedJourneyFollow(JOURNEY_ADOPTION.RECOVERY)'))
})

/* --- 6/7. Güzergah tıklaması --------------------------------------------------- */

test('a route line click opens the workspace in the shared product with that route', () => {
  const handler = MAP_PAGE.slice(
    MAP_PAGE.indexOf('const handleTransportRouteSelected'),
    MAP_PAGE.indexOf('const isTransportRouteSelectable'),
  )
  assert.ok(handler, 'güzergah tıklama işleyicisi bulunamadı')

  // KANONİK seçim güncellenir; ikinci bir "seçili rota" durumu doğmaz.
  assert.ok(handler.includes('setSelectedTransportRouteId(next)'))
  assert.equal((MAP_PAGE.match(/selectedTransportRouteId, setSelectedTransportRouteId/g) ?? []).length, 1)

  // Ve çalışma alanı PAYLAŞILAN bağlamda açılır.
  assert.ok(handler.includes('openJourneyWorkspaceWith(JOURNEY_PRODUCTS.SHARED)'))
})

test('a route click starts nothing, follows nothing and claims no camera', () => {
  const handler = MAP_PAGE.slice(
    MAP_PAGE.indexOf('const handleTransportRouteSelected'),
    MAP_PAGE.indexOf('const isTransportRouteSelectable'),
  )

  /* Tıklama bir SEÇİMDİR, bir yaşam döngüsü komutu DEĞİL. */
  for (const forbidden of ['simulation.start', 'simulation.follow', 'setFollowing', 'setStartedSimulationId']) {
    assert.ok(!handler.includes(forbidden), `güzergah tıklaması ${forbidden} çağırıyor`)
  }

  // Kamera da oynatılmaz: kullanıcı zaten baktığı yere tıkladı.
  for (const camera of ['mapView.', 'focusRoute', 'fitExtent', 'focusPoint', 'setZoom']) {
    assert.ok(!handler.includes(camera), `güzergah tıklaması kamerayı oynatıyor (${camera})`)
  }

  // Açılış yolu da yalnızca SUNUM yapar.
  const opener = MAP_PAGE.slice(
    MAP_PAGE.indexOf('const openJourneyWorkspaceWith'),
    MAP_PAGE.indexOf('const closeJourneyPanel'),
  )
  assert.ok(opener.includes('journey.setProduct(product)'))
  assert.ok(opener.includes('journey.openPanel()'))
  assert.ok(!opener.includes('follow'))
  assert.ok(!opener.includes('start'))
})

/* --- 8. Araç tıklaması önceliği ------------------------------------------------ */

test('the moving vehicle keeps click precedence and still opens its popup', () => {
  const interaction = stripComments(read('../../src/hooks/useTransportStopInteraction.js'))

  /* Zincir DEĞİŞMEDİ: araç isabeti en üsttedir ve güzergah seçimi ona hiç
     ulaşmaz — bu kanca araçta yalnızca ÇEKİLİR.

     Faz 10'da kararın kendisi saf `transportClickOutcome`'a taşındı, bu yüzden
     sıra artık METİNDE değil DAVRANIŞTA kanıtlanır (bkz.
     `map-selection-consistency.test.js`); burada yalnızca kancanın o karara
     uyduğu ve araçta çekildiği okunur. */
  assert.ok(interaction.includes('transportClickOutcome'))
  assert.match(interaction, /if \(outcome\.action === TRANSPORT_CLICK_ACTIONS\.IGNORE\) return/)

  const ignoreBranch = interaction.indexOf('TRANSPORT_CLICK_ACTIONS.IGNORE')
  const routeBranch = interaction.indexOf('TRANSPORT_CLICK_ACTIONS.SELECT_ROUTE')
  assert.ok(ignoreBranch > 0 && routeBranch > ignoreBranch, 'araç önceliği güzergahın önünde değil')

  // Balonu hâlâ aracın kendi katmanı açar; ikinci bir isabet kuralı yazılmadı.
  assert.ok(MAP_PAGE.includes('onVehicleClick: openVehiclePopup'))
  assert.ok(MAP_PAGE.includes('<TransportVehiclePopup'))
})

/* --- 9. Nokta seçimi sahipliği ------------------------------------------------- */

test('waypoint picking still outranks shared route takeover', () => {
  /* Silahlı seçim sırasında ulaşım tıklaması ZATEN çekilir; kural değişmedi
     ve güzergah seçimi o kancanın içindedir, dolayısıyla paylaşılan ürüne
     geçiş de olamaz. */
  assert.ok(MAP_PAGE.includes('enabled: allowed.canViewTransport && workspaceMode.isSelecting && !journey.isPicking'))

  /* Ve seçim, PAYLAŞILAN ürün gösterilirken hiç silahlanmaz: görünmeyen bir
     yuvaya yazılmaz. */
  const armed = {
    mode: JOURNEY_MODES.WAYPOINTS,
    panel: PANEL_STATES.OPEN,
    activeSlotKey: 'wp-1',
    workspaceAtRest: true,
  }
  assert.equal(journeyPickingActive({ ...armed, product: JOURNEY_PRODUCTS.PERSONAL }), true)
  assert.equal(journeyPickingActive({ ...armed, product: JOURNEY_PRODUCTS.SHARED }), false)

  // İndirgeyici de ürün değişiminde silahı bırakır.
  const switched = journeyPlannerReducer(
    { ...initialJourneyPlannerState(), activeSlotKey: 'wp-1' },
    { type: 'setProduct', product: JOURNEY_PRODUCTS.SHARED },
  )
  assert.equal(switched.activeSlotKey, null)
})

/* --- 10. Ayrı takip kartı kaldırıldı ------------------------------------------- */

test('the standalone shared tracking card is gone from the main map but kept in admin', () => {
  assert.ok(!MAP_PAGE.includes('TransportTrackingControls'), 'ana harita hâlâ ayrı kartı çiziyor')
  assert.ok(!MAP_PAGE.includes('transport-tracking-card'))

  // Bileşen SİLİNMEDİ: güzergah yönetimi ekranı onu kullanmaya devam eder.
  assert.match(ADMIN_PAGE, /<TransportTrackingControls/)
  assert.match(ADMIN_PAGE, /import TransportTrackingControls from/)
})

/* --- 11/12. Paylaşılan hat: aktif simülasyon YOK ------------------------------- */

const ROUTES = [{ id: 7, name: '7 Numaralı Hat', colorHex: '#123456' }]
const PATHS = [{ routeId: 7, distanceMeters: 5400, durationSeconds: 900 }]

const presentFor = ({ canStart = false, simulation = null, followingRouteId = null } = {}) =>
  sharedJourneyPresentation({
    routeId: 7,
    routes: ROUTES,
    paths: PATHS,
    controls: transportSimulationControls({
      routeId: 7,
      simulation,
      followingRouteId,
      canStart,
    }),
  })

test('an inactive route shows no simulation and offers no start to a view-only user', () => {
  const shared = presentFor({ canStart: false })

  assert.equal(shared.routeName, '7 Numaralı Hat')
  assert.equal(shared.isActive, false)

  // Sahte ilerleme YOKTUR.
  assert.equal(shared.progressPercent, null)
  assert.equal(shared.progressLabel, null)

  // Başlatma da durdurma da sunulmaz.
  assert.equal(shared.showStart, false)
  assert.equal(shared.showFollow, false)
  assert.equal(shared.showUnfollow, false)

  // Ve "aktif simülasyon yok" görünür bir cümledir.
  assert.ok(SHARED.includes('Aktif simülasyon yok'))
})

test('an inactive route offers start only to a user holding the start permission', () => {
  assert.equal(presentFor({ canStart: true }).showStart, true)
  assert.equal(presentFor({ canStart: false }).showStart, false)

  // Yetki kodu MapPage'de tek yerden okunur; panel kendi kararını vermez.
  assert.match(MAP_PAGE, /const canStartSharedSimulation = can\(PERMISSIONS\.TRANSPORT_SIMULATION_START\)/)
  assert.match(MAP_PAGE, /canStart: canStartSharedSimulation\b/)
  assert.ok(!SHARED.includes('PERMISSIONS.'))
})

/* --- 13/14/15. Paylaşılan hat: aktif simülasyon -------------------------------- */

const RUNNING = {
  simulationId: 'sim-1',
  routeId: 7,
  status: 'Running',
  longitude: 30,
  latitude: 40,
  progressPercent: 42,
  updatedAtUtc: '2026-09-01T10:00:00Z',
}

test('an active route reports the server snapshot progress and offers follow', () => {
  const shared = presentFor({ simulation: RUNNING })

  assert.equal(shared.isActive, true)
  assert.equal(shared.statusLabel, 'Çalışıyor')
  // İlerleme SUNUCUNUN değeridir; tarayıcıda ikinci bir yüzde hesaplanmaz.
  assert.equal(shared.progressPercent, 42)
  assert.equal(shared.progressLabel, '%42')

  // Mesafe/süre kalıcı güzergahtan gelir ve uydurulmaz.
  assert.equal(shared.distanceMeters, 5400)
  assert.equal(shared.durationSeconds, 900)

  assert.equal(shared.showFollow, true)
  assert.equal(shared.showUnfollow, false)
})

test('opening the shared product never follows by itself', () => {
  /* Gözlem ≠ TAKİP. Rota seçili ve simülasyon çalışıyor olsa bile takip
     KAPALIDIR: yalnızca kullanıcının açık "Takip Et" kararı onu açar. */
  const shared = presentFor({ simulation: RUNNING, followingRouteId: null })

  assert.equal(shared.isFollowing, false)
  assert.equal(shared.showUnfollow, false)
  assert.equal(shared.showFollow, true)

  // Ve hiçbir açılış yolu takip çağırmaz.
  assert.ok(!MAP_PAGE.includes('openJourneyWorkspaceWith(JOURNEY_PRODUCTS.SHARED)\n    simulation.follow'))
  const opener = MAP_PAGE.slice(
    MAP_PAGE.indexOf('const openJourneyWorkspaceWith'),
    MAP_PAGE.indexOf('const closeJourneyPanel'),
  )
  assert.ok(!opener.includes('follow'))
})

test('unfollow releases only the camera and never stops the shared run', () => {
  const following = presentFor({ simulation: RUNNING, followingRouteId: 7 })

  assert.equal(following.isFollowing, true)
  assert.equal(following.showUnfollow, true)
  // GÖZLEM sürer: çalıştırma hâlâ aktiftir ve ilerleme okunmaya devam eder.
  assert.equal(following.isActive, true)
  assert.equal(following.progressPercent, 42)

  /* Bırakmak yalnızca kamera sahipliğini bırakır; hiçbir yaşam döngüsü
     komutu göndermez. */
  const unfollow = MAP_PAGE.slice(
    MAP_PAGE.indexOf('const unfollowSharedSimulation'),
    MAP_PAGE.indexOf('const sharedJourney'),
  )
  assert.ok(unfollow.includes('simulation.unfollow()'))
  assert.ok(!unfollow.includes('stop'))
  assert.ok(!unfollow.includes('cancel'))
})

/* --- 16/17. Bu fazda OLMAYANLAR ------------------------------------------------ */

test('the shared stop control stays a permission-gated, confirmed command', () => {
  /* Faz 2'de bu bir OLUMSUZLUKTU: durdurmayı tüketen bir backend komutu
     henüz yoktu, bu yüzden düğme de yoktu. Faz 3 komutu ekledi; iddia
     ZAYIFLAMADI, sınırları taşındı — düğme artık var ama YALNIZCA kendi
     yetkisiyle, yalnızca aktif bir çalıştırmada ve YALNIZCA onayın ardında.

     Bu bölümün ölçtüğü şey hâlâ aynıdır: paylaşılan bölüm kendi yetki
     kararını vermez, komutu kendi göndermez ve terminal durumu uydurmaz.
     Yaşam döngüsünün tamamı `transport-simulation-stop.test.js`'tedir. */
  for (const [name, source] of [['SharedTransportJourneyContent.jsx', SHARED], ['journeyWorkspace.js', WORKSPACE]]) {
    // Yetki kararı burada VERİLMEZ; hazır bir bayrak olarak gelir.
    assert.ok(!source.includes('TRANSPORT_SIMULATION_STOP'), `${name} yetki kodunu kendisi okuyor`)
    // Komut da buradan GÖNDERİLMEZ.
    assert.ok(!/stopTransportSimulation|cancelTransportSimulation/.test(source), `${name} durdurma komutu çağırıyor`)
  }

  /* Düğme SUNUM bileşenindedir ve yalnızca haber verir; onayı ve isteği
     çağıran yüzey yönetir. */
  assert.ok(SHARED.includes('shared.showStop &&'))
  assert.ok(SHARED.includes('onClick={onStop}'))
  /* Faz 3B: terminal eylemin KULLANICI SÖZCÜĞÜ "Sıfırla" oldu. Ürün anlamı
     "çalıştırmayı bitir ve hattı yeniden başlatılabilir hâle getir"dir;
     "Duraklat" ise aynı çalıştırmayı sürdürülebilir biçimde dondurur. Backend
     sözleşmesi (Stop) DEĞİŞMEDİ. */
  assert.ok(SHARED.includes('Sıfırla'))
  assert.ok(!SHARED.includes('Simülasyonu Durdur'))

  // KİŞİSEL yolculuk kendi sözcüğünü korur; iki ürün karışmaz.
  assert.ok(PANEL.includes('Simülasyonu Durdur'))

  // Ve karar saf kuralın ürettiği bayraklardan okunur.
  assert.ok(WORKSPACE.includes('showStop: Boolean(controls?.showStop)'))
  assert.ok(WORKSPACE.includes('stoppableSimulationId: controls?.stoppableSimulationId ?? null'))

  /* Başlatma yetkisi durdurma otoritesi olarak KULLANILMAZ: iki bayrak
     birbirinden türetilmez. */
  assert.ok(!/showStop[^\n]*showStart/.test(WORKSPACE))
  assert.ok(!/showStop[^\n]*canStart/.test(WORKSPACE))
})

test('no shared navigation or maneuver is fabricated', () => {
  /* Kalıcı güzergah (`TransportRoutePath`) manevra bilgisi TAŞIMAZ; geometriden
     talimat türetmek, sunucunun bilmediği bir yönlendirmeyi otoriter gibi
     göstermek olurdu. */
  for (const [name, source] of [['SharedTransportJourneyContent.jsx', SHARED], ['journeyWorkspace.js', WORKSPACE]]) {
    for (const forbidden of ['journeyNavigationModel', 'journeyStepList', 'currentStepSequence', 'maneuver', 'Yol Tarifi']) {
      assert.ok(!source.includes(forbidden), `${name} paylaşılan yönlendirme uyduruyor (${forbidden})`)
    }
  }

  // Paylaşılan bölüm yalnızca kanonik alanları taşır.
  const shared = presentFor({ simulation: RUNNING })
  assert.deepEqual(
    Object.keys(shared).filter((key) => /step|instruction|maneuver|direction/i.test(key)),
    [],
  )
})

/* --- 18/19. Kişisel ürün ve kanal ayrımı --------------------------------------- */

test('the personal journey lifecycle wiring is untouched', () => {
  assert.ok(MAP_PAGE.includes('useJourneySimulation({ permitted: allowed.canUseJourney })'))
  assert.ok(MAP_PAGE.includes('useJourneyVehicleLayer(mapInstance, {'))
  assert.ok(MAP_PAGE.includes('onStartSimulation={startJourney}'))
  assert.ok(MAP_PAGE.includes('onStopSimulation={requestJourneyStop}'))
  assert.ok(MAP_PAGE.includes('onToggleFollow={toggleJourneyFollow}'))
  assert.ok(MAP_PAGE.includes('onReturnToPlanning={returnToJourneyPlanning}'))

  // Kişisel planlama KİPLERİ ürün ekseniyle birleştirilmedi.
  assert.ok(PANEL.includes('JOURNEY_MODES.ROUTE_FULL'))
  assert.ok(PANEL.includes('JOURNEY_MODES.ROUTE_SEGMENT'))
  assert.ok(PANEL.includes('JOURNEY_MODES.WAYPOINTS'))
  assert.ok(PANEL.includes('onModeChange'))
})

test('the two products keep separate SignalR clients and services', () => {
  const personal = stripComments(read('../../src/services/journeySimulationHub.js'))
  const sharedClient = stripComments(read('../../src/services/transportSimulationHub.js'))

  assert.ok(!personal.includes('transport-simulation'))
  assert.ok(!sharedClient.includes('journey-simulation'))

  // Ana harita iki AYRI kancayı çağırır; birleşik bir kanca kurulmadı.
  assert.ok(MAP_PAGE.includes('useJourneySimulation({'))
  assert.ok(MAP_PAGE.includes('useTransportSimulation({'))
  for (const forbidden of ['UnifiedSimulation', 'useUnifiedSimulation', 'mergedSimulation']) {
    assert.ok(!MAP_PAGE.includes(forbidden))
  }

  /* Sunum modeli de bir durum makinesi DEĞİLDİR: ağ çağrısı, kanal ya da
     zamanlayıcı içermez. */
  for (const forbidden of ['fetch', 'signalr', 'setInterval', 'setTimeout', 'useState', 'useEffect']) {
    assert.ok(!WORKSPACE.toLowerCase().includes(forbidden.toLowerCase()), `journeyWorkspace.js ${forbidden} taşıyor`)
  }
})

/* --- 20. Yetkilendirme kestirmesi YOKTUR --------------------------------------- */

test('the workspace authorization path carries no role-name shortcut', () => {
  const PATTERNS = [
    /\b(currentUser|user|auth|session|account|identity|principal|claims|me)\s*\??\.\s*roles?\b/i,
    /\broles\s*\??\.\s*(includes|some|indexOf|find)\s*\(/i,
    /\brole\w*\s*[=!]==?\s*['"`]\s*(admin|administrator|operat|viewer|editor|superuser|ulaşım)/i,
    /\bis_?admin\b/i,
    /\bis_?operator\b/i,
    /\busername\s*[=!]==?/i,
  ]

  for (const [name, source] of [
    ['journeyWorkspace.js', WORKSPACE],
    ['SharedTransportJourneyContent.jsx', SHARED],
    ['JourneyPlannerPanel.jsx', PANEL],
  ]) {
    for (const pattern of PATTERNS) {
      assert.ok(!pattern.test(source), `${name} rol/kimlik kestirmesi taşıyor: ${pattern}`)
    }
  }

  /* Kararlar YALNIZCA yetenek bayraklarından gelir; saf modül yetki KODU bile
     okumaz — kodları okuyan tek yer mevcut yetki kancasıdır. */
  assert.ok(!WORKSPACE.includes('PERMISSIONS.'))
  assert.ok(MAP_PAGE.includes('canUseJourney: allowed.canUseJourney'))
  assert.ok(MAP_PAGE.includes('canViewTransport: allowed.canViewTransport'))
})

/* --- 21. Kapatmak SUNUMDUR ----------------------------------------------------- */

test('closing the workspace stays presentation only', () => {
  const close = MAP_PAGE.slice(
    MAP_PAGE.indexOf('const closeJourneyPanel'),
    MAP_PAGE.indexOf('const toggleJourneyPanel'),
  )
  assert.ok(close.includes('journey.closePanel()'))

  /* Kapatmak hiçbir ürünü durdurmaz, hiçbir takibi bırakmaz ve hiçbir kanalı
     kapatmaz. */
  for (const forbidden of ['simulation.stop', 'simulation.unfollow', 'journeySimulation.stop', 'journeySimulation.dismiss', 'setFollowing']) {
    assert.ok(!close.includes(forbidden), `paneli kapatmak ${forbidden} çağırıyor`)
  }

  // İndirgeyici de yalnızca görünürlüğü ve silahı değiştirir.
  const state = { ...initialJourneyPlannerState(), panel: PANEL_STATES.OPEN, routeId: 7, activeSlotKey: 'wp-1' }
  const closed = journeyPlannerReducer(state, { type: 'setPanel', panel: PANEL_STATES.CLOSED })

  assert.equal(closed.panel, PANEL_STATES.CLOSED)
  assert.equal(closed.activeSlotKey, null)
  assert.equal(closed.routeId, 7)
  assert.equal(closed.product, state.product)
})

/* --- Panel kabuğu --------------------------------------------------------------- */

test('the panel renders exactly one product at a time and both keep running', () => {
  // Ürün sekmeleri YALNIZCA birden fazla ürün varken çıkar.
  assert.ok(PANEL.includes('productTabs.length > 1'))
  assert.ok(PANEL.includes('aria-label="Yolculuk ürünü"'))

  // Paylaşılan bölüm kendi bileşenindedir; MapPage dev bir koşula dönüşmedi.
  assert.ok(PANEL.includes('<SharedTransportJourneyContent'))
  assert.ok(PANEL.includes('showingShared && ('))

  // Kişisel evreler paylaşılan görünümde ÇİZİLMEZ ama durumları korunur.
  assert.ok(PANEL.includes('showingPersonal && isLive && ('))
  assert.ok(PANEL.includes('showingPersonal && !isLive && ('))

  /* Ürün değişimi bir yaşam döngüsü çağrısı yapmaz: panel yalnızca haber
     verir. */
  assert.ok(PANEL.includes('onProductChange?.(tab.id)'))
  assert.ok(!PANEL.includes('onProductChange?.(tab.id); onStopSimulation'))
})
