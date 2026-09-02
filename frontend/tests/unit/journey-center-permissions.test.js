import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { PERMISSIONS } from '../../src/auth/permissionCodes.js'
import {
  JOURNEY_MODES,
  initialJourneyPlannerState,
} from '../../src/map/journeyPlanning.js'

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

/** Yorumlar ayıklanır: bir kavramı ANLATMAK onu uygulamak değildir. */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

const MAP_PAGE = read('../../src/pages/MapPage.jsx')
const PANEL = read('../../src/components/map/JourneyPlannerPanel.jsx')
const PLANNER_HOOK = read('../../src/hooks/useJourneyPlanner.js')
const SIMULATION_HOOK = read('../../src/hooks/useJourneySimulation.js')
const WORKSPACE_PERMISSIONS = read('../../src/hooks/useWorkspacePermissions.js')
const PERMISSION_CODES = read('../../src/auth/permissionCodes.js')

/* --- Kanonik kodlar ---------------------------------------------------------- */

test('the two new capabilities exist as canonical frontend codes', () => {
  /* Backend'in `PermissionCodes` sabitleriyle BİREBİR aynı olmalıdır: bir harf
     farkı sessizce "yetki yok" demek olurdu ve hiçbir yerde hata vermezdi. */
  assert.equal(PERMISSIONS.JOURNEY_USE, 'journey.use')
  assert.equal(PERMISSIONS.TRANSPORT_SIMULATION_STOP, 'transport.simulation.stop')

  // Mevcut kodlar DEĞİŞMEDİ; yeni kodlar onların takma adı değildir.
  assert.equal(PERMISSIONS.TRANSPORT_VIEW, 'transport.view')
  assert.equal(PERMISSIONS.TRANSPORT_SIMULATION_START, 'transport.simulation.start')
  assert.notEqual(PERMISSIONS.JOURNEY_USE, PERMISSIONS.TRANSPORT_VIEW)
  assert.notEqual(PERMISSIONS.TRANSPORT_SIMULATION_STOP, PERMISSIONS.TRANSPORT_SIMULATION_START)
})

test('no follow or unfollow permission code was invented', () => {
  /* Takip KAMERA sahipliğidir: "Takibi Bırak", "Simülasyonu Durdur" DEĞİLDİR
     ve bir backend yaşam döngüsü komutu değildir. */
  for (const code of Object.values(PERMISSIONS)) {
    assert.ok(!/follow|takip/i.test(code), `takip için yetki kodu üretilmiş: ${code}`)
  }
})

/* --- Kişisel yolculuk ürün kapısı -------------------------------------------- */

test('the workspace exposes a journey capability read from journey.use alone', () => {
  const code = stripComments(WORKSPACE_PERMISSIONS)

  assert.ok(code.includes('const canUseJourney = can(PERMISSIONS.JOURNEY_USE)'))
  assert.ok(/\n\s*canUseJourney,/.test(code), 'yetenek dışa verilmiyor')

  /* `transport.view` ile BİRLEŞTİRİLMEZ: birleştirmek, ürünü yalnızca ulaşım
     ağını da görebilen kullanıcılara açmak olurdu. */
  assert.ok(!/canUseJourney\s*=\s*canAll\(/.test(code))
  assert.ok(!/canUseJourney[^\n]*TRANSPORT_VIEW/.test(code))
})

test('every personal journey surface is gated by the journey capability', () => {
  const code = stripComments(MAP_PAGE)

  // Planlayıcı kancası, canlı simülasyon kancası, panel ve kısayol.
  assert.ok(/useJourneyPlanner\(\{[^}]*permitted:\s*allowed\.canUseJourney/s.test(code))
  assert.ok(code.includes('useJourneySimulation({ permitted: allowed.canUseJourney })'))
  /* Faz 2: çalışma alanı EN AZ BİR ürünle çizilir (`canOpenJourney`); KİŞİSEL
     bölüm ise hâlâ yalnızca `journey.use` ile sunulur ve o karar saf modülde
     verilir. Kapıyı açmak, ürünü açmak DEĞİLDİR. */
  assert.ok(code.includes('{canOpenJourney && ('))
  assert.ok(code.includes('canUseJourney: allowed.canUseJourney'))
  /* Faz 2: kısayol BİRLEŞİK çalışma alanını açar ve en az bir üründe
     görünür; kişisel ürünün kendi kapısı yukarıda ölçüldü. */
  assert.ok(/journey=\{\{\s*permitted:\s*canOpenJourney/s.test(code))

  /* Eski bağlanma geri gelmemelidir: hiçbir yolculuk yüzeyi artık
     `canViewTransport` üzerinden açılmaz. */
  assert.ok(!/useJourneySimulation\(\{\s*permitted:\s*allowed\.canViewTransport/.test(code))
  assert.ok(!/useJourneyPlanner\(\{[^}]*permitted:\s*allowed\.canViewTransport/s.test(code))
})

/* --- Ürün kapısı bir KAYNAK anahtarı değildir -------------------------------- */

test('transport route and stop selections still require transport.view', () => {
  const mapPage = stripComments(MAP_PAGE)
  const panel = stripComments(PANEL)

  // Yetenek panele AYRI bir prop olarak geçer; ürün kapısıyla karıştırılmaz.
  assert.ok(/canUseTransport=\{allowed\.canViewTransport\}/.test(mapPage))
  assert.ok(/canUseTransport:\s*allowed\.canViewTransport/.test(mapPage))

  // Hat kipleri, hat seçici ve bölüm seçicileri hepsi aynı bayrağı okur.
  assert.ok(panel.includes('MODE_TABS.filter((tab) => canUseTransport || !tab.transport)'))
  assert.ok(panel.includes('canUseTransport && state.mode !== JOURNEY_MODES.WAYPOINTS'))
  assert.ok(panel.includes('canUseTransport && state.mode === JOURNEY_MODES.ROUTE_SEGMENT'))

  // Durak önerileri yetkisi olmayana HİÇ sunulmaz.
  assert.ok(panel.includes('routeStops={canUseTransport ? stops : []}'))
})

test('poi selections still require poi.view and are independent of the journey gate', () => {
  const mapPage = stripComments(MAP_PAGE)
  const panel = stripComments(PANEL)

  assert.ok(mapPage.includes('canUsePois={allowed.canViewPoi}'))
  assert.ok(/enabled:\s*allowed\.canViewPoi && journey\.isPicking/.test(mapPage))

  // POI önerileri kendi bayrağının ardındadır ve ulaşım bayrağına bakmaz.
  assert.ok(panel.includes('{canUsePois && (poiSearch?.results ?? []).map('))
  assert.ok(!/canUsePois\s*&&\s*canUseTransport/.test(panel))
})

test('a journey user without transport access starts in the free waypoint mode', () => {
  /* Hat kipleri ulaşım ağına erişim ister; varsayılan olarak hiç
     doldurulamayacak bir hat formu açmak, garanti 403'e davet etmek olurdu.
     Bu bir yetkilendirme kararı DEĞİL, bir başlangıç seçimidir. */
  assert.equal(initialJourneyPlannerState().mode, JOURNEY_MODES.ROUTE_FULL)
  assert.equal(
    initialJourneyPlannerState({ canUseTransport: true }).mode,
    JOURNEY_MODES.ROUTE_FULL,
  )
  assert.equal(
    initialJourneyPlannerState({ canUseTransport: false }).mode,
    JOURNEY_MODES.WAYPOINTS,
  )
})

/* --- Paylaşılan hat simülasyonu ---------------------------------------------- */

test('shared observation stays on transport.view and start stays on its own code', () => {
  const code = stripComments(MAP_PAGE)

  // Gözlem/takip: görüntüleme yetkisi. Takip için AYRI bir kod istenmez.
  assert.ok(/useTransportSimulation\(\{[^}]*canView:\s*allowed\.canViewTransport/s.test(code))
  assert.ok(/useTransportLayer\([^,]+,\s*\{[^}]*permitted:\s*allowed\.canViewTransport/s.test(code))

  /* Başlatma AYRI bir yetkidir. Faz 4B'de ikinci bir tüketicisi oldu (yeniden
     başlatma İKİ kodu birden ister), bu yüzden kod TEK bir yetenek adına
     bağlanır — iki ayrı okuma, zamanla sapabilen iki kural kitabı demekti. */
  assert.match(code, /const canStartSharedSimulation = can\(PERMISSIONS\.TRANSPORT_SIMULATION_START\)/)
  assert.match(code, /canStart: canStartSharedSimulation\b/)
  assert.equal((code.match(/PERMISSIONS\.TRANSPORT_SIMULATION_START/g) ?? []).length, 1)
})

test('the shared stop code is read only where the decision is made', () => {
  /* Faz 1'de bu bir OLUMSUZLUKTU (kodu tüketen hiçbir şey yoktu); Faz 3 komutu
     ekledi. İddia zayıflamadı, KONUMLANDI: yetki kodu YALNIZCA kararın
     verildiği yerlerde — yetenek bayrağını üreten iki sayfada — okunur.
     Sunum bileşenleri, saf kurallar ve istemci fonksiyonu onu HİÇ görmez;
     görselerdi, arayüz backend'in kuralından ayrı ikinci bir kural kitabına
     sahip olurdu. */
  assert.ok(PERMISSION_CODES.includes("TRANSPORT_SIMULATION_STOP: 'transport.simulation.stop'"))

  /* Kararı veren yüzeyler kodu okur ve her biri onu TEK bir yetenek adına
     bağlar. Sabit bir satır biçimi ARANMAZ: okuma yerel bir değişkene
     alınabilir ya da adı değişebilir; ölçülen şey yeteneğin etkin yetki
     kodundan türetildiği ve görünürlük kuralına verildiğidir. */
  const capabilityRead = /const\s+([A-Za-z0-9_]+)\s*=\s*can\(\s*PERMISSIONS\.TRANSPORT_SIMULATION_STOP\s*\)/

  const adminPage = stripComments(read('../../src/pages/admin/TransportRoutePage.jsx'))

  for (const [name, source] of [['MapPage.jsx', MAP_PAGE], ['TransportRoutePage.jsx', adminPage]]) {
    const match = source.match(capabilityRead)
    assert.ok(match, `${name} durdurma yeteneğini etkin yetki kodundan türetmiyor`)
    assert.ok(
      new RegExp(`canStop:\\s*${match[1]}\\b`).test(source),
      `${name} yeteneği görünürlük kuralına vermiyor`,
    )
  }

  // …çizen ve gönderen katmanlar OKUMAZ.
  for (const [name, source] of [
    ['JourneyPlannerPanel.jsx', PANEL],
    ['SharedTransportJourneyContent.jsx', read('../../src/components/map/SharedTransportJourneyContent.jsx')],
    ['TransportTrackingControls.jsx', read('../../src/components/map/TransportTrackingControls.jsx')],
    ['transportSimulationState.js', read('../../src/map/transportSimulationState.js')],
    ['transportApi.js', read('../../src/services/transportApi.js')],
  ]) {
    assert.ok(
      !stripComments(source).includes('TRANSPORT_SIMULATION_STOP'),
      `${name} yetki kararını kendisi veriyor`,
    )
  }

  /* Ve yetenek çalışma alanı kancasına SIZMADI: paylaşılan yaşam döngüsü
     kişisel ürünün yetenek kümesinin parçası değildir. */
  assert.ok(!stripComments(WORKSPACE_PERMISSIONS).includes('TRANSPORT_SIMULATION_STOP'))
})

/* --- Yetkilendirme kestirmesi YOKTUR ----------------------------------------- */

test('the journey and transport authorization path carries no role-name shortcut', () => {
  const AUTH_SHORTCUT_PATTERNS = [
    /\b(currentUser|user|auth|session|account|identity|principal|claims|me)\s*\??\.\s*roles?\b/i,
    /\broles\s*\??\.\s*(includes|some|indexOf|find)\s*\(/i,
    /\brole\w*\s*[=!]==?\s*['"`]\s*(admin|administrator|operat|viewer|editor|superuser|ulaşım)/i,
    /\bis_?admin\b/i,
    /\bis_?operator\b/i,
    /\busername\s*[=!]==?/i,
  ]

  for (const [name, source] of [
    ['permissionCodes.js', PERMISSION_CODES],
    ['useWorkspacePermissions.js', WORKSPACE_PERMISSIONS],
    ['useJourneyPlanner.js', PLANNER_HOOK],
    ['useJourneySimulation.js', SIMULATION_HOOK],
    ['JourneyPlannerPanel.jsx', PANEL],
  ]) {
    const code = stripComments(source)
    for (const pattern of AUTH_SHORTCUT_PATTERNS) {
      assert.ok(!pattern.test(code), `${name} rol/kimlik kestirmesi taşıyor: ${pattern}`)
    }
  }
})

test('no new client-side authorization authority is created', () => {
  /* Arayüz yalnızca ETKİN kodları TÜKETİR. Rol→yetki eşlemesi, kod listesi ya
     da "şu rol şunu yapabilir" matrisi tarayıcıda İKİNCİ kez yazılmaz. */
  const codes = stripComments(PERMISSION_CODES)

  assert.ok(!/GisRoles|ROLE_PERMISSIONS|RolePermission|DEFAULT_ROLE/i.test(codes))

  for (const [name, source] of [
    ['useJourneyPlanner.js', PLANNER_HOOK],
    ['useJourneySimulation.js', SIMULATION_HOOK],
    ['JourneyPlannerPanel.jsx', PANEL],
  ]) {
    const code = stripComments(source)
    // Kancalar ve panel yetkiyi KENDİ hesaplamaz; hazır bir bayrak alırlar.
    assert.ok(!code.includes('PERMISSIONS.'), `${name} kendi yetki kararını veriyor`)
    assert.ok(!code.includes('usePermissions'), `${name} ikinci bir yetki otoritesi kuruyor`)
  }
})
