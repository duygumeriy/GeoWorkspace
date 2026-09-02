import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  JOURNEY_PHASES,
  JOURNEY_SIMULATION_STATUS,
  journeyDisplayGeometryWkt,
  journeyLiveModel,
  journeyPhase,
  journeyTerminalTitle,
} from '../../src/map/journeySimulationState.js'

/**
 * Faz 5E-B · Dilim 2 — biten yolculuk bir ÇIKMAZ değildir.
 *
 * Ölçülen esas karar şudur: <code>simulation != null</code> "canlı" demek
 * değildir. Evre yalnızca SUNUCUNUN bildirdiği durumdan türetilir ve saf
 * modülde durur; burada doğrudan çalıştırılır. React'siz çalıştırılamayan tek
 * şey bağlamadır (panelin hangi evrede neyi çizdiği, sayfanın hangi eylemi
 * hangi düğmeye verdiği) — orada da tek tek düğmeler aranır.
 */

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

const PANEL = stripComments(read('../../src/components/map/JourneyPlannerPanel.jsx'))
const MAP_PAGE = stripComments(read('../../src/pages/MapPage.jsx'))
const SIM_HOOK = stripComments(read('../../src/hooks/useJourneySimulation.js'))

/** Sunucunun döndürdüğü çalıştırmanın yalnızca kullanılan yüzeyi. */
const simulation = {
  simulationId: 'sim-1',
  requestedProfile: 'driving',
  geometryWkt: 'LINESTRING(36.33 41.28,36.34 41.27)',
  totalDistanceMeters: 4200,
  totalDurationSeconds: 600,
  steps: [],
}

const snapshotWith = (status, patch = {}) => ({
  simulationId: 'sim-1',
  status,
  longitude: 36.33,
  latitude: 41.28,
  progressPercent: 100,
  distanceCoveredMeters: 4200,
  ...patch,
})

const RUNNING = snapshotWith(JOURNEY_SIMULATION_STATUS.RUNNING, {
  progressPercent: 42,
  distanceCoveredMeters: 1764,
})
const COMPLETED = snapshotWith(JOURNEY_SIMULATION_STATUS.COMPLETED)
const CANCELLED = snapshotWith(JOURNEY_SIMULATION_STATUS.CANCELLED, {
  progressPercent: 61,
  distanceCoveredMeters: 2562,
})

/* --- 1/2/3. Evre, yalnızca sunucunun durumundan ------------------------------- */

test('a running journey is active, not terminal', () => {
  assert.equal(journeyPhase({ simulation, snapshot: RUNNING }), JOURNEY_PHASES.ACTIVE)
})

test('a completed journey is terminal, not active', () => {
  assert.equal(journeyPhase({ simulation, snapshot: COMPLETED }), JOURNEY_PHASES.TERMINAL)
})

test('a cancelled journey is terminal, not active', () => {
  assert.equal(journeyPhase({ simulation, snapshot: CANCELLED }), JOURNEY_PHASES.TERMINAL)
})

test('an adopted run without a snapshot yet is active, never terminal', () => {
  /* Anlık görüntü henüz gelmemiş bir çalıştırma BAŞLAYAN bir yolculuktur.
     Tarayıcı hiçbir zaman kendiliğinden "bitti" demez. */
  assert.equal(journeyPhase({ simulation, snapshot: null }), JOURNEY_PHASES.ACTIVE)
  assert.equal(journeyPhase({ simulation, snapshot: { simulationId: 'sim-1' } }), JOURNEY_PHASES.ACTIVE)
})

test('no adopted run means the planner owns the panel', () => {
  assert.equal(journeyPhase({ simulation: null, snapshot: COMPLETED }), JOURNEY_PHASES.PLANNER)
  assert.equal(journeyPhase({}), JOURNEY_PHASES.PLANNER)
  assert.equal(journeyPhase(), JOURNEY_PHASES.PLANNER)
})

test('the terminal snapshot keeps its server-derived result intact', () => {
  /* Terminal olmak veriyi SİLMEZ: sonuç, kullanıcı bırakana kadar okunabilir
     ve hiçbir ölçüm tarayıcıda yeniden hesaplanmaz. */
  const model = journeyLiveModel({ simulation, snapshot: CANCELLED })

  assert.equal(model.isTerminal, true)
  assert.equal(model.status, JOURNEY_SIMULATION_STATUS.CANCELLED)
  assert.equal(model.totalDistanceMeters, 4200)
  assert.equal(model.totalDurationSeconds, 600)
  assert.equal(model.progressPercent, 61)
  // Kalan mesafe sunucunun İKİ değerinin farkıdır, bir tahmin değil.
  assert.equal(model.remainingDistanceMeters, 4200 - 2562)
})

test('the hook reports the phase and derives both flags from it', () => {
  assert.match(SIM_HOOK, /const phase = journeyPhase\(\{ simulation, snapshot \}\)/)
  assert.match(SIM_HOOK, /isActive: phase === JOURNEY_PHASES\.ACTIVE/)
  assert.match(SIM_HOOK, /isTerminal: phase === JOURNEY_PHASES\.TERMINAL/)

  // İkinci bir "canlı mı" kuralı kancada YAŞAMAZ.
  assert.ok(!SIM_HOOK.includes('simulation != null && !isTerminalJourneyStatus'))
})

/* --- 4/5. Terminal kartı -------------------------------------------------------- */

/**
 * Bir JSX koşul dalını süslü parantezleri sayarak ayıklar.
 *
 * Sabit uzunlukta bir pencere almak, komşu dalın içeriğini iddiaya sızdırır;
 * burada dalın gerçek sınırı okunur.
 */
function conditionalBlocks(source, condition) {
  const blocks = []
  let from = source.indexOf(condition)

  while (from >= 0) {
    let depth = 0
    let index = from

    for (; index < source.length; index += 1) {
      if (source[index] === '{') depth += 1
      else if (source[index] === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }

    blocks.push(source.slice(from, index + 1))
    from = source.indexOf(condition, index + 1)
  }

  return blocks
}

/**
 * Bir JSX bileşen ÇAĞRISINI ayıklar.
 *
 * Sayfanın tamamında `onClose=` aramak yanlış bileşeni yakalar: sayfada
 * "Stop" harflerini adında taşıyan bağlamlar (`myStops`,
 * `transportStopInfo`) da vardır ve bunların kapatma geri çağrıları
 * tamamen meşrudur. Sözleşme bir dosyaya değil, TEK BİR çağrıya aittir.
 */
function jsxElement(source, tag) {
  const from = source.indexOf(`<${tag}`)
  assert.ok(from > 0, `<${tag} … /> çağrısı bulunamadı`)

  let depth = 0
  for (let index = from; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    else if (char === '}') depth -= 1
    // Öznitelik ifadelerinin İÇİ atlanır; yalnızca çağrının kendi kapanışı sayılır.
    else if (depth === 0 && char === '/' && source[index + 1] === '>') {
      return source.slice(from, index + 2)
    }
  }

  return assert.fail(`<${tag} … /> kapanışı bulunamadı`)
}

/** Sözleşmenin ölçüldüğü tek yer: planlayıcı panelinin kendi çağrısı. */
const PANEL_USAGE = jsxElement(MAP_PAGE, 'JourneyPlannerPanel')

/** Koşulun, verilen işareti taşıyan dalı. */
const branchWith = (condition, marker) => {
  const found = conditionalBlocks(PANEL, condition).find((block) => block.includes(marker))
  assert.ok(found, `${condition} dalı (${marker}) bulunamadı`)
  return found
}

test('the panel separates the two live phases instead of one isLive flag', () => {
  assert.match(PANEL, /const phase = journeyPhase\(\{ simulation: live\?\.simulation, snapshot: live\?\.snapshot \}\)/)
  assert.match(PANEL, /const isActive = liveModel != null && phase === JOURNEY_PHASES\.ACTIVE/)
  assert.match(PANEL, /const isTerminal = liveModel != null && phase === JOURNEY_PHASES\.TERMINAL/)
  // `isLive` artık YALNIZCA "planlayıcı formu yerine sonuç var" demektir.
  assert.match(PANEL, /const isLive = isActive \|\| isTerminal/)

  /* Sunum modeli yoksa hiçbir canlı dal çizilmez: anlık görüntüsü henüz
     gelmemiş bir çalıştırmada panel null okumaya kalkmaz. */
  assert.ok(PANEL.includes('liveModel != null &&'))
})

test('follow and stop belong to the active phase only', () => {
  const active = branchWith('{isActive && (', 'journey-actions')
  assert.ok(active.includes('onToggleFollow'))
  assert.ok(active.includes('Takibi Bırak'))
  assert.ok(active.includes('Takip Et'))
  assert.ok(active.includes('onStopSimulation'))
  assert.ok(active.includes('Simülasyonu Durdur'))

  /* Terminal dalında hareket kontrolleri YOKTUR: biten bir yolculuğu takip
     etmek ya da durdurmak diye bir şey yoktur. */
  const terminal = branchWith('{isTerminal && (', 'journey-actions')
  assert.ok(!terminal.includes('onToggleFollow'))
  assert.ok(!terminal.includes('Takip Et'))
  assert.ok(!terminal.includes('Takibi Bırak'))
  assert.ok(!terminal.includes('onStopSimulation'))
  assert.ok(!terminal.includes('Simülasyonu Durdur'))

  /* Ve eski "terminalken de takip düğmesi" davranışı geri gelemez: koşulsuz
     takip düğmesi kaynakta artık yoktur. */
  assert.ok(!PANEL.includes('liveModel.isTerminal && ('))
  assert.ok(!PANEL.includes('!liveModel.isTerminal && ('))
})

test('the terminal card offers both exits and no confirmation', () => {
  const terminal = branchWith('{isTerminal && (', 'journey-actions')

  assert.ok(terminal.includes('Yeni Yolculuk'))
  assert.ok(terminal.includes('onNewJourney'))
  assert.ok(terminal.includes('Planlamaya Dön'))
  assert.ok(terminal.includes('onReturnToPlanning'))

  // Onay diyalogu YOKTUR: ortada kaybolacak bir iş yok.
  assert.ok(!terminal.includes('Confirm'))
  assert.ok(!terminal.includes('pending'))
})

test('the terminal card shows the final server result, computing nothing new', () => {
  const card = branchWith('{isTerminal && (', 'journey-terminal')

  // Nihai durum başlığı sunucunun durumundan okunur.
  /* Başlık Faz 5E-B · Dilim 4'te durum modeline taşındı: panel de, kapalı
     paneldeki kısayol da AYNI cümleyi kullanır. */
  assert.ok(card.includes('journeyTerminalTitle(liveModel.status)'))
  assert.equal(journeyTerminalTitle(JOURNEY_SIMULATION_STATUS.COMPLETED), 'Yolculuk tamamlandı')
  assert.equal(journeyTerminalTitle(JOURNEY_SIMULATION_STATUS.CANCELLED), 'Yolculuk iptal edildi')
  assert.equal(journeyTerminalTitle('Beklenmeyen'), 'Yolculuk sona erdi')

  // Özet satırı (profil · mesafe · süre) her iki evrede de aynı modelden gelir.
  assert.ok(PANEL.includes('formatRouteDistance(liveModel.totalDistanceMeters)'))
  assert.ok(PANEL.includes('formatRouteDuration(liveModel.totalDurationSeconds)'))

  // İlerleme çubuğu YALNIZCA hareket varken çizilir.
  const metrics = branchWith('{isActive && (', 'journey-live-bar')
  assert.ok(metrics.includes('journey-live-metrics'))
  assert.ok(!branchWith('{isTerminal && (', 'journey-terminal').includes('journey-live-bar'))
})

/* --- 6. dismiss: sahiplik biter, sunucuya istek gitmez -------------------------- */

test('dismiss drops the adopted run without any backend stop call', () => {
  const body = SIM_HOOK.slice(
    SIM_HOOK.indexOf('const dismiss = useCallback('),
    SIM_HOOK.indexOf('useEffect(', SIM_HOOK.indexOf('const dismiss = useCallback(')),
  )

  // Sahiplik bırakılır: grup üyeliği + benimsenmiş durum.
  assert.ok(body.includes('await leave()'))
  assert.ok(body.includes('setSimulation(null)'))
  assert.ok(body.includes('setSnapshot(null)'))

  /* Durdurma isteği GÖNDERİLMEZ: terminal bir çalıştırma zaten terminaldir,
     çalışan bir yolculuk ise kullanıcının AYRI kararıyla durdurulur. */
  assert.ok(!body.includes('stopJourneySimulation'))
  assert.ok(!body.includes('fetch'))

  // Durdurma hâlâ kendi eyleminde ve gerçek uca gidiyor.
  assert.match(SIM_HOOK, /const stop = useCallback\([\s\S]{0,400}stopJourneySimulation\(active\)/)
})

test('dismiss is idempotent: leaving twice has no second effect', () => {
  /* `leave` üyeliği ÖNCE düşürür, sonra sunucuya haber verir; ikinci çağrı
     `active` boş olduğu için hiçbir şey yapmaz. */
  const leave = SIM_HOOK.slice(SIM_HOOK.indexOf('const leave = useCallback('), SIM_HOOK.indexOf('useEffect(() => () => {'))
  assert.match(leave, /joinedRef\.current = null/)
  assert.match(leave, /if \(!active \|\| !connectionRef\.current\) return/)
})

/* --- 7/8. İki çıkış ------------------------------------------------------------- */

const mapPageAction = (name) => {
  const from = MAP_PAGE.indexOf(`const ${name} = useCallback(`)
  assert.ok(from > 0, `${name} bulunamadı`)
  return MAP_PAGE.slice(from, MAP_PAGE.indexOf('}, [', from))
}

/**
 * Panel görünürlüğü Faz 5E-B · Dilim 4'ten beri KANONİK sarmalayıcılardan
 * geçer (harita bağlam sahipliğiyle birlikte). Terminal çıkışları artık
 * `journey.openPanel()`i doğrudan çağırmaz; sorumluluk sarmalayıcınındır ve
 * onun sözleşmesi burada AYRI ölçülür.
 */
const PRESENTATION_ONLY_FORBIDDEN = [
  'journeySimulation.start',
  'journeySimulation.stop',
  'journeySimulation.dismiss',
  'journey.clear',
  'setSimulation',
  'setSnapshot',
  'fetchCurrentJourneySimulation',
  'fetch(',
]

test('the panel open/close wrappers are presentation-only', () => {
  const open = mapPageAction('openJourneyPanel')
  assert.match(open, /journey\.openPanel\(\)/)
  assert.match(open, /mapContext\.activate\(MAP_CONTEXTS\.journey\)/)

  const close = mapPageAction('closeJourneyPanel')
  assert.match(close, /mapContext\.close\(MAP_CONTEXTS\.journey\)/)
  assert.match(close, /journey\.closePanel\(\)/)

  /* Paneli açmak ya da kapatmak bir yaşam döngüsü işlemi DEĞİLDİR: çalışan
     yolculuk durmaz, terminal sonuç bırakılmaz, seçimler temizlenmez. */
  for (const [name, body] of [['openJourneyPanel', open], ['closeJourneyPanel', close]]) {
    for (const forbidden of PRESENTATION_ONLY_FORBIDDEN) {
      assert.ok(!body.includes(forbidden), `${name} ${forbidden} çağırıyor`)
    }
  }
})

test('"Planlamaya Dön" drops the result and keeps the planner selections', () => {
  const action = mapPageAction('returnToJourneyPlanning')

  assert.ok(action.includes('journeySimulation.dismiss()'))
  // Panel kanonik sarmalayıcıyla geri gelir (sözleşmesi yukarıda ölçülür).
  assert.ok(action.includes('openJourneyPanel()'))

  // Seçimler KORUNUR: temizleme bu eylemin işi değildir.
  assert.ok(!action.includes('journey.clear()'))
  // Ve durdurma isteği yok.
  assert.ok(!action.includes('journeySimulation.stop'))
})

test('"Yeni Yolculuk" drops the result and reuses the existing clear behaviour', () => {
  const action = mapPageAction('startNewJourney')

  assert.ok(action.includes('journeySimulation.dismiss()'))
  // İkinci bir sıfırlama mekanizması YOKTUR: mevcut `clear` kullanılır.
  assert.ok(action.includes('journey.clear()'))
  // Ve panel açık kalır, kullanıcı hemen planlamaya başlayabilir.
  assert.ok(action.includes('openJourneyPanel()'))

  assert.ok(!action.includes('journeySimulation.stop'))
  assert.ok(!action.includes('requestPreview'))
})

test('both exits are wired to the terminal card, and only there', () => {
  assert.match(PANEL_USAGE, /onReturnToPlanning=\{returnToJourneyPlanning\}/)
  assert.match(PANEL_USAGE, /onNewJourney=\{startNewJourney\}/)

  // Kapatma/katlama/açma hâlâ YALNIZCA panel durumudur.
  assert.match(PANEL_USAGE, /onClose=\{closeJourneyPanel\}/)
  assert.match(PANEL_USAGE, /onOpen=\{openJourneyPanel\}/)
  assert.match(PANEL_USAGE, /onCollapse=\{journey\.collapsePanel\}/)

  // Ve terminal eylemleri kapatma yollarına SIZMAZ.
  for (const handler of ['closeJourneyPanel', 'openJourneyPanel']) {
    const body = mapPageAction(handler)
    assert.ok(!body.includes('returnToJourneyPlanning'))
    assert.ok(!body.includes('startNewJourney'))
  }
})

/* --- 9/10. Harita geometrisinin sahipliği ---------------------------------------- */

const PREVIEW_WKT = 'LINESTRING(36.30 41.20,36.31 41.21)'

test('an adopted run owns the map line, running or terminal', () => {
  for (const snapshot of [RUNNING, COMPLETED, CANCELLED]) {
    assert.equal(
      journeyDisplayGeometryWkt({ simulation, previewGeometryWkt: PREVIEW_WKT }),
      simulation.geometryWkt,
      `${snapshot.status} durumunda sunucu geometrisi kazanmalı`,
    )
  }
})

test('after dismiss the preview owns the map again', () => {
  // `dismiss` simulation'ı düşürür; kural o anda önizlemeye döner.
  assert.equal(
    journeyDisplayGeometryWkt({ simulation: null, previewGeometryWkt: PREVIEW_WKT }),
    PREVIEW_WKT,
  )
})

test('with nothing adopted and nothing previewed the map stays clean', () => {
  assert.equal(journeyDisplayGeometryWkt({ simulation: null, previewGeometryWkt: null }), null)
  assert.equal(journeyDisplayGeometryWkt({}), null)
  assert.equal(journeyDisplayGeometryWkt(), null)
})

test('geometry is selected, never copied into planner state', () => {
  /* Kural yalnızca hangi kaynağın okunacağını seçer; simülasyon geometrisi
     planlayıcı durumuna YAZILMAZ ve ikinci bir katman açılmaz. */
  assert.match(MAP_PAGE, /geometryWkt: journeyGeometryWkt/)
  assert.ok(!MAP_PAGE.includes('setPreview('))
  assert.equal((MAP_PAGE.match(/useJourneyPreviewLayer\(/g) ?? []).length, 1)
  assert.equal((MAP_PAGE.match(/useJourneyVehicleLayer\(/g) ?? []).length, 1)
})

/* --- 11/12. Kapatma ve katlama --------------------------------------------------- */

test('closing or collapsing never stops or dismisses a run', () => {
  /* Panel durumu ile çalıştırma sahipliği AYRI eksenlerdir. X ve katlama
     düğmeleri yalnızca ilkine dokunur. */
  const header = PANEL.slice(PANEL.indexOf('<header className="journey-head">'), PANEL.indexOf('</header>'))
  assert.ok(header.includes('onClick={onClose}'))
  assert.ok(header.includes('onClick={collapsed ? onOpen : onCollapse}'))
  assert.ok(!header.includes('onStopSimulation'))
  assert.ok(!header.includes('onNewJourney'))
  assert.ok(!header.includes('onReturnToPlanning'))

  /* Sayfa tarafında sözleşme YALNIZCA planlayıcı panelinin çağrısına aittir:
     kapatma ve katlama panel durumundan başka hiçbir şeye bağlanmamalıdır. */
  assert.match(PANEL_USAGE, /onClose=\{closeJourneyPanel\}/)
  assert.match(PANEL_USAGE, /onCollapse=\{journey\.collapsePanel\}/)

  const closeProps = [...PANEL_USAGE.matchAll(/on(?:Close|Collapse)=\{([^}]*)\}/g)].map(
    ([, handler]) => handler,
  )
  assert.equal(closeProps.length, 2, 'kapatma/katlama sözleşmesi tek biçimli olmalı')

  /* Sarmalayıcıya bağlanmak iddiayı zayıflatmaz: adı geçen her işleyicinin
     GÖVDESİ çözülür ve yasak eylemler orada aranır. Doğrudan bir indirgeyici
     eylemi (`journey.collapsePanel`) zaten yalnızca panel durumudur. */
  for (const handler of closeProps) {
    if (!handler.startsWith('journey.')) {
      const body = mapPageAction(handler)
      for (const forbidden of [
        'journeySimulation.dismiss',
        'stopJourneySimulation',
        'journeySimulation.stop',
        'returnToJourneyPlanning',
        'startNewJourney',
        'journey.clear',
      ]) {
        assert.ok(!body.includes(forbidden), `${handler} ${forbidden} çağırıyor`)
      }
      continue
    }

    assert.match(handler, /^journey\.(closePanel|collapsePanel)$/)
  }
})

test('a collapsed terminal result is still a result, not a planner prompt', () => {
  const collapsedSummary = PANEL.slice(
    PANEL.indexOf('className="journey-collapsed-summary"'),
    PANEL.indexOf('{!collapsed && showingPersonal && isLive && ('),
  )
  assert.ok(collapsedSummary.length > 0, 'katlanmış özet dilimi bulunamadı')

  /* Faz 2 evre zincirini ÜRÜN dalının içine taşıdı ama SIRASINI ve
     ANLAMINI korudu: terminal önce sorulur, planlayıcı istemi hâlâ EN SON
     çaredir. */
  assert.ok(collapsedSummary.includes(') : isTerminal ? ('))
  assert.ok(collapsedSummary.includes('journeyTerminalTitle(liveModel.status)'))
  // Ve aktif özet ayrı bir daldadır.
  assert.ok(collapsedSummary.includes(') : isActive ? ('))

  /* Sıra bağlayıcıdır: terminal, aktif ve özet dallarının HEPSİ planlayıcı
     isteminden ÖNCE gelir — aksi hâlde biten bir yolculuk katlanınca
     "Yolculuk planlamak için dokunun" yazısına düşerdi. */
  const prompt = collapsedSummary.indexOf('Yolculuk planlamak için dokunun')
  assert.ok(prompt > 0, 'planlayıcı istemi bulunamadı')
  for (const arm of [') : isTerminal ? (', ') : isActive ? (', ') : summary ? (']) {
    assert.ok(collapsedSummary.indexOf(arm) < prompt, `${arm} planlayıcı isteminden sonra geliyor`)
  }

  /* Katlamak bir SUNUM kararıdır: özet düğmesi yalnızca paneli geri açar ve
     hiçbir yaşam döngüsü komutu taşımaz — terminal sonuç sessizce
     bırakılmaz. */
  for (const forbidden of ['onStopSimulation', 'onNewJourney', 'onReturnToPlanning', 'dismiss']) {
    assert.ok(!collapsedSummary.includes(forbidden), `katlanmış özet ${forbidden} taşıyor`)
  }
})

/* --- 13/14. Durdurma ve değişmeyen sözleşmeler ------------------------------------ */

test('stop leads to a terminal presentation, not a dead active state', () => {
  /* Durdurma yanıtı terminal bir anlık görüntüdür ve terminal olay HER ZAMAN
     kabul edilir; ondan sonra evre TERMINAL olur ve çıkışlar belirir. */
  assert.match(SIM_HOOK, /const response = await stopJourneySimulation\(active\)/)
  assert.match(SIM_HOOK, /applyUpdate\(body\)/)

  const afterStop = journeyPhase({ simulation, snapshot: CANCELLED })
  assert.equal(afterStop, JOURNEY_PHASES.TERMINAL)
  assert.equal(journeyLiveModel({ simulation, snapshot: CANCELLED }).isTerminal, true)
})

test('the start contract and server authority are untouched', () => {
  // Niyet hâlâ planlayıcıdan kurulur; önizleme gövdesi gönderilmez.
  assert.match(MAP_PAGE, /const intent = journey\.buildIntent\(\)/)
  assert.match(MAP_PAGE, /await journeySimulation\.start\(intent\)/)

  // Bu dilim tarayıcıya kalıcılık ya da istemci tarafı tamamlanma EKLEMEZ.
  const state = stripComments(read('../../src/map/journeySimulationState.js'))
  for (const forbidden of ['localStorage', 'sessionStorage', 'Date.now()', 'setTimeout']) {
    assert.ok(!state.includes(forbidden), `journeySimulationState.js ${forbidden} kullanıyor`)
  }
  assert.ok(!stripComments(read('../../src/hooks/useJourneySimulation.js')).includes('localStorage'))
})
