import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ADMIN_STOP_DEFAULT_FILTERS,
  adminStopActions,
  adminStopFiltersActive,
  buildAdminStopView,
  duplicateStopNameWarning,
  moveStopInRoute,
} from '../../src/map/adminTransportStops.js'

const stops = [
  { id: 1, routeId: 7, routeName: 'Merkez Hattı', name: 'Üniversite', sequenceOrder: 1, isActive: true, isDeleted: false },
  { id: 2, routeId: 7, routeName: 'Merkez Hattı', name: 'Meydan', sequenceOrder: 2, isActive: true, isDeleted: false },
  { id: 3, routeId: 8, routeName: 'Sahil Hattı', name: 'İskele', sequenceOrder: 1, isActive: true, isDeleted: false },
  { id: 4, routeId: 8, routeName: 'Sahil Hattı', name: 'Eski İskele', sequenceOrder: 2, isActive: true, isDeleted: true },
]

test('admin stop search is Turkish-aware and stop-name scoped', () => {
  assert.deepEqual(buildAdminStopView(stops, { ...ADMIN_STOP_DEFAULT_FILTERS, search: 'UNIVERSITE' }).map((stop) => stop.id), [1])
  assert.deepEqual(buildAdminStopView(stops, { ...ADMIN_STOP_DEFAULT_FILTERS, search: 'iskele' }).map((stop) => stop.id), [3, 4])
})

test('route and status filters compose and reset to the complete list', () => {
  const filtered = buildAdminStopView(stops, { search: 'iskele', routeId: '8', status: 'deleted' })
  assert.deepEqual(filtered.map((stop) => stop.id), [4])
  assert.equal(adminStopFiltersActive({ search: 'iskele', routeId: '8', status: 'deleted' }), true)
  assert.equal(adminStopFiltersActive(ADMIN_STOP_DEFAULT_FILTERS), false)
  assert.deepEqual(buildAdminStopView(stops, ADMIN_STOP_DEFAULT_FILTERS).map((stop) => stop.id), [1, 2, 3, 4])
})

test('duplicate warning is same-route, normalized, excludes deleted stops and remains non-blocking data', () => {
  assert.equal(duplicateStopNameWarning(stops, { routeId: 7, name: ' ünİVERSİTE ' }), 'Bu güzergâhta aynı isimde başka bir durak bulunuyor.')
  assert.equal(duplicateStopNameWarning(stops, { stopId: 1, routeId: 7, name: 'Üniversite' }), '')
  assert.equal(duplicateStopNameWarning(stops, { routeId: 8, name: 'Üniversite' }), '')
  assert.equal(duplicateStopNameWarning(stops, { routeId: 8, name: 'Eski İskele' }), '')
})

test('admin stop actions are capability based for active and deleted records', () => {
  assert.deepEqual(adminStopActions(stops[0], { canView: true, canUpdateStop: true, canDeleteStop: false }), ['focus', 'edit'])
  assert.deepEqual(adminStopActions(stops[0], { canView: true, canUpdateStop: false, canDeleteStop: true }), ['focus', 'delete'])
  assert.deepEqual(adminStopActions(stops[3], { canRestoreStop: false }), [])
  assert.deepEqual(adminStopActions(stops[3], { canRestoreStop: true }), ['restore'])
})

test('accessible reorder helper enforces boundaries and returns canonical contiguous order', () => {
  const routeStops = [
    stops[0],
    stops[1],
    { ...stops[2], routeId: 7, routeName: 'Merkez Hattı', sequenceOrder: 3 },
  ]
  assert.equal(moveStopInRoute(routeStops, 1, -1), null)
  assert.equal(moveStopInRoute(routeStops, 3, 1), null)
  const moved = moveStopInRoute(routeStops, 2, -1)
  assert.deepEqual(moved.map((stop) => stop.id), [2, 1, 3])
  assert.deepEqual(moved.map((stop) => stop.sequenceOrder), [1, 2, 3])
  assert.deepEqual(routeStops.map((stop) => stop.id), [1, 2, 3])
})
