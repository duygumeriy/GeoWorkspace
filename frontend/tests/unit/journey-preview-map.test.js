import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fromLonLat } from 'ol/proj.js'
import {
  JOURNEY_PREVIEW_KIND,
  JOURNEY_PREVIEW_LAYER_CLASSNAME,
  createJourneyPreviewLayer,
  journeyFitPadding,
  journeyPreviewFeature,
  syncJourneyPreviewFeature,
} from '../../src/map/journeyPreviewLayer.js'
import {
  TRANSPORT_ROUTE_PATH_LAYER_CLASSNAME,
  TRANSPORT_STOP_KIND,
  TRANSPORT_STOP_LAYER_CLASSNAME,
} from '../../src/map/transport.js'
import { POI_FEATURE_KIND, POI_LAYER_CLASSNAME } from '../../src/map/poi.js'
import { resolveJourneyPick } from '../../src/map/journeyInteraction.js'
import { WAYPOINT_SOURCES } from '../../src/map/journeyPlanning.js'

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

const LINE = 'LINESTRING(36.33 41.28,36.34 41.27)'

/* --- WKT / projeksiyon ------------------------------------------------------- */

test('backend WKT is read as EPSG:4326 and projected into the map projection', () => {
  const feature = journeyPreviewFeature(LINE)
  assert.ok(feature)

  const [first] = feature.getGeometry().getCoordinates()
  const expected = fromLonLat([36.33, 41.28])

  // Ham derece DEĞİL, harita projeksiyonundaki metre.
  assert.ok(Math.abs(first[0] - expected[0]) < 0.5)
  assert.ok(Math.abs(first[1] - expected[1]) < 0.5)
  assert.ok(Math.abs(first[0]) > 1000)

  assert.equal(feature.get('featureKind'), JOURNEY_PREVIEW_KIND)
})

test('malformed or empty geometry yields null rather than throwing', () => {
  for (const value of ['', '   ', 'NOT-WKT', 'LINESTRING(', null, undefined, 42]) {
    assert.equal(journeyPreviewFeature(value), null)
  }
})

/* --- Kaynak eşitleme --------------------------------------------------------- */

test('a new preview replaces the previous one instead of stacking features', () => {
  const { source } = createJourneyPreviewLayer()

  syncJourneyPreviewFeature(source, LINE)
  assert.equal(source.getFeatures().length, 1)

  syncJourneyPreviewFeature(source, 'LINESTRING(30 40,31 41,32 42)')
  // Tek bir önizleme yaşar; React yeniden çizdiğinde ikinci çizgi oluşmaz.
  assert.equal(source.getFeatures().length, 1)
  assert.equal(source.getFeatures()[0].getGeometry().getCoordinates().length, 3)
})

test('clearing the preview removes the geometry from the map', () => {
  const { source } = createJourneyPreviewLayer()
  syncJourneyPreviewFeature(source, LINE)

  assert.equal(syncJourneyPreviewFeature(source, null), null)
  assert.equal(source.getFeatures().length, 0)

  // Bozuk gövde de kaynağı temiz bırakır.
  syncJourneyPreviewFeature(source, LINE)
  syncJourneyPreviewFeature(source, 'garbage')
  assert.equal(source.getFeatures().length, 0)
})

test('the preview owns a dedicated layer rather than the persisted transport sources', () => {
  const { layer } = createJourneyPreviewLayer()

  assert.equal(layer.getClassName(), JOURNEY_PREVIEW_LAYER_CLASSNAME)
  assert.notEqual(JOURNEY_PREVIEW_LAYER_CLASSNAME, TRANSPORT_ROUTE_PATH_LAYER_CLASSNAME)

  const source = read('../../src/hooks/useJourneyPreviewLayer.js')
  // Kalıcı ulaşım kaynaklarına yazılmaz.
  assert.ok(!source.includes('pathSource'))
  assert.ok(!source.includes('routeSource'))
})

/* --- Kamera ------------------------------------------------------------------ */

test('fit padding leaves room for the left panel and switches on compact layouts', () => {
  const [, , , left] = journeyFitPadding({ panelWidth: 340 })
  assert.ok(left > 340)

  const [, , bottom, compactLeft] = journeyFitPadding({ panelWidth: 340, compact: true })
  // Dar ekranda panel alttadır: soldan değil alttan yer açılır.
  assert.ok(bottom > compactLeft)
})

test('the camera fits once per new successful preview, not on every rerender', () => {
  const source = read('../../src/hooks/useJourneyPreviewLayer.js')

  // Uyum bir jetona bağlıdır ve jeton yalnızca yeni bir başarılı önizlemede artar.
  assert.ok(source.includes('fittedTokenRef'))
  assert.ok(source.includes('previewToken === fittedTokenRef.current'))

  // Panel genişliği ref üzerinden okunur: değişmesi tek başına uyum tetiklemez.
  assert.ok(source.includes('paddingRef'))
  assert.ok(!/\}, \[[^\]]*panelWidth[^\]]*\]\)/.test(source))

  const planner = read('../../src/hooks/useJourneyPlanner.js')
  assert.ok(planner.includes('setPreviewToken((token) => token + 1)'))
})

/* --- Harita ile nokta seçimi ------------------------------------------------- */

function fakeMap(candidates) {
  return {
    forEachFeatureAtPixel(pixel, callback) {
      for (const candidate of candidates) {
        const feature = { get: (key) => candidate.properties[key] }
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
  properties: {
    featureKind: TRANSPORT_STOP_KIND,
    transportStop: { id: 71, routeId: 7, name: 'Batı', routeName: 'Hat 1' },
    routeId: 7,
  },
}

const poiCandidate = {
  layerClassName: POI_LAYER_CLASSNAME,
  properties: { featureKind: POI_FEATURE_KIND, poiId: 500, name: 'Kütüphane' },
}

test('picking resolves a stop to its canonical id, never from its label', () => {
  const reference = resolveJourneyPick(fakeMap([stopCandidate]), [10, 10])

  assert.equal(reference.source, WAYPOINT_SOURCES.STOP)
  assert.equal(reference.id, 71)
  assert.equal(reference.label, 'Batı')
})

test('a POI is only pickable when POI usage is allowed', () => {
  assert.equal(resolveJourneyPick(fakeMap([poiCandidate]), [10, 10]), null)

  const reference = resolveJourneyPick(fakeMap([poiCandidate]), [10, 10], { allowPoi: true })
  assert.equal(reference.source, WAYPOINT_SOURCES.POI)
  assert.equal(reference.id, 500)
})

test('a hidden route makes its stop unpickable', () => {
  const reference = resolveJourneyPick(fakeMap([stopCandidate]), [10, 10], {
    isStopSelectable: () => false,
  })
  assert.equal(reference, null)
})

test('a stop wins over a POI underneath it, matching the existing precedence', () => {
  const reference = resolveJourneyPick(fakeMap([stopCandidate, poiCandidate]), [10, 10], { allowPoi: true })
  assert.equal(reference.source, WAYPOINT_SOURCES.STOP)
})

test('an empty pixel assigns nothing', () => {
  assert.equal(resolveJourneyPick(fakeMap([]), [10, 10], { allowPoi: true }), null)
  assert.equal(resolveJourneyPick(null, [10, 10]), null)
})

test('picking only listens while a slot is armed and restores normal behaviour after', () => {
  const source = read('../../src/hooks/useJourneyWaypointPicking.js')

  // Silahlı değilken hiçbir dinleyici kurulmaz.
  assert.ok(source.includes('if (!map || !active) return undefined'))
  // Ve söküldüğünde işleyici ile imleç geri alınır.
  assert.ok(source.includes("map.un('singleclick', handleClick)"))
  assert.ok(source.includes("element.style.cursor = ''"))
})
