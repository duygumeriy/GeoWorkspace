import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ADMIN_ROUTE_DEFAULT_FILTERS,
  adminRouteFiltersActive,
  adminRouteStatus,
  buildAdminRouteView,
  pruneHiddenRoutes,
  toggleHiddenRoute,
} from '../../src/map/adminTransportRoutes.js'

const routes = [
  { id: 1, name: 'Üniversite Hattı' },
  { id: 2, name: 'Şehir İçi' },
  { id: 3, name: 'Sahil Ring' },
]
const paths = [
  { routeId: 1, isStale: false },
  { routeId: 2, isStale: true },
]

test('admin route search is Turkish-aware, case-insensitive and substring based', () => {
  assert.deepEqual(buildAdminRouteView(routes, paths, { search: 'UNIVERSITE', status: 'all' }).map((route) => route.id), [1])
  assert.deepEqual(buildAdminRouteView(routes, paths, { search: 'sehir', status: 'all' }).map((route) => route.id), [2])
  assert.deepEqual(buildAdminRouteView(routes, paths, { search: 'ring', status: 'all' }).map((route) => route.id), [3])
})

test('route path status uses the existing current, stale and missing semantics', () => {
  assert.equal(adminRouteStatus(paths, 1), 'current')
  assert.equal(adminRouteStatus(paths, 2), 'stale')
  assert.equal(adminRouteStatus(paths, 3), 'missing')
})

test('route search and status filters compose and reset without changing source routes', () => {
  const filtered = buildAdminRouteView(routes, paths, { search: 'sehir', status: 'stale' })
  assert.deepEqual(filtered.map((route) => route.id), [2])
  assert.equal(adminRouteFiltersActive({ search: 'sehir', status: 'stale' }), true)
  assert.equal(adminRouteFiltersActive(ADMIN_ROUTE_DEFAULT_FILTERS), false)
  assert.deepEqual(buildAdminRouteView(routes, paths, ADMIN_ROUTE_DEFAULT_FILTERS), routes)
})

test('per-route visibility is immutable, independent and survives list filtering', () => {
  const original = new Set([1])
  const withSecondHidden = toggleHiddenRoute(original, 2)
  assert.deepEqual([...original], [1])
  assert.deepEqual([...withSecondHidden].sort(), [1, 2])
  assert.deepEqual(buildAdminRouteView(routes, paths, { search: 'sahil', status: 'all' }).map((route) => route.id), [3])
  assert.deepEqual([...withSecondHidden].sort(), [1, 2])
  assert.deepEqual([...toggleHiddenRoute(withSecondHidden, 1)], [2])
})

test('filtering a selected route out leaves canonical selection and visibility state untouched', () => {
  const selectedRouteId = 1
  const hidden = new Set([selectedRouteId])
  const visible = buildAdminRouteView(routes, paths, { search: 'sahil', status: 'missing' })
  assert.deepEqual(visible.map((route) => route.id), [3])
  assert.equal(routes.find((route) => route.id === selectedRouteId)?.id, selectedRouteId)
  assert.equal(hidden.has(selectedRouteId), true)
  assert.deepEqual([...pruneHiddenRoutes(hidden, routes)], [selectedRouteId])
})
