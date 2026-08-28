import assert from 'node:assert/strict'
import test from 'node:test'
import { toLonLat } from 'ol/proj.js'
import {
  MAX_ROUTE_ARROWS,
  MIN_ROUTE_ARROWS,
  TRANSPORT_ROUTE_KIND,
  TRANSPORT_ROUTE_PATH_KIND,
  createTransportLayers,
  routeArrowCount,
  routeArrowPlacements,
  transportFeatures,
} from '../../src/map/transport.js'
import {
  formatRouteDistance,
  formatRouteDuration,
  formatRouteGeneratedAt,
  transportPathStatus,
  transportRouteSummary,
} from '../../src/map/transportPathPresentation.js'

const routes = [
  { id: 7, name: 'Merkez Hattı', colorHex: '#E11D48', isActive: true },
  { id: 8, name: 'Sahil Hattı', colorHex: '#0284C7', isActive: true },
]
const stops = [
  { id: 71, routeId: 7, name: 'Batı', longitude: 29, latitude: 41, sequenceOrder: 1 },
  { id: 72, routeId: 7, name: 'Doğu', longitude: 30, latitude: 41, sequenceOrder: 2 },
  { id: 81, routeId: 8, name: 'Güney', longitude: 29, latitude: 40, sequenceOrder: 1 },
  { id: 82, routeId: 8, name: 'Kuzey', longitude: 29, latitude: 41, sequenceOrder: 2 },
]
const currentPath = {
  id: 17,
  routeId: 7,
  geometryWkt: 'LINESTRING (29 41, 29.5 41.1, 30 41)',
  distanceMeters: 12400,
  durationSeconds: 830,
  generatedAt: '2026-08-27T12:00:00Z',
  isStale: false,
  lastFailureReason: null,
}

test('a current persisted WKT path is authoritative and transformed from 4326 to 3857', () => {
  const { routeFeatures, pathFeatures } = transportFeatures(routes, stops, [currentPath])
  assert.equal(pathFeatures.length, 1)
  assert.equal(routeFeatures.some((feature) => feature.get('routeId') === 7), false)
  const mapCoordinate = pathFeatures[0].getGeometry().getFirstCoordinate()
  assert.ok(Math.abs(mapCoordinate[0]) > 1000)
  const lonLat = toLonLat(mapCoordinate)
  assert.ok(Math.abs(lonLat[0] - 29) < 1e-9)
  assert.ok(Math.abs(lonLat[1] - 41) < 1e-9)
})

test('a path feature carries stable route and journey metadata', () => {
  const feature = transportFeatures(routes, stops, [currentPath]).pathFeatures[0]
  assert.equal(feature.get('type'), TRANSPORT_ROUTE_PATH_KIND)
  assert.equal(feature.get('featureKind'), TRANSPORT_ROUTE_PATH_KIND)
  assert.equal(feature.get('routeId'), 7)
  assert.equal(feature.get('routeName'), 'Merkez Hattı')
  assert.equal(feature.get('colorHex'), '#E11D48')
  assert.equal(feature.get('distanceMeters'), 12400)
  assert.equal(feature.get('durationSeconds'), 830)
  assert.equal(feature.get('generatedAt'), currentPath.generatedAt)
})

test('stale persisted geometry is suppressed and replaced by an explicit preview', () => {
  const stale = { ...currentPath, isStale: true, lastFailureReason: 'Rota servisi kullanılamıyor.' }
  const { routeFeatures, pathFeatures } = transportFeatures(routes, stops, [stale])
  assert.equal(pathFeatures.length, 0)
  const preview = routeFeatures.find((feature) => feature.get('routeId') === 7)
  assert.equal(preview.get('featureKind'), TRANSPORT_ROUTE_KIND)
  assert.equal(preview.get('isPreview'), true)
  assert.equal(preview.get('previewReason'), 'stale')
})

test('a route without a path keeps the ordered direct-line preview', () => {
  const { routeFeatures, pathFeatures } = transportFeatures([routes[0]], stops, [])
  assert.equal(pathFeatures.length, 0)
  assert.equal(routeFeatures.length, 1)
  assert.equal(routeFeatures[0].get('previewReason'), 'not-generated')
  const longitudes = routeFeatures[0].getGeometry().getCoordinates().map((coordinate) => toLonLat(coordinate)[0])
  assert.ok(Math.abs(longitudes[0] - 29) < 1e-9)
  assert.ok(Math.abs(longitudes[1] - 30) < 1e-9)
})

test('the persisted route line uses the configured route color', () => {
  const feature = transportFeatures(routes, stops, [currentPath]).pathFeatures[0]
  const { pathLayer } = createTransportLayers()
  const styles = pathLayer.getStyleFunction()(feature, 1)
  assert.equal(styles[0].getStroke().getColor(), '#E11D48')
})

test('arrows are generated for a current path and follow eastbound LineString direction', () => {
  const feature = transportFeatures(routes, stops, [currentPath]).pathFeatures[0]
  const arrows = routeArrowPlacements(feature.getGeometry())
  assert.ok(arrows.length >= MIN_ROUTE_ARROWS)
  assert.ok(arrows.every((arrow) => Number.isFinite(arrow.rotation)))
  // An eastbound RegularShape starts upward and rotates clockwise by PI/2.
  assert.ok(Math.abs(arrows[0].rotation - Math.PI / 2) < 0.4)
})

test('arrow density follows resolution with a hard 3–28 bound', () => {
  assert.equal(routeArrowCount(0), 0)
  assert.equal(routeArrowCount(1), MIN_ROUTE_ARROWS)
  assert.equal(routeArrowCount(1_000_000), MAX_ROUTE_ARROWS)
  assert.equal(routeArrowCount(9_000, 10), 10)
  assert.equal(routeArrowCount(9_000, 20), 5)
})

test('low zoom keeps a sparse minimum without hiding the route line', () => {
  const feature = transportFeatures(routes, stops, [currentPath]).pathFeatures[0]
  const { pathLayer } = createTransportLayers()
  const styles = pathLayer.getStyleFunction()(feature, 1000)
  assert.equal(styles.length, MIN_ROUTE_ARROWS + 1)
  assert.ok(styles[0].getStroke())
})

test('stop markers expose sequence, terminal shape, and selected halo state', () => {
  const features = transportFeatures(routes, stops, [currentPath])
  const first = features.stopFeatures.find((feature) => feature.get('stopId') === 71)
  const last = features.stopFeatures.find((feature) => feature.get('stopId') === 72)
  assert.equal(first.get('sequenceOrder'), 1)
  assert.equal(first.get('terminal'), 'start')
  assert.equal(last.get('terminal'), 'end')

  const normalLayer = createTransportLayers()
  const normalStyles = normalLayer.stopLayer.getStyleFunction()(first)
  assert.equal(normalStyles.at(-1).getText().getText(), '1')

  const selectedLayer = createTransportLayers(() => 71)
  const selectedStyles = selectedLayer.stopLayer.getStyleFunction()(first)
  assert.equal(selectedStyles.length, normalStyles.length + 1)
  assert.equal(selectedStyles.at(-1).getText().getText(), '1')
})

test('reordered stop data immediately changes marker sequence and endpoints', () => {
  const reordered = stops.map((stop) => stop.routeId === 7
    ? { ...stop, sequenceOrder: stop.id === 71 ? 2 : 1 }
    : stop)
  const features = transportFeatures(routes, reordered, [currentPath]).stopFeatures
  assert.equal(features.find((feature) => feature.get('stopId') === 72).get('terminal'), 'start')
  assert.equal(features.find((feature) => feature.get('stopId') === 71).get('sequenceOrder'), 2)
})

test('master route visibility hides paths and previews but leaves stop styling independent', () => {
  const features = transportFeatures(routes, stops, [currentPath])
  const { pathLayer, routeLayer, stopLayer } = createTransportLayers(
    () => null, () => null, () => false, () => true,
  )
  assert.equal(pathLayer.getStyleFunction()(features.pathFeatures[0], 1), undefined)
  assert.equal(routeLayer.getStyleFunction()(features.routeFeatures[0], 1), undefined)
  assert.ok(stopLayer.getStyleFunction()(features.stopFeatures[0], 1))
})

test('a child route toggle hides only that route and all of its arrows', () => {
  const features = transportFeatures(routes, stops, [currentPath])
  const { pathLayer, routeLayer } = createTransportLayers(
    () => null, () => null, () => true, () => true, (routeId) => routeId !== 7,
  )
  assert.equal(pathLayer.getStyleFunction()(features.pathFeatures[0], 1), undefined)
  const otherPreview = features.routeFeatures.find((feature) => feature.get('routeId') === 8)
  assert.ok(routeLayer.getStyleFunction()(otherPreview, 1))
})

test('stale routes cannot produce current-path arrows', () => {
  const stale = { ...currentPath, isStale: true }
  assert.equal(transportFeatures(routes, stops, [stale]).pathFeatures.length, 0)
})

test('status and canonical distance/duration values have compact Turkish presentation', () => {
  assert.deepEqual(transportPathStatus(null), { key: 'missing', label: 'Oluşturulmadı', action: 'Rota Oluştur' })
  assert.equal(transportPathStatus(currentPath).label, 'Güncel')
  assert.equal(transportPathStatus({ ...currentPath, isStale: true }).action, 'Rotayı Güncelle')
  assert.equal(formatRouteDistance(850), '850 m')
  assert.equal(formatRouteDistance(12400), '12.4 km')
  assert.equal(formatRouteDuration(45), '45 sn')
  assert.equal(formatRouteDuration(830), '13 dk 50 sn')
  assert.equal(formatRouteDuration(4320), '1 sa 12 dk')
})

test('route summary uses canonical path values and active stop count', () => {
  const summary = transportRouteSummary(currentPath, 2)
  assert.deepEqual(summary, {
    distance: '12.4 km',
    duration: '13 dk 50 sn',
    stopCount: '2',
    generatedAt: formatRouteGeneratedAt(currentPath.generatedAt),
    status: transportPathStatus(currentPath),
    metricsAreStale: false,
  })
})

test('stale summary labels persisted metrics as stale and ungenerated summary uses placeholders', () => {
  const stale = transportRouteSummary({ ...currentPath, isStale: true }, 2)
  assert.equal(stale.distance, '12.4 km')
  assert.equal(stale.duration, '13 dk 50 sn')
  assert.equal(stale.status.label, 'Güncel değil')
  assert.equal(stale.metricsAreStale, true)

  const missing = transportRouteSummary(null, 0)
  assert.equal(missing.distance, '—')
  assert.equal(missing.duration, '—')
  assert.equal(missing.generatedAt, '—')
  assert.equal(missing.stopCount, '0')
  assert.equal(missing.status.label, 'Oluşturulmadı')
})

test('hover emphasizes its route while canonical selection keeps stronger priority', () => {
  const features = transportFeatures(routes, stops, [currentPath])
  const selectedPath = features.pathFeatures.find((feature) => feature.get('routeId') === 7)
  const hoveredPreview = features.routeFeatures.find((feature) => feature.get('routeId') === 8)
  const layers = createTransportLayers(
    () => null,
    () => 7,
    () => true,
    () => true,
    () => true,
    () => 8,
  )

  assert.equal(layers.pathLayer.getStyleFunction()(selectedPath, 1)[1].getStroke().getWidth(), 7)
  assert.equal(layers.routeLayer.getStyleFunction()(hoveredPreview, 1).getStroke().getWidth(), 6)

  const normalLayers = createTransportLayers()
  assert.equal(normalLayers.routeLayer.getStyleFunction()(hoveredPreview, 1).getStroke().getWidth(), 4)
})

test('a hidden route cannot receive hover styling', () => {
  const preview = transportFeatures(routes, stops, [currentPath]).routeFeatures
    .find((feature) => feature.get('routeId') === 8)
  const { routeLayer } = createTransportLayers(
    () => null,
    () => 7,
    () => true,
    () => true,
    (routeId) => routeId !== 8,
    () => 8,
  )
  assert.equal(routeLayer.getStyleFunction()(preview, 1), undefined)
})

test('direction arrows remain styles of one route feature rather than independent hover identities', () => {
  const { pathFeatures } = transportFeatures(routes, stops, [currentPath])
  const feature = pathFeatures[0]
  const { pathLayer } = createTransportLayers(
    () => null,
    () => null,
    () => true,
    () => true,
    () => true,
    () => 7,
  )
  const styles = pathLayer.getStyleFunction()(feature, 1)
  assert.ok(styles.length > 1)
  assert.equal(styles[0].getStroke().getWidth(), 6)
  assert.equal(pathFeatures.length, 1)
  assert.equal(feature.get('routeId'), 7)
  assert.equal(feature.get('featureKind'), TRANSPORT_ROUTE_PATH_KIND)
})
