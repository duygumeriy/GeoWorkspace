import { foldForSearch } from './drawingFilters.js'
import { transportPathStatus } from './transportPathPresentation.js'

export const ADMIN_ROUTE_DEFAULT_FILTERS = Object.freeze({ search: '', status: 'all' })

export function routePathFor(paths, routeId) {
  return paths.find((path) => Number(path.routeId) === Number(routeId)) ?? null
}

export function adminRouteStatus(paths, routeId) {
  return transportPathStatus(routePathFor(paths, routeId)).key
}

export function buildAdminRouteView(routes, paths, filters = ADMIN_ROUTE_DEFAULT_FILTERS) {
  const search = foldForSearch(filters.search ?? '')
  const status = filters.status ?? 'all'

  return routes.filter((route) => {
    if (search && !foldForSearch(route.name ?? '').includes(search)) return false
    return status === 'all' || adminRouteStatus(paths, route.id) === status
  })
}

export function adminRouteFiltersActive(filters = ADMIN_ROUTE_DEFAULT_FILTERS) {
  return Boolean(filters.search?.trim()) || filters.status !== 'all'
}

export function toggleHiddenRoute(hiddenRouteIds, routeId) {
  const next = new Set(hiddenRouteIds)
  const canonicalId = Number(routeId)
  if (next.has(canonicalId)) next.delete(canonicalId)
  else next.add(canonicalId)
  return next
}

export function pruneHiddenRoutes(hiddenRouteIds, routes) {
  const activeIds = new Set(routes.map((route) => Number(route.id)))
  return new Set([...hiddenRouteIds].filter((routeId) => activeIds.has(Number(routeId))))
}
