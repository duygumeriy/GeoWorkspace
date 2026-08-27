import { foldForSearch } from './drawingFilters.js'

export function myStopRouteOptions(stops) {
  const values = new Map(stops.map((stop) => [String(stop.routeId), stop.routeName || `#${stop.routeId}`]))
  return [...values].sort((left, right) => left[1].localeCompare(right[1], 'tr'))
}

export const MY_STOP_SORT_OPTIONS = Object.freeze([
  { id: 'route-order', label: 'Güzergah Sırası' },
  { id: 'name-asc', label: 'Durak Adı A-Z' },
  { id: 'name-desc', label: 'Durak Adı Z-A' },
])

export function buildMyStopView(stops, { search = '', routeId = 'all', sort = 'route-order' } = {}) {
  const needle = foldForSearch(search)
  const visible = stops.filter((stop) => {
    if (routeId !== 'all' && String(stop.routeId) !== String(routeId)) return false
    if (!needle) return true
    return foldForSearch(`${stop.name ?? ''} ${stop.routeName ?? ''}`).includes(needle)
  })

  return visible.sort((left, right) => {
    const byName = (left.name ?? '').localeCompare(right.name ?? '', 'tr', { sensitivity: 'base' })
    if (sort === 'name-asc') return byName || left.id - right.id
    if (sort === 'name-desc') return -byName || left.id - right.id
    return (left.routeName ?? '').localeCompare(right.routeName ?? '', 'tr', { sensitivity: 'base' })
      || left.sequenceOrder - right.sequenceOrder
      || left.id - right.id
  })
}
