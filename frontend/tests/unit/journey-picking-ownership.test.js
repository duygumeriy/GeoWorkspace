import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  JOURNEY_MODES,
  PANEL_STATES,
  journeyPickingActive,
  journeyPlannerReducer,
  initialJourneyPlannerState,
  shouldDisarmJourneySlot,
} from '../../src/map/journeyPlanning.js'
import {
  JOURNEY_PICK_CURSOR,
  claimJourneyPickCursor,
} from '../../src/map/journeyInteraction.js'

/**
 * Faz 5E-B · Dilim 1 — "bir sonraki tıklama ne yapar?" sorusunun TEK cevabı.
 *
 * Ölçülen şey bir metin değil bir DAVRANIŞTIR: kuralın kendisi saf modüllerde
 * durur ve burada doğrudan çalıştırılır. Yalnızca React'siz çalıştırılamayan
 * bağlama (MapPage'in hangi kapıya hangi bayrağı verdiği) sözleşme olarak
 * denetlenir — orada da tek tek kapılar aranır, dosya geneli metin taraması
 * yapılmaz.
 */

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

/** Yorumlar ayıklanır: bir kuralı ANLATMAK onu uygulamak değildir. */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

const MAP_PAGE = stripComments(read('../../src/pages/MapPage.jsx'))
const PLANNER_HOOK = stripComments(read('../../src/hooks/useJourneyPlanner.js'))
const PICK_HOOK = stripComments(read('../../src/hooks/useJourneyWaypointPicking.js'))
const FEATURE_HOOK = stripComments(read('../../src/hooks/useFeatureInteraction.js'))
const VEHICLE_HOOK = stripComments(read('../../src/hooks/useTransportVehicleLayer.js'))

/** Silahlı bir serbest-kip planlayıcısı; testler yalnızca tek bir eksene dokunur. */
const armed = {
  mode: JOURNEY_MODES.WAYPOINTS,
  panel: PANEL_STATES.OPEN,
  activeSlotKey: 'wp-1',
}

/* --- 1. Çalışma alanı sahipliği ------------------------------------------------ */

test('picking is active only when the workspace is at rest', () => {
  assert.equal(journeyPickingActive({ ...armed, workspaceAtRest: true }), true)

  /* Çizim, ölçüm, analiz, yerleştirme, düzenleme … hepsi tek bir eksende
     buluşur: dinlenme durumu yoksa seçim de yoktur. */
  assert.equal(journeyPickingActive({ ...armed, workspaceAtRest: false }), false)
})

test('the three original conditions still gate picking', () => {
  const at = (patch) => journeyPickingActive({ ...armed, workspaceAtRest: true, ...patch })

  assert.equal(at({ mode: JOURNEY_MODES.ROUTE_FULL }), false)
  assert.equal(at({ mode: JOURNEY_MODES.ROUTE_SEGMENT }), false)
  assert.equal(at({ panel: PANEL_STATES.COLLAPSED }), false)
  assert.equal(at({ panel: PANEL_STATES.CLOSED }), false)
  assert.equal(at({ activeSlotKey: null }), false)
})

test('the workspace-at-rest default keeps callers that pass no workspace honest', () => {
  // Varsayılan true'dur ki kural yalnızca bilerek kapatılabilsin.
  assert.equal(journeyPickingActive(armed), true)
  assert.equal(journeyPickingActive(), false)
})

/* --- 2/3. Silahlanma ve silah bırakma ------------------------------------------ */

test('leaving the resting workspace disarms an armed slot exactly once', () => {
  // Silah varken ve dinlenme bittiğinde: bırakılır.
  assert.equal(shouldDisarmJourneySlot({ activeSlotKey: 'wp-1', workspaceAtRest: false }), true)

  /* Zaten silahsızsa hiçbir eylem gönderilmez: her render'da aynı eylemi
     göndermek sonsuz bir döngü olurdu. */
  assert.equal(shouldDisarmJourneySlot({ activeSlotKey: null, workspaceAtRest: false }), false)

  // Dinlenme sürüyorsa silah korunur.
  assert.equal(shouldDisarmJourneySlot({ activeSlotKey: 'wp-1', workspaceAtRest: true }), false)
})

test('the disarm action empties the slot without touching the rest of the plan', () => {
  const state = journeyPlannerReducer(
    { ...initialJourneyPlannerState(), mode: JOURNEY_MODES.WAYPOINTS, activeSlotKey: 'wp-1' },
    { type: 'armSlot', key: null },
  )

  assert.equal(state.activeSlotKey, null)
  // Kip, panel ve noktalar YERİNDE kalır: silah bırakmak plan silmek değildir.
  assert.equal(state.mode, JOURNEY_MODES.WAYPOINTS)
  assert.equal(state.panel, PANEL_STATES.OPEN)
  assert.equal(state.waypoints.length, 2)
})

test('the planner hook applies both rules from the pure module', () => {
  // Kural kopyalanmaz, ÇAĞRILIR: ikinci bir tanım zamanla ayrışırdı.
  assert.match(PLANNER_HOOK, /isPicking: journeyPickingActive\(\{/)
  assert.match(PLANNER_HOOK, /workspaceAtRest,/)
  assert.match(PLANNER_HOOK, /shouldDisarmJourneySlot\(\{ activeSlotKey: state\.activeSlotKey, workspaceAtRest \}\)/)

  // Silah bırakma efekti yalnızca bu iki değere bağlıdır (döngü kurulmaz).
  assert.match(PLANNER_HOOK, /\}, \[workspaceAtRest, state\.activeSlotKey\]\)/)
})

test('MapPage defines the resting workspace as ordinary single-click selection', () => {
  assert.match(
    MAP_PAGE,
    /const workspaceAtRest =\s*workspaceMode\.isSelecting && workspaceMode\.activeSelectionTool === 'single'/,
  )
  // Ve planlayıcı kancasına GEÇİRİLİR: kapı gerçekten kurulmuş olmalıdır.
  assert.match(MAP_PAGE, /useJourneyPlanner\(\{[^}]*permitted: allowed\.canUseJourney,[^}]*workspaceAtRest,\s*\}\)/s)
})

test('arming a slot first returns the workspace to rest, through each family own exit', () => {
  // Silahlanma ham eylem DEĞİL, sarmalayıcı üzerinden sunulur.
  assert.match(MAP_PAGE, /onArmSlot=\{armJourneySlot\}/)
  assert.ok(!MAP_PAGE.includes('onArmSlot={journey.armSlot}'))

  /* Yeni ara nokta da yuvasını silahlı açar; o da aynı kapıdan geçer, yoksa
     eklenen yuva doğduğu anda bırakılırdı. */
  assert.match(MAP_PAGE, /onAddWaypoint=\{addJourneyWaypoint\}/)

  // Dinlenmedeyken tek iş eylemin kendisidir; değilken önce araç bırakılır.
  assert.match(MAP_PAGE, /const withWorkspaceAtRest = useCallback\(/)
  assert.match(MAP_PAGE, /if \(workspaceAtRest\) \{\s*action\(\)/)
  assert.match(MAP_PAGE, /guardEdit\(\(\) => \{\s*leaveActiveWorkspaceTool\(\)\s*action\(\)/)

  /* Bırakma her ailenin KENDİ çıkışından geçer: ikinci bir kapatma yolu
     açılmaz. Yerleştirmeler bağlam emekliliğiyle (bekleyen nokta + form),
     analizler yalnızca araçla (sonuç korunur), seçim araçları tekliye döner. */
  const exit = MAP_PAGE.slice(
    MAP_PAGE.indexOf('const leaveActiveWorkspaceTool'),
    MAP_PAGE.indexOf('const withWorkspaceAtRest'),
  )
  assert.match(exit, /isPlacingPoi\) mapContext\.close\(MAP_CONTEXTS\.poiCreate\)/)
  assert.match(exit, /isPlacingTransportStop\) mapContext\.close\(MAP_CONTEXTS\.transportStopCreate\)/)
  assert.match(exit, /isRelocatingTransportStop\) cancelTransportStopRelocation\(\)/)
  assert.match(exit, /isAnalyzing\) workspaceMode\.stopAnalysis\(\)/)
  assert.match(exit, /isSelectingAnalysisArea\) workspaceMode\.stopLocationAnalysis\(\)/)
  assert.match(exit, /isDrawing\) workspaceMode\.stopDrawing\(\)/)
  assert.match(exit, /isMeasuring\) workspaceMode\.stopMeasuring\(\)/)
  assert.match(exit, /selectSelectionTool\('single'\)/)

  /* Düzenleme oturumu ZORLA kapatılmaz: kaydedilmemiş geometri uygulamanın
     kendi onayından geçer. */
  assert.ok(!exit.includes('stopEditing'))
  assert.ok(!exit.includes('discardEdit'))
})

/* --- 4/5/6/7. Rakip tıklama sahipleri ------------------------------------------ */

test('every competing singleclick owner is gated on picking', () => {
  // (4) Çizim seçimi — tıklama VE hover imleci birlikte çekilir.
  assert.match(
    MAP_PAGE,
    /const clickSelectEnabled =\s*allowed\.canSelect\s*&& workspaceMode\.isSelecting\s*&& workspaceMode\.activeSelectionTool !== 'polygon'\s*&& !journey\.isPicking/,
  )

  // (5) Araç balonu — YALNIZCA tıklama.
  assert.match(MAP_PAGE, /clickEnabled: !journey\.isPicking/)

  // (6) Konum analizi POI inceleyicisi.
  assert.match(
    MAP_PAGE,
    /const analysisPoiClickEnabled =\s*poiOverlayVisible\s*&& workspaceMode\.isSelecting\s*&& workspaceMode\.activeSelectionTool !== 'polygon'\s*&& !journey\.isPicking/,
  )

  // (7) POI ve durak/güzergah tıklaması: önceki fazdaki kapılar yerinde.
  assert.match(MAP_PAGE, /enabled: poiClickEnabled && !journey\.isPicking/)
  assert.match(MAP_PAGE, /workspaceMode\.isSelecting && !journey\.isPicking/)
})

test('the vehicle layer keeps rendering, moving and following while its click is off', () => {
  /* Kapatılan tek şey İSABET DENETİMİDİR. Katman kurulumu, feature eşitlemesi
     ve takip kamerası efektleri `clickEnabled`e HİÇ bakmaz — bakmaları,
     bir yolculuk noktası seçerken paylaşılan aracın donması demekti. */
  // İlk parça imza/gövde başıdır, bir efekt değildir: atlanır.
  const effects = VEHICLE_HOOK.split('useEffect(').slice(1)
  const clickEffect = effects.find((body) => body.includes("map.on('singleclick'"))
  assert.ok(clickEffect, 'araç tıklama efekti bulunamadı')
  assert.match(clickEffect, /if \(!map \|\| !clickEnabled \|\| typeof onVehicleClick !== 'function'\) return undefined/)
  assert.match(clickEffect, /\[map, onVehicleClick, clickEnabled\]/)

  for (const body of effects.filter((candidate) => candidate !== clickEffect)) {
    assert.ok(!body.includes('clickEnabled'), 'çizim/kamera efekti tıklama bayrağına bağlanmış')
  }

  // Katman ve eşitleme yolu duruyor: araç gizlenmiyor.
  assert.match(VEHICLE_HOOK, /createTransportVehicleLayer\(\)/)
  assert.match(VEHICLE_HOOK, /syncTransportVehicleFeature\(sourceRef\.current, presentation\)/)

  // Varsayılan açıktır: mevcut çağıranların davranışı değişmez.
  assert.match(VEHICLE_HOOK, /clickEnabled = true/)
})

test('the analysis inspector loses only its click, never its results', () => {
  const inspect = stripComments(read('../../src/hooks/useLocationAnalysisPoiInspect.js'))
  // `enabled` yalnızca dinleyiciyi kurar; sonucu temizleyen tek şey analizin kendisidir.
  assert.match(inspect, /const active = Boolean\(map && analysis && permitted && visible && enabled\)/)
  assert.match(inspect, /\}, \[analysisKey, permitted, visible\]\)/)
})

/* --- 8. İmleç sahipliği --------------------------------------------------------- */

/** Gerçek elemanın yalnızca kullanılan yüzeyi. */
const fakeElement = (cursor = '') => ({ style: { cursor } })

test('the pick cursor is borrowed and given back exactly as it was', () => {
  const element = fakeElement('grab')

  const release = claimJourneyPickCursor(element)
  assert.equal(element.style.cursor, JOURNEY_PICK_CURSOR)

  release()
  // Boş dizeye ÇEKİLMEZ: önceki değer aynen geri verilir.
  assert.equal(element.style.cursor, 'grab')
})

test('an empty previous cursor is also restored verbatim', () => {
  const element = fakeElement('')
  const release = claimJourneyPickCursor(element)
  assert.equal(element.style.cursor, JOURNEY_PICK_CURSOR)
  release()
  assert.equal(element.style.cursor, '')
})

test('a late release cannot overwrite whoever owns the cursor now', () => {
  const element = fakeElement('default')
  const release = claimJourneyPickCursor(element)

  // Araya başka bir sahip girdi (örneğin durak taşıma kipi).
  element.style.cursor = 'move'
  release()

  assert.equal(element.style.cursor, 'move')
})

test('claiming a missing target element is a no-op, not a crash', () => {
  assert.doesNotThrow(() => claimJourneyPickCursor(null)())
  assert.doesNotThrow(() => claimJourneyPickCursor(undefined)())
})

test('the picking hook borrows the cursor instead of setting it by hand', () => {
  assert.match(PICK_HOOK, /claimJourneyPickCursor\(map\.getTargetElement\(\)\)/)
  assert.match(PICK_HOOK, /releaseCursor\(\)/)
  // Ham atama kalmadı: geri alma tek bir yerden yapılır.
  assert.ok(!PICK_HOOK.includes("style.cursor = ''"))
  assert.ok(!PICK_HOOK.includes("style.cursor = 'crosshair'"))
})

test('feature hover only clears the cursor it set itself', () => {
  /* Eskiden her hareketde koşulsuz boş dizeye çekiliyordu: seçim kipinin artı
     imleci ilk fare hareketinde siliniyordu. Artık sahiplik sorulur. */
  assert.match(FEATURE_HOOK, /let ownsCursor = false/)
  assert.match(FEATURE_HOOK, /target\.style\.cursor = 'pointer'\s*ownsCursor = true/)
  assert.match(FEATURE_HOOK, /\} else if \(ownsCursor\) \{\s*target\.style\.cursor = ''/)
  assert.match(FEATURE_HOOK, /if \(ownsCursor && map\.getTargetElement\(\)\) \{/)

  // Ve hover'ın tamamı `enabled`e bağlıdır; seçim silahlıyken hiç kurulmaz.
  assert.match(FEATURE_HOOK, /if \(!map \|\| !enabled \|\| !hoverEnabled\)/)
})

/* --- 9. Escape ------------------------------------------------------------------ */

test('Escape disarms picking and consumes the keypress', () => {
  const escape = MAP_PAGE.slice(
    MAP_PAGE.indexOf('const handleEscape = useCallback('),
    MAP_PAGE.indexOf('const togglePoiPlacement'),
  )

  const branch = /if \(journey\.isPicking\) \{\s*disarmJourneySlot\(\)\s*return\s*\}/
  assert.match(escape, branch)

  /* Yerel silah, geniş kapanışlardan ÖNCE gelir: aynı tuş vuruşunda bir bağlam
     kapanmaz, bir araç değişmez, seçim düşmez. */
  const armedAt = escape.search(branch)
  for (const later of [
    'workspace.pendingDrawing',
    'workspaceMode.isEditing',
    'workspaceMode.isAnalyzing',
    'workspaceMode.isDrawing',
    'workspaceMode.isMeasuring',
    'mapContext.close()',
    'workspace.clearSelection()',
  ]) {
    assert.ok(armedAt < escape.indexOf(later), `${later} silahlı yuvadan önce geliyor`)
  }

  // Diğer Esc davranışları değişmedi: onay diyalogları hâlâ en önde.
  assert.ok(escape.indexOf('pendingDiscard') < armedAt)
  assert.ok(escape.indexOf('pendingPoiDelete') < armedAt)
})

/* --- 10. Gerileme --------------------------------------------------------------- */

test('with picking off, every gate falls back to its previous condition', () => {
  /* Kapılar tek bir çarpanla genişletildi. `journey.isPicking` false iken her
     ifade Faz 5E-A'daki değerine döner — yani bu dilim, seçim silahlı
     olmadığında hiçbir davranışı değiştirmez. */
  const gate = (source) => source.split('&&').map((part) => part.trim())

  const clickSelect = gate(
    MAP_PAGE.slice(MAP_PAGE.indexOf('const clickSelectEnabled ='), MAP_PAGE.indexOf('const selectFromMap')),
  )
  assert.ok(clickSelect.includes('!journey.isPicking'))
  assert.equal(clickSelect.filter((part) => part.includes('journey')).length, 1)

  // Seçim kipi hiç kurulmadan da varsayılan davranış korunur.
  assert.equal(journeyPickingActive({ ...armed, workspaceAtRest: true, activeSlotKey: null }), false)
  assert.equal(shouldDisarmJourneySlot({ activeSlotKey: null, workspaceAtRest: true }), false)
})
