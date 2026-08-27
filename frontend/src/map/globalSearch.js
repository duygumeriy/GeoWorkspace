import { foldForSearch } from './drawingFilters.js'

export function searchGlobalRecords(type, query, { drawings = [], stops = [], routes = [] }, limit = 20) {
  const needle = foldForSearch(query)
  if (!needle) return []
  const source = type === 'drawing' ? drawings : type === 'stop' ? stops : type === 'route' ? routes : []

  return source.filter((item) => {
    const text = type === 'stop' ? `${item.name ?? ''} ${item.routeName ?? ''}` : item.name ?? ''
    return foldForSearch(text).includes(needle)
  }).slice(0, limit)
}
