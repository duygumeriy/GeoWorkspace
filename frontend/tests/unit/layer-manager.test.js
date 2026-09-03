import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import Feature from 'ol/Feature.js'
import Point from 'ol/geom/Point.js'
import { createLayerStyleFunction } from '../../src/map/featureStyle.js'
import { buildPoiCategoryTree, drawingGroups, filterPoiCategoryTree, matchesLayerSearch, recordRows } from '../../src/map/layerManager.js'
import { categoryIndex, isDescendantOf } from '../../src/map/locationAnalysis.js'
import { drawingIdentity, visibilityState } from '../../src/map/layerVisibility.js'
import { createPoiLayer, poiToFeature } from '../../src/map/poi.js'
import { createTransportLayers, transportFeatures } from '../../src/map/transport.js'
import { resolveTransportClick, TRANSPORT_CLICK_TARGET } from '../../src/map/transportInteraction.js'

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')
const categories = [
  { id: 1, name: 'Sağlık', parentId: null },
  { id: 2, name: 'Hastane', parentId: 1 },
  { id: 3, name: 'Eczane', parentId: 1 },
  { id: 4, name: 'Market', parentId: null },
]
const pois = [
  { id: 10, name: 'Şehir Hastanesi', categoryId: 2, longitude: 32.8, latitude: 39.9 },
  { id: 11, name: 'Merkez Eczanesi', categoryId: 3, longitude: 32.9, latitude: 40 },
  { id: 12, name: 'BİM', categoryId: 4, longitude: 33, latitude: 40.1 },
  { id: 13, name: 'Kategorisiz', categoryId: 999, longitude: 33.1, latitude: 40.2 },
]
const byId = categoryIndex(categories)
const descendant = (candidate, ancestor) => isDescendantOf(byId, candidate, ancestor)

test('POI rendering predicate hides only the selected canonical record', () => {
  const hidden = new Set([10])
  const layer = createPoiLayer(() => null, () => false, () => null, () => 1, (id) => !hidden.has(id)).layer
  assert.equal(layer.getStyleFunction()(poiToFeature(pois[0])), undefined)
  assert.ok(layer.getStyleFunction()(poiToFeature(pois[1])))
})

test('hidden POI has no style and therefore no ordinary OpenLayers hit instruction', () => {
  const layer = createPoiLayer(() => 10, () => true, () => null, () => 1, () => false).layer
  assert.equal(layer.getStyleFunction()(poiToFeature(pois[0])), undefined)
  const interaction = read('../../src/hooks/usePoiInteraction.js')
  assert.match(interaction, /isPoiVisible\(feature\.get\('poiId'\)\)/)
})

test('nested category scope derives state from every descendant POI', () => {
  const tree = buildPoiCategoryTree(pois, categories, new Set([11]), descendant)
  const health = tree.find((node) => node.id === 1)
  assert.deepEqual(health.poiIds, [10, 11])
  assert.equal(health.state.indeterminate, true)
  assert.deepEqual(health.children.map((node) => node.id), [2, 3])
})

test('category operations retain canonical scope after search filtering', () => {
  const tree = buildPoiCategoryTree(pois, categories, new Set(), descendant)
  const filtered = filterPoiCategoryTree(tree, 'şehir')
  const health = filtered.find((node) => node.id === 1)
  assert.deepEqual(health.poiIds, [10, 11])
  assert.equal(health.count, 2)
  assert.deepEqual(health.children[0].directPois.map((poi) => poi.id), [10])
})

test('category sibling remains isolated and unknown-category POIs stay reachable as Diğer', () => {
  const tree = buildPoiCategoryTree(pois, categories, new Set([10, 11]), descendant)
  assert.equal(tree.find((node) => node.id === 4).state.checked, true)
  const unknown = tree.find((node) => node.key === 'unknown')
  assert.equal(unknown.label, 'Diğer')
  assert.deepEqual(unknown.poiIds, [13])
})

test('Turkish-aware search is presentation-only', () => {
  const hidden = new Set([10, 12])
  assert.equal(matchesLayerSearch('BİM', 'bim'), true)
  const rows = recordRows(pois, hidden).filter((row) => matchesLayerSearch(row.name, 'hastane'))
  assert.deepEqual(rows.map((row) => row.id), [10])
  assert.deepEqual([...hidden], [10, 12])
})

test('stop parent tri-state and row visibility derive without changing route membership', () => {
  const stops = [{ id: 1, routeId: 7 }, { id: 2, routeId: 8 }]
  const rows = recordRows(stops, new Set([1]))
  assert.equal(visibilityState(stops.map((stop) => stop.id), new Set([1])).indeterminate, true)
  assert.deepEqual(rows.map((stop) => stop.routeId), [7, 8])
  assert.deepEqual(rows.map((stop) => stop.visible), [false, true])
})

test('hidden stop has no render style even while selected', () => {
  const routes = [{ id: 7, name: 'Hat', colorHex: '#123456' }]
  const stops = [{ id: 1, routeId: 7, name: 'Durak', longitude: 32.8, latitude: 39.9, sequenceOrder: 1 }]
  const feature = transportFeatures(routes, stops).stopFeatures[0]
  const layers = createTransportLayers(() => 1, () => null, () => true, () => true, () => true, () => null, () => false)
  assert.equal(layers.stopLayer.getStyleFunction()(feature), undefined)
})

test('hidden stop is rejected explicitly by transport hit resolution', () => {
  const stopFeature = { get: (key) => ({ featureKind: 'transport-stop', stopId: 1, transportStop: { id: 1 } })[key] }
  const layer = { getClassName: () => 'transport-stop-layer' }
  const map = { forEachFeatureAtPixel: (_pixel, callback) => callback(stopFeature, layer) }
  assert.equal(resolveTransportClick(map, [1, 1], { isStopVisible: () => false }).target, TRANSPORT_CLICK_TARGET.NONE)
})

test('drawing model uses composite identities and derives subgroup/global state', () => {
  const records = [
    { type: 'point', databaseId: 1, name: 'Nokta' },
    { type: 'line', databaseId: 1, name: 'Hat' },
    { type: 'polygon', databaseId: 1, name: 'Alan' },
  ]
  const groups = drawingGroups(records, new Set(['point:1']))
  assert.deepEqual(groups.map((group) => group.ids[0]), ['point:1', 'line:1', 'polygon:1'])
  assert.equal(groups[0].state.checked, false)
  assert.equal(groups[1].state.checked, true)
})

test('hidden drawing returns no style or hit instruction while selection identity survives', () => {
  const selectedKeys = new Set(['feat-1'])
  const feature = new Feature({ geometry: new Point([0, 0]) })
  feature.setId('feat-1')
  feature.set('drawingType', 'point')
  feature.set('databaseId', 1)
  feature.set('style', {})
  const style = createLayerStyleFunction(() => ({ selectedKeys, visibility: {}, hiddenDrawingIds: new Set(['point:1']) }))
  assert.equal(style(feature), undefined)
  assert.deepEqual([...selectedKeys], ['feat-1'])
  assert.equal(drawingIdentity('line', 1), 'line:1')
})

test('panel remains presentation-only and uses native indeterminate checkbox semantics', () => {
  const panel = read('../../src/components/map/LayersPanel.jsx')
  assert.match(panel, /<MapSheet/)
  assert.match(panel, /type="checkbox"/)
  assert.match(panel, /ref\.current\.indeterminate/)
  assert.match(panel, /aria-expanded=/)
  assert.ok(!/new Map\(|VectorLayer|VectorSource|fetch\(|authFetch|deletePoi|deleteDrawing/.test(panel))
  assert.ok(!/Administrator|roleName|username/.test(panel))
})

test('expand and collapse state is presentation-only', () => {
  const panel = read('../../src/components/map/LayersPanel.jsx')
  const toggle = panel.slice(panel.indexOf('const toggleExpanded'), panel.indexOf('const poiCategories'))
  assert.match(toggle, /setExpanded/)
  assert.ok(!/onSet.*Visibility|onTogglePoi|onToggleDrawing|onToggleTransport/.test(toggle))
})

test('route master visibility and child preferences remain separate', () => {
  const page = read('../../src/pages/MapPage.jsx')
  const panel = read('../../src/components/map/LayersPanel.jsx')
  assert.match(page, /const \[transportRoutesVisible, setTransportRoutesVisible\] = useState\(true\)/)
  assert.match(page, /const \[hiddenTransportRouteIds, setHiddenTransportRouteIds\]/)
  assert.match(panel, /Güzergâh katmanını göster/)
  assert.match(panel, /state=\{transport\.routeState\}/)
})

test('raster fallback reuses existing suspension paths and never adds per-record layers', () => {
  const page = read('../../src/pages/MapPage.jsx')
  const poiHook = read('../../src/hooks/usePoiPresentationLayer.js')
  const drawingHook = read('../../src/hooks/useMapPresentationLayer.js')
  assert.match(page, /suspended: layerVisibility\.hiddenPoiIds\.size > 0/)
  assert.match(page, /hiddenDrawingIds.*split\(':'.*\)/s)
  assert.match(poiHook, /!suspendedRef\.current/)
  assert.match(drawingHook, /suspendedTypes/)
  assert.ok(!/hidden(Poi|Drawing).*new (VectorLayer|ImageLayer)/s.test(page))
})

test('responsive panel has one MapSheet scroll owner and no large fixed minimum width', () => {
  const panel = read('../../src/components/map/LayersPanel.jsx')
  const css = read('../../src/components/map/LayersPanel.css')
  const sheetCss = read('../../src/components/map/MapSheet.css')
  assert.equal((panel.match(/<MapSheet/g) ?? []).length, 1)
  assert.match(sheetCss, /\.map-sheet-body[\s\S]*overflow-y: auto/)
  assert.match(css, /@media \(max-width: 640px\)/)
  assert.ok(!/min-width:\s*[4-9]\d\dpx/.test(css))
  assert.ok(!/overflow-x:\s*(auto|scroll|hidden)/.test(css))
})
