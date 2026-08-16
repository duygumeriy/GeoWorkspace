import { useCallback, useEffect, useRef, useState } from 'react'
import Draw from 'ol/interaction/Draw'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import Style from 'ol/style/Style'
import Fill from 'ol/style/Fill'
import Stroke from 'ol/style/Stroke'
import CircleStyle from 'ol/style/Circle'
import { ANALYSIS_LAYER_CLASSNAME, geometryToWkt4326 } from '../map/drawing.js'
import { analyzeIntersections, readApiError } from '../services/api.js'

/** Amber, distinct from both the purple drawings and the cyan measurements. */
const ANALYSIS_COLOR = '#F59E0B'

/**
 * Spatial inventory analysis — "how many records does this area touch".
 *
 * Two entry points, one result:
 *
 *  1. The **Envanter Analizi** tool. The user draws a polygon that lives only in
 *     this hook's own vector source. It is never added to the drawings source,
 *     never tagged as a drawing and never POSTed to a create endpoint, so the
 *     database sees nothing but the read-only analysis request. A page refresh
 *     wipes it, exactly as it should.
 *
 *  2. `analyzeSaved`, called right after a polygon is persisted, which runs the
 *     same query for the record that was just written and passes its id as
 *     `excludePolygonId` so the polygon does not count itself.
 *
 * Both write into one `result` object, so there is a single readout on screen
 * rather than two competing ones.
 *
 * As with measurement, the mode is NOT owned here: `active` comes from
 * `useWorkspaceMode`, which is what keeps this Draw interaction from ever being
 * live at the same time as the drawing, selection or measurement ones.
 *
 * @param {import('ol/Map').default | null} map
 * @param {{ active: boolean, showToast: Function }} deps
 */
export default function useInventoryAnalysis(map, { active, showToast }) {
  const sourceRef = useRef(null)
  const [status, setStatus] = useState('idle')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  /**
   * Which matched record the user is looking at, as `"line:70"`.
   *
   * ONE piece of state serves both the panel's expanded row and the map's
   * highlight, so the two cannot disagree about what is selected. It is a
   * composite key rather than an object because a database id is only unique
   * within its own type.
   */
  const [selectedKey, setSelectedKey] = useState(null)

  // Only the newest request may write the result: clearing or re-drawing while
  // a request is in flight must not be overwritten by the stale answer.
  const requestIdRef = useRef(0)

  /* --- Dedicated throwaway layer ------------------------------------------ */

  useEffect(() => {
    if (!map) return undefined

    const source = new VectorSource()
    const layer = new VectorLayer({
      source,
      className: ANALYSIS_LAYER_CLASSNAME,
      // Above the drawings so the analysed area stays readable over them.
      zIndex: 15,
      style: new Style({
        stroke: new Stroke({ color: ANALYSIS_COLOR, width: 3, lineDash: [10, 6] }),
        fill: new Fill({ color: 'rgba(245, 158, 11, 0.14)' }),
        image: new CircleStyle({
          radius: 5,
          fill: new Fill({ color: ANALYSIS_COLOR }),
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

  /* --- Shared request path ------------------------------------------------ */

  /**
   * The one place that talks to the analysis endpoint.
   *
   * @param {string} wkt EPSG:4326 polygon
   * @param {{ label: string, temporary: boolean, excludePolygonId?: number|null }} context
   */
  const runAnalysis = useCallback(
    async (wkt, { label, temporary, excludePolygonId = null }) => {
      requestIdRef.current += 1
      const requestId = requestIdRef.current

      setStatus('loading')
      setError('')
      // A previous result's selection must not survive into a new one: the ids
      // it refers to may not be in the new answer at all.
      setSelectedKey(null)

      try {
        const res = await analyzeIntersections(wkt, { excludePolygonId })
        if (!res.ok) throw new Error(await readApiError(res, 'Analiz yapılamadı'))

        const body = await res.json()
        // A newer request (or a clear) has taken over in the meantime.
        if (requestId !== requestIdRef.current) return null

        /* Counts come from the server and are NOT recomputed here. The backend
           is the authority on which records intersect — a second opinion
           computed in the browser could only ever disagree with it, and it is
           the one that enforces the ownership boundary. */
        setResult({
          label,
          temporary,
          total: body.totalCount,
          point: body.pointCount,
          line: body.lineCount,
          polygon: body.polygonCount,
          items: {
            point: body.points ?? [],
            line: body.lines ?? [],
            polygon: body.polygons ?? [],
          },
        })
        setStatus('done')
        return body
      } catch (requestError) {
        if (requestId !== requestIdRef.current) return null
        const message = requestError?.message || 'Kesişim analizi yapılamadı.'
        setResult(null)
        setError(message)
        setStatus('error')
        showToast('error', message)
        return null
      }
    },
    [showToast],
  )

  /* --- Draw interaction for the temporary tool ---------------------------- */

  useEffect(() => {
    if (!map || !active) return undefined

    const source = sourceRef.current
    if (!source) return undefined

    const draw = new Draw({ source, type: 'Polygon' })
    map.addInteraction(draw)

    draw.on('drawstart', () => {
      // One analysis area at a time: the previous one and its result go away
      // the moment a new area is started, so the readout can never describe a
      // polygon that is no longer on the map.
      source.clear()
      requestIdRef.current += 1
      setResult(null)
      setSelectedKey(null)
      setError('')
      setStatus('idle')
    })

    draw.on('drawend', (event) => {
      // Real 3857 -> 4326 reprojection, the same helper the drawings use.
      const wkt = geometryToWkt4326(event.feature.getGeometry())
      runAnalysis(wkt, { label: 'Geçici analiz alanı', temporary: true })
    })

    const handleKeyDown = (keyEvent) => {
      if (keyEvent.key === 'Escape') draw.abortDrawing()
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      map.removeInteraction(draw)
      draw.dispose()
    }
  }, [map, active, runAnalysis])

  /**
   * Runs the analysis for a polygon that has just been saved.
   *
   * @param {{ wkt: string, databaseId: number, name: string }} record
   */
  const analyzeSaved = useCallback(
    ({ wkt, databaseId, name }) => {
      // A saved polygon leaves no temporary geometry behind — the record itself
      // is already on the drawings layer in its own colour.
      sourceRef.current?.clear()
      return runAnalysis(wkt, {
        label: name ? `"${name}" poligonu` : 'Kaydedilen poligon',
        temporary: false,
        excludePolygonId: databaseId,
      })
    },
    [runAnalysis],
  )

  /** "Temizle": drops the temporary geometry, the result and the highlight. */
  const clear = useCallback(() => {
    sourceRef.current?.clear()
    // Invalidates any in-flight request so a late answer cannot repopulate.
    requestIdRef.current += 1
    setResult(null)
    setSelectedKey(null)
    setError('')
    setStatus('idle')
  }, [])

  /** Selects a matched record, or clears the selection when given the same one. */
  const selectItem = useCallback((key) => {
    setSelectedKey((current) => (current === key ? null : key))
  }, [])

  return {
    isActive: Boolean(active),
    status,
    isLoading: status === 'loading',
    result,
    error,
    /** `"line:70"` — shared by the panel row and the map highlight. */
    selectedKey,
    selectItem,
    analyzeSaved,
    clear,
  }
}

/** The composite key a matched record is addressed by, in both surfaces. */
export function analysisItemKey(item) {
  return `${item.drawingType}:${item.id}`
}
