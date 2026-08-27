import { useCallback, useMemo } from 'react'
import usePoiSearch from './usePoiSearch.js'
import { searchGlobalRecords } from '../map/globalSearch.js'

const LOCAL_MIN_QUERY_LENGTH = 1

/** Reuses the POI endpoint and searches already-authorized map data for other types. */
export default function useGlobalMapSearch({ enabled, type, query, drawings, stops, routes }) {
  const poi = usePoiSearch({ enabled: enabled && type === 'poi', query })
  const term = query.trim()

  const localResults = useMemo(() => {
    if (!enabled || type === 'poi' || term.length < LOCAL_MIN_QUERY_LENGTH) return []
    return searchGlobalRecords(type, term, { drawings, stops, routes })
  }, [enabled, type, term, drawings, stops, routes])
  const poiResults = useMemo(
    () => poi.results.map((item) => ({ ...item, searchType: 'poi' })),
    [poi.results],
  )
  const decoratedLocalResults = useMemo(
    () => localResults.map((item) => ({ ...item, searchType: type })),
    [localResults, type],
  )

  const reset = useCallback(() => poi.reset(), [poi.reset])

  return type === 'poi'
    ? { ...poi, results: poiResults }
    : {
        results: decoratedLocalResults,
        loading: false,
        error: '',
        searched: term.length >= LOCAL_MIN_QUERY_LENGTH,
        reset,
      }
}
