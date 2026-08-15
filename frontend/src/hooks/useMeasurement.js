import { useCallback, useEffect, useRef, useState } from 'react'
import Draw from 'ol/interaction/Draw'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import Style from 'ol/style/Style'
import Fill from 'ol/style/Fill'
import Stroke from 'ol/style/Stroke'
import CircleStyle from 'ol/style/Circle'
import { MEASURE_LAYER_CLASSNAME } from '../map/drawing.js'
import { measurementLabel } from '../map/measure.js'

export const MEASURE_MODES = Object.freeze([
  { id: 'distance', label: 'Mesafe', geometryType: 'LineString' },
  { id: 'area', label: 'Alan', geometryType: 'Polygon' },
])

const MEASURE_COLOR = '#00D1FF'

/**
 * Measurement mode.
 *
 * Deliberately isolated from the persisted drawings: it owns its own vector
 * source and layer, so nothing measured here is ever POSTed to the API or
 * mixed into the drawings source. Clearing or leaving the mode disposes of it.
 *
 * The mode itself is not owned here — it comes from `useWorkspaceMode`, the one
 * place that decides which interaction family is live, so measuring and drawing
 * can never both be active.
 *
 * @param {import('ol/Map').default | null} map
 * @param {string|null} mode distance | area | null
 */
export default function useMeasurement(map, mode) {
  const sourceRef = useRef(null)
  const [liveLabel, setLiveLabel] = useState('')
  const [results, setResults] = useState([])

  /* --- Dedicated throwaway layer ------------------------------------------ */

  useEffect(() => {
    if (!map) return undefined

    const source = new VectorSource()
    const layer = new VectorLayer({
      source,
      className: MEASURE_LAYER_CLASSNAME,
      zIndex: 20,
      style: new Style({
        stroke: new Stroke({ color: MEASURE_COLOR, width: 3, lineDash: [8, 6] }),
        fill: new Fill({ color: 'rgba(0, 209, 255, 0.12)' }),
        image: new CircleStyle({
          radius: 5,
          fill: new Fill({ color: MEASURE_COLOR }),
          stroke: new Stroke({ color: '#ffffff', width: 2 }),
        }),
      }),
    })

    sourceRef.current = source
    map.addLayer(layer)

    return () => {
      map.removeLayer(layer)
      source.clear()
      sourceRef.current = null
    }
  }, [map])

  /* --- Draw interaction for the active mode ------------------------------- */

  useEffect(() => {
    if (!map || !mode) {
      setLiveLabel('')
      return undefined
    }

    const source = sourceRef.current
    if (!source) return undefined

    const config = MEASURE_MODES.find((item) => item.id === mode)
    const draw = new Draw({ source, type: config.geometryType })
    map.addInteraction(draw)

    let geometryListener = null

    draw.on('drawstart', (event) => {
      const geometry = event.feature.getGeometry()
      setLiveLabel(measurementLabel(geometry))
      // Live readout while the pointer moves, before the shape is finished.
      geometryListener = geometry.on('change', (changeEvent) => {
        setLiveLabel(measurementLabel(changeEvent.target))
      })
    })

    draw.on('drawend', (event) => {
      if (geometryListener) {
        geometryListener.target.un('change', geometryListener.listener)
        geometryListener = null
      }
      const label = measurementLabel(event.feature.getGeometry())
      setLiveLabel('')
      // The finished measurement stays visible until explicitly cleared.
      setResults((current) => [...current, { id: `m-${Date.now()}`, mode, label }])
    })

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') draw.abortDrawing()
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      map.removeInteraction(draw)
      draw.dispose()
      setLiveLabel('')
    }
  }, [map, mode])

  const clear = useCallback(() => {
    sourceRef.current?.clear()
    setResults([])
    setLiveLabel('')
  }, [])

  return { mode, isActive: Boolean(mode), liveLabel, results, clear }
}
