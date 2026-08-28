import assert from 'node:assert/strict'
import test from 'node:test'
import { transportActivityContext } from '../../src/map/transportActivityPresentation.js'

test('route generation activity presents safe route and canonical metrics', () => {
  const context = transportActivityContext(JSON.stringify({
    kind: 'RouteGeneration',
    routeId: 7,
    routeName: 'Merkez Hattı',
    routeGenerated: true,
    distanceMeters: 4200,
    durationSeconds: 600,
  }))
  assert.equal(context, 'Merkez Hattı #7 · rota oluşturuldu · 4.2 km · 10 dk')
})

test('reorder, transfer and coordinate move activity expose useful context without coordinates', () => {
  const reordered = transportActivityContext(JSON.stringify({
    kind: 'StopReorder', routeId: 7, routeName: 'Merkez Hattı', stopCount: 3,
    orderedStopIds: [73, 71, 72], routeGenerated: false,
  }))
  const transferred = transportActivityContext(JSON.stringify({
    kind: 'StopTransfer', stopId: 72, stopName: 'Meydan', sourceRouteId: 7,
    sourceRouteName: 'Merkez Hattı', destinationRouteId: 8, destinationRouteName: 'Sahil Hattı',
  }))
  const moved = transportActivityContext(JSON.stringify({
    kind: 'StopCoordinateMove', stopId: 72, stopName: 'Meydan', routeId: 7,
    routeName: 'Merkez Hattı', coordinateChanged: true,
  }))

  assert.match(reordered, /#73 → #71 → #72/)
  assert.match(reordered, /rota yeniden hesaplanamadı/)
  assert.equal(transferred, 'Meydan #72 · Merkez Hattı #7 → Sahil Hattı #8')
  assert.equal(moved, 'Meydan #72 · Merkez Hattı #7 · konum güncellendi')
  assert.doesNotMatch(`${reordered} ${transferred} ${moved}`, /longitude|latitude|OSRM|http/i)
})

test('unknown or malformed activity details are not rendered as raw text', () => {
  assert.equal(transportActivityContext('{raw private payload'), null)
  assert.equal(transportActivityContext(JSON.stringify({ kind: 'Unknown', token: 'secret' })), null)
})
