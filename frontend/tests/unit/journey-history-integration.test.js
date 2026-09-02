import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

/**
 * Yorumlar ayıklanır: bir kavramı ANLATMAK onu uygulamak değildir.
 *
 * Aynı yardımcı yolculuk ve kaydedilmiş yolculuk testlerinde de kullanılır;
 * ölçülen şey KODUN kendisidir, açıklamaları değil.
 */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

const MAP_PAGE = stripComments(read('../../src/pages/MapPage.jsx'))
const PANEL = stripComments(read('../../src/components/map/JourneyPlannerPanel.jsx'))
const SECTION = stripComments(read('../../src/components/map/JourneyHistorySection.jsx'))
const HISTORY_HOOK = stripComments(read('../../src/hooks/useJourneyHistory.js'))
const HISTORY_MODULE = stripComments(read('../../src/map/journeyHistory.js'))
const SIM_HOOK = stripComments(read('../../src/hooks/useJourneySimulation.js'))
const TRANSPORT_API = stripComments(read('../../src/services/transportApi.js'))
const SHARED_CONTENT = stripComments(read('../../src/components/map/SharedTransportJourneyContent.jsx'))

/** Faz 8'de EKLENEN kişisel yüzeyler. */
const NEW_SOURCES = [
  ['useJourneyHistory.js', HISTORY_HOOK],
  ['journeyHistory.js', HISTORY_MODULE],
  ['JourneyHistorySection.jsx', SECTION],
]

/**
 * Tek bir <code>useCallback</code>'in GÖVDESİ.
 *
 * Bileşenin tamamını taramak yerine yalnızca ilgili geri çağırım okunur:
 * "MapPage'de şu kelime geçmiyor" biçiminde bir iddia, dosyanın başka bir
 * yerindeki tamamen meşru bir kullanımda kırılırdı. Sınır, bileşen düzeyindeki
 * iki boşluklu kapanıştır (`\n  }, [`).
 */
const callbackBody = (source, name) => {
  const start = source.indexOf(`const ${name} = useCallback(`)
  assert.ok(start >= 0, `${name} bulunamadı`)

  const end = source.indexOf('\n  }, [', start)
  assert.ok(end > start, `${name} gövdesinin sınırı bulunamadı`)

  return source.slice(start, end)
}

const AUTH_SHORTCUT_PATTERNS = [
  /\b(currentUser|user|auth|session|account|identity|principal|claims|me)\s*\??\.\s*roles?\b/i,
  /\broles\s*\??\.\s*(includes|some|indexOf|find)\s*\(/i,
  /\brole\w*\s*[=!]==?\s*['"`]\s*(admin|administrator|operator|viewer|editor|superuser)/i,
  /\bis_?admin\b/i,
  /\busername\s*[=!]==?/i,
]

/* --- Kişisel bölüm ------------------------------------------------------------- */

test('the personal product offers a third section without touching the shared one', () => {
  assert.match(PANEL, /\{ id: PERSONAL_SECTIONS\.HISTORY, label: 'Geçmiş' \}/)

  // Üç bölüm de AYNI sekme çubuğundan çizilir; ikinci bir gezinme kurulmaz.
  assert.match(PANEL, /aria-label="Kişisel yolculuk bölümü"/)

  /* Paylaşılan ürün kendi bileşenini kullanmaya devam eder ve geçmiş kavramı
     oraya sızmaz. */
  assert.match(PANEL, /<SharedTransportJourneyContent/)
  for (const forbidden of ['history', 'History', 'Geçmiş']) {
    assert.ok(!SHARED_CONTENT.includes(forbidden), `paylaşılan içerik ${forbidden} tanımamalı`)
  }
})

test('only one section renders at a time', () => {
  /* Planlama, kayıtlar ve geçmiş birbirini DIŞLAR: ikisi birden çizilseydi
     panel iki farklı ürünü üst üste gösterirdi. */
  assert.match(PANEL, /const showingHistory = section === PERSONAL_SECTIONS\.HISTORY/)
  assert.match(PANEL, /const showingPlanner = !showingSaved && !showingHistory/)
})

/* --- Ayrı durum, tek kanal ------------------------------------------------------ */

test('history opens no second personal SignalR client', () => {
  /* Kişisel canlı kanalın sahibi TEK kancadır. Geçmiş sıradan REST'tir. */
  assert.match(SIM_HOOK, /createJourneySimulationConnection/)

  for (const [name, source] of NEW_SOURCES) {
    for (const forbidden of ['createJourneySimulationConnection', '@microsoft/signalr', 'journeySimulationHub']) {
      assert.ok(!source.includes(forbidden), `${name} ${forbidden} kullanmamalı`)
    }
  }
})

test('nothing in the history surfaces polls', () => {
  for (const [name, source] of NEW_SOURCES) {
    for (const forbidden of ['setInterval', 'setTimeout', 'requestAnimationFrame']) {
      assert.ok(!source.includes(forbidden), `${name} ${forbidden} kurmamalı`)
    }
  }
})

test('no browser storage is used as the authority for history', () => {
  for (const [name, source] of NEW_SOURCES) {
    for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie']) {
      assert.ok(!source.includes(forbidden), `${name} ${forbidden} kullanmamalı`)
    }
  }
})

test('the list is read when the section opens, not on a timer', () => {
  assert.match(MAP_PAGE, /const journeyHistorySectionOpen = journey\.state\.panel === PANEL_STATES\.OPEN/)
  assert.match(MAP_PAGE, /enabled: journeyHistorySectionOpen/)
  assert.match(HISTORY_HOOK, /if \(!permitted \|\| !enabled\) return\s*\n\s*load\(/)
})

test('history state is its own hook, separate from saved journeys and from the live run', () => {
  // Üç kanca ayrı ayrı çağrılır; hiçbiri diğerinin durumunu taşımaz.
  assert.match(MAP_PAGE, /const savedJourneys = useSavedJourneys\(/)
  assert.match(MAP_PAGE, /const journeyHistory = useJourneyHistory\(/)
  assert.match(MAP_PAGE, /const journeySimulation = useJourneySimulation\(/)

  /* Geçmiş kancası kaydedilmiş yolculuk API'sini HİÇ tanımaz: iki ürün ayrı
     kalır. */
  for (const forbidden of ['SavedJourney', 'savedJourney', 'useSavedJourneys']) {
    assert.ok(!HISTORY_HOOK.includes(forbidden), `geçmiş kancası ${forbidden} tanımamalı`)
  }
})

/* --- Tutanak DEĞİŞTİRİLEMEZ ------------------------------------------------------ */

test('history exposes no way to edit, rename, favourite or delete a record', () => {
  /* Kaydedilmiş yolculukta bu eylemler VARDIR; geçmişte olmamalıdır — olmuş
     bir şeyin tutanağı düzenlenmez. */
  for (const [name, source] of NEW_SOURCES) {
    for (const forbidden of ['rename', 'setFavorite', 'isFavorite', 'remove(', 'deleteJourneyHistory']) {
      assert.ok(!source.includes(forbidden), `${name} ${forbidden} sunmamalı`)
    }
  }

  // API katmanında da yalnızca okuma ve yeniden yapma vardır.
  const historyApi = TRANSPORT_API.slice(TRANSPORT_API.indexOf('export function fetchJourneyHistory'))
  assert.ok(!/method: 'PUT'|method: 'DELETE'|method: 'PATCH'/.test(historyApi))
  assert.ok(!historyApi.includes('createJourneyHistory'))
})

test('the client cannot author a history record', () => {
  /* "Bu yolculuğu yaptım" iddiası tarayıcıdan KABUL EDİLMEZ: tutanağın tek
     kaynağı sunucunun kendi terminal geçişidir. */
  const historyApi = TRANSPORT_API.slice(TRANSPORT_API.indexOf('export function fetchJourneyHistory'))
  const posts = historyApi.match(/method: 'POST'/g) ?? []

  // Tek POST vardır ve o da YENİDEN YAPMA'dır.
  assert.equal(posts.length, 1)
  assert.match(historyApi, /journeys\/history\/\$\{journeyHistoryId\}\/reuse/)
})

/* --- Kimlik güvenliği ------------------------------------------------------------ */

test('every row action carries the id of the row it belongs to', () => {
  assert.match(SECTION, /onOpenDetail\?\.\(item\.id\)/)
  assert.match(SECTION, /onReuse\?\.\(item\.id\)/)
  assert.match(SECTION, /onLoadIntoPlanner\?\.\(item\.id\)/)

  /* Bölümde "seçili kayıt" diye bir DURUM yoktur: olsaydı, bayat bir seçim
     yanlış kaydı yeniden başlatabilirdi. */
  assert.ok(!SECTION.includes('useState'))
  assert.ok(!/selectedId|selectedHistory/.test(SECTION))
})

test('the detail that opens is the one that was asked for', () => {
  /* Kimlik DONDURULUR: cevap geldiğinde hangi satırın açık olduğuna bakan bir
     kod, geç gelen bir cevaptan sonra yanlış kaydı gösterirdi. */
  const body = callbackBody(HISTORY_HOOK, 'openDetail')

  assert.match(body, /const id = Number\(journeyHistoryId\)/)
  assert.match(body, /fetchJourneyHistoryDetail\(id\)/)
  assert.match(body, /setDetailId\(id\)/)
})

test('loading into the planner re-asks by id rather than reading the open detail', () => {
  const body = callbackBody(MAP_PAGE, 'loadJourneyFromHistory')

  assert.match(body, /journeyHistory\.openDetail\(journeyHistoryId\)/)
  assert.match(body, /journeyHistoryDraft\(detail\)/)
  assert.match(body, /journey\.loadSaved\(draft\)/)

  // Ekrandaki modeli okumak, geç gelen bir cevaptan sonra yanlış yolculuğu
  // taslağa koyabilirdi.
  assert.ok(!body.includes('journeyHistory.detail'))
})

/* --- Yükleme, başlatma DEĞİLDİR ---------------------------------------------------- */

test('opening a detail or loading a draft never starts a simulation', () => {
  for (const name of ['loadJourneyFromHistory']) {
    const body = callbackBody(MAP_PAGE, name)
    for (const forbidden of ['adopt(', 'journeySimulation', 'reuse(']) {
      assert.ok(!body.includes(forbidden), `${name} ${forbidden} kullanmamalı`)
    }
  }

  // Ayrıntı açma yolu da yalnızca okur.
  const openDetail = callbackBody(HISTORY_HOOK, 'openDetail')
  for (const forbidden of ['reuseJourneyHistory', 'adopt', 'start']) {
    assert.ok(!openDetail.includes(forbidden), `ayrıntı açma ${forbidden} kullanmamalı`)
  }
})

test('explicit reuse adopts the servers new run into the one personal hook', () => {
  const body = callbackBody(MAP_PAGE, 'reuseJourneyFromHistory')

  assert.match(body, /journeyHistory\.reuse\(journeyHistoryId\)/)
  /* Benimseme TEK yerdedir: ikinci bir canlı durum ya da ikinci bir kanal
     açılmaz. */
  assert.match(body, /journeySimulation\.adopt\(started\)/)
})

test('reuse sends the record id and never the historical run id', () => {
  const hookBody = callbackBody(HISTORY_HOOK, 'reuse')

  assert.match(hookBody, /reuseJourneyHistory\(id\)/)

  /* ASIL İDDİA: tarihsel çalıştırma kimliği isteğe HİÇ girmez — girseydi ölü
     bir çalıştırma diriltilmeye çalışılırdı. */
  assert.ok(!hookBody.includes('simulationId'))

  const historyApi = TRANSPORT_API.slice(TRANSPORT_API.indexOf('export function reuseJourneyHistory'))
  assert.ok(!historyApi.slice(0, 400).includes('simulationId'))
})

test('reusing history never creates a saved journey', () => {
  const body = callbackBody(MAP_PAGE, 'reuseJourneyFromHistory')

  /* İKİ ÜRÜN AYRIDIR: geçmişi yeniden yapmak onu saklamak değildir. */
  for (const forbidden of ['savedJourneys', 'createSavedJourney', 'savedJourneys.save']) {
    assert.ok(!body.includes(forbidden), `yeniden yapma ${forbidden} çağırmamalı`)
  }
})

/* --- Sunum ------------------------------------------------------------------------ */

test('the row states status, profile and timings as text', () => {
  assert.match(SECTION, /\{item\.statusLabel\}/)
  assert.match(SECTION, /\{item\.profileLabel\}/)
  assert.match(SECTION, /\{item\.durationLabel\}/)
  assert.match(SECTION, /\{item\.distanceLabel\}/)
  assert.match(SECTION, /\{item\.endedLabel\}/)

  // Renk tek başına bilgi taşımaz: ton yalnızca sınıf adına girer.
  assert.match(SECTION, /tone-\$\{item\.statusTone\}/)
})

test('history renders from its own snapshots without fetching live records', () => {
  /* Geçmişi çizmek için POI/durak/hat kaydına GİDİLMEZ; adların hepsi
     tutanağın kendi kopyalarındandır. */
  for (const forbidden of ['fetchPoi', 'fetchTransportStops', 'fetchTransportRoutes', 'usePoiSearch']) {
    assert.ok(!SECTION.includes(forbidden), `bölüm ${forbidden} çağırmamalı`)
    assert.ok(!HISTORY_HOOK.includes(forbidden), `kanca ${forbidden} çağırmamalı`)
  }
})

test('loading and errors are announced, not just drawn', () => {
  assert.match(SECTION, /role="status"/)
  assert.match(SECTION, /role="alert"/)

  // Her eylem düğmesi hangi yolculuğa ait olduğunu söyler.
  const labels = SECTION.match(/aria-label=\{`[^`]*`\}/g) ?? []
  assert.ok(labels.length >= 3, `beklenen en az 3 erişilebilir ad, bulunan ${labels.length}`)
  assert.match(SECTION, /aria-expanded=\{isOpen\}/)
})

/* --- Sınırlar --------------------------------------------------------------------- */

test('saved journeys keep their own surface untouched', () => {
  /* Faz 7 ürünü YERİNDE durur: kaydetme, adlandırma, favori ve silme hâlâ
     kendi bölümündedir. */
  for (const relative of [
    '../../src/hooks/useSavedJourneys.js',
    '../../src/components/map/SavedJourneysSection.jsx',
    '../../src/components/map/JourneyNameDialog.jsx',
    '../../src/map/savedJourneys.js',
  ]) {
    assert.ok(existsSync(new URL(relative, import.meta.url)), `${relative} bulunmalı`)
  }

  assert.match(PANEL, /<SavedJourneysSection/)
  assert.match(MAP_PAGE, /onToggleSavedFavorite=\{toggleSavedJourneyFavorite\}/)
})

test('the phase 6 surfaces are not touched by the history work', () => {
  for (const relative of [
    '../../src/components/map/Topbar.jsx',
    '../../src/components/map/Sidebar.jsx',
    '../../src/components/map/TransportTrackingControls.jsx',
    '../../src/components/map/TransportVehiclePopup.jsx',
  ]) {
    assert.ok(existsSync(new URL(relative, import.meta.url)), `${relative} bulunmalı`)
    assert.ok(
      !/journeyHistory|JourneyHistory/.test(read(relative)),
      `${relative} bu fazda değişmemeli`,
    )
  }
})

test('the history surfaces derive nothing from role names', () => {
  for (const [name, source] of [...NEW_SOURCES, ['transportApi.js', TRANSPORT_API]]) {
    for (const pattern of AUTH_SHORTCUT_PATTERNS) {
      assert.ok(!pattern.test(source), `${name} yetkilendirme kestirmesi içermemeli: ${pattern}`)
    }
  }

  /* Yetki kararı MEVCUT ürün kapısından gelir; ikinci bir kod okunmaz. */
  assert.match(MAP_PAGE, /permitted: allowed\.canUseJourney,\s*\n\s*enabled: journeyHistorySectionOpen,/)
})
