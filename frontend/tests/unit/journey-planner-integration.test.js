import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

/** Yorumlar ayıklanır: bir kavramı ANLATMAK onu uygulamak değildir. */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

const PLANNER_HOOK = read('../../src/hooks/useJourneyPlanner.js')
const PANEL = read('../../src/components/map/JourneyPlannerPanel.jsx')
const MAP_PAGE = read('../../src/pages/MapPage.jsx')
const TRANSPORT_API = read('../../src/services/transportApi.js')
const PREVIEW_HOOK = read('../../src/hooks/useJourneyPreviewLayer.js')
const PICK_HOOK = read('../../src/hooks/useJourneyWaypointPicking.js')

const JOURNEY_SOURCES = [
  ['useJourneyPlanner.js', PLANNER_HOOK],
  ['JourneyPlannerPanel.jsx', PANEL],
  ['useJourneyPreviewLayer.js', PREVIEW_HOOK],
  ['useJourneyWaypointPicking.js', PICK_HOOK],
  ['journeyPlanning.js', read('../../src/map/journeyPlanning.js')],
  ['journeyPresentation.js', read('../../src/map/journeyPresentation.js')],
  ['journeyManeuvers.js', read('../../src/map/journeyManeuvers.js')],
  ['journeyPreviewLayer.js', read('../../src/map/journeyPreviewLayer.js')],
  ['journeyInteraction.js', read('../../src/map/journeyInteraction.js')],
]

/**
 * GERÇEK yetkilendirme kestirmelerinin desenleri.
 *
 * Aranan şey `role` KELİMESİ değil, yetkiyi etkin yetki kodu yerine kimlikten
 * türetme ŞEKLİDİR: kimlik nesnesinden rol okumak, rol listesinde arama
 * yapmak, bir rol ADIYLA karşılaştırmak, yönetici bayrağı ya da kullanıcı adı
 * kullanmak.
 *
 * Yolculuk planlayıcısının kendi alan kavramı olan geçiş noktası rolü
 * (`origin` / `via` / `destination`) bilinçli olarak DIŞARIDADIR: ürün
 * anlamını taşıyan bir alanı, kaba bir metin eşleşmesi uğruna yeniden
 * adlandırmak kodu bozar ve testin koruduğu şeyi korumaz.
 */
const AUTH_SHORTCUT_PATTERNS = [
  // currentUser.role, user.roles, auth?.role, session.role …
  /\b(currentUser|user|auth|session|account|identity|principal|claims|me)\s*\??\.\s*roles?\b/i,
  // roles.includes('...'), roles.some(...), roles.indexOf(...)
  /\broles\s*\??\.\s*(includes|some|indexOf|find)\s*\(/i,
  // role === 'Admin' gibi rol ADIYLA karşılaştırma
  /\brole\w*\s*[=!]==?\s*['"`]\s*(admin|administrator|operator|viewer|editor|superuser)/i,
  // Yönetici bayrağı ve kullanıcı adıyla yetkilendirme
  /\bis_?admin\b/i,
  /\busername\s*[=!]==?/i,
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

/* --- İstek yaşam döngüsü ----------------------------------------------------- */

test('a stale preview response can never overwrite a newer request', () => {
  /* İKİ koruma birden gereklidir: AbortController uçan isteği iptal eder,
     sayaç ise iptalden ÖNCE yola çıkmış bir cevabın geç gelip sonucu geri
     sarmasını engeller. */
  assert.ok(PLANNER_HOOK.includes('AbortController'))
  assert.ok(PLANNER_HOOK.includes('requestIdRef'))

  // Her okuma noktasında sürüm kontrolü yapılır.
  const guards = PLANNER_HOOK.match(/requestId !== requestIdRef\.current/g) ?? []
  assert.ok(guards.length >= 3, `beklenen en az 3 sürüm kontrolü, bulunan ${guards.length}`)

  // İptal bir hata değil, yaşam döngüsüdür.
  assert.ok(PLANNER_HOOK.includes("caught?.name === 'AbortError'"))
})

test('preview is an explicit action and is never fired from keystrokes', () => {
  // Faz 5C bilinçle "Rotayı Hesapla" düğmesine bağlıdır.
  assert.ok(PANEL.includes('Rotayı Hesapla'))
  assert.ok(PANEL.includes('onRequestPreview'))

  /* `requestPreview` bir efektten otomatik ÇAĞRILMAZ: yönlendirme motoru her
     seçim değişikliğinde dövülmemelidir. */
  assert.ok(!/useEffect\([^)]*requestPreview/s.test(PLANNER_HOOK))
})

test('changing the selection invalidates the stale preview geometry', () => {
  assert.ok(PLANNER_HOOK.includes('requestSignature'))
  assert.ok(PLANNER_HOOK.includes('lastAppliedSignature'))
})

/* --- API sınırı -------------------------------------------------------------- */

test('the preview call reuses the existing auth pipeline and endpoint base', () => {
  assert.ok(TRANSPORT_API.includes("authFetch('/api/transport/journeys/preview'"))
  assert.ok(TRANSPORT_API.includes("method: 'POST'"))
  assert.ok(TRANSPORT_API.includes('signal'))

  // İkinci bir token deposu ya da taban adres AÇILMAZ.
  for (const [name, source] of JOURNEY_SOURCES) {
    const code = stripComments(source)
    assert.ok(!code.includes('sessionStorage'), `${name} kendi token'ını okuyor`)
    assert.ok(!code.includes('localStorage'), `${name} kendi token'ını okuyor`)
    // `authFetch(` büyük F taşır; bu desen yalnızca çıplak fetch'i yakalar.
    assert.ok(!/\bfetch\(/.test(code), `${name} authFetch dışına çıkıyor`)
  }
})

test('the browser never contacts a routing engine directly', () => {
  for (const [name, source] of JOURNEY_SOURCES.concat([['MapPage.jsx', MAP_PAGE]])) {
    const code = stripComments(source).toLowerCase()
    for (const forbidden of ['osrm', 'route/v1', 'localhost:5000', ':5001']) {
      assert.ok(!code.includes(forbidden), `${name} yönlendirme motoruna doğrudan gidiyor (${forbidden})`)
    }
  }
})

/* --- Yetki ------------------------------------------------------------------- */

test('the planner is offered only through the effective permission model', () => {
  // Panel `transport.view` olmadan hiç render edilmez.
  assert.match(MAP_PAGE, /allowed\.canViewTransport && \(\s*<JourneyPlannerPanel/)
  // POI seçenekleri ayrı bir yetkiye bağlıdır.
  assert.ok(MAP_PAGE.includes('canUsePois={allowed.canViewPoi}'))

  for (const [name, source] of JOURNEY_SOURCES) {
    const code = stripComments(source)
    for (const shortcut of ['isAdmin', 'Administrator', 'Operator', 'roleName']) {
      assert.ok(!code.includes(shortcut), `${name} rol/kimlik kestirmesi içeriyor (${shortcut})`)
    }
    for (const pattern of AUTH_SHORTCUT_PATTERNS) {
      assert.ok(!pattern.test(code), `${name} rol/kimlik kestirmesi içeriyor (${pattern})`)
    }
  }
})

/* --- Mevcut mimariyle bir arada --------------------------------------------- */

test('the journey preview never becomes a second map or a second simulation hook', () => {
  for (const [name, source] of JOURNEY_SOURCES) {
    const code = stripComments(source)
    /* İkinci bir OpenLayers haritası kurulmaz. Düz bir JS `new Map()`
       (arama tablosu) bu iddianın konusu değildir; aranan şey ol/Map. */
    assert.ok(!/from 'ol\/Map/.test(code), `${name} ikinci bir OpenLayers haritası kuruyor`)
    assert.ok(!/signalr|HubConnection/i.test(code), `${name} SignalR'a dokunuyor`)
    assert.ok(!code.includes('useTransportSimulation'), `${name} canlı simülasyon kancasına bağlanıyor`)
  }
})

test('the live simulation wiring in MapPage is untouched by the planner', () => {
  // Faz 1-4 kontrolleri yerinde durur.
  assert.ok(MAP_PAGE.includes('useTransportSimulation({'))
  assert.ok(MAP_PAGE.includes('useTransportVehicleLayer(mapInstance, {'))
  assert.ok(MAP_PAGE.includes('transportSimulationControls({'))

  // Önizleme kancası onlardan AYRI çağrılır.
  assert.ok(MAP_PAGE.includes('useJourneyPreviewLayer(mapInstance, {'))
  assert.ok(!MAP_PAGE.includes('journey.preview?.simulationId'))
})

test('the live-journey action is real server work, never fake local behaviour', () => {
  /* Faz 5C'de bu düğme YOKTU ve bu bilinçliydi. Faz 5D onu GERÇEK bir
     sunucu akışına bağladı; dolayısıyla iddia "düğme olmasın"dan "düğme
     sahte olmasın"a döner. Kapsam değişti, güvenlik gereği değişmedi. */
  assert.ok(PANEL.includes('Simülasyonu Başlat'))
  assert.ok(PANEL.includes('onStartSimulation'))

  // Düğme gerçek uca gider; yerel bir animasyon ya da taklit durum değildir.
  assert.ok(MAP_PAGE.includes('journeySimulation.start(intent)'))
  assert.ok(TRANSPORT_API.includes("authFetch('/api/transport/journeys/simulations'"))
  assert.ok(TRANSPORT_API.includes("method: 'POST'"))

  // Gönderilen şey YALNIZCA kanonik yolculuk niyetidir.
  assert.ok(MAP_PAGE.includes('const intent = journey.buildIntent()'))
  assert.ok(TRANSPORT_API.includes('body: JSON.stringify(intent)'))

  /* Ve sunucu yanıtı yeni güzergah gerçeği olarak KABUL EDİLİR.

     Sahiplik kuralı Faz 5E-B'de saf modüle taşındı; sıralamanın KENDİSİ orada
     çalıştırılarak ölçülür (`journey-terminal-lifecycle.test.js`). Burada
     yalnızca entegrasyon sınırı denetlenir: sayfa kuralı çağırıyor, doğru iki
     girdiyi veriyor, sonucu mevcut önizleme katmanına aktarıyor ve ikinci bir
     sıralama kopyası tutmuyor. */
  const stateImports = namedImports(MAP_PAGE, '../map/journeySimulationState.js')
  assert.ok(stateImports.includes('journeyDisplayGeometryWkt'))
  assert.match(
    MAP_PAGE,
    /const journeyGeometryWkt = journeyDisplayGeometryWkt\(\{\s*simulation: journeySimulation\.simulation,\s*previewGeometryWkt: journey\.preview\?\.geometryWkt \?\? null,\s*\}\)/,
  )
  assert.match(MAP_PAGE, /useJourneyPreviewLayer\(mapInstance, \{\s*geometryWkt: journeyGeometryWkt,/)
  assert.ok(!MAP_PAGE.includes('journeySimulation.simulation?.geometryWkt ?? journey.preview?.geometryWkt'))

  // Mevcut paylaşılan hat denetimleri ayrı bileşende yaşamaya devam eder.
  assert.ok(MAP_PAGE.includes('TransportTrackingControls'))
})

test('the plan id is correlation data and never reaches the start request', () => {
  /* Yasaklanan şey KELİME değil, YETKİ kullanımıdır. Önizleme yanıtının
     içinde bir planId bulunması ve dosyaların bunu "gönderilmez" diye
     belgelemesi güvenlidir; tehlikeli olan onu isteğe koymaktır. Bu yüzden
     iddia, isteğin KURULDUĞU sınıra bakar. */
  const planner = stripComments(PLANNER_HOOK)
  const panel = stripComments(PANEL)
  const mapPage = stripComments(MAP_PAGE)
  const api = stripComments(TRANSPORT_API)
  const liveHook = stripComments(read('../../src/hooks/useJourneySimulation.js'))

  // Hiçbir ÇALIŞAN kod planId'ye dokunmaz (yorumlar belgelemek için serbesttir).
  for (const [name, code] of [
    ['useJourneyPlanner.js', planner],
    ['JourneyPlannerPanel.jsx', panel],
    ['MapPage.jsx', mapPage],
    ['transportApi.js', api],
    ['useJourneySimulation.js', liveHook],
  ]) {
    assert.ok(!code.includes('planId'), `${name} çalışan kodda planId kullanıyor`)
  }

  /* Niyet YALNIZCA doğrulanmış seçimden kurulur: `buildIntent` doğrulama
     sonucunu döndürür ve önizleme yanıtına hiç bakmaz. */
  assert.ok(planner.includes('validation.ok ? validation.request : null'))

  // Ve gövde niyetin KENDİSİDİR; zenginleştirilmez.
  assert.ok(api.includes('body: JSON.stringify(intent)'))
})

/* --- Harita etkileşimi ------------------------------------------------------- */

test('normal map interactions resume when planner picking is not armed', () => {
  // Silahlıyken normal durak/güzergah ve POI tıklaması çekilir…
  assert.ok(MAP_PAGE.includes('workspaceMode.isSelecting && !journey.isPicking'))
  assert.ok(MAP_PAGE.includes('poiClickEnabled && !journey.isPicking'))

  /* …ve kancanın kendisi kuralı SAF modülden uygular. Koşullar Faz 5E-B'de
     `journeyPickingActive`e taşındı: dördüncüsü (çalışma alanının dinlenme
     durumu) orada da doğrudan çalıştırılarak ölçülür
     (`journey-picking-ownership.test.js`). Buradaki iddia bağlamadır: kancada
     ikinci bir kural KOPYASI yaşamamalıdır. */
  assert.ok(PLANNER_HOOK.includes('isPicking: journeyPickingActive({'))
  assert.ok(PLANNER_HOOK.includes('workspaceAtRest'))
  assert.ok(!PLANNER_HOOK.includes('state.mode === JOURNEY_MODES.WAYPOINTS'))

  const rules = read('../../src/map/journeyPlanning.js')
  assert.ok(rules.includes('mode === JOURNEY_MODES.WAYPOINTS'))
  assert.ok(rules.includes('panel === PANEL_STATES.OPEN'))
  assert.ok(rules.includes('activeSlotKey != null'))
})

test('the existing transport click chain is left exactly as it was', () => {
  const interaction = read('../../src/map/transportInteraction.js')
  // Faz 5C mevcut öncelik zincirine DOKUNMAZ; kendi çözümleyicisini ekler.
  assert.ok(!interaction.includes('journey'))
  assert.ok(!interaction.includes('Journey'))
})

/* --- Profil arayüzü ---------------------------------------------------------- */

test('the panel offers exactly three profiles with non-transit semantics', () => {
  assert.ok(PANEL.includes('JOURNEY_PROFILES.map'))

  /* İkonlar Faz 5E-B · Dilim 6'da TEK bir sözlüğe taşındı: panel de haritadaki
     canlı işaretçi de aynı üç sembolü kanonik profil kimliğinden okur. Panelin
     kendi tablosu KALMADI — ikinci bir tablo, iki ayrı görünüm demekti. */
  assert.ok(PANEL.includes('journeyProfileIcon(profile.id)'))
  assert.ok(!PANEL.includes('PROFILE_ICONS'))

  const icons = read('../../src/components/map/journeyProfileIcons.js')
  assert.match(icons, /driving: Car/)
  assert.match(icons, /walking: Footprints/)
  assert.match(icons, /cycling: Bike/)

  // Otobüs ya da transit ikonu hiçbir yerde yoktur.
  for (const source of [PANEL, icons]) {
    for (const forbidden of ['BusFront', 'TramFront', 'TrainFront', 'Bus', 'Train']) {
      assert.ok(!source.includes(forbidden), `transit ikonu sızdı (${forbidden})`)
    }
  }
})

test('no client side duration estimate or speed multiplier exists', () => {
  for (const [name, source] of JOURNEY_SOURCES) {
    const code = stripComments(source)
    for (const forbidden of ['multiplier', 'Multiplier', 'speedKph', 'WALKING_SPEED', 'CYCLING_SPEED', 'estimateDuration']) {
      assert.ok(!code.includes(forbidden), `${name} istemci tarafı tahmin içeriyor (${forbidden})`)
    }
  }

  // Süre ve mesafe YALNIZCA sunucu alanlarından biçimlendirilir.
  const presentation = read('../../src/map/journeyPresentation.js')
  assert.ok(presentation.includes('summary.distanceMeters'))
  assert.ok(presentation.includes('summary.durationSeconds'))
})

test('an unavailable profile keeps the user choice rather than switching to driving', () => {
  /* Sunucu 400 ile "bu profil kullanılamıyor" der; planlayıcı profili
     DEĞİŞTİRMEZ — kullanıcı sebebi anlayabilmelidir. */
  assert.ok(!PLANNER_HOOK.includes("setProfile('driving')"))
  assert.ok(!PLANNER_HOOK.includes('DEFAULT_JOURNEY_PROFILE'))
})

/* --- Panel yerleşimi --------------------------------------------------------- */

test('the panel renders three distinct states including a reopen affordance', () => {
  assert.ok(PANEL.includes('PANEL_STATES.CLOSED'))
  assert.ok(PANEL.includes('journey-collapsed-summary'))

  /* KAPALI durumun görünümü Faz 5E-B · Dilim 4'te haritanın kendi denetim
     yığınına taşındı: panelin köşesindeki eski düğme analiz panelinin tam
     üstüne oturuyordu. Yeniden açma hâlâ vardır, yeri değişti. */
  assert.ok(!PANEL.includes('journey-reopen'))
  const quick = read('../../src/components/map/QuickActions.jsx')
  assert.ok(quick.includes('journey-trigger'))
  assert.ok(quick.includes('journey.onToggle'))

  const css = read('../../src/components/map/JourneyPlanner.css')
  // Katlanmış panel ekranda KALIR.
  assert.ok(css.includes('.journey-panel.is-collapsed'))
  /* Dar ekranda uygulamanın KENDİ kesme noktası kullanılır (640px ailesi);
     panelin kendine ait 720px istisnası kalktı. */
  assert.ok(css.includes('@media (max-width: 640px)'))
  assert.ok(!/@media \(max-width: 720px\)/.test(css))
})

test('the panel is a component rather than business logic inside MapPage', () => {
  // MapPage yalnızca bağlar: kip/profil/doğrulama kuralları orada YAŞAMAZ.
  assert.ok(!MAP_PAGE.includes('buildJourneyPreviewRequest'))
  assert.ok(!MAP_PAGE.includes('journeyPlannerReducer'))
  assert.ok(!MAP_PAGE.includes('maneuverInstruction'))
})
