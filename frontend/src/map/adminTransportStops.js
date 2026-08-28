import { foldForSearch } from './drawingFilters.js'

export const ADMIN_STOP_DEFAULT_FILTERS = Object.freeze({ search: '', routeId: 'all', status: 'all' })

export function adminStopStatus(stop) {
  if (stop?.isDeleted === true) return 'deleted'
  return 'active'
}

export function buildAdminStopView(stops, filters = ADMIN_STOP_DEFAULT_FILTERS) {
  const search = foldForSearch(filters.search ?? '')
  const routeId = filters.routeId ?? 'all'
  const status = filters.status ?? 'all'

  return stops
    .filter((stop) => {
      if (routeId !== 'all' && String(stop.routeId) !== String(routeId)) return false
      if (status !== 'all' && adminStopStatus(stop) !== status) return false
      return !search || foldForSearch(stop.name ?? '').includes(search)
    })
    .sort((left, right) => (left.routeName ?? '').localeCompare(right.routeName ?? '', 'tr', { sensitivity: 'base' })
      || left.sequenceOrder - right.sequenceOrder
      || (left.name ?? '').localeCompare(right.name ?? '', 'tr', { sensitivity: 'base' })
      || left.id - right.id)
}

export function adminStopFiltersActive(filters = ADMIN_STOP_DEFAULT_FILTERS) {
  return Boolean(filters.search?.trim()) || filters.routeId !== 'all' || filters.status !== 'all'
}

export function duplicateStopNameWarning(stops, { stopId = null, routeId, name } = {}) {
  const normalized = foldForSearch(name ?? '').trim()
  if (!normalized || routeId == null) return ''
  return stops.some((stop) => stop.id !== stopId
    && stop.isDeleted !== true
    && String(stop.routeId) === String(routeId)
    && foldForSearch(stop.name ?? '').trim() === normalized)
    ? 'Bu güzergâhta aynı isimde başka bir durak bulunuyor.'
    : ''
}

export function adminStopActions(stop, permissions) {
  if (stop?.isDeleted === true) return permissions.canRestoreStop ? ['restore'] : []
  return [
    permissions.canView ? 'focus' : null,
    permissions.canUpdateStop ? 'edit' : null,
    permissions.canDeleteStop ? 'delete' : null,
  ].filter(Boolean)
}

export function moveStopInRoute(stops, stopId, direction) {
  const currentIndex = stops.findIndex((stop) => stop.id === stopId)
  const targetIndex = currentIndex + direction
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= stops.length || ![-1, 1].includes(direction)) return null
  const reordered = [...stops]
  const [moved] = reordered.splice(currentIndex, 1)
  reordered.splice(targetIndex, 0, moved)
  return reordered.map((stop, index) => ({ ...stop, sequenceOrder: index + 1 }))
}
