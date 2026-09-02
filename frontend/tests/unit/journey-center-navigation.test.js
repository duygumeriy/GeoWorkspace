import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  JOURNEY_CENTER_TITLE,
  JOURNEY_PRODUCTS,
  canOpenJourneyWorkspace,
  journeyCenterSubtitle,
  journeyProductLabel,
  journeyProductTabs,
  resolveJourneyProduct,
} from '../../src/map/journeyWorkspace.js'
import {
  PANEL_STATES,
  PERSONAL_SECTIONS,
  initialJourneyPlannerState,
  journeyPlannerReducer,
  resolvePersonalSection,
} from '../../src/map/journeyPlanning.js'
import {
  JOURNEY_SIMULATION_STATUS,
  journeyStatusLabel,
  journeyTerminalTitle,
} from '../../src/map/journeySimulationState.js'
import { historyStatusLabel } from '../../src/map/journeyHistory.js'
import { lifecycleCapabilities } from '../../src/map/activeSimulations.js'

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

/** Yorumlar ayıklanır: bir markayı DIŞLADIĞINI anlatan yorum, o markayı içerir. */
const stripComments = (source) =>
  source.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

const SIDEBAR = read('../../src/components/map/Sidebar.jsx')
const PANEL = read('../../src/components/map/JourneyPlannerPanel.jsx')
const SHARED = read('../../src/components/map/SharedTransportJourneyContent.jsx')
const MAP_PAGE = read('../../src/pages/MapPage.jsx')

/**
 * GERÇEK yetkilendirme kestirmelerinin desenleri.
 *
 * <b>Aranan şey `role` KELİMESİ DEĞİLDİR</b>, yetkiyi etkin yetki kodu yerine
 * KİMLİKTEN türetme ŞEKLİDİR: bir kimlik nesnesinden rol okumak, rol listesinde
 * arama yapmak, bir rol ADIYLA karşılaştırmak, yönetici/operatör bayrağı ya da
 * kullanıcı adı kullanmak.
 *
 * <b>Yolculuk alanının kendi `role` kavramı bilinçle DIŞARIDADIR.</b> Geçiş
 * noktasının plandaki rolü (`origin` / `via` / `destination`) bir yetki değil,
 * bir ürün kavramıdır ve `waypointRoleAt` ile üretilir; `role === 'via'`
 * meşru alan mantığıdır. Bunu yakalayan kaba bir desen, ürün anlamı taşıyan
 * bir değişkeni test uğruna yeniden adlandırmaya zorlar ve koruduğu şeyi
 * korumazdı — bu yüzden sağ tarafta bir ROL ADI aranır.
 *
 * Desenler diğer Yolculuk testleriyle (Faz 7/8) AYNIDIR: tek bir sözlük.
 */
const AUTH_SHORTCUT_PATTERNS = [
  // currentUser.role, user.roles, auth?.role, session.role …
  /\b(currentUser|user|auth|session|account|identity|principal|claims|me)\s*\??\.\s*roles?\b/i,
  // roles.includes('...'), roles.some(...), roles.indexOf(...)
  /\broles\s*\??\.\s*(includes|some|indexOf|find)\s*\(/i,
  // roleName === 'Admin' gibi rol ADIYLA karşılaştırma
  /\brole\w*\s*[=!]==?\s*['"`]\s*(admin|administrator|operator|viewer|editor|superuser)/i,
  // Yönetici/operatör bayrağı ve kullanıcı adıyla yetkilendirme
  /\bis_?admin\b/i,
  /\bis_?operator\b/i,
  /\busername\s*[=!]==?/i,
]

const reduce = (state, ...actions) => actions.reduce(journeyPlannerReducer, state)
const planner = () => initialJourneyPlannerState({ canUseTransport: false })

/* --- Tek giriş ------------------------------------------------------------------ */

test('the sidebar offers exactly one Journey Center entry', () => {
  const rows = SIDEBAR.match(/label: '([^']+)'/g) ?? []
  const journeyRows = rows.filter((row) => /Yolculuk|Kaydedilen|Geçmiş|Paylaşımlı/.test(row))

  /* Kişisel planlama, kaydedilenler, geçmiş ve paylaşımlı ulaşım AYRI satırlar
     DEĞİLDİR: dördü de tek ürünün bölümleridir ve kenar çubuğunda tek bir
     satırla temsil edilir. */
  assert.deepEqual(journeyRows, ["label: 'Yolculuk Merkezi'"])
})

test('the entry opens the map panel instead of a sidebar page', () => {
  /* Yolculuk Merkezi bir kenar çubuğu sayfası değildir; satır kendi açma
     eylemini çağırır ve panel koordinatörüne sıradan bir sayfa gibi girmez. */
  assert.match(SIDEBAR, /if \(panelId === JOURNEY_CENTER_ITEM_ID\) \{\s*\n\s*onOpenJourneyCenter\?\.\(\)/)

  // Görünürlük panelin KENDİ yetki hesabından gelir; rol adı okunmaz.
  assert.match(MAP_PAGE, /canOpenJourneyCenter=\{canOpenJourney\}/)
  assert.match(MAP_PAGE, /onOpenJourneyCenter=\{toggleJourneyPanel\}/)
})

test('the entry is gated by the same capability rule as the panel', () => {
  // Hiçbir ürüne erişimi olmayan kullanıcı için ne panel ne satır vardır.
  assert.equal(canOpenJourneyWorkspace({ canUseJourney: false, canViewTransport: false }), false)
  assert.equal(canOpenJourneyWorkspace({ canUseJourney: true, canViewTransport: false }), true)
  assert.equal(canOpenJourneyWorkspace({ canViewTransport: true }), true)

  assert.match(SIDEBAR, /canOpenJourneyCenter\s*\n?\s*\? \[\{ id: JOURNEY_CENTER_ITEM_ID/)
})

test('the map shortcut and the sidebar row name the same product', () => {
  const quick = read('../../src/components/map/QuickActions.jsx')

  assert.equal(JOURNEY_CENTER_TITLE, 'Yolculuk Merkezi')
  assert.match(SIDEBAR, /label: 'Yolculuk Merkezi'/)
  assert.match(quick, /JOURNEY_CENTER_TITLE/)
})

test('the sidebar brand slot is the product artwork, not a retyped title', () => {
  /* Faz 10 sözleşmesi: marka yuvası sağlanan Info&Motion çizimidir. Yeni bir
     gezinme satırı eklemek markayı DEĞİŞTİRMEZ.

     Ölçüm ÇİZİLEN marka bloğu üzerindedir: dosyanın tamamını taramak, markanın
     nerede durduğunu açıklayan yorumlarda kırılırdı. */
  const brand = stripComments(SIDEBAR.slice(
    SIDEBAR.indexOf('<div className="map-sidebar-brand">'),
    SIDEBAR.indexOf('<nav className="map-sidebar-nav"'),
  ))

  assert.match(brand, /<img className="map-sidebar-brand-logo" src=\{infomotionLogo\}/)

  // Ad ve slogan çizimin İÇİNDEDİR; yanına ikinci bir başlık yazılmaz.
  assert.ok(!brand.includes('Staj Harita Uygulaması'))
  assert.ok(!brand.includes('map-sidebar-brand-name'))

  // Kurumsal marka (Başarsoft) bu yuvada değil, üst şerittedir.
  assert.ok(!/Başarsoft/.test(brand))
})

/* --- İki ürün, iki eksen --------------------------------------------------------- */

test('personal and shared are distinct named products', () => {
  assert.equal(journeyProductLabel(JOURNEY_PRODUCTS.PERSONAL), 'Kendi Yolculuğum')
  assert.equal(journeyProductLabel(JOURNEY_PRODUCTS.SHARED), 'Paylaşımlı Ulaşım')
  assert.notEqual(
    journeyProductLabel(JOURNEY_PRODUCTS.PERSONAL),
    journeyProductLabel(JOURNEY_PRODUCTS.SHARED),
  )
})

test('the product switch is offered only when there is a real choice', () => {
  assert.deepEqual(journeyProductTabs({ canUseJourney: true }), [])
  assert.deepEqual(
    journeyProductTabs({ canUseJourney: true, canViewTransport: true }).map((tab) => tab.id),
    [JOURNEY_PRODUCTS.PERSONAL, JOURNEY_PRODUCTS.SHARED],
  )
})

test('the active product is announced, not only coloured', () => {
  /* Ürün düğmeleri GERÇEK düğmelerdir ve durumlarını `aria-pressed` ile
     bildirir; tıklanabilir bir div ya da yalnızca renk yeterli değildir. */
  assert.match(PANEL, /className="journey-products" role="group" aria-label="Yolculuk ürünü"/)
  assert.match(PANEL, /aria-pressed=\{product === tab\.id\}/)
  assert.match(PANEL, /className=\{`journey-product-tab \$\{product === tab\.id \? 'is-active' : ''\}`/)
})

test('secondary navigation never borrows the product switch language', () => {
  /* Kişisel bölümler ve paylaşımlı görünümler AYNI ikincil dili kullanır;
     ürün çubuğunun dili yalnızca ürün çubuğunundur. Aksi hâlde "Seçili Hat",
     "Kendi Yolculuğum" ile aynı eksenin değeri gibi okunurdu. */
  assert.ok(!SHARED.includes('journey-product-tab ${'))
  assert.match(SHARED, /className=\{`journey-tab \$\{!showingActive \? 'is-active' : ''\}`/)
  assert.match(SHARED, /className=\{`journey-tab \$\{showingActive \? 'is-active' : ''\}`/)

  // Kişisel bölüm çubuğu da aynı sınıfı kullanır.
  assert.match(PANEL, /className=\{`journey-tab \$\{section === tab\.id \? 'is-active' : ''\}`/)
})

/* --- Sabit başlık ---------------------------------------------------------------- */

test('the header identity does not change with the product', () => {
  /* Başlık ürün adını TEKRARLAMAZ: hemen altındaki ürün çubuğu zaten onu
     söylüyor ve aynı bilgiyi iki kez yazmak çubuğu gereksiz kılardı. */
  assert.match(PANEL, /<span>\{JOURNEY_CENTER_TITLE\}<\/span>/)
  assert.ok(!PANEL.includes('workspaceTitle'))
})

test('the context line summarises what is already on screen', () => {
  // Paylaşımlı: hat adı, çalışıyorsa durumuyla birlikte.
  assert.equal(
    journeyCenterSubtitle({
      product: JOURNEY_PRODUCTS.SHARED,
      shared: { routeName: '34A', isActive: true, statusLabel: 'Çalışıyor' },
    }),
    '34A · Çalışıyor',
  )

  /* Çalışmayan hatta durum YAZILMAZ: "Aktif simülasyon yok" cümlesi zaten
     gövdededir ve aynı olumsuzu iki kez söylemek gürültüdür. */
  assert.equal(
    journeyCenterSubtitle({
      product: JOURNEY_PRODUCTS.SHARED,
      shared: { routeName: '34A', isActive: false, statusLabel: 'Durdu' },
    }),
    '34A',
  )

  // Kişisel: canlı durum her şeyin önündedir.
  assert.equal(
    journeyCenterSubtitle({
      product: JOURNEY_PRODUCTS.PERSONAL,
      live: { label: 'Sürüyor · %40' },
      planner: { profileLabel: 'Araç', pointCount: 3 },
    }),
    'Sürüyor · %40',
  )

  // Çalıştırma yokken taslak özetlenir.
  assert.equal(
    journeyCenterSubtitle({
      product: JOURNEY_PRODUCTS.PERSONAL,
      planner: { profileLabel: 'Araç', pointCount: 3 },
    }),
    'Araç · 3 nokta',
  )
})

test('the context line disappears rather than saying nothing', () => {
  for (const context of [
    undefined,
    { product: JOURNEY_PRODUCTS.SHARED, shared: null },
    { product: JOURNEY_PRODUCTS.SHARED, shared: {} },
    { product: JOURNEY_PRODUCTS.PERSONAL, planner: null },
  ]) {
    assert.equal(journeyCenterSubtitle(context), null)
  }

  // Nokta seçilmemişken sayı yazılmaz; profil tek başına yeterlidir.
  assert.equal(
    journeyCenterSubtitle({
      product: JOURNEY_PRODUCTS.PERSONAL,
      planner: { profileLabel: 'Yürüyüş', pointCount: 0 },
    }),
    'Yürüyüş',
  )
})

/* --- Kişisel ikincil gezinme ------------------------------------------------------ */

test('personal exposes exactly the three known sections', () => {
  assert.deepEqual(Object.values(PERSONAL_SECTIONS), ['plan', 'saved', 'history'])
  assert.match(PANEL, /\{ id: PERSONAL_SECTIONS\.PLAN, label: 'Planla' \}/)
  assert.match(PANEL, /\{ id: PERSONAL_SECTIONS\.SAVED, label: 'Kaydedilenler' \}/)
  assert.match(PANEL, /\{ id: PERSONAL_SECTIONS\.HISTORY, label: 'Geçmiş' \}/)
})

test('section resolution stays extension-safe', () => {
  /* Faz 8 regresyonu: panel bölümleri tek tek sayarsa eklenen her yeni bölüm
     sessizce planlamaya düşer. */
  for (const section of Object.values(PERSONAL_SECTIONS)) {
    assert.equal(resolvePersonalSection(section), section)
  }
  assert.equal(resolvePersonalSection('archive'), PERSONAL_SECTIONS.PLAN)
  assert.match(PANEL, /const section = resolvePersonalSection\(state\.section\)/)
})

test('switching product preserves the personal section the user chose', () => {
  const state = reduce(
    planner(),
    { type: 'setSection', section: PERSONAL_SECTIONS.HISTORY },
    { type: 'setProduct', product: JOURNEY_PRODUCTS.SHARED },
    { type: 'setProduct', product: JOURNEY_PRODUCTS.PERSONAL },
  )

  assert.equal(state.section, PERSONAL_SECTIONS.HISTORY)
})

test('history and saved survive unrelated planner activity', () => {
  for (const section of [PERSONAL_SECTIONS.HISTORY, PERSONAL_SECTIONS.SAVED]) {
    const state = reduce(
      planner(),
      { type: 'setSection', section },
      { type: 'setProfile', profile: 'walking' },
      { type: 'addWaypoint' },
      { type: 'setPanel', panel: PANEL_STATES.COLLAPSED },
      { type: 'setPanel', panel: PANEL_STATES.OPEN },
      { type: 'reset' },
    )

    assert.equal(state.section, section)
  }
})

test('loading a definition is the one navigation that returns to planning', () => {
  const loaded = reduce(
    planner(),
    { type: 'setSection', section: PERSONAL_SECTIONS.HISTORY },
    {
      type: 'loadSaved',
      draft: { mode: 'waypoints', profile: 'driving', routeId: null, waypoints: null },
    },
  )

  assert.equal(loaded.section, PERSONAL_SECTIONS.PLAN)
})

/* --- Gezinme yaşam döngüsüne dokunmaz ---------------------------------------------- */

test('product and section changes carry no lifecycle command', () => {
  /* Planlayıcı durumu çalıştırma taşımaz ve gezinme yeni bir alan üretmez;
     canlı durumun sahibi ayrı kancalardır. */
  const before = planner()
  const after = reduce(
    before,
    { type: 'setProduct', product: JOURNEY_PRODUCTS.SHARED },
    { type: 'setSection', section: PERSONAL_SECTIONS.HISTORY },
  )

  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort())
  for (const forbidden of ['simulationId', 'snapshot', 'following', 'starting', 'watched']) {
    assert.equal(forbidden in after, false)
  }
})

test('closing the panel hides the surface without ending anything', () => {
  /* Bağlam emekliliği YALNIZCA paneli kapatır. Çalışan simülasyon, izlenen
     hatlar, takip ve terminal sonuç kullanıcının açık kararlarına bağlıdır. */
  const retire = MAP_PAGE.slice(
    MAP_PAGE.indexOf('[MAP_CONTEXTS.journey]: () => {'),
    MAP_PAGE.indexOf('[MAP_CONTEXTS.inventory]'),
  )

  assert.match(retire, /journey\.closePanel\(\)/)
  for (const forbidden of ['stop(', 'cancel', 'dismiss(', 'clearWatch', 'setFollowing', 'leave(']) {
    assert.ok(!retire.includes(forbidden), `panel kapatma ${forbidden} çağırmamalı`)
  }

  const closed = journeyPlannerReducer(
    journeyPlannerReducer(planner(), { type: 'setSection', section: PERSONAL_SECTIONS.SAVED }),
    { type: 'setPanel', panel: PANEL_STATES.CLOSED },
  )

  // Yeniden açıldığında kullanıcı bıraktığı bölümü bulur.
  assert.equal(closed.section, PERSONAL_SECTIONS.SAVED)
})

/* --- Paylaşımlı anlamlar korunur ---------------------------------------------------- */

test('selecting a shared route stays a selection', () => {
  /* Hat seçmek başlatmaz, takip etmez ve yaşam döngüsü komutu göndermez;
     seçim yalnızca hangi hattın ayrıntısının çizileceğini söyler. */
  const openWith = MAP_PAGE.slice(
    MAP_PAGE.indexOf('const openJourneyWorkspaceWith = useCallback('),
    MAP_PAGE.indexOf('const closeJourneyPanel = useCallback('),
  )

  assert.match(openWith, /journey\.setProduct\(product\)/)
  assert.match(openWith, /journey\.openPanel\(\)/)
  for (const forbidden of ['startShared', 'onFollow', 'setFollowing', 'toggleWatch']) {
    assert.ok(!openWith.includes(forbidden))
  }
})

test('watching and following keep separate words and separate buttons', () => {
  const activeList = read('../../src/components/map/ActiveSimulationsList.jsx')

  // İzleme: haritadaki aracı açıp kapatır.
  assert.match(activeList, /Tümünü İzle/)
  assert.match(activeList, /İzlemeyi Temizle/)

  // Takip: yalnızca KAMERA sahipliği; bırakmak yayını kesmez.
  assert.match(SHARED, />\s*Takip Et\s*</)
  assert.match(SHARED, />\s*Takibi Bırak\s*</)
  assert.ok(!SHARED.includes('İzlemeyi Bırak'))
})

test('lifecycle buttons keep their tone hierarchy', () => {
  /* Başlat/Devam Ettir birincil, Duraklat ikincil, Sıfırla yıkıcıdır. Hepsi
     aynı görünseydi geri alınamaz eylem sıradan bir düğme gibi okunurdu. */
  const startBlock = SHARED.slice(SHARED.indexOf('shared.showStart'), SHARED.indexOf('shared.showPause'))
  const pauseBlock = SHARED.slice(SHARED.indexOf('shared.showPause'), SHARED.indexOf('shared.showResume'))
  const stopBlock = SHARED.slice(SHARED.indexOf('shared.showStop'), SHARED.indexOf('shared.showFollow'))

  assert.match(startBlock, /className="journey-primary"/)
  assert.match(pauseBlock, /className="journey-secondary"/)
  assert.match(stopBlock, /className="journey-danger"/)
})

test('shared controls are shown from the presentation model', () => {
  /* POZİTİF iddia: hangi denetimin görüneceğini saf sunum modeli söyler.
     Bileşen ikinci bir kural kitabı tutmaz ve yetkiyi kendisi yorumlamaz. */
  for (const flag of ['showStart', 'showPause', 'showResume', 'showStop', 'showFollow', 'showUnfollow']) {
    assert.ok(SHARED.includes(`shared.${flag}`), `${flag} sunum modelinden okunmalı`)
  }
})

test('lifecycle capability derives from effective permissions, not from an identity', () => {
  /* Yönetim denetimlerinin TEK kaynağı bu saf kuraldır ve girdisi yalnızca iki
     yetenektir. Rol adı, kullanıcı adı ya da yönetici bayrağı için bir
     PARAMETRE bile yoktur — kestirme yapısal olarak imkânsızdır. */
  const none = lifecycleCapabilities({})
  assert.equal(none.canManage, false)
  assert.equal(none.canRestart, false)

  /* Başlatabilmek, başkalarının çalıştırmalarına dokunma yetkisi DEĞİLDİR. */
  const starterOnly = lifecycleCapabilities({ canStart: true })
  assert.equal(starterOnly.canManage, false)
  assert.equal(starterOnly.canRestart, false)

  const stopperOnly = lifecycleCapabilities({ canStop: true })
  assert.equal(stopperOnly.canPause, true)
  assert.equal(stopperOnly.canReset, true)
  // YENİDEN BAŞLAT bitirip yerine yenisini kurar: İKİ yetki birden ister.
  assert.equal(stopperOnly.canRestart, false)

  const both = lifecycleCapabilities({ canStart: true, canStop: true })
  assert.equal(both.canRestart, true)
})

/**
 * Muhafızın KENDİSİNİ sınar.
 *
 * <b>Neden gerekli.</b> Bu muhafız bir kez zaten yanlış ateşledi: kaba bir
 * `role ===` deseni, geçiş noktasının plandaki rolünü (`role === 'via'`) bir
 * yetkilendirme kestirmesi sandı ve üretim kodunda hiçbir kusur yokken testi
 * düşürdü. Bir muhafız yalnızca neyi YAKALADIĞIYLA değil, neyi RAHAT
 * BIRAKTIĞIYLA da doğrudur; ikisi de burada sabitlenir ki aynı yanlış pozitif
 * geri dönmesin.
 */
const detectsShortcut = (source) => AUTH_SHORTCUT_PATTERNS.some((pattern) => pattern.test(source))

test('the authorization guard catches identity-derived authorization', () => {
  for (const forbidden of [
    "if (user.role === 'Admin') {",
    "if (currentUser.role === 'Operator') {",
    'const level = account?.roles',
    "if (roles.includes('Admin')) {",
    'if (session.roles.some((item) => item === admin)) {',
    "if (roleName === 'Administrator') {",
    'if (isAdmin) {',
    'if (is_admin) {',
    'if (isOperator) {',
    "if (username === 'admin') {",
  ]) {
    assert.ok(detectsShortcut(forbidden), `yakalanmalıydı: ${forbidden}`)
  }
})

test('the authorization guard leaves legitimate journey domain code alone', () => {
  for (const legitimate of [
    // Geçiş noktasının plandaki rolü — yetki değil, ürün kavramı.
    "const role = waypointRoleAt(index, state.waypoints.length)",
    "const isVia = role === 'via'",
    "className={`journey-waypoint role-${role}`}",
    "<span className=\"journey-waypoint-role\">{ROLE_LABELS[role]}</span>",
    "Role = JourneyContractNames.Of(RoleAt(index, points.Count)),",
    "roleLabel: roleLabel(point.role),",
    // Erişilebilirlik nitelikleri de bir yetki ifadesi değildir.
    'role="group"',
    'role="status"',
    'role="alert"',
    // Yetenek TABANLI kod: doğru olan budur ve yakalanmamalıdır.
    'const able = lifecycleCapabilities({ canStart, canStop })',
    'if (shared.showStart) {',
  ]) {
    assert.ok(!detectsShortcut(legitimate), `yanlış pozitif: ${legitimate}`)
  }
})

test('the journey surfaces derive nothing from role names', () => {
  for (const [name, source] of [['SharedTransportJourneyContent.jsx', SHARED], ['JourneyPlannerPanel.jsx', PANEL], ['Sidebar.jsx', SIDEBAR]]) {
    for (const pattern of AUTH_SHORTCUT_PATTERNS) {
      assert.ok(!pattern.test(source), `${name} yetkilendirme kestirmesi içermemeli: ${pattern}`)
    }
  }
})

/* --- Tek sözlük -------------------------------------------------------------------- */

test('one runtime status has exactly one user-facing name', () => {
  /* Aynı sunucu durumu (`Cancelled`) canlı panelde "durduruldu", geçmişte
     "İptal Edildi" diye okunuyordu; kullanıcı iki farklı sonuç olduğunu
     sanabilirdi. */
  assert.equal(journeyStatusLabel(JOURNEY_SIMULATION_STATUS.CANCELLED), 'İptal Edildi')
  assert.equal(historyStatusLabel(JOURNEY_SIMULATION_STATUS.CANCELLED), 'İptal Edildi')
  assert.equal(journeyTerminalTitle(JOURNEY_SIMULATION_STATUS.CANCELLED), 'Yolculuk iptal edildi')

  assert.equal(journeyStatusLabel(JOURNEY_SIMULATION_STATUS.COMPLETED), 'Tamamlandı')
  assert.equal(historyStatusLabel(JOURNEY_SIMULATION_STATUS.COMPLETED), 'Tamamlandı')
})

test('the stop action keeps its own verb', () => {
  /* SONUCUN adı ile EYLEMİN adı ayrıdır: kullanıcı yolculuğu "Durdur" ile
     bitirir, sonucun adı ise "İptal Edildi"dir. */
  assert.match(PANEL, /Simülasyonu Durdur/)
  assert.match(SHARED, />\s*\{shared\.stopping \? 'Sıfırlanıyor…' : 'Sıfırla'\}\s*</)
})

test('status is always carried by text, never by colour alone', () => {
  const history = read('../../src/components/map/JourneyHistorySection.jsx')

  assert.match(history, /\{item\.statusLabel\}/)
  assert.match(history, /tone-\$\{item\.statusTone\}/)

  for (const status of Object.values(JOURNEY_SIMULATION_STATUS)) {
    assert.ok(journeyStatusLabel(status).length > 0)
  }
})

/* --- Kanal ve depolama sınırları ------------------------------------------------------ */

test('consolidation introduced no new channel, timer or storage', () => {
  const sources = [
    ['Sidebar.jsx', SIDEBAR],
    ['JourneyPlannerPanel.jsx', PANEL],
    ['SharedTransportJourneyContent.jsx', SHARED],
    ['journeyWorkspace.js', read('../../src/map/journeyWorkspace.js')],
  ]

  for (const [name, source] of sources) {
    for (const forbidden of [
      'localStorage', 'sessionStorage', 'setInterval', 'setTimeout',
      '@microsoft/signalr', 'createJourneySimulationConnection',
    ]) {
      assert.ok(!source.includes(forbidden), `${name} ${forbidden} kullanmamalı`)
    }
  }

  // Kişisel canlı kanalın sahibi hâlâ TEK kancadır.
  assert.match(
    read('../../src/hooks/useJourneySimulation.js'),
    /createJourneySimulationConnection/,
  )
})

test('the Araçlar dock stays its own overlay', () => {
  const dock = read('../../src/components/map/TransportTrackingControls.jsx')

  // Yolculuk Merkezi'ne taşınmadı ve onun bölümlerini tanımıyor.
  assert.ok(!dock.includes('JOURNEY_CENTER_TITLE'))
  assert.ok(!dock.includes('PERSONAL_SECTIONS'))
  assert.ok(!PANEL.includes('TransportTrackingControls'))
})
