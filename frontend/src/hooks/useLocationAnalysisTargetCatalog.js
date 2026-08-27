import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchLocationAnalysisTargetCatalog, readApiError } from '../services/api.js'

/** Backend'in yürürlükteki coğrafi kaynaklardan ürettiği analiz kataloğu. */
export default function useLocationAnalysisTargetCatalog({ enabled = true, cacheKey = null } = {}) {
  const normalizedCacheKey = cacheKey == null ? null : String(cacheKey)
  const [state, setState] = useState({
    loading: enabled,
    error: '',
    isRestricted: false,
    regions: [],
    provinces: [],
  })
  const mounted = useRef(true)
  const request = useRef(null)
  const loadedFor = useRef(null)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const refresh = useCallback(async () => {
    if (!enabled || normalizedCacheKey === null) return
    const requestedFor = normalizedCacheKey
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setState((current) => ({ ...current, loading: true, error: '' }))
    try {
      const response = await fetchLocationAnalysisTargetCatalog({ signal: controller.signal })
      if (!response.ok) throw new Error(await readApiError(response, 'Analiz hedefleri yüklenemedi.'))
      const body = await response.json()
      if (!mounted.current || controller.signal.aborted) return
      loadedFor.current = requestedFor
      setState({
        loading: false,
        error: '',
        isRestricted: body.isRestricted === true,
        regions: Array.isArray(body.regions) ? body.regions : [],
        provinces: Array.isArray(body.provinces)
          ? body.provinces.map((province) => ({ ...province, code: province.key }))
          : [],
      })
    } catch (error) {
      if (!mounted.current || controller.signal.aborted || error?.name === 'AbortError') return
      setState((current) => ({ ...current, loading: false, error: error?.message || 'Analiz hedefleri yüklenemedi.' }))
    } finally {
      if (request.current === controller) request.current = null
    }
  }, [enabled, normalizedCacheKey])

  /* Kullanıcı/izin sahibi değişirse önceki kataloğun tek bir karesi bile
     yeni oturuma taşınmaz. Panelin yalnızca kapanması ise cache key'i
     değiştirmez; aynı kullanıcı tekrar açtığında veri yeniden kullanılır. */
  useEffect(() => {
    request.current?.abort()
    request.current = null
    loadedFor.current = null
    setState({ loading: false, error: '', isRestricted: false, regions: [], provinces: [] })
  }, [normalizedCacheKey])

  useEffect(() => {
    if (!enabled) {
      request.current?.abort()
      request.current = null
      setState((current) => ({ ...current, loading: false }))
      return undefined
    }
    if (loadedFor.current === normalizedCacheKey) return undefined
    refresh()
    return () => request.current?.abort()
  }, [enabled, refresh])

  return { ...state, refresh }
}
