import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  TRANSPORT_CLICK_ACTIONS,
  TRANSPORT_CLICK_TARGET,
  transportClickOutcome,
} from '../../src/map/transportInteraction.js'

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

const HOOK = stripComments(read('../../src/hooks/useTransportStopInteraction.js'))
const MAP_PAGE = stripComments(read('../../src/pages/MapPage.jsx'))

const hit = (target, extra = {}) => ({ target, stop: null, routeId: null, ...extra })

/**
 * Bir sonucun ÇALIŞTIRMAYA komut taşıyıp taşımadığı.
 *
 * <b>Adlar YAŞAM DÖNGÜSÜNE ÖZGÜDÜR, genel değil.</b> Kuru bir `stop` kelimesi
 * aramak işe yaramaz: tıklama sonucundaki `stop`, TIKLANAN DURAĞIN kendisidir
 * — alan verisidir. Aynı kelime paylaşılan hat kancasının durdurma metodunda
 * da geçer (`simulation.stop`), dolayısıyla kelime tek başına hiçbir şey
 * ayırt etmez. Ayırt eden şey adın NE OLDUĞUDUR: bir çalıştırmaya verilen
 * komut mu, yoksa seçilen nesne mi.
 *
 * Listedeki adlar projenin KENDİ sözlüğünden alınmıştır — paylaşılan
 * simülasyon kancasının dışa verdiği yüzey (`toggleWatch`, `clearWatch`,
 * `follow`, `unfollow`, `managedRuns`, `runLifecycleBatch`) ve
 * `LIFECYCLE_OPERATIONS` (pause/resume/reset/restart) — uydurulmuş genel
 * kelimeler değil.
 */
const LIFECYCLE_KEYS = Object.freeze([
  'startSimulation',
  'stopSimulation',
  'pauseSimulation',
  'resumeSimulation',
  'resetSimulation',
  'restartSimulation',
  'runLifecycleBatch',
  'lifecyclePending',
  'toggleWatch',
  'watchAll',
  'clearWatch',
  'unwatch',
  'watchedRuns',
  'follow',
  'unfollow',
  'followingRouteId',
  'toggleManaged',
  'clearManaged',
  'managedRuns',
  'simulationId',
])

const carriesLifecycleCommand = (outcome) =>
  LIFECYCLE_KEYS.some((key) => Object.hasOwn(outcome ?? {}, key))

/* --- Seçim: tıklamanın karşılığı ------------------------------------------------ */

test('clicking a route selects that exact route', () => {
  const outcome = transportClickOutcome(hit(TRANSPORT_CLICK_TARGET.ROUTE, { routeId: 34 }))

  assert.equal(outcome.action, TRANSPORT_CLICK_ACTIONS.SELECT_ROUTE)
  assert.equal(outcome.routeId, 34)

  /* Seçmek BAŞLATMAK ya da TAKİP ETMEK değildir: sonuçta böyle bir alan
     yoktur. */
  assert.equal(outcome.clearsRoute, false)
})

test('clicking empty map clears the selected route', () => {
  /* ASIL DÜZELTME: POI, durak ve çizim seçimleri boş tıklamada zaten
     bırakılıyordu; güzergah bırakılmıyordu. */
  const outcome = transportClickOutcome(hit(TRANSPORT_CLICK_TARGET.NONE))

  assert.equal(outcome.action, TRANSPORT_CLICK_ACTIONS.CLEAR)
  assert.equal(outcome.clearsRoute, true)
})

test('a real feature is never mistaken for empty map', () => {
  /* Tıklama gerçek bir nesneye isabet ettiyse seçim BIRAKILMAZ: kullanıcı bir
     şeye dokunmuştur ve seçili hattı kaybetmeyi beklemez. */
  for (const target of [
    TRANSPORT_CLICK_TARGET.VEHICLE,
    TRANSPORT_CLICK_TARGET.STOP,
    TRANSPORT_CLICK_TARGET.ROUTE,
  ]) {
    assert.equal(transportClickOutcome(hit(target)).clearsRoute, false, target)
  }
})

test('a route hit with no selection handler still is not an empty click', () => {
  /* Görünmez ya da işleyicisiz bir güzergah isabeti mevcut davranışı korur:
     durak seçimi bırakılır, HAT seçimi korunur. */
  const outcome = transportClickOutcome(
    hit(TRANSPORT_CLICK_TARGET.ROUTE, { routeId: 7 }),
    { canSelectRoute: false },
  )

  assert.equal(outcome.action, TRANSPORT_CLICK_ACTIONS.CLEAR)
  assert.equal(outcome.clearsRoute, false)
})

test('the vehicle keeps click precedence and the chain withdraws', () => {
  const outcome = transportClickOutcome(hit(TRANSPORT_CLICK_TARGET.VEHICLE))

  assert.equal(outcome.action, TRANSPORT_CLICK_ACTIONS.IGNORE)
  assert.equal(outcome.stop, null)
  assert.equal(outcome.routeId, null)
})

test('a stop click stays a stop selection', () => {
  const stop = { id: 9, name: 'A' }
  const outcome = transportClickOutcome(hit(TRANSPORT_CLICK_TARGET.STOP, { stop }))

  assert.equal(outcome.action, TRANSPORT_CLICK_ACTIONS.SELECT_STOP)
  assert.equal(outcome.stop, stop)
  assert.equal(outcome.clearsRoute, false)
})

test('a missing or malformed hit is treated as empty map', () => {
  for (const value of [undefined, null, {}, { target: 'nonsense' }]) {
    const outcome = transportClickOutcome(value)
    assert.equal(outcome.action, TRANSPORT_CLICK_ACTIONS.CLEAR)
  }

  // Yalnızca gerçekten "hiçbir şey" hattı bırakır.
  assert.equal(transportClickOutcome({ target: 'nonsense' }).clearsRoute, false)
  assert.equal(transportClickOutcome(undefined).clearsRoute, true)
})

test('a route can be selected again after it was cleared', () => {
  /* Bırakma bir KİLİT değildir: aynı hat hemen yeniden seçilebilir. */
  const cleared = transportClickOutcome(hit(TRANSPORT_CLICK_TARGET.NONE))
  assert.equal(cleared.clearsRoute, true)

  const reselected = transportClickOutcome(hit(TRANSPORT_CLICK_TARGET.ROUTE, { routeId: 34 }))
  assert.equal(reselected.action, TRANSPORT_CLICK_ACTIONS.SELECT_ROUTE)
  assert.equal(reselected.routeId, 34)
})

/* --- Bırakma YALNIZCA seçimdir --------------------------------------------------- */

test('an empty-map outcome introduces no selection of its own', () => {
  /* Boş tıklamanın ne YAPTIĞI kadar ne YAPMADIĞI da sözleşmedir: hattı bırakır
     ama yerine bir durak ya da başka bir hat KOYMAZ. */
  const outcome = transportClickOutcome(hit(TRANSPORT_CLICK_TARGET.NONE))

  assert.equal(outcome.action, TRANSPORT_CLICK_ACTIONS.CLEAR)
  assert.equal(outcome.clearsRoute, true)
  assert.equal(outcome.stop, null)
  assert.equal(outcome.routeId, null)
})

test('a click outcome carries selection data and nothing else', () => {
  /* ASIL GÜVENCE ŞEKİLDEDİR: anahtar kümesi TAM OLARAK budur. Kümeyi
     sabitlemek, tek tek yasaklı ad saymaktan güçlüdür — listeye yazmayı
     unuttuğumuz bir alan bile buradan geçemez. */
  const outcomes = [
    transportClickOutcome(hit(TRANSPORT_CLICK_TARGET.NONE)),
    transportClickOutcome(hit(TRANSPORT_CLICK_TARGET.ROUTE, { routeId: 1 })),
    transportClickOutcome(hit(TRANSPORT_CLICK_TARGET.STOP, { stop: {} })),
    transportClickOutcome(hit(TRANSPORT_CLICK_TARGET.VEHICLE)),
  ]

  for (const outcome of outcomes) {
    assert.deepEqual(Object.keys(outcome).sort(), ['action', 'clearsRoute', 'routeId', 'stop'])

    // Ve hiçbiri bir yaşam döngüsü komutu TAŞIYAMAZ.
    assert.equal(carriesLifecycleCommand(outcome), false)

    /* Karar DEĞİŞMEZDİR: çağıran onu sessizce zenginleştiremez. Atanan değer
       hiçbir sonucun mevcut değeriyle eşleşmesin diye bilinçle yabancıdır. */
    assert.throws(() => { outcome.action = 'tampered' })
  }
})

test('the lifecycle guard separates domain data from lifecycle commands', () => {
  /* <b>Neden bu ayrım açıkça sınanıyor.</b> Muhafız bir kez yanlış ateşledi:
     yasaklı adlar arasına konan kuru `stop` kelimesi, TIKLANAN DURAĞI taşıyan
     meşru `stop` alanına çarptı. Alan adı ile komut adı aynı kelimeyi
     paylaşabilir — nitekim paylaşılan hat kancasının kendi durdurma metodu da
     `stop` diye adlandırılmıştır. Ayrım kelimede değil, ADIN NE OLDUĞUNDADIR:
     seçim verisi mi, yoksa bir çalıştırmaya komut mu. */

  // 1) Meşru alan verisi KABUL EDİLİR — tıklanan durak da dâhil.
  const stopSelection = {
    action: TRANSPORT_CLICK_ACTIONS.SELECT_STOP,
    clearsRoute: false,
    routeId: null,
    stop: { id: 12, name: 'Kızılay', routeId: 34 },
  }
  assert.equal(carriesLifecycleCommand(stopSelection), false)

  const routeSelection = {
    action: TRANSPORT_CLICK_ACTIONS.SELECT_ROUTE,
    clearsRoute: false,
    routeId: 34,
    stop: null,
  }
  assert.equal(carriesLifecycleCommand(routeSelection), false)

  // 2) Yaşam döngüsü taşıyan sentetik şekiller REDDEDİLİR.
  for (const forbidden of [
    { stopSimulation: true },
    { startSimulation: 34 },
    { pauseSimulation: true },
    { resumeSimulation: true },
    { resetSimulation: true },
    { restartSimulation: true },
    { runLifecycleBatch: ['reset'] },
    { toggleWatch: 34 },
    { clearWatch: true },
    { unwatch: 34 },
    { follow: 34 },
    { unfollow: true },
    { managedRuns: { 34: 'run-1' } },
    { simulationId: 'run-1' },
    // Seçim verisiyle BİRLİKTE gelse bile yakalanır.
    { ...stopSelection, unfollow: true },
  ]) {
    assert.ok(
      carriesLifecycleCommand(forbidden),
      `yaşam döngüsü taşıyan şekil yakalanmalıydı: ${Object.keys(forbidden).join(', ')}`,
    )
  }
})

test('the canonical clear touches the selection and nothing else', () => {
  /* MapPage'deki bırakma tek bir sunum durumunu boşaltır. İzlenen ve takip
     edilen araçlar kaybolmaz çünkü sahiplik `followingRouteId`'dedir,
     `selectedRouteId`'de değil. */
  const clear = MAP_PAGE.slice(
    MAP_PAGE.indexOf('const clearSelectedTransportRoute = useCallback('),
    MAP_PAGE.indexOf('const isTransportRouteSelectable = useCallback('),
  )

  assert.match(clear, /setSelectedTransportRouteId\(null\)/)

  for (const forbidden of [
    'simulation.stop', 'simulation.pause', 'simulation.reset', 'simulation.restart',
    'simulation.follow', 'simulation.unfollow', 'toggleWatch', 'clearWatch',
    'toggleManaged', 'clearManaged', 'leave(', 'dismiss(',
  ]) {
    assert.ok(!clear.includes(forbidden), `bırakma ${forbidden} çağırmamalı`)
  }
})

test('the hook applies the pure decision instead of re-deciding', () => {
  assert.match(HOOK, /transportClickOutcome\(hit, \{ canSelectRoute: Boolean\(onSelectRoute\) \}\)/)
  assert.match(HOOK, /if \(outcome\.clearsRoute\) onClearRoute\?\.\(\)/)

  /* Kanca ikinci bir kural kitabı tutmaz ve yaşam döngüsü çağırmaz. */
  for (const forbidden of ['simulation.', 'follow(', 'watch(', 'start(']) {
    assert.ok(!HOOK.includes(forbidden), `kanca ${forbidden} çağırmamalı`)
  }
})

test('the map page wires the clear into the existing click pipeline', () => {
  /* Paralel bir genel tıklama dinleyicisi AÇILMADI: mevcut zincirin boş dalı
     genişletildi. */
  assert.match(MAP_PAGE, /onClearRoute: clearSelectedTransportRoute/)

  const listeners = (stripComments(HOOK).match(/map\.on\('singleclick'/g) ?? []).length
  assert.equal(listeners, 1)
})

/* --- Diğer seçimler DEĞİŞMEDİ ----------------------------------------------------- */

test('drawing and POI empty-click behaviour is untouched', () => {
  const drawing = stripComments(read('../../src/hooks/useFeatureInteraction.js'))
  const poi = stripComments(read('../../src/hooks/usePoiInteraction.js'))

  // İkisi de boş tıklamada kendi seçimlerini bırakmaya devam eder.
  assert.match(drawing, /onSelect\(feature \? feature\.getId\(\) : null/)
  assert.match(poi, /onSelect\(feature \? featureToPoi\(feature\) : null\)/)

  // Ve hiçbiri güzergah seçimini tanımaz: sorumluluk tek yerdedir.
  assert.ok(!drawing.includes('RouteId'))
  assert.ok(!poi.includes('RouteId'))
})
