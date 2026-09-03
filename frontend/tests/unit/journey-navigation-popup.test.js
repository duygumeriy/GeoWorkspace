import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  JOURNEY_STEP_STATES,
  journeyNavigationModel,
  journeyStepDistanceLabel,
} from '../../src/map/journeyNavigation.js'
import {
  JOURNEY_SIMULATION_STATUS,
  journeyStatusLabel,
  journeyVehiclePopupModel,
} from '../../src/map/journeySimulationState.js'
import {
  JOURNEY_VEHICLE_KIND,
  JOURNEY_VEHICLE_LAYER_CLASSNAME,
  createJourneyVehicleLayer,
  findJourneyVehicleAtPixel,
  syncJourneyVehicleFeature,
} from '../../src/map/journeyVehicle.js'
import { TRANSPORT_VEHICLE_KIND, TRANSPORT_VEHICLE_LAYER_CLASSNAME } from '../../src/map/transportVehicle.js'

/**
 * Faz 5E-B · Dilim 7A — kişisel yolculuğun tamamlanan UX'i.
 *
 * Üç kural çalıştırılarak ölçülür: adım adım yönlendirme modeli, araç
 * balonunun sunucu-otoriter modeli ve işaretçinin kimlikle çözülen isabet
 * denetimi. React'siz çalıştırılamayan bağlamalar (onay diyaloğu, tıklama
 * sahipliği, balon yaşam döngüsü) ilgili geri çağrı/efekt/JSX ayıklanarak
 * denetlenir.
 */

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

const MAP_PAGE = stripComments(read('../../src/pages/MapPage.jsx'))
const PANEL = stripComments(read('../../src/components/map/JourneyPlannerPanel.jsx'))
const POPUP = stripComments(read('../../src/components/map/JourneyVehiclePopup.jsx'))
const VEHICLE_HOOK = stripComments(read('../../src/hooks/useJourneyVehicleLayer.js'))
const NAVIGATION = stripComments(read('../../src/map/journeyNavigation.js'))
const LIVE_STATE = stripComments(read('../../src/map/journeySimulationState.js'))

/**
 * Adı verilen `useCallback` çağrısının TAMAMI.
 *
 * Sınır, ilk `}, [` aranarak bulunamaz: tek satırlık bir geri çağrının
 * (`useCallback(() => setX(true), [])`) böyle bir kapanışı YOKTUR ve arama
 * komşu fonksiyona taşar — o zaman "istek fonksiyonu durdurma çağırıyor" gibi
 * yanlış bir sonuç çıkar. Parantezler sayılır.
 */
const callbackBody = (source, name) => {
  const marker = `const ${name} = useCallback(`
  const from = source.indexOf(marker)
  assert.ok(from > 0, `${name} bulunamadı`)

  let depth = 1
  for (let index = from + marker.length; index < source.length; index += 1) {
    const char = source[index]
    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return source.slice(from, index + 1)
    }
  }

  return assert.fail(`${name} kapanışı bulunamadı`)
}

/**
 * Belirli bir ÇAĞRI ifadesinin sayısı.
 *
 * Kimlik adında "stop" harflerinin geçmesi bir çağrı değildir:
 * `journeyStopPending`, `setJourneyStopPending`, `journeyStopping` sunum
 * durumudur. Aranan şey `ad(` biçimindeki gerçek çağrıdır.
 */
const callCount = (source, callee) => {
  const pattern = new RegExp(`${callee.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`, 'g')
  return (source.match(pattern) ?? []).length
}

/** Bir JSX özniteliğinin ifade metni (`prop={…}`). */
const jsxProp = (element, prop) => {
  const marker = `${prop}={`
  const from = element.indexOf(marker)
  assert.ok(from >= 0, `${prop} bulunamadı`)

  let depth = 1
  for (let index = from + marker.length; index < element.length; index += 1) {
    const char = element[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return element.slice(from + marker.length, index)
    }
  }

  return assert.fail(`${prop} kapanışı bulunamadı`)
}

/** Sunucuya durdurma/bırakma gönderen ya da kamerayı bırakan gerçek çağrılar. */
const AUTHORITATIVE_CALLS = [
  'journeySimulation.stop',
  'stopJourneySimulation',
  'journeySimulation.dismiss',
  'leave',
  'setFollowing',
  'fetch',
]

/**
 * Bir JSX bileşen çağrısı (öznitelik ifadelerinin içi atlanarak).
 *
 * `marker` verildiğinde aynı bileşenin DOĞRU örneği seçilir: sayfada birden
 * çok `ConfirmDialog` vardır ve yanlışını ölçmek testi anlamsız kılardı.
 */
function jsxElement(source, tag, marker = '') {
  let from = source.indexOf(`<${tag}`)

  while (from >= 0) {
    let depth = 0
    let closed = -1

    for (let index = from; index < source.length; index += 1) {
      const char = source[index]
      if (char === '{') depth += 1
      else if (char === '}') depth -= 1
      else if (depth === 0 && char === '/' && source[index + 1] === '>') {
        closed = index + 2
        break
      }
    }

    if (closed < 0) break
    const element = source.slice(from, closed)
    if (!marker || element.includes(marker)) return element
    from = source.indexOf(`<${tag}`, closed)
  }

  return assert.fail(`<${tag} … ${marker}/> bulunamadı`)
}

const STEPS = [
  { sequence: 0, maneuverType: 'depart', name: 'Atatürk Bulvarı', distanceMeters: 250 },
  { sequence: 1, maneuverType: 'turn', maneuverModifier: 'right', name: 'İstiklal Caddesi', distanceMeters: 1400 },
  { sequence: 2, maneuverType: 'arrive' },
]

const simulationOf = (patch = {}) => ({
  simulationId: 'sim-1',
  requestedProfile: 'driving',
  totalDistanceMeters: 4200,
  totalDurationSeconds: 600,
  steps: STEPS,
  ...patch,
})

const snapshotOf = (patch = {}) => ({
  simulationId: 'sim-1',
  status: JOURNEY_SIMULATION_STATUS.RUNNING,
  progressPercent: 42.4,
  distanceCoveredMeters: 1780,
  longitude: 36.33,
  latitude: 41.28,
  currentStepSequence: 1,
  ...patch,
})

/* --- 15/16/17/18/19. Güncel ve sıradaki adım ------------------------------------- */

test('the current step resolves from the server sequence, not from progress', () => {
  const model = journeyNavigationModel({ steps: STEPS, currentStepSequence: 1 })

  assert.equal(model.current.sequence, 1)
  assert.equal(model.current.instruction, 'Sağa dönün')
  assert.equal(model.next.sequence, 2)

  // Tamamlanan / güncel / sıradaki ayrımı sunucunun SIRASINDAN çıkar.
  assert.deepEqual(model.steps.map((step) => step.state), [
    JOURNEY_STEP_STATES.DONE,
    JOURNEY_STEP_STATES.CURRENT,
    JOURNEY_STEP_STATES.UPCOMING,
  ])
})

test('sequence identity is honoured even when it is not the array index', () => {
  /* Liste başı kırpılmış bir yanıt geldiğinde dizine güvenmek YANLIŞ talimatı
     "şu an" diye gösterirdi. */
  const shifted = [
    { sequence: 7, maneuverType: 'continue' },
    { sequence: 8, maneuverType: 'turn', maneuverModifier: 'left' },
  ]
  const model = journeyNavigationModel({ steps: shifted, currentStepSequence: 8 })

  assert.equal(model.current.sequence, 8)
  assert.equal(model.next, null)
  assert.equal(model.steps[0].state, JOURNEY_STEP_STATES.DONE)
})

test('the last step has no next step', () => {
  const model = journeyNavigationModel({ steps: STEPS, currentStepSequence: 2 })

  assert.equal(model.current.sequence, 2)
  // Varıştan sonra bir talimat UYDURULMAZ.
  assert.equal(model.next, null)
})

test('a journey without maneuvers is valid, not an error', () => {
  for (const value of [undefined, null, [], 'steps', 42, {}]) {
    const model = journeyNavigationModel({ steps: value, currentStepSequence: 1 })
    assert.equal(model.hasSteps, false)
    assert.deepEqual(model.steps, [])
    assert.equal(model.current, null)
    assert.equal(model.next, null)
  }

  assert.equal(journeyNavigationModel().hasSteps, false)
})

test('a missing or malformed current sequence fails safely', () => {
  for (const value of [undefined, null, '1', 1.5, NaN, 99, -1]) {
    const model = journeyNavigationModel({ steps: STEPS, currentStepSequence: value })
    assert.equal(model.current, null, `${value} için güncel adım uydurulmamalı`)
    assert.equal(model.next, null)
    // Liste yine de okunur; hepsi "sırada" olur.
    assert.equal(model.steps.length, 3)
    assert.ok(model.steps.every((step) => step.state === JOURNEY_STEP_STATES.UPCOMING))
  }
})

test('the step distance is labelled as the step own length, never as remaining', () => {
  assert.equal(journeyStepDistanceLabel({ distanceMeters: 250 }), '250 m')
  assert.equal(journeyStepDistanceLabel({ distanceMeters: 1400 }), '1.4 km')
  assert.equal(journeyStepDistanceLabel({}), null)
  assert.equal(journeyStepDistanceLabel(null), null)
  assert.equal(journeyStepDistanceLabel({ distanceMeters: -5 }), null)

  // Balon da öyle etiketler: "sonra dönün" gibi bir kalan mesafe iması yok.
  assert.ok(POPUP.includes('Adım uzunluğu:'))
  assert.ok(!POPUP.includes('kaldı'))
  assert.ok(!POPUP.includes('sonra'))
})

/* --- 20/21. Panel ve balon aynı modeli okur --------------------------------------- */

test('the panel and the popup consume the same navigation helper', () => {
  assert.match(PANEL, /journeyNavigationModel\(\{\s*steps: live\?\.simulation\?\.steps,\s*currentStepSequence: liveModel\?\.currentStepSequence,\s*\}\)/)
  assert.match(LIVE_STATE, /journeyNavigationModel\(\{\s*steps: simulation\.steps,\s*currentStepSequence: live\.currentStepSequence,\s*\}\)/)

  // İkinci bir "şu anki adım" hesabı hiçbir yüzeyde yaşamaz.
  assert.ok(!PANEL.includes('findIndex'))
  assert.ok(!POPUP.includes('currentStepSequence'))
})

test('no browser-side routing, progress or duration calculation is introduced', () => {
  for (const [name, source] of [
    ['journeyNavigation.js', NAVIGATION],
    ['JourneyVehiclePopup.jsx', POPUP],
  ]) {
    for (const forbidden of ['osrm', 'route/v1', 'Date.now(', 'setInterval', 'setTimeout', 'speed', 'estimate']) {
      assert.ok(!source.toLowerCase().includes(forbidden.toLowerCase()), `${name} ${forbidden} kullanıyor`)
    }
  }

  // Talimat metni MEVCUT manevra sunumundan gelir; ikinci bir eşleme yok.
  assert.match(NAVIGATION, /from '\.\/journeyManeuvers\.js'/)
})

/* --- 6/7/8/9/22/23. Balon modeli ------------------------------------------------- */

test('the popup model is built from the adopted simulation and snapshot', () => {
  const popup = journeyVehiclePopupModel({ simulation: simulationOf(), snapshot: snapshotOf() })

  assert.equal(popup.simulationId, 'sim-1')
  assert.equal(popup.title, 'Araç Yolculuğu')
  assert.equal(popup.statusLabel, 'Sürüyor')
  // Yüzde SUNUCUNUN değeridir; biçimlendirme yalnızca gösterim güvenliğidir.
  assert.equal(popup.progressPercent, 42.4)
  assert.equal(popup.progressLabel, '%42')
  // Konum da sunucunun anlık görüntüsünden gelir.
  assert.equal(popup.longitude, 36.33)
  assert.equal(popup.latitude, 41.28)
  // Talimatlar aynı gezinme modelinden.
  assert.equal(popup.currentStep.sequence, 1)
  assert.equal(popup.nextStep.sequence, 2)
})

test('the popup profile comes from the adopted run, in the canonical vocabulary', () => {
  assert.equal(journeyVehiclePopupModel({ simulation: simulationOf({ requestedProfile: 'driving' }), snapshot: snapshotOf() }).title, 'Araç Yolculuğu')
  assert.equal(journeyVehiclePopupModel({ simulation: simulationOf({ requestedProfile: 'walking' }), snapshot: snapshotOf() }).title, 'Yürüyüş Yolculuğu')
  assert.equal(journeyVehiclePopupModel({ simulation: simulationOf({ requestedProfile: 'cycling' }), snapshot: snapshotOf() }).title, 'Bisiklet Yolculuğu')

  // Otobüs/transit semantiği YOKTUR; bilinmeyen profil güvenli etikete düşer.
  const unknown = journeyVehiclePopupModel({ simulation: simulationOf({ requestedProfile: 'bus' }), snapshot: snapshotOf() })
  assert.equal(unknown.title, '— Yolculuğu')
  assert.ok(!POPUP.includes('Otobüs'))
})

test('a newer accepted snapshot moves the popup and refreshes its fields', () => {
  const first = journeyVehiclePopupModel({ simulation: simulationOf(), snapshot: snapshotOf() })
  const later = journeyVehiclePopupModel({
    simulation: simulationOf(),
    snapshot: snapshotOf({ progressPercent: 71, longitude: 36.4, latitude: 41.3, currentStepSequence: 2 }),
  })

  assert.equal(later.progressLabel, '%71')
  assert.equal(later.longitude, 36.4)
  assert.equal(later.currentStep.sequence, 2)
  assert.equal(later.nextStep, null)
  assert.notEqual(first.progressLabel, later.progressLabel)
})

test('the popup cannot exist without an adopted run', () => {
  assert.equal(journeyVehiclePopupModel({ simulation: null, snapshot: snapshotOf() }), null)
  assert.equal(journeyVehiclePopupModel({ simulation: simulationOf(), snapshot: null }), null)
  assert.equal(journeyVehiclePopupModel(), null)
})

test('a terminal run keeps its final popup from the final server snapshot', () => {
  const popup = journeyVehiclePopupModel({
    simulation: simulationOf(),
    snapshot: snapshotOf({ status: JOURNEY_SIMULATION_STATUS.COMPLETED, progressPercent: 100, currentStepSequence: 2 }),
  })

  assert.equal(popup.isTerminal, true)
  assert.equal(popup.statusLabel, 'Tamamlandı')
  assert.equal(popup.progressLabel, '%100')
  assert.equal(journeyStatusLabel(JOURNEY_SIMULATION_STATUS.CANCELLED), 'İptal Edildi')
  assert.equal(journeyStatusLabel('Beklenmeyen'), 'Bilinmiyor')
})

/* --- 11/12. Kimlik ve bırakma ---------------------------------------------------- */

test('the popup is bound to a simulation id, so a replacement run cannot inherit it', () => {
  const model = callbackBody(MAP_PAGE, 'openJourneyVehiclePopup')
  assert.match(model, /setJourneyPopupSimulationId\(simulationId\)/)

  /* Model YALNIZCA kimlik eşleşince üretilir: yeni bir çalıştırma eskisinin
     balonunu devralamaz, bırakılan sonuç da balonu düşürür. */
  const memo = MAP_PAGE.slice(
    MAP_PAGE.indexOf('const journeyVehiclePopup = useMemo('),
    MAP_PAGE.indexOf('}, [journeyPopupSimulationId'),
  )
  assert.match(memo, /journeyVehiclePopupModel\(\{\s*simulation: journeySimulation\.simulation,\s*snapshot: journeySimulation\.snapshot,\s*\}\)/)
  assert.match(memo, /model\.simulationId === journeyPopupSimulationId \? model : null/)

  // Bırakma `simulation`ı düşürür; model de null olur (Dilim 2 sözleşmesi).
  assert.equal(journeyVehiclePopupModel({ simulation: null, snapshot: null }), null)
})

/* --- 10/28. Kapatmak yalnızca kapatır -------------------------------------------- */

test('closing the popup neither stops, dismisses, unfollows nor leaves', () => {
  const usage = jsxElement(MAP_PAGE, 'JourneyVehiclePopup')

  assert.match(usage, /journey=\{journeyVehiclePopup\}/)
  assert.match(usage, /onClose=\{\(\) => setJourneyPopupSimulationId\(null\)\}/)

  for (const forbidden of ['stop', 'dismiss', 'setFollowing', 'leave']) {
    assert.ok(!usage.includes(forbidden), `kapatma ${forbidden} çağırıyor`)
  }

  // Balon bileşeni de kamera/abonelik kavramlarını hiç tanımaz.
  for (const forbidden of ['setFollowing', 'following', 'signalR', 'HubConnection', 'fetch(']) {
    assert.ok(!POPUP.includes(forbidden), `balon ${forbidden} kullanıyor`)
  }
})

test('opening the popup claims no camera and starts no follow', () => {
  const open = callbackBody(MAP_PAGE, 'openJourneyVehiclePopup')
  for (const forbidden of ['setFollowing', 'toggleJourneyFollow', 'following']) {
    assert.ok(!open.includes(forbidden), `balon açmak ${forbidden} çağırıyor`)
  }
})

/* --- 13. Tıklama sahipliği -------------------------------------------------------- */

/** Gerçek haritanın yalnızca kullanılan yüzeyi. */
const fakeMap = (candidates) => ({
  forEachFeatureAtPixel(pixel, callback) {
    for (const candidate of candidates) {
      const feature = { get: (key) => candidate.properties[key] }
      const layer = { getClassName: () => candidate.layerClassName }
      const result = callback(feature, layer)
      if (result) return result
    }
    return undefined
  },
})

const journeyCandidate = {
  layerClassName: JOURNEY_VEHICLE_LAYER_CLASSNAME,
  properties: { featureKind: JOURNEY_VEHICLE_KIND, simulationId: 'sim-1' },
}

const transportCandidate = {
  layerClassName: TRANSPORT_VEHICLE_LAYER_CLASSNAME,
  properties: { featureKind: TRANSPORT_VEHICLE_KIND, transportVehicle: { simulationId: 'route-run' } },
}

test('the journey vehicle is resolved by explicit identity, never by style or order', () => {
  assert.ok(findJourneyVehicleAtPixel(fakeMap([journeyCandidate]), [10, 10]))

  // Paylaşılan hat aracı yolculuk aracı SANILMAZ.
  assert.equal(findJourneyVehicleAtPixel(fakeMap([transportCandidate]), [10, 10]), null)
  // Doğru katman ama yanlış tür, ya da tersi: ikisi birden aranır.
  assert.equal(findJourneyVehicleAtPixel(fakeMap([{
    layerClassName: JOURNEY_VEHICLE_LAYER_CLASSNAME, properties: { featureKind: 'something-else' },
  }]), [10, 10]), null)
  assert.equal(findJourneyVehicleAtPixel(fakeMap([{
    layerClassName: 'poi-layer', properties: { featureKind: JOURNEY_VEHICLE_KIND },
  }]), [10, 10]), null)

  assert.equal(findJourneyVehicleAtPixel(fakeMap([]), [10, 10]), null)
  assert.equal(findJourneyVehicleAtPixel(null, [10, 10]), null)
})

test('waypoint picking owns the click and suppresses the journey popup', () => {
  const usage = MAP_PAGE.slice(
    MAP_PAGE.indexOf('useJourneyVehicleLayer(mapInstance, {'),
    MAP_PAGE.indexOf('})', MAP_PAGE.indexOf('useJourneyVehicleLayer(mapInstance, {')),
  )
  assert.match(usage, /onVehicleClick: openJourneyVehiclePopup/)
  assert.match(usage, /clickEnabled: !journey\.isPicking/)

  // Kancada da kapı vardır: bayrak kapalıyken dinleyici HİÇ kurulmaz.
  const clickEffect = VEHICLE_HOOK.split('useEffect(').slice(1).find((body) => body.includes("map.on('singleclick'"))
  assert.ok(clickEffect)
  assert.match(clickEffect, /if \(!map \|\| !clickEnabled \|\| typeof onVehicleClick !== 'function'\) return undefined/)
  assert.match(clickEffect, /findJourneyVehicleAtPixel\(map, event\.pixel\)/)
})

/* --- 14. Sabit hat ürünü ayrı kalır ---------------------------------------------- */

test('the fixed-route vehicle popup remains a separate, untouched product', () => {
  const transportPopup = read('../../src/components/map/TransportVehiclePopup.jsx')

  // İki bileşen birbirini TANIMAZ.
  assert.ok(!transportPopup.includes('journey'))
  assert.ok(!POPUP.includes('transport'))
  assert.ok(!POPUP.includes('routeName'))

  // İkisi aynı anda açık kalmaz; sıra yalnızca sayfa düzeyinde kurulur.
  assert.match(callbackBody(MAP_PAGE, 'openJourneyVehiclePopup'), /setVehiclePopupTarget\(null\)/)
  assert.match(MAP_PAGE, /if \(vehiclePopupTarget == null\) return\s*setJourneyPopupSimulationId\(null\)/)

  // Ve paylaşılan hat balonu hâlâ kendi durumundan çizilir.
  assert.match(MAP_PAGE, /vehicle=\{vehiclePopup\}/)
})

/* --- 1/2/3/4/5. Durdurma onayı --------------------------------------------------- */

test('stopping an active journey asks first instead of calling the backend', () => {
  // Panelin durdurma düğmesi ONAY isteyen sarmalayıcıya bağlıdır.
  const panelUsage = jsxElement(MAP_PAGE, 'JourneyPlannerPanel')
  assert.match(panelUsage, /onStopSimulation=\{requestJourneyStop\}/)
  assert.ok(!panelUsage.includes('onStopSimulation={journeySimulation.stop}'))

  /* Sarmalayıcı YALNIZCA sunum durumunu açar. Ölçülen şey gerçek ÇAĞRILARDIR:
     `journeyStopPending` gibi bir kimlikte "stop" harflerinin geçmesi bir
     sunucu isteği değildir. */
  const request = callbackBody(MAP_PAGE, 'requestJourneyStop')
  assert.match(request, /setJourneyStopPending\(true\)/)

  for (const callee of AUTHORITATIVE_CALLS) {
    assert.equal(callCount(request, callee), 0, `onay isteği ${callee}() çağırıyor`)
  }
})

test('cancelling makes no stop call, confirming makes exactly one', () => {
  const dialog = jsxElement(MAP_PAGE, 'ConfirmDialog', 'journeyStopPending')

  assert.match(dialog, /open=\{journeyStopPending\}/)
  assert.match(dialog, /confirmLabel="Yolculuğu Durdur"/)
  assert.match(dialog, /cancelLabel="Vazgeç"/)
  /* Vazgeçmek YALNIZCA sunum durumunu kapatır. İfade ayıklanır ve içinde
     gerçek bir yetkili çağrı ARANMAZ — `setJourneyStopPending(false)` tamamen
     meşrudur ve adında "Stop" geçmesi onu bir sunucu isteği yapmaz. */
  const cancel = jsxProp(dialog, 'onCancel')
  assert.match(cancel, /setJourneyStopPending\(false\)/)
  for (const callee of AUTHORITATIVE_CALLS) {
    assert.equal(callCount(cancel, callee), 0, `vazgeçme ${callee}() çağırıyor`)
  }

  // Onay MEVCUT durdurma eylemini TAM OLARAK bir kez çağırır.
  const confirm = callbackBody(MAP_PAGE, 'confirmJourneyStop')
  assert.equal(callCount(confirm, 'journeySimulation.stop'), 1)
  assert.equal(callCount(confirm, 'stopJourneySimulation'), 0, 'ikinci bir durdurma yolu açılmış')
  assert.match(jsxProp(dialog, 'onConfirm'), /^confirmJourneyStop$/)
})

test('an in-flight stop cannot be submitted twice', () => {
  const confirm = callbackBody(MAP_PAGE, 'confirmJourneyStop')

  // Ref yarışı kapatır…
  assert.match(confirm, /if \(journeyStopInFlight\.current\) return/)
  assert.match(confirm, /journeyStopInFlight\.current = true/)
  // …ve düğme de kilitlenir.
  assert.match(confirm, /setJourneyStopping\(true\)/)
  assert.match(jsxElement(MAP_PAGE, 'ConfirmDialog', 'journeyStopPending'), /busy=\{journeyStopping\}/)

  const dialogComponent = stripComments(read('../../src/components/map/ConfirmDialog.jsx'))
  assert.match(dialogComponent, /busy = false/)
  assert.match(dialogComponent, /disabled=\{busy\}/)

  // Her durumda bayrak bırakılır: başarısız bir istek düğmeyi kilitli bırakmaz.
  assert.match(confirm, /finally \{[\s\S]*journeyStopInFlight\.current = false/)
})

test('closing, collapsing and every terminal exit skip the confirmation', () => {
  for (const name of [
    'closeJourneyPanel',
    'openJourneyPanel',
    'returnToJourneyPlanning',
    'startNewJourney',
    'openJourneyVehiclePopup',
  ]) {
    const body = callbackBody(MAP_PAGE, name)
    assert.ok(!body.includes('setJourneyStopPending'), `${name} onay diyaloğunu açıyor`)
    assert.ok(!body.includes('journeySimulation.stop'), `${name} sunucuya durdurma gönderiyor`)
  }

  // Diyalog YALNIZCA çalışan yolculuğun durdurma düğmesinden açılır.
  assert.equal((MAP_PAGE.match(/setJourneyStopPending\(true\)/g) ?? []).length, 1)
})

/* --- 26/27. Terminal yaşam döngüsü ------------------------------------------------ */

test('the terminal popup survives until the result itself is dismissed', () => {
  /* Terminal işaretçi son sunucu durumuyla kalır (Dilim 2); balon da o modeli
     okur. Bırakma `simulation`ı düşürdüğü an model null olur. */
  const terminal = journeyVehiclePopupModel({
    simulation: simulationOf(),
    snapshot: snapshotOf({ status: JOURNEY_SIMULATION_STATUS.CANCELLED, progressPercent: 61 }),
  })
  assert.equal(terminal.isTerminal, true)
  assert.equal(terminal.progressLabel, '%61')

  assert.equal(journeyVehiclePopupModel({ simulation: null, snapshot: null }), null)
})

/* --- 30/31/32/33/34. Gerileme ----------------------------------------------------- */

test('one journey vehicle feature is still updated in place', () => {
  const { source } = createJourneyVehicleLayer()

  const first = syncJourneyVehicleFeature(source, {
    simulationId: 'sim-1', profileId: 'driving', longitude: 30, latitude: 40,
  })
  const second = syncJourneyVehicleFeature(source, {
    simulationId: 'sim-1', profileId: 'driving', longitude: 31, latitude: 41,
  })

  assert.equal(second, first)
  assert.equal(source.getFeatures().length, 1)
  // Balon bu feature'ın kimliğini okur; ikinci bir kopya üretilmez.
  assert.equal(second.get('simulationId'), 'sim-1')
})

test('camera, map and connection contracts are unchanged by this slice', () => {
  // Güvenli kutu ve zum sözleşmesi yerinde.
  assert.match(VEHICLE_HOOK, /vehicleCameraTarget\(\{/)
  assert.ok(!VEHICLE_HOOK.includes('zoom'))
  assert.match(VEHICLE_HOOK, /cameraDuration = 400/)

  // İkinci bir harita ya da SignalR istemcisi yoktur.
  assert.equal((MAP_PAGE.match(/new Map\(\{/g) ?? []).length, 1)
  for (const source of [POPUP, NAVIGATION]) {
    assert.ok(!/signalr|HubConnection/i.test(source))
    assert.ok(!/from 'ol\/Map/.test(source))
  }

  // Rol/kullanıcı adı kestirmesi yoktur.
  for (const source of [POPUP, NAVIGATION, PANEL]) {
    for (const shortcut of ['isAdmin', 'roleName', 'username', 'Administrator']) {
      assert.ok(!source.includes(shortcut))
    }
  }
})
