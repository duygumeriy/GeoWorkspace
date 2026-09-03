import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { PERMISSIONS } from '../../src/auth/permissionCodes.js'
import {
  JOURNEY_PRODUCTS,
  canOpenJourneyWorkspace,
  journeyProductTabs,
  journeyWorkspaceProducts,
  resolveJourneyProduct,
} from '../../src/map/journeyWorkspace.js'
import { lifecycleCapabilities } from '../../src/map/activeSimulations.js'
import { transportSimulationControls } from '../../src/map/transportSimulationState.js'

/**
 * Faz 11 — ETKİN YETKİ KABULÜ.
 *
 * Bu dosya bir metin taraması DEĞİLDİR: Yolculuk Merkezi'nin yetenek
 * MATRİSİNİ, saf yardımcıları gerçekten çağırarak kanıtlar. Girdi her zaman
 * "kullanıcının etkin yetki KODLARI" kümesidir — rol adı, kullanıcı adı ya da
 * yönetici bayrağı hiçbir yerde bulunmaz.
 *
 * <b>Etkin yetki = rol yetkileri ∪ doğrudan kullanıcı yetkileri.</b> Bileşim
 * kuralının sahibi backend'dir (`EffectivePermissionService`); burada
 * kanıtlanan şey, kümenin NASIL oluştuğunun arayüz kararlarını hiç
 * etkilemediğidir: aynı kod kümesi, kaynağı ne olursa olsun aynı yetenekleri
 * üretir.
 */

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

/* --- Etkin yetki kümesi → yetenekler ------------------------------------------
   `can(code)` TAM kod eşleşmesidir (bkz. permissionStore.js); burada aynı
   sözleşme küçük bir küme üzerinden modellenir. Rolden mi yoksa doğrudan
   grant'tan mı geldiği bu noktada ARTIK BİLİNMEZ — ve bilinmemelidir. */

const effective = (...codes) => {
  const set = new Set(codes)
  const can = (code) => set.has(code)
  return {
    can,
    canUseJourney: can(PERMISSIONS.JOURNEY_USE),
    canViewTransport: can(PERMISSIONS.TRANSPORT_VIEW),
    canStart: can(PERMISSIONS.TRANSPORT_SIMULATION_START),
    canStop: can(PERMISSIONS.TRANSPORT_SIMULATION_STOP),
  }
}

/** Rolden gelenler ∪ doğrudan verilenler — backend'in UNION'ıyla aynı kural. */
const union = (roleCodes, directCodes) => effective(...roleCodes, ...directCodes)

const RUNNING = {
  simulationId: 'sim-1',
  routeId: 7,
  status: 'Running',
  progressPercent: 42,
}

const controlsFor = (capabilities, simulation = RUNNING) =>
  transportSimulationControls({
    routeId: 7,
    simulation,
    canStart: capabilities.canStart,
    canStop: capabilities.canStop,
  })

/* --- A/B. Kişisel ürün: kaynak fark etmez -------------------------------------- */

test('journey.use opens the personal product whether it comes from a role or a direct grant', () => {
  const fromRole = union([PERMISSIONS.JOURNEY_USE], [])
  const fromDirect = union([], [PERMISSIONS.JOURNEY_USE])

  for (const capabilities of [fromRole, fromDirect]) {
    assert.equal(capabilities.canUseJourney, true)
    assert.deepEqual(journeyWorkspaceProducts(capabilities), [JOURNEY_PRODUCTS.PERSONAL])
    assert.equal(resolveJourneyProduct(capabilities), JOURNEY_PRODUCTS.PERSONAL)
    assert.equal(canOpenJourneyWorkspace(capabilities), true)
  }

  /* İki yol AYNI yetenek nesnesini üretir: "nereden geldi" sorusu arayüzde hiç
     sorulmaz. */
  assert.deepEqual(
    journeyWorkspaceProducts(fromRole),
    journeyWorkspaceProducts(fromDirect),
  )
})

/* --- C/D. Paylaşılan yaşam döngüsü: bölünmüş kaynaklar ------------------------- */

test('a capability split between role and direct grant behaves as one effective set', () => {
  // C) rol: transport.view — doğrudan: start
  const c = union([PERMISSIONS.TRANSPORT_VIEW], [PERMISSIONS.TRANSPORT_SIMULATION_START])

  assert.deepEqual(journeyWorkspaceProducts(c), [JOURNEY_PRODUCTS.SHARED])
  assert.equal(controlsFor(c, null).showStart, true)
  assert.equal(controlsFor(c).showStop, false)
  assert.equal(lifecycleCapabilities(c).canRestart, false)

  // D) rol: view + start — doğrudan: stop → tam yaşam döngüsü, Yeniden Başlat dâhil
  const d = union(
    [PERMISSIONS.TRANSPORT_VIEW, PERMISSIONS.TRANSPORT_SIMULATION_START],
    [PERMISSIONS.TRANSPORT_SIMULATION_STOP],
  )

  const controls = controlsFor(d)
  assert.equal(controls.showStop, true)
  assert.equal(controls.showPause, true)
  assert.deepEqual(lifecycleCapabilities(d), {
    canManage: true, canPause: true, canResume: true, canReset: true, canRestart: true,
  })

  /* Aynı kodların TAMAMI role verilseydi sonuç birebir aynı olurdu: bileşim
     yalnızca kümeyi üretir, davranışı değil. */
  const allFromRole = union(
    [
      PERMISSIONS.TRANSPORT_VIEW,
      PERMISSIONS.TRANSPORT_SIMULATION_START,
      PERMISSIONS.TRANSPORT_SIMULATION_STOP,
    ],
    [],
  )

  assert.deepEqual(lifecycleCapabilities(allFromRole), lifecycleCapabilities(d))
  assert.deepEqual(controlsFor(allFromRole), controlsFor(d))
})

/* --- E. Yalnızca gözlem -------------------------------------------------------- */

test('transport.view alone observes and follows but operates nothing', () => {
  const viewer = union([PERMISSIONS.TRANSPORT_VIEW], [])
  const controls = controlsFor(viewer)

  // Gözlem ve TAKİP yetki istemez; takip yalnızca kamera sahipliğidir.
  assert.equal(controls.isActive, true)
  assert.equal(controls.showFollow, true)

  // Hiçbir yaşam döngüsü yüzeyi yoktur.
  assert.equal(controls.showStart, false)
  assert.equal(controls.showStop, false)
  assert.equal(controls.showPause, false)
  assert.equal(controls.showResume, false)
  assert.deepEqual(lifecycleCapabilities(viewer), {
    canManage: false, canPause: false, canResume: false, canReset: false, canRestart: false,
  })
})

/* --- F. Okuma olmadan başlatma ------------------------------------------------- */

test('start without transport.view exposes no shared product to start from', () => {
  /* Ürün erişimi OKUMA yeteneğinden gelir; başlatma kodu onun yerine GEÇMEZ.
     Yeni bir davranış uydurulmaz: kullanıcı paylaşılan ürüne hiç ulaşamaz,
     dolayısıyla seçilebilecek bir hat da yoktur. */
  const starterWithoutRead = union([PERMISSIONS.TRANSPORT_SIMULATION_START], [])

  assert.deepEqual(journeyWorkspaceProducts(starterWithoutRead), [])
  assert.equal(resolveJourneyProduct(starterWithoutRead), null)
  assert.equal(canOpenJourneyWorkspace(starterWithoutRead), false)

  /* Seçili hat OLMADAN denetim de yoktur: `routeId` null iken başlatma
     sunulmaz. */
  assert.equal(
    transportSimulationControls({
      routeId: null,
      simulation: null,
      canStart: true,
      canStop: false,
    }).showStart,
    false,
  )
})

/* --- G. Hiçbir ilgili yetki ---------------------------------------------------- */

test('no relevant permission resolves no product and no command surface', () => {
  const none = union([], [])

  assert.deepEqual(journeyWorkspaceProducts(none), [])
  assert.equal(canOpenJourneyWorkspace(none), false)
  assert.equal(resolveJourneyProduct(none), null)
  // İstenen ürün bile fail-closed'dur.
  assert.equal(resolveJourneyProduct({ ...none, requested: JOURNEY_PRODUCTS.SHARED }), null)
  assert.deepEqual(journeyProductTabs(none), [])
})

/* --- 6. Ürün yalıtımı ---------------------------------------------------------- */

test('the two products stay independently authorized', () => {
  const personalOnly = union([PERMISSIONS.JOURNEY_USE], [])
  const sharedOnly = union([PERMISSIONS.TRANSPORT_VIEW], [])
  const both = union([PERMISSIONS.JOURNEY_USE, PERMISSIONS.TRANSPORT_VIEW], [])

  assert.deepEqual(journeyWorkspaceProducts(personalOnly), [JOURNEY_PRODUCTS.PERSONAL])
  assert.deepEqual(journeyWorkspaceProducts(sharedOnly), [JOURNEY_PRODUCTS.SHARED])
  // Sıra KARARLIDIR: kişisel önce, paylaşılan sonra.
  assert.deepEqual(journeyWorkspaceProducts(both), [
    JOURNEY_PRODUCTS.PERSONAL,
    JOURNEY_PRODUCTS.SHARED,
  ])

  // Tek ürünü olana sekme çubuğu çizilmez; iki ürünü olana çizilir.
  assert.deepEqual(journeyProductTabs(personalOnly), [])
  assert.deepEqual(journeyProductTabs(sharedOnly), [])
  assert.equal(journeyProductTabs(both).length, 2)

  /* Kapalı bir ürün İSTENSE bile açılmaz: erişilen tek ürün gösterilir. */
  assert.equal(
    resolveJourneyProduct({ ...personalOnly, requested: JOURNEY_PRODUCTS.SHARED }),
    JOURNEY_PRODUCTS.PERSONAL,
  )
  assert.equal(
    resolveJourneyProduct({ ...sharedOnly, requested: JOURNEY_PRODUCTS.PERSONAL }),
    JOURNEY_PRODUCTS.SHARED,
  )
})

/* --- 10. YENİDEN BAŞLATMA sözleşmesi ------------------------------------------- */

test('restart requires start AND stop, in every combination', () => {
  const matrix = [
    { start: true, stop: true, restart: true },
    { start: true, stop: false, restart: false },
    { start: false, stop: true, restart: false },
    { start: false, stop: false, restart: false },
  ]

  for (const { start, stop, restart } of matrix) {
    const capabilities = union(
      [
        ...(start ? [PERMISSIONS.TRANSPORT_SIMULATION_START] : []),
        ...(stop ? [PERMISSIONS.TRANSPORT_SIMULATION_STOP] : []),
      ],
      [],
    )

    assert.equal(
      lifecycleCapabilities(capabilities).canRestart,
      restart,
      `start=${start} stop=${stop} için yeniden başlatma yanlış`,
    )
  }

  /* Üçüncü bir kod UYDURULMADI: yeniden başlatma iki mevcut yeteneğin
     BİRLİKTE aranmasıdır. */
  for (const code of Object.values(PERMISSIONS)) {
    assert.ok(!/restart/i.test(code), `yeniden başlatma için yetki kodu üretilmiş: ${code}`)
  }
})

/* --- 4. ÖZEL ROL: ad hiçbir şey ifade etmez ------------------------------------ */

test('a custom role name is invisible to every Journey Center decision', () => {
  /* Rol ADI arayüz kararlarına hiç GİRMEZ: yetenekler yalnızca kod
     kümesinden türer. Aşağıdaki adlar birer KABUL SENARYOSUDUR; üretim
     kodunda hiçbiri geçmez. */
  const dispatcherCodes = [
    PERMISSIONS.TRANSPORT_VIEW,
    PERMISSIONS.TRANSPORT_SIMULATION_START,
    PERMISSIONS.TRANSPORT_SIMULATION_STOP,
  ]

  const reference = union(dispatcherCodes, [])

  for (const roleName of ['Journey Dispatcher', 'Foo', 'Intern', 'Temporary', 'XYZ', 'Admin']) {
    /* Rol adı yetenek üretimine hiç verilmez; buradaki döngü tam olarak bunu
       gösterir: ad değişir, girdi kümesi aynı kalır, sonuç değişmez. */
    const capabilities = { ...union(dispatcherCodes, []), roleName }

    assert.deepEqual(journeyWorkspaceProducts(capabilities), journeyWorkspaceProducts(reference))
    assert.deepEqual(lifecycleCapabilities(capabilities), lifecycleCapabilities(reference))
    assert.deepEqual(controlsFor(capabilities), controlsFor(reference))
  }
})

test('an "Admin"-named role without permissions gains nothing', () => {
  /* Ad ayrıcalık DEĞİLDİR. Yetkisiz bir kümeye ayrıcalıklı görünen kimlik
     alanları eklemek hiçbir kapı açmaz. */
  const impostor = {
    ...union([], []),
    roleName: 'Admin',
    role: 'Administrator',
    isAdmin: true,
    isOperator: true,
    username: 'admin',
  }

  assert.deepEqual(journeyWorkspaceProducts(impostor), [])
  assert.equal(canOpenJourneyWorkspace(impostor), false)
  assert.equal(resolveJourneyProduct(impostor), null)
  assert.deepEqual(lifecycleCapabilities(impostor), {
    canManage: false, canPause: false, canResume: false, canReset: false, canRestart: false,
  })

  const controls = transportSimulationControls({
    routeId: 7,
    simulation: RUNNING,
    canStart: false,
    canStop: false,
    ...{ isAdmin: true, roleName: 'Administrator' },
  })

  assert.equal(controls.showStart, false)
  assert.equal(controls.showStop, false)
  assert.equal(controls.showPause, false)
  assert.equal(controls.showResume, false)
})

/* --- 9. Aynı yetenek, aynı kural ----------------------------------------------- */

test('both shared lifecycle sides are re-checked on the command path, not only hidden', () => {
  /* Görünürlük bir denetim DEĞİLDİR: yetkiler oturum içinde tazelenebilir ve
     açık bir onay kutusu ya da odaklanmış bir düğme, yetki geri alındıktan
     sonra da tıklanabilir. Bu yüzden KOMUT yolu da kendi kapısını taşır.

     İddia SİMETRİKTİR: başlatma tarafının durdurma tarafından daha gevşek bir
     kural kitabı taşıması, aynı yeteneğin iki farklı yorumu demek olurdu. */
  const mapPage = stripComments(read('../../src/pages/MapPage.jsx'))
  const adminPage = stripComments(read('../../src/pages/admin/TransportRoutePage.jsx'))

  for (const [name, source, startFlag, stopFlag] of [
    ['MapPage.jsx', mapPage, 'canStartSharedSimulation', 'canStopSharedSimulation'],
    ['TransportRoutePage.jsx', adminPage, 'canStartSimulation', 'canStopSimulation'],
  ]) {
    assert.ok(
      new RegExp(`if \\(!${startFlag}\\) return`).test(source),
      `${name} başlatma komut yolunda yeteneği yeniden denetlemiyor`,
    )
    assert.ok(
      new RegExp(`if \\(!${stopFlag}\\) return`).test(source),
      `${name} durdurma komut yolunda yeteneği yeniden denetlemiyor`,
    )
  }
})

/* --- 12. KİMLİK KESTİRMESİ REGRESYON KORUMASI ---------------------------------- */

test('the Journey Center authorization path carries no identity-shaped shortcut', () => {
  /* Kalıplar YETKİLENDİRME BİÇİMLİDİR, kelime avı DEĞİL.

     Faz 9 dersi: `\brole\s*===` gibi genel bir ifade KULLANILMAZ — yolculuk
     alanı ara nokta rolünü (`role === 'via'`) meşru biçimde taşır. Faz 11
     dersi: çıplak `stop` kelimesi de bir yaşam döngüsü komutu SAYILMAZ;
     `TransportStop` meşru alan verisidir. */
  const IDENTITY_SHORTCUTS = [
    /\b(currentUser|user|auth|session|account|identity|principal|claims|me)\s*\??\.\s*roles?\b/i,
    /\broles\s*\??\.\s*(includes|some|indexOf|find)\s*\(/i,
    /\brole\w*\s*[=!]==?\s*['"`]\s*(admin|administrator|operat|viewer|editor|superuser|ulaşım)/i,
    /\bis_?admin\b/i,
    /\bis_?operator\b/i,
    /\busername\s*[=!]==?/i,
    /\b(can[A-Za-z]*|allow\w*|permitted)\s*=\s*[^\n]*\b(isAdmin|roleName|username)\b/i,
  ]

  const sources = [
    ['journeyWorkspace.js', read('../../src/map/journeyWorkspace.js')],
    ['activeSimulations.js', read('../../src/map/activeSimulations.js')],
    ['transportSimulationState.js', read('../../src/map/transportSimulationState.js')],
    ['journeyPlanning.js', read('../../src/map/journeyPlanning.js')],
    ['useWorkspacePermissions.js', read('../../src/hooks/useWorkspacePermissions.js')],
    ['useTransportSimulation.js', read('../../src/hooks/useTransportSimulation.js')],
    ['useJourneySimulation.js', read('../../src/hooks/useJourneySimulation.js')],
    ['SharedTransportJourneyContent.jsx', read('../../src/components/map/SharedTransportJourneyContent.jsx')],
    ['TransportTrackingControls.jsx', read('../../src/components/map/TransportTrackingControls.jsx')],
    ['ActiveSimulationManagementBar.jsx', read('../../src/components/map/ActiveSimulationManagementBar.jsx')],
  ]

  for (const [name, source] of sources) {
    const code = stripComments(source)
    for (const pattern of IDENTITY_SHORTCUTS) {
      assert.ok(!pattern.test(code), `${name} kimlik biçimli kestirme taşıyor: ${pattern}`)
    }
  }

  /* MEŞRU alan kullanımı yanlışlıkla yakalanmamalıdır: yolculuk planı ara
     noktaları gerçekten bir `role` alanı taşır ve bu bir yetkilendirme
     kavramı DEĞİLDİR. */
  const planning = stripComments(read('../../src/map/journeyPlanning.js'))
  assert.ok(/via/.test(planning), 'ara nokta rolü artık burada değil — koruma yanlış dosyayı ölçüyor')
})
