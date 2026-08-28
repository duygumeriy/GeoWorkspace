import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAP_CONTEXTS,
  POI_CONTEXTS,
  SELECTION_CONTEXTS,
  SIDEBAR_CONTEXTS,
  createMapContextCoordinator,
  sharesState,
} from '../../src/map/mapContexts.js'

/**
 * Harita bağlam koordinatörü.
 *
 * Ölçülen şey GENEL kuraldır, panel çiftleri değil: "yeni bağlam devralır,
 * öncekiler bırakır". Aşağıdaki senaryolar (çizim → POI, POI → çizim, ısı
 * haritası → çizim …) o tek kuralın örnekleridir; hiçbiri koordinatöre yeni
 * bir özel durum eklemez.
 *
 * `retired`, hangi bağlamın hangi bağlama devrederken bırakıldığını kaydeder;
 * gerçek MapPage tablosunun yaptığı işin sınanabilir karşılığıdır.
 */
function coordinatorWithLog(retirerOverrides = {}) {
  const retired = []
  const retirers = {}

  for (const id of Object.values(MAP_CONTEXTS)) {
    retirers[id] = (next) => {
      retired.push({ id, next })
      retirerOverrides[id]?.(next)
    }
  }

  const rendered = []
  const coordinator = createMapContextCoordinator({
    getRetirer: (id) => retirers[id],
    onChange: (active) => rendered.push(active),
  })

  return { coordinator, retired, rendered }
}

/* --- Tek sahip ---------------------------------------------------------------- */

test('at most one primary context owns the UI at a time', () => {
  const { coordinator } = coordinatorWithLog()

  coordinator.activate(MAP_CONTEXTS.drawingInfo)
  assert.equal(coordinator.active, MAP_CONTEXTS.drawingInfo)

  coordinator.activate(MAP_CONTEXTS.poiInfo)
  // Tek bir `active` vardır: ikisinin aynı anda açık olması TEMSİL EDİLEMEZ.
  assert.equal(coordinator.active, MAP_CONTEXTS.poiInfo)
  assert.equal(coordinator.isActive(MAP_CONTEXTS.drawingInfo), false)
})

test('activating the same context again changes nothing', () => {
  const { coordinator, retired } = coordinatorWithLog()

  coordinator.activate(MAP_CONTEXTS.poiInfo)
  coordinator.activate(MAP_CONTEXTS.poiInfo)

  // Kendi kendini emekliye ayırmak açık bir paneli sıfırlardı.
  assert.deepEqual(retired, [])
})

/* --- Geçiş senaryoları (hepsi AYNI mekanizma) --------------------------------- */

const TRANSITIONS = [
  ['Drawing Info -> POI', MAP_CONTEXTS.drawingInfo, MAP_CONTEXTS.poiInfo],
  ['POI Info -> drawing', MAP_CONTEXTS.poiInfo, MAP_CONTEXTS.drawingInfo],
  ['Heatmap controls -> drawing', MAP_CONTEXTS.heatmap, MAP_CONTEXTS.drawingInfo],
  ['Heatmap controls -> POI', MAP_CONTEXTS.heatmap, MAP_CONTEXTS.poiInfo],
  ['Drawing Info -> heatmap controls', MAP_CONTEXTS.drawingInfo, MAP_CONTEXTS.heatmap],
  ['POI Info -> heatmap controls', MAP_CONTEXTS.poiInfo, MAP_CONTEXTS.heatmap],
  ['Drawing Info -> POI Ekle', MAP_CONTEXTS.drawingInfo, MAP_CONTEXTS.poiCreate],
  ['POI Info -> inventory analysis', MAP_CONTEXTS.poiInfo, MAP_CONTEXTS.inventory],
  ['Inventory result -> drawing', MAP_CONTEXTS.inventory, MAP_CONTEXTS.drawingInfo],
  ['POI Info -> POI Düzenle', MAP_CONTEXTS.poiInfo, MAP_CONTEXTS.poiEdit],
]

for (const [name, from, to] of TRANSITIONS) {
  test(`${name}: the previous context retires and only the new one remains`, () => {
    const { coordinator, retired } = coordinatorWithLog()

    coordinator.activate(from)
    coordinator.activate(to)

    assert.equal(coordinator.active, to)
    assert.deepEqual(retired, [{ id: from, next: to }])
  })
}

/* --- Kapatma ------------------------------------------------------------------ */

test('closing by id ignores a stale request after another context took over', () => {
  const { coordinator, retired } = coordinatorWithLog()

  coordinator.activate(MAP_CONTEXTS.poiInfo)
  coordinator.activate(MAP_CONTEXTS.drawingInfo)
  retired.length = 0

  // Boş haritaya tıklamanın geç kalan "POI panelini kapat" isteği.
  coordinator.close(MAP_CONTEXTS.poiInfo)

  assert.equal(coordinator.active, MAP_CONTEXTS.drawingInfo)
  assert.deepEqual(retired, [])
})

test('closing without an id drops whatever is open', () => {
  const { coordinator, retired } = coordinatorWithLog()

  coordinator.activate(MAP_CONTEXTS.layers)
  coordinator.close()

  assert.equal(coordinator.active, null)
  assert.deepEqual(retired, [{ id: MAP_CONTEXTS.layers, next: null }])
})

/* --- Durum paylaşan bağlamlar ------------------------------------------------- */

test('contexts that share the selection do not drop it when handing over', () => {
  /* Kural bir ÖZELLİK beyanıdır, panel çiftlerine özel bir istisna değil:
     stil paneli seçili kaydı düzenler, dolayısıyla devralırken seçim kalır. */
  assert.equal(sharesState(SELECTION_CONTEXTS, MAP_CONTEXTS.styleEditor), true)
  assert.equal(sharesState(SELECTION_CONTEXTS, MAP_CONTEXTS.multiSelection), true)
  assert.equal(sharesState(SELECTION_CONTEXTS, MAP_CONTEXTS.poiInfo), false)
  assert.equal(sharesState(SELECTION_CONTEXTS, null), false)

  // POI düzenleme de bilgi panelindeki KAYDI düzenler.
  assert.equal(sharesState(POI_CONTEXTS, MAP_CONTEXTS.poiEdit), true)
  assert.equal(sharesState(POI_CONTEXTS, MAP_CONTEXTS.inventory), false)
})

test('a retirer sees which context is taking over, so shared state can survive', () => {
  let selectionCleared = 0
  const { coordinator } = coordinatorWithLog({
    [MAP_CONTEXTS.drawingInfo]: (next) => {
      if (!sharesState(SELECTION_CONTEXTS, next)) selectionCleared += 1
    },
  })

  coordinator.activate(MAP_CONTEXTS.drawingInfo)
  coordinator.activate(MAP_CONTEXTS.styleEditor)
  assert.equal(selectionCleared, 0)

  coordinator.activate(MAP_CONTEXTS.drawingInfo)
  coordinator.activate(MAP_CONTEXTS.poiInfo)
  assert.equal(selectionCleared, 1)
})

/* --- Panel görünürlüğü ≠ katman görünürlüğü ---------------------------------- */

test('retiring a context touches panels only, never the map layers', () => {
  /* Isı haritası en açık örnektir: paneli kapanır, KATMANI kalır. Katman
     durumu (`heatmapEnabled`) koordinatörün bildiği bir şey değildir ve
     emeklilik tablosunda ısı haritasının bırakacağı hiçbir şey yoktur. */
  let heatmapLayerEnabled = true
  const { coordinator } = coordinatorWithLog({
    [MAP_CONTEXTS.heatmap]: () => {
      /* Bilerek boş: burada `heatmapLayerEnabled = false` yazmak, panelin
         kapanmasını katmanın kapanması sanmak olurdu. */
    },
  })

  coordinator.activate(MAP_CONTEXTS.heatmap)
  coordinator.activate(MAP_CONTEXTS.drawingInfo)

  assert.equal(coordinator.active, MAP_CONTEXTS.drawingInfo)
  assert.equal(heatmapLayerEnabled, true)
})

/* --- Kapsam ------------------------------------------------------------------- */

test('the coordinator owns map context only — no app navigation', () => {
  const ids = Object.values(MAP_CONTEXTS)

  // Tema, üst gezinme ve ana menü bu mekanizmanın konusu DEĞİLDİR.
  assert.equal(ids.includes('theme'), false)
  assert.equal(ids.includes('navigation'), false)

  /* Kenar çubuğu panelleri, kimliklerini kenar çubuğunun `id` değerlerinden
     alır. Liste TAM olarak sabitlenir: yeni bir panelin koordinatöre katılması
     bilinçli bir karar olmalıdır ve buradan geçmeden eklenememelidir. */
  assert.deepEqual(
    [...SIDEBAR_CONTEXTS],
    ['drawings', 'myPois', 'myStops', 'layers', 'trash', 'heatmap', 'locationAnalysis', 'settings', 'about'],
  )
})
