import { useCallback, useEffect, useRef, useState } from 'react'
import Draw from 'ol/interaction/Draw.js'
import { toLonLat } from 'ol/proj.js'
import { createTransportPendingLayer } from '../map/transport.js'

export default function useTransportStopPlacement(map, { active, onPlaced }) {
  const sourceRef = useRef(null)
  const onPlacedRef = useRef(onPlaced)
  onPlacedRef.current = onPlaced
  const [pending, setPending] = useState(null)

  useEffect(() => {
    if (!map) return undefined
    const { source, layer } = createTransportPendingLayer()
    sourceRef.current = source
    map.addLayer(layer)
    return () => {
      map.removeLayer(layer)
      source.clear()
      sourceRef.current = null
    }
  }, [map])

  useEffect(() => {
    if (!map || !active || !sourceRef.current) return undefined
    const draw = new Draw({ source: sourceRef.current, type: 'Point' })
    draw.on('drawstart', () => sourceRef.current?.clear())
    draw.on('drawend', (event) => {
      const [longitude, latitude] = toLonLat(event.feature.getGeometry().getCoordinates())
      const point = { longitude, latitude }
      setPending(point)
      onPlacedRef.current?.(point)
    })
    map.addInteraction(draw)
    return () => {
      map.removeInteraction(draw)
      draw.dispose()
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
