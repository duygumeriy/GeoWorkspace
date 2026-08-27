import { useCallback, useEffect, useRef, useState } from 'react'
import { readApiError } from '../services/api.js'
import { fetchOwnTransportStops } from '../services/transportApi.js'

/** Duraklarım verisi; sahiplik filtresi yalnızca backend'deki /mine sorgusundadır. */
export default function useMyStops({ active, permitted }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    if (!permitted) return false
    const token = ++requestRef.current
    setLoading(true)
    setError(null)
    try {
      const response = await fetchOwnTransportStops()
      if (!response.ok) throw new Error(await readApiError(response, 'Duraklarınız yüklenemedi'))
      const body = await response.json()
      if (token !== requestRef.current) return false
      setItems(Array.isArray(body) ? body : [])
      return true
    } catch (loadError) {
      if (token !== requestRef.current) return false
      setError(loadError?.message || 'Duraklarınız yüklenemedi.')
      return false
    } finally {
      if (token === requestRef.current) setLoading(false)
    }
  }, [permitted])

  useEffect(() => {
    if (active && permitted) load()
  }, [active, permitted, load])

  useEffect(() => {
    if (permitted) return
    requestRef.current += 1
    setItems([])
    setError(null)
    setLoading(false)
  }, [permitted])

  const remove = useCallback((id) => setItems((current) => current.filter((item) => item.id !== id)), [])
  return { items, loading, error, reload: load, remove }
}
