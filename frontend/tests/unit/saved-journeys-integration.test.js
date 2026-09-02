import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

/**
 * Yorumlar ayıklanır: bir kavramı ANLATMAK onu uygulamak değildir.
 *
 * Aynı yardımcı yolculuk testlerinde de kullanılır; burada da ölçülen şey
 * KODUN kendisidir, açıklamaları değil.
 */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

const MAP_PAGE = stripComments(read('../../src/pages/MapPage.jsx'))
const PANEL = stripComments(read('../../src/components/map/JourneyPlannerPanel.jsx'))
const SECTION = stripComments(read('../../src/components/map/SavedJourneysSection.jsx'))
const DIALOG = stripComments(read('../../src/components/map/JourneyNameDialog.jsx'))
const SAVED_HOOK = stripComments(read('../../src/hooks/useSavedJourneys.js'))
const SIM_HOOK = stripComments(read('../../src/hooks/useJourneySimulation.js'))
const SAVED_MODULE = stripComments(read('../../src/map/savedJourneys.js'))
const TRANSPORT_API = stripComments(read('../../src/services/transportApi.js'))
const SHARED_CONTENT = stripComments(read('../../src/components/map/SharedTransportJourneyContent.jsx'))

/** Faz 7'de EKLENEN ya da DEĞİŞTİRİLEN kişisel yüzeyler. */
const NEW_SOURCES = [
  ['useSavedJourneys.js', SAVED_HOOK],
  ['savedJourneys.js', SAVED_MODULE],
  ['SavedJourneysSection.jsx', SECTION],
  ['JourneyNameDialog.jsx', DIALOG],
]

/**
 * Tek bir <code>useCallback</code>'in GÖVDESİ.
 *
 * Bileşenin tamamını taramak yerine yalnızca ilgili geri çağırım okunur:
 * "MapPage'de şu kelime geçmiyor" biçiminde bir iddia, dosyanın başka bir
 * yerindeki tamamen meşru bir kullanımda kırılırdı ve koruduğu şeyi korumazdı.
 * Sınır, bileşen düzeyindeki iki boşluklu kapanıştır (`\n  }, [`) ve bu, proje
 * genelinde tutarlı olan tek biçimdir.
 */
const callbackBody = (source, name) => {
  const start = source.indexOf(`const ${name} = useCallback(`)
  assert.ok(start >= 0, `${name} bulunamadı`)

  const end = source.indexOf('\n  }, [', start)
  assert.ok(end > start, `${name} gövdesinin sınırı bulunamadı`)

  return source.slice(start, end)
}

/**
 * GERÇEK yetkilendirme kestirmelerinin desenleri.
 *
 * Aranan şey `role` KELİMESİ değil, yetkiyi etkin yetki kodu yerine kimlikten
 * türetme ŞEKLİDİR. Yolculuk noktasının kendi alan kavramı olan `role`
 * (origin/via/destination) bilinçli olarak dışarıdadır.
 */
const AUTH_SHORTCUT_PATTERNS = [
  /\b(currentUser|user|auth|session|account|identity|principal|claims|me)\s*\??\.\s*roles?\b/i,
  /\broles\s*\??\.\s*(includes|some|indexOf|find)\s*\(/i,
  /\brole\w*\s*[=!]==?\s*['"`]\s*(admin|administrator|operator|viewer|editor|superuser)/i,
  /\bis_?admin\b/i,
  /\busername\s*[=!]==?/i,
]

/* --- Kaydetme: BAŞLATMA DEĞİLDİR ---------------------------------------------- */

test('the save action is offered only for a valid canonical journey', () => {
  /* Kapı, önizlemenin varlığı değil KANONİK TANIMIN geçerliliğidir: kullanıcı
     yola çıkmadan da kaydedebilmelidir. */
  assert.match(MAP_PAGE, /canSaveJourney=\{Boolean\(journey\.buildIntent\(\)\)\}/)

  // Panel bu bayrağı gerçekten TÜKETİR; süs değildir.
  assert.match(PANEL, /disabled=\{!canSaveJourney\}/)
  assert.match(PANEL, /onClick=\{onSaveJourney\}/)
})

test('opening the save dialog never fires for an invalid selection', () => {
  const body = callbackBody(MAP_PAGE, 'requestJourneySave')

  assert.match(body, /if \(!journey\.buildIntent\(\)\) return/)
  assert.match(body, /setJourneySavePending\(true\)/)
})

test('saving stores the definition and touches nothing that belongs to a run', () => {
  const body = callbackBody(MAP_PAGE, 'confirmJourneySave')

  assert.match(body, /savedJourneys\.save\(/)
  assert.match(body, /journey\.buildIntent\(\)/)

  /* ASIL İDDİA: kaydetme yolu canlı kancaya HİÇ dokunmaz — başlatmaz,
     benimsemez, kamerayı oynatmaz. */
  for (const forbidden of ['journeySimulation', 'adopt(', 'setFollowing', 'startJourney']) {
    assert.ok(!body.includes(forbidden), `kaydetme yolu ${forbidden} kullanmamalı`)
  }
})

test('the save dialog validates the name with the shared rule and is not a browser prompt', () => {
  assert.match(DIALOG, /import \{ validateSavedJourneyName \} from '\.\.\/\.\.\/map\/savedJourneys\.js'/)
  assert.match(DIALOG, /validateSavedJourneyName\(name\)/)

  // Geçersiz adda onay YUKARI çıkmaz.
  assert.match(DIALOG, /if \(!validated\.ok\) \{[\s\S]*?return/)

  for (const source of [DIALOG, MAP_PAGE, SECTION]) {
    assert.ok(!/\bwindow\.prompt\(|[^.\w]prompt\(/.test(source))
  }
})

/* --- Yükleme ile başlatma AYRIDIR ---------------------------------------------- */

test('loading a saved journey only rebuilds the draft', () => {
  const body = callbackBody(MAP_PAGE, 'loadSavedJourney')

  assert.match(body, /savedJourneys\.load\(/)
  assert.match(body, /journey\.loadSaved\(draft\)/)

  // Yükleme HİÇBİR çalıştırma kurmaz.
  for (const forbidden of ['reuse(', 'adopt(', 'journeySimulation']) {
    assert.ok(!body.includes(forbidden), `yükleme yolu ${forbidden} kullanmamalı`)
  }
})

test('reuse is an explicit action that adopts the servers new run into the one personal hook', () => {
  const body = callbackBody(MAP_PAGE, 'startSavedJourney')

  assert.match(body, /savedJourneys\.reuse\(/)
  /* Benimseme TEK yerdedir: ikinci bir canlı durum ya da ikinci bir kanal
     açılmaz. */
  assert.match(body, /journeySimulation\.adopt\(started\)/)
})

/* --- Tek kanal, yoklama yok ----------------------------------------------------- */

test('the saved journey surfaces open no second personal SignalR client', () => {
  /* Kişisel canlı kanalın sahibi TEK kancadır. Kaydedilmiş yolculuklar sıradan
     REST'tir ve bir hub bağlantısı kurmaz. */
  assert.match(SIM_HOOK, /createJourneySimulationConnection/)

  for (const [name, source] of NEW_SOURCES) {
    for (const forbidden of ['createJourneySimulationConnection', '@microsoft/signalr', 'journeySimulationHub']) {
      assert.ok(!source.includes(forbidden), `${name} ${forbidden} kullanmamalı`)
    }
  }
})

test('nothing in the saved journey surfaces polls', () => {
  for (const [name, source] of NEW_SOURCES) {
    for (const forbidden of ['setInterval', 'setTimeout', 'requestAnimationFrame']) {
      assert.ok(!source.includes(forbidden), `${name} ${forbidden} kurmamalı`)
    }
  }
})

test('the list is read when the section opens, not on a timer', () => {
  assert.match(MAP_PAGE, /const journeySavedSectionOpen = journey\.state\.panel === PANEL_STATES\.OPEN/)
  assert.match(MAP_PAGE, /enabled: journeySavedSectionOpen/)
  assert.match(SAVED_HOOK, /if \(!permitted \|\| !enabled\) return\s*\n\s*refresh\(\)/)
})

test('no browser storage is used as the authority for saved journeys', () => {
  for (const [name, source] of NEW_SOURCES) {
    for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie']) {
      assert.ok(!source.includes(forbidden), `${name} ${forbidden} kullanmamalı`)
    }
  }
})

/* --- Kimlik: her eylem KAYIT KİMLİĞİ taşır -------------------------------------- */

test('every row action carries the id of the row it belongs to', () => {
  assert.match(SECTION, /onToggleFavorite\?\.\(item\.id, !item\.isFavorite\)/)
  assert.match(SECTION, /onRename\?\.\(item\.id\)/)
  assert.match(SECTION, /onDelete\?\.\(item\.id\)/)
  assert.match(SECTION, /onUse\?\.\(item\.id\)/)
  assert.match(SECTION, /onLoad\?\.\(item\.id\)/)

  /* Panelde "seçili kayıt" diye bir DURUM yoktur: olsaydı, bayat bir seçim
     yanlış kaydı silebilirdi. */
  assert.ok(!SECTION.includes('useState'))
  assert.ok(!/selectedId|selectedSavedJourney/.test(SECTION))
})

test('rename and delete freeze their target through the pure rule', () => {
  for (const name of ['requestSavedJourneyRename', 'requestSavedJourneyDelete']) {
    const body = callbackBody(MAP_PAGE, name)
    assert.match(body, /savedJourneyTarget\(savedJourneys\.items, savedJourneyId\)/)
  }

  /* Onay çözüldüğünde LİSTE okunmaz; dondurulmuş hedef kullanılır. */
  const confirmDelete = callbackBody(MAP_PAGE, 'confirmSavedJourneyDelete')
  assert.match(confirmDelete, /const target = journeyDeletePending/)
  assert.match(confirmDelete, /savedJourneys\.remove\(target\.id\)/)
  assert.ok(!confirmDelete.includes('savedJourneys.items'))

  const confirmRename = callbackBody(MAP_PAGE, 'confirmSavedJourneyRename')
  assert.match(confirmRename, /const target = journeyRenamePending/)
  assert.match(confirmRename, /savedJourneys\.rename\(target\.id, name\)/)
  assert.ok(!confirmRename.includes('savedJourneys.items'))
})

test('deleting a saved journey goes through the applications own confirmation', () => {
  assert.match(MAP_PAGE, /<ConfirmDialog\s+open=\{Boolean\(journeyDeletePending\)\}/)
  assert.match(MAP_PAGE, /title="Kaydedilen yolculuğu sil"/)

  // Tarayıcının `confirm()`'i KULLANILMAZ; tek onay kalıbı vardır.
  assert.ok(!MAP_PAGE.includes('window.confirm('))
})

test('the favourite toggle sends a value rather than asking the server to flip one', () => {
  assert.match(SAVED_HOOK, /updateSavedJourney\(id, \{ isFavorite: Boolean\(isFavorite\) \}\)/)
  assert.ok(!SAVED_HOOK.includes('toggleFavorite('))
})

/* --- API sözleşmesi ------------------------------------------------------------- */

test('the saved journey endpoints are owner-scoped by the token, not by a path identity', () => {
  assert.match(TRANSPORT_API, /authFetch\('\/api\/transport\/journeys\/saved'/)
  assert.match(TRANSPORT_API, /journeys\/saved\/\$\{savedJourneyId\}\/reuse/)

  /* İstek yolunda ya da gövdesinde bir KULLANICI KİMLİĞİ taşınmaz: sunucu onu
     doğrulanmış JWT'den okur. */
  const savedApi = TRANSPORT_API.slice(TRANSPORT_API.indexOf('fetchSavedJourneys'))
  assert.ok(!/userId|ownerId/i.test(savedApi))

  // Aynı authFetch; ikinci bir API katmanı ya da token deposu açılmaz.
  assert.ok(!savedApi.includes('fetch('))
})

test('the save request carries the journey intent and no runtime state', () => {
  const savedApi = TRANSPORT_API.slice(TRANSPORT_API.indexOf('export function createSavedJourney'))
  const create = savedApi.slice(0, savedApi.indexOf('export function updateSavedJourney'))

  assert.match(create, /JSON\.stringify\(\{ name, isFavorite, journey \}\)/)
  for (const forbidden of ['geometryWkt', 'simulationId', 'planId', 'distanceMeters']) {
    assert.ok(!create.includes(forbidden))
  }
})

/* --- Sınırlar: paylaşılan hat ve Faz 6 ------------------------------------------ */

test('the shared transport tab is untouched by this phase', () => {
  /* Paylaşılan bölüm kendi bileşenini, kendi servisini ve kendi durumunu
     kullanmaya devam eder; kaydedilmiş yolculuk kavramı oraya sızmaz. */
  assert.match(PANEL, /<SharedTransportJourneyContent/)

  for (const forbidden of ['saved', 'Saved']) {
    assert.ok(!SHARED_CONTENT.includes(forbidden), `paylaşılan içerik ${forbidden} tanımamalı`)
  }

  // Ve kaydedilmiş yolculuk modülü paylaşılan hattı hiç tanımaz.
  for (const forbidden of ['transportSimulation', 'sharedJourneyPresentation', 'TransportRoute']) {
    assert.ok(!SAVED_MODULE.includes(forbidden))
  }
})

test('the personal profiles and modes survive unchanged', () => {
  // Üç profil ve üç kip hâlâ panelin kendi kaynağından gelir.
  assert.match(PANEL, /JOURNEY_PROFILES\.map/)
  assert.match(PANEL, /MODE_TABS\.filter/)

  // Bölüm sekmeleri kip sekmelerinin YERİNE GEÇMEZ; ikisi de çizilir.
  assert.match(PANEL, /aria-label="Kişisel yolculuk bölümü"/)
  assert.match(PANEL, /aria-label="Planlama türü"/)
  assert.match(PANEL, /aria-label="Seyahat türü"/)
})

test('the phase 6 surfaces are not touched by the saved journey work', () => {
  /* Faz 6 yüzeyleri (marka işaretçisi, Araçlar rıhtımı, üst çubuk, kenar
     çubuğu) YERİNDE durur ve kaydedilmiş yolculuk kavramını hiç tanımaz. */
  for (const relative of [
    '../../src/components/map/Topbar.jsx',
    '../../src/components/map/Sidebar.jsx',
    '../../src/components/map/TransportTrackingControls.jsx',
  ]) {
    assert.ok(existsSync(new URL(relative, import.meta.url)), `${relative} bulunmalı`)
    assert.ok(!/savedJourney|SavedJourney/.test(read(relative)), `${relative} bu fazda değişmemeli`)
  }
})

/* --- Erişilebilirlik ve yetki --------------------------------------------------- */

test('row actions name the record they belong to and the star reports its state', () => {
  assert.match(SECTION, /aria-pressed=\{item\.isFavorite\}/)
  assert.match(SECTION, /favorilerden çıkar/)
  assert.match(SECTION, /favorilere ekle/)

  // Her eylem düğmesi kaydın ADINI taşır: "Sil" tek başına hangi satır olduğunu söylemez.
  const labels = SECTION.match(/aria-label=\{`[^`]*`\}/g) ?? []
  assert.ok(labels.length >= 4, `beklenen en az 4 erişilebilir ad, bulunan ${labels.length}`)
  assert.ok(labels.every((label) => label.includes('item.name')))

  // Profil METİNLE gösterilir; yalnız ikon değil.
  assert.match(SECTION, /\{item\.profileLabel\}/)

  // Yükleme durumu da SÖYLENİR.
  assert.match(SECTION, /role="status"/)
  assert.match(SECTION, /role="alert"/)
})

test('the saved journey surfaces derive nothing from role names', () => {
  for (const [name, source] of [...NEW_SOURCES, ['transportApi.js', TRANSPORT_API]]) {
    for (const pattern of AUTH_SHORTCUT_PATTERNS) {
      assert.ok(!pattern.test(source), `${name} yetkilendirme kestirmesi içermemeli: ${pattern}`)
    }
  }

  /* Yetki kararı MEVCUT ürün kapısından gelir; ikinci bir kod ya da rol adı
     okunmaz. */
  assert.match(MAP_PAGE, /permitted: allowed\.canUseJourney,\s*\n\s*enabled: journeySavedSectionOpen,/)
})
