import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  TRANSPORT_ROUTE_KIND,
  TRANSPORT_ROUTE_LAYER_CLASSNAME,
  TRANSPORT_ROUTE_PATH_KIND,
  TRANSPORT_ROUTE_PATH_LAYER_CLASSNAME,
  TRANSPORT_STOP_KIND,
  TRANSPORT_STOP_LAYER_CLASSNAME,
} from '../../src/map/transport.js'
import {
  TRANSPORT_CLICK_TARGET,
  resolveTransportClick,
} from '../../src/map/transportInteraction.js'
import { TRANSPORT_VEHICLE_KIND, TRANSPORT_VEHICLE_LAYER_CLASSNAME } from '../../src/map/transportVehicle.js'

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

const ROUTE_ID = 7
const stopRecord = { id: 71, routeId: ROUTE_ID, name: 'Batı' }

/** Gerçek haritanın yalnızca kullanılan yüzeyi: pikseldeki feature'lar. */
function fakeMap(candidates) {
  return {
    forEachFeatureAtPixel(pixel, callback) {
      for (const candidate of candidates) {
        const feature = {
          get: (key) => candidate.properties[key],
        }
        const layer = { getClassName: () => candidate.layerClassName }
        const result = callback(feature, layer)
        if (result) return result
      }
      return undefined
    },
  }
}

const stopCandidate = {
  layerClassName: TRANSPORT_STOP_LAYER_CLASSNAME,
  properties: { featureKind: TRANSPORT_STOP_KIND, transportStop: stopRecord, routeId: ROUTE_ID },
}
const pathCandidate = {
  layerClassName: TRANSPORT_ROUTE_PATH_LAYER_CLASSNAME,
  properties: { featureKind: TRANSPORT_ROUTE_PATH_KIND, routeId: ROUTE_ID },
}
const previewCandidate = {
  layerClassName: TRANSPORT_ROUTE_LAYER_CLASSNAME,
  properties: { featureKind: TRANSPORT_ROUTE_KIND, routeId: ROUTE_ID, isPreview: true },
}
const vehicleCandidate = {
  layerClassName: TRANSPORT_VEHICLE_LAYER_CLASSNAME,
  properties: { featureKind: TRANSPORT_VEHICLE_KIND, routeId: ROUTE_ID, simulationId: 'run-1' },
}

/* --- Doğrudan güzergah seçimi ------------------------------------------------ */

test('clicking a calculated route line resolves to its canonical route id', () => {
  const hit = resolveTransportClick(fakeMap([pathCandidate]), [10, 10])

  assert.equal(hit.target, TRANSPORT_CLICK_TARGET.ROUTE)
  assert.equal(hit.routeId, ROUTE_ID)
  assert.equal(hit.stop, null)
})

test('a preview line resolves to the same canonical route id as a calculated path', () => {
  /* Güzergah bayat ya da hiç hesaplanmamışsa önizleme çizgisi çizilir; seçim
     sonucu DEĞİŞMEZ, çünkü iki gösterim de aynı güzergahtır. */
  const fromPath = resolveTransportClick(fakeMap([pathCandidate]), [10, 10])
  const fromPreview = resolveTransportClick(fakeMap([previewCandidate]), [10, 10])

  assert.equal(fromPreview.target, TRANSPORT_CLICK_TARGET.ROUTE)
  assert.equal(fromPreview.routeId, fromPath.routeId)
})

/* --- Öncelik ------------------------------------------------------------------ */

test('a stop keeps priority over the route line beneath it', () => {
  const hit = resolveTransportClick(fakeMap([stopCandidate, pathCandidate]), [10, 10])

  assert.equal(hit.target, TRANSPORT_CLICK_TARGET.STOP)
  assert.deepEqual(hit.stop, stopRecord)
  assert.equal(hit.routeId, null)
})

test('the vehicle wins over both, and the chain steps aside for its own popup', () => {
  const hit = resolveTransportClick(fakeMap([vehicleCandidate, stopCandidate, pathCandidate]), [10, 10])

  assert.equal(hit.target, TRANSPORT_CLICK_TARGET.VEHICLE)
  assert.equal(hit.stop, null)
  assert.equal(hit.routeId, null)
})

test('the calculated path is preferred over the preview line', () => {
  const hit = resolveTransportClick(fakeMap([pathCandidate, previewCandidate]), [10, 10])

  assert.equal(hit.target, TRANSPORT_CLICK_TARGET.ROUTE)
  assert.equal(hit.routeId, ROUTE_ID)
})

test('empty map space still resolves to nothing, preserving deselection', () => {
  const hit = resolveTransportClick(fakeMap([]), [10, 10])

  assert.equal(hit.target, TRANSPORT_CLICK_TARGET.NONE)
  assert.equal(hit.stop, null)
  assert.equal(hit.routeId, null)
})

test('foreign features are ignored so POI and drawing clicks keep their behaviour', () => {
  const poiCandidate = {
    layerClassName: 'poi-layer',
    properties: { featureKind: 'poi', poiId: 3 },
  }
  const drawingCandidate = {
    layerClassName: 'drawing-layer',
    properties: { featureKind: 'drawing', id: 9 },
  }

  const hit = resolveTransportClick(fakeMap([poiCandidate, drawingCandidate]), [10, 10])

  assert.equal(hit.target, TRANSPORT_CLICK_TARGET.NONE)
})

/* --- Gizlenen güzergahlar ----------------------------------------------------- */

test('a hidden route cannot be selected by clicking its line', () => {
  const hit = resolveTransportClick(fakeMap([pathCandidate]), [10, 10], {
    isRouteVisible: (routeId) => routeId !== ROUTE_ID,
  })

  assert.equal(hit.target, TRANSPORT_CLICK_TARGET.NONE)
  assert.equal(hit.routeId, null)
})

test('hiding a route does not disable stop selection on it', () => {
  const hit = resolveTransportClick(fakeMap([stopCandidate, pathCandidate]), [10, 10], {
    isRouteVisible: () => false,
  })

  assert.equal(hit.target, TRANSPORT_CLICK_TARGET.STOP)
})

test('a missing map or pixel resolves to nothing instead of throwing', () => {
  assert.equal(resolveTransportClick(null, [1, 1]).target, TRANSPORT_CLICK_TARGET.NONE)
  assert.equal(resolveTransportClick(fakeMap([pathCandidate]), null).target, TRANSPORT_CLICK_TARGET.NONE)
})

/* --- Mevcut durum ve mimari korunur ------------------------------------------ */

test('route clicks reuse the existing selection state and open the shared workspace', () => {
  const mapPage = read('../../src/pages/MapPage.jsx')

  // Yeni bir "seçili rota" durumu YOK: mevcut state güncellenir.
  assert.match(mapPage, /const handleTransportRouteSelected = useCallback\(\(routeId\) => \{/)
  assert.match(mapPage, /setSelectedTransportRouteId\(next\)/)
  assert.match(mapPage, /onSelectRoute: handleTransportRouteSelected/)
  assert.match(mapPage, /isRouteVisible: isTransportRouteSelectable/)
  assert.equal((mapPage.match(/selectedTransportRouteId, setSelectedTransportRouteId/g) ?? []).length, 1)

  /* Faz 2: aynı seçim artık AYRI bir kart değil, YOLCULUK çalışma alanını
     paylaşılan bağlamda açar. Sol alttaki bağımsız kart kaldırıldı. */
  assert.match(mapPage, /openJourneyWorkspaceWith\(JOURNEY_PRODUCTS\.SHARED\)/)
  assert.ok(!mapPage.includes('<TransportTrackingControls'))

  /* Tıklama bir SEÇİMDİR, bir yaşam döngüsü komutu DEĞİL: işleyicide
     başlatma, takip ve kamera talebi YOKTUR. */
  const handler = mapPage.slice(
    mapPage.indexOf('const handleTransportRouteSelected'),
    mapPage.indexOf('const isTransportRouteSelectable'),
  )
  assert.ok(!handler.includes('simulation.start'))
  assert.ok(!handler.includes('simulation.follow'))
  assert.ok(!handler.includes('setFollowing'))
  assert.ok(!handler.includes('mapView.'))
  assert.ok(!handler.includes('focusRoute'))
})

test('no duplicate transport layer, map or SignalR client is introduced', () => {
  const mapPage = read('../../src/pages/MapPage.jsx')
  const hook = read('../../src/hooks/useTransportStopInteraction.js')

  assert.equal((mapPage.match(/useTransportLayer\(/g) ?? []).length, 1)
  assert.equal((mapPage.match(/new Map\(\{/g) ?? []).length, 1)
  assert.ok(!mapPage.includes('createTransportSimulationClient'))
  assert.ok(!mapPage.includes('@microsoft/signalr'))

  // Tıklama zinciri tek dinleyicidir; ikinci bir singleclick eklenmedi.
  assert.equal((hook.match(/map\.on\('singleclick'/g) ?? []).length, 1)
  assert.ok(!hook.includes('createTransportLayers'))
})

test('the click chain introduces no role-name or admin shortcut', () => {
  for (const relative of [
    '../../src/map/transportInteraction.js',
    '../../src/hooks/useTransportStopInteraction.js',
  ]) {
    assert.ok(!/Administrator|roleName|isAdmin/.test(read(relative)), `${relative} exposed a role shortcut`)
  }
})
