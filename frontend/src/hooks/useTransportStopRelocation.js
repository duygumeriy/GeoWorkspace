import { useCallback, useEffect, useRef, useState } from 'react'
import Feature from 'ol/Feature.js'
import Point from 'ol/geom/Point.js'
import { fromLonLat, toLonLat } from 'ol/proj.js'
import { createTransportRelocationLayer } from '../map/transport.js'

/**
 * Owns the one temporary marker used while relocating an existing stop.
 * The permanent transport source is never mutated; cancel/failure therefore
 * only has to clear this preview and leave the server-backed marker intact.
 */
export default function useTransportStopRelocation(map, { active, onPlaced }) {
  const sourceRef = useRef(null)
  const onPlacedRef = useRef(onPlaced)
  const [pending, setPending] = useState(null)
  onPlacedRef.current = onPlaced

  useEffect(() => {
    if (!map || !active) return undefined
    const { source, layer } = createTransportRelocationLayer()
    sourceRef.current = source
    map.addLayer(layer)
    return () => {
      map.removeLayer(layer)
      source.clear()
      sourceRef.current = null
    }
  }, [map, active])

  useEffect(() => {
    if (!map || !active) return undefined

    const target = map.getTargetElement?.()
    const previousCursor = target?.style.cursor ?? ''
    if (target) target.style.cursor = 'crosshair'

    const handleClick = (event) => {
      const [longitude, latitude] = toLonLat(event.coordinate)
      const point = { longitude, latitude }
      const source = sourceRef.current
      source?.clear()
      source?.addFeature(new Feature(new Point(fromLonLat([longitude, latitude]))))
      setPending(point)
      onPlacedRef.current?.(point)
    }

    map.on('singleclick', handleClick)
    return () => {
      map.un('singleclick', handleClick)
      if (target && target.style.cursor === 'crosshair') target.style.cursor = previousCursor
    }
  }, [map, active])

  const clearPending = useCallback(() => {
    sourceRef.current?.clear()
    setPending(null)
  }, [])

  useEffect(() => {
    if (!active) clearPending()
  }, [active, clearPending])

  return { pending, clearPending }
}
