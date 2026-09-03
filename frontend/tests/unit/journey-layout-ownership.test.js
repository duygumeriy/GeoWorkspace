import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  JOURNEY_COMPACT_BREAKPOINT,
  JOURNEY_COMPACT_QUERY,
  JOURNEY_PANEL_LEFT,
  JOURNEY_PANEL_WIDTH,
  JOURNEY_SHEET_HEIGHT,
  journeyFitPadding,
  journeyMapInset,
  journeyPanelStyle,
} from '../../src/map/journeyLayout.js'
import {
  JOURNEY_PHASES,
  JOURNEY_SIMULATION_STATUS,
  journeyStatusIndicator,
} from '../../src/map/journeySimulationState.js'
import { MAP_CONTEXTS, createMapContextCoordinator } from '../../src/map/mapContexts.js'

/**
 * Faz 5E-B · Dilim 4 — panelin KAPLADIĞI yerin sahipliği.
 *
 * İki şey ölçülür: aynı köşeyi paylaşan iki panelin artık üst üste binememesi
 * (koordinatör çekirdeği doğrudan çalıştırılır) ve panelin ölçülerinin TEK bir
 * yerde tanımlı olması (düzen modeli çalıştırılır, CSS'in onu tükettiği
 * doğrulanır). Sunum bağlamaları ilgili JSX dalı/çağrısı ayıklanarak denetlenir.
 */

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

const MAP_PAGE = stripComments(read('../../src/pages/MapPage.jsx'))
const PANEL = stripComments(read('../../src/components/map/JourneyPlannerPanel.jsx'))
const QUICK = stripComments(read('../../src/components/map/QuickActions.jsx'))
const CSS = read('../../src/components/map/JourneyPlanner.css')
const QUICK_CSS = read('../../src/components/map/QuickActions.css')
const PREVIEW_HOOK = stripComments(read('../../src/hooks/useJourneyPreviewLayer.js'))

/** Bir JSX bileşen çağrısı (öznitelik ifadelerinin içi atlanarak). */
function jsxElement(source, tag) {
  const from = source.indexOf(`<${tag}`)
  assert.ok(from > 0, `<${tag} … /> çağrısı bulunamadı`)

  let depth = 0
  for (let index = from; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    else if (char === '}') depth -= 1
    else if (depth === 0 && char === '/' && source[index + 1] === '>') {
      return source.slice(from, index + 2)
    }
  }

  return assert.fail(`<${tag} … /> kapanışı bulunamadı`)
}

/** Adı verilen `useCallback` gövdesi. */
const callbackBody = (name) => {
  const from = MAP_PAGE.indexOf(`const ${name} = useCallback(`)
  assert.ok(from > 0, `${name} bulunamadı`)
  return MAP_PAGE.slice(from, MAP_PAGE.indexOf('}, [', from))
}

const PANEL_USAGE = jsxElement(MAP_PAGE, 'JourneyPlannerPanel')

/* --- 1/2. Aynı köşede iki panel yaşayamaz ---------------------------------------- */

test('the journey panel joins the existing coordinator instead of a second one', () => {
  // Bağlam kimliği MEVCUT tabloya eklendi; ikinci bir koordinatör yok.
  assert.equal(MAP_CONTEXTS.journey, 'journey')
  assert.equal((MAP_PAGE.match(/useMapContext\(/g) ?? []).length, 1)

  // Açmak sahiplik almaktır, kapatmak bırakmaktır.
  assert.match(callbackBody('openJourneyPanel'), /journey\.openPanel\(\)\s*mapContext\.activate\(MAP_CONTEXTS\.journey\)/)
  assert.match(callbackBody('closeJourneyPanel'), /mapContext\.close\(MAP_CONTEXTS\.journey\)/)
})

test('activating another primary context retires the journey panel, and only the panel', () => {
  /* Koordinatörün SAF çekirdeği çalıştırılır: yolculuk paneli sahipken analiz
     açılırsa, yolculuğun emeklilik fonksiyonu çağrılır. */
  const retired = []
  const coordinator = createMapContextCoordinator({
    getRetirer: (id) => (next) => retired.push([id, next]),
    onChange: () => {},
  })

  coordinator.activate(MAP_CONTEXTS.journey)
  coordinator.activate(MAP_CONTEXTS.inventory)

  assert.deepEqual(retired, [[MAP_CONTEXTS.journey, MAP_CONTEXTS.inventory]])
  assert.equal(coordinator.isActive(MAP_CONTEXTS.journey), false)
  // Ve tersi de doğrudur: panel açılınca öteki emekliye ayrılır.
  coordinator.activate(MAP_CONTEXTS.journey)
  assert.deepEqual(retired[1], [MAP_CONTEXTS.inventory, MAP_CONTEXTS.journey])
})

test('the journey retirer touches the panel and nothing else', () => {
  const from = MAP_PAGE.indexOf('[MAP_CONTEXTS.journey]:')
  assert.ok(from > 0, 'yolculuk emekliliği tabloya eklenmemiş')
  const retirer = MAP_PAGE.slice(from, MAP_PAGE.indexOf('},', from) + 2)

  assert.match(retirer, /journey\.closePanel\(\)/)

  /* Emeklilik bir SUNUM kararıdır: çalışan simülasyon durdurulmaz, terminal
     sonuç bırakılmaz, plan seçimleri temizlenmez. */
  for (const forbidden of [
    'journeySimulation.stop',
    'journeySimulation.dismiss',
    'dismiss(',
    'journey.clear',
    'setSimulation',
  ]) {
    assert.ok(!retirer.includes(forbidden), `emeklilik ${forbidden} çağırıyor`)
  }
})

/* --- 3/4/5. Devredilen şey yalnızca paneldir -------------------------------------- */

test('panel visibility is a presentation state layered on the untouched lifecycle', () => {
  /* Panel KAPALIYKEN hiçbir şey çizmez; çalıştırma durumu kancada yaşamaya
     devam eder ve panel yeniden açıldığında evre yeniden okunur. */
  assert.match(PANEL, /if \(state\.panel === PANEL_STATES\.CLOSED\) return null/)

  // Evre her render'da canlı durumdan türetilir; panele kopyalanmaz.
  assert.match(PANEL, /const phase = journeyPhase\(\{ simulation: live\?\.simulation, snapshot: live\?\.snapshot \}\)/)

  /* Kapatma/açma yolları simülasyona ya da plan seçimlerine DOKUNMAZ:
     bunların hepsi kullanıcının kendi açık eylemleridir. */
  for (const name of ['openJourneyPanel', 'closeJourneyPanel', 'toggleJourneyPanel']) {
    const body = callbackBody(name)
    for (const forbidden of ['journeySimulation.stop', 'journeySimulation.dismiss', 'journey.clear']) {
      assert.ok(!body.includes(forbidden), `${name} ${forbidden} çağırıyor`)
    }
  }
})

test('the panel close button and the trigger both go through panel state only', () => {
  assert.match(PANEL_USAGE, /onClose=\{closeJourneyPanel\}/)
  assert.match(PANEL_USAGE, /onOpen=\{openJourneyPanel\}/)
  assert.match(PANEL_USAGE, /onCollapse=\{journey\.collapsePanel\}/)

  const closeProps = [...PANEL_USAGE.matchAll(/on(?:Close|Collapse)=\{([^}]*)\}/g)].map(([, handler]) => handler)
  assert.deepEqual(closeProps.sort(), ['closeJourneyPanel', 'journey.collapsePanel'])
})

/* --- 6/7. Tek düzen ölçütü --------------------------------------------------------- */

test('one breakpoint decides both the CSS layout and the camera padding', () => {
  assert.equal(JOURNEY_COMPACT_BREAKPOINT, 640)
  assert.equal(JOURNEY_COMPACT_QUERY, '(max-width: 640px)')

  // CSS ve JS AYNI kesme noktasını kullanır; panelin 720px istisnası kalktı.
  assert.ok(CSS.includes(`@media (max-width: ${JOURNEY_COMPACT_BREAKPOINT}px)`))
  assert.ok(!/@media \(max-width: 720px\)/.test(CSS))

  // Sayfa bu tek sorguyu okur ve sonucu dolguya verir.
  assert.match(MAP_PAGE, /const journeyCompact = useMediaQuery\(JOURNEY_COMPACT_QUERY\)/)
  assert.match(MAP_PAGE, /compact: journeyCompact,/)
})

test('pointer capability is no longer the layout authority', () => {
  const previewCall = MAP_PAGE.slice(
    MAP_PAGE.indexOf('useJourneyPreviewLayer(mapInstance, {'),
    MAP_PAGE.indexOf('})', MAP_PAGE.indexOf('useJourneyPreviewLayer(mapInstance, {')),
  )

  /* Dokunmatik bir dizüstü geniş ekranlıdır, dar bir masaüstü penceresi ise
     fare kullanır: işaretçi yeteneği bir DÜZEN ölçüsü değildir. */
  assert.ok(!previewCall.includes('hasFinePointer'))
  assert.ok(previewCall.includes('journeyCompact'))

  // `hasFinePointer` kendi alanında (hover/kısayol) yaşamaya devam eder.
  assert.ok(MAP_PAGE.includes('hoverEnabled: hasFinePointer'))
})

/* --- 8/9/10. Kamera dolgusu tek modelden --------------------------------------------- */

test('a visible desktop panel is reserved on the left, not the bottom', () => {
  const inset = journeyMapInset({ compact: false, panelVisible: true })
  assert.equal(inset.left, JOURNEY_PANEL_LEFT + JOURNEY_PANEL_WIDTH)
  assert.equal(inset.bottom, 0)

  const [top, right, bottom, left] = journeyFitPadding({ compact: false, panelVisible: true })
  assert.ok(left > JOURNEY_PANEL_WIDTH)
  assert.equal(left, top + inset.left)
  assert.equal(bottom, top)
  assert.equal(right, top)
})

test('a compact sheet is reserved at the bottom, never as desktop-left padding', () => {
  const inset = journeyMapInset({ compact: true, panelVisible: true })
  assert.equal(inset.left, 0)
  assert.equal(inset.bottom, JOURNEY_SHEET_HEIGHT)

  const [top, , bottom, left] = journeyFitPadding({ compact: true, panelVisible: true })
  // Dar ekranda soldan hiçbir şey ayrılmaz: panel orada değildir.
  assert.equal(left, top)
  assert.equal(bottom, top + JOURNEY_SHEET_HEIGHT)
  assert.ok(bottom > left)
})

test('a hidden panel reserves nothing at all', () => {
  assert.deepEqual(journeyMapInset({ compact: false, panelVisible: false }), { left: 0, bottom: 0 })
  assert.deepEqual(journeyMapInset({ compact: true, panelVisible: false }), { left: 0, bottom: 0 })

  const [top, right, bottom, left] = journeyFitPadding({ panelVisible: false })
  assert.equal(left, top)
  assert.equal(bottom, top)
  assert.equal(right, top)
})

test('the panel geometry is defined once in JS and consumed by CSS', () => {
  const style = journeyPanelStyle()
  assert.equal(style['--journey-panel-width'], `${JOURNEY_PANEL_WIDTH}px`)
  assert.equal(style['--journey-panel-left'], `${JOURNEY_PANEL_LEFT}px`)
  assert.equal(style['--journey-sheet-height'], `${JOURNEY_SHEET_HEIGHT}px`)

  // Panel bu değişkenleri gerçekten yazar…
  assert.match(PANEL, /style=\{journeyPanelStyle\(\)\}/)

  // …ve CSS onları YEDEKSİZ tüketir: aynı sayı ikinci kez tanımlanmaz.
  assert.ok(CSS.includes('left: var(--journey-panel-left);'))
  assert.ok(CSS.includes('width: min(var(--journey-panel-width), calc(100% - 5.25rem));'))
  assert.ok(CSS.includes('max-height: min(var(--journey-sheet-height), 55%);'))
  assert.ok(!/var\(--journey-(panel-width|panel-left|sheet-height),/.test(CSS))

  /* Kamera dolgusu artık önizleme katmanı modülünde DEĞİLDİR: geometri iki
     dosyada birden yaşamaz. */
  const previewLayer = read('../../src/map/journeyPreviewLayer.js')
  assert.ok(!previewLayer.includes('export function journeyFitPadding'))
  assert.match(PREVIEW_HOOK, /import \{ journeyFitPadding \} from '\.\.\/map\/journeyLayout\.js'/)

  // Ve sayfa artık elle 340 taşımaz.
  assert.ok(!/panelWidth: .*340/.test(MAP_PAGE))
  assert.match(MAP_PAGE, /panelVisible: journey\.state\.panel !== 'closed',/)
})

/* --- 11. Dar ekranda zorunlu denetimler erişilebilir kalır -------------------------- */

test('the compact sheet keeps the toolbar band and the zoom column clear', () => {
  const media = CSS.slice(
    CSS.indexOf(`@media (max-width: ${JOURNEY_COMPACT_BREAKPOINT}px)`),
    CSS.indexOf('/* --- Canlı navigasyon'),
  )

  // Sağda yakınlaştırma sütunu, altta çizim çubuğu şeridi serbest bırakılır.
  assert.match(media, /right: 4\.75rem;/)
  assert.match(media, /bottom: 5\.25rem;/)
  assert.match(media, /max-height: min\(var\(--journey-sheet-height\), 55%\);/)

  /* Denetimlerin kendisi GİZLENMEZ: çözüm panelin yerini vermektir, haritanın
     düğmelerini kapatmak değil. */
  assert.ok(!media.includes('display: none'))
  assert.ok(!media.includes('.draw-toolbar'))
  assert.ok(!media.includes('.ol-zoom'))

  // Panel artık analiz paneliyle aynı katmanda: ikisi aynı anda görünemez.
  const base = CSS.slice(CSS.indexOf('.journey-panel {'), CSS.indexOf('}', CSS.indexOf('.journey-panel {')))
  const analysis = read('../../src/components/map/AnalysisPanel.css')
  const analysisZ = analysis.match(/z-index: (\d+);/)[1]
  assert.match(base, new RegExp(`z-index: ${analysisZ};`))
})

/* --- 12/13. Kapalı/katlanmış durumda yolculuk görünürdür ----------------------------- */

test('a closed panel still announces a running journey through the control stack', () => {
  const indicator = journeyStatusIndicator({
    simulation: { simulationId: 'sim-1' },
    snapshot: { simulationId: 'sim-1', status: JOURNEY_SIMULATION_STATUS.RUNNING, progressPercent: 42.4 },
  })

  assert.equal(indicator.phase, JOURNEY_PHASES.ACTIVE)
  assert.equal(indicator.tone, 'active')
  // Yüzde SUNUCUNUN değeridir; yalnızca yuvarlanır.
  assert.equal(indicator.label, 'Yolculuk sürüyor · %42')

  // İlerleme bilinmiyorsa uydurulmaz.
  assert.equal(
    journeyStatusIndicator({ simulation: { simulationId: 's' }, snapshot: { simulationId: 's', status: 'Running' } }).label,
    'Yolculuk sürüyor',
  )
})

test('a closed panel announces a terminal journey with the shared wording', () => {
  const completed = journeyStatusIndicator({
    simulation: { simulationId: 'sim-1' },
    snapshot: { simulationId: 'sim-1', status: JOURNEY_SIMULATION_STATUS.COMPLETED, progressPercent: 100 },
  })
  assert.equal(completed.phase, JOURNEY_PHASES.TERMINAL)
  assert.equal(completed.tone, 'terminal')
  assert.equal(completed.label, 'Yolculuk tamamlandı')

  const cancelled = journeyStatusIndicator({
    simulation: { simulationId: 'sim-1' },
    snapshot: { simulationId: 'sim-1', status: JOURNEY_SIMULATION_STATUS.CANCELLED, progressPercent: 61 },
  })
  assert.equal(cancelled.label, 'Yolculuk iptal edildi')

  // Benimsenmiş çalıştırma yoksa kısayol sıradan bir düğmedir.
  assert.equal(journeyStatusIndicator({ simulation: null, snapshot: null }), null)
  assert.equal(journeyStatusIndicator(), null)
})

test('the trigger lives in the existing control stack and reads that status', () => {
  /* Panelin köşesindeki eski yeniden açma düğmesi analiz panelinin tam üstüne
     oturuyordu; kısayol artık haritanın kendi denetim yığınındadır — arama
     düğmesiyle aynı kalıp. */
  assert.ok(!PANEL.includes('journey-reopen'))
  assert.ok(!CSS.includes('.journey-reopen'))

  assert.match(QUICK, /className=\{`quick-action journey-trigger/)
  assert.match(QUICK, /aria-pressed=\{Boolean\(journey\.open\)\}/)
  /* Ad ÜRÜNÜN adıdır (Faz 9): kısayol yalnızca planlayıcıyı değil, kaydedilenleri,
     geçmişi ve paylaşımlı ulaşımı da açar. */
  assert.match(QUICK, /journey\.status\s*\n?\s*\? `\$\{JOURNEY_CENTER_TITLE\} · \$\{journey\.status\.label\}`/)
  assert.match(QUICK, /className=\{`journey-trigger-dot is-\$\{journey\.status\.tone\}`\}/)

  // Nokta bir bildirim ya da animasyon değildir.
  const dot = QUICK_CSS.slice(QUICK_CSS.indexOf('.journey-trigger-dot {'), QUICK_CSS.indexOf('.quick-action:focus-visible'))
  assert.ok(!dot.includes('animation'))
  assert.ok(dot.includes('.journey-trigger-dot.is-active'))
  assert.ok(dot.includes('.journey-trigger-dot.is-terminal'))

  // Sayfa durumu sunucu modelinden türetir ve kısayola verir.
  assert.match(MAP_PAGE, /const journeyStatus = useMemo\(\s*\(\) => journeyStatusIndicator\(\{/)
  assert.match(MAP_PAGE, /status: journeyStatus,/)
  assert.match(MAP_PAGE, /onToggle: toggleJourneyPanel,/)
  /* Faz 2: kısayol BİRLEŞİK çalışma alanını açar ve EN AZ BİR ürünle görünür
     (`canOpenJourney`). Bu bir yetki genişletmesi değildir — içerideki kişisel
     bölüm hâlâ `journey.use`, paylaşılan bölüm hâlâ `transport.view` ister ve
     iki yetki birbirini İMA ETMEZ. */
  assert.match(MAP_PAGE, /permitted: canOpenJourney,/)
})

test('a collapsed panel keeps showing the phase it is in', () => {
  const collapsed = PANEL.slice(
    PANEL.indexOf('className="journey-collapsed-summary"'),
    PANEL.indexOf('{!collapsed && showingPersonal && isLive && ('),
  )
  assert.ok(collapsed.length > 0, 'katlanmış özet dilimi bulunamadı')

  /* Faz 2: katlanmış özet artık ÖNCE hangi ÜRÜNE bakıldığını sorar, sonra
     kişisel evreyi. Kişisel evre zinciri OLDUĞU GİBİ durur — yalnızca ürün
     dalının içine yerleşti: paylaşılan hatta bakan kullanıcıya kişisel
     yolculuk özetini okutmak, baktığı ürünün değil öbürünün durumunu
     göstermek olurdu. */
  assert.ok(collapsed.includes('{showingShared ? ('))
  assert.ok(collapsed.includes(') : isTerminal ? ('))
  assert.ok(collapsed.includes(') : isActive ? ('))
  assert.ok(collapsed.includes('journeyTerminalTitle(liveModel.status)'))

  // Ve paylaşılan dal kendi özetini verir; kişisel modeli hiç okumaz.
  const sharedArm = collapsed.slice(
    collapsed.indexOf('{showingShared ? ('),
    collapsed.indexOf(') : isTerminal ? ('),
  )
  assert.ok(sharedArm.includes('shared.routeName'))
  assert.ok(!sharedArm.includes('liveModel'))
})

/* --- 14/15. Kamera sözleşmesi ve yaşam döngüsü korunur ------------------------------ */

test('the fit-once and no-zoom-reset contracts are untouched', () => {
  assert.ok(PREVIEW_HOOK.includes('fittedTokenRef'))
  assert.ok(PREVIEW_HOOK.includes('previewToken === fittedTokenRef.current'))
  assert.ok(PREVIEW_HOOK.includes('padding: journeyFitPadding(paddingRef.current)'))

  /* Dolgu ANINDA okunur: panelin görünürlüğü ya da genişliği değişti diye
     kamera oynamaz. */
  assert.match(PREVIEW_HOOK, /paddingRef\.current = \{ panelVisible, compact \}/)
  assert.ok(!/\}, \[[^\]]*panelVisible[^\]]*\]\)/.test(PREVIEW_HOOK))

  // Takip kamerası ve zum davranışı bu dilimde HİÇ değişmedi.
  const vehicleHook = stripComments(read('../../src/hooks/useJourneyVehicleLayer.js'))
  assert.ok(vehicleHook.includes('vehicleCameraTarget'))
  assert.ok(!vehicleHook.includes('zoom'))
  assert.ok(!PREVIEW_HOOK.includes('setZoom'))
})

test('no journey business action is reachable from a layout decision', () => {
  /* Bu dilim SUNUM işidir: düzen kararları hiçbir sunucu çağrısına ya da
     yaşam döngüsü işlemine bağlanmaz. */
  const layout = read('../../src/map/journeyLayout.js')
  for (const forbidden of ['fetch', 'dismiss', 'stop', 'localStorage', 'ResizeObserver', 'getBoundingClientRect']) {
    assert.ok(!layout.includes(forbidden), `journeyLayout.js ${forbidden} kullanıyor`)
  }
})
