import { useEffect, useRef } from 'react'
import Feature from 'ol/Feature'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import Style from 'ol/style/Style'
import Stroke from 'ol/style/Stroke'
import Fill from 'ol/style/Fill'
import CircleStyle from 'ol/style/Circle'

/**
 * Marks the analysis result the user is looking at, on the map.
 *
 * ## Why a separate layer
 *
 * The obvious alternative — restyling the matched drawing — would mutate a
 * record's own appearance to say something temporary about it, and the change
 * would have to be undone by hand on every deselect (and would be one bug away
 * from being saved). Drawing a copy of its geometry on a throwaway layer keeps
 * the drawing's real style untouched: nothing to restore, and nothing that can
 * reach the database.
 *
 * Cyan, so it separates from both the purple drawings and the amber analysis
 * area, which stays on screen underneath it.
 *
 * @param {import('ol/Map').default | null} map
 * @param {{ geometry: import('ol/geom/Geometry').default | null }} options
 *   The matched feature's geometry, or null when nothing is selected.
 */
export default function useAnalysisHighlight(map, { geometry }) {
  const sourceRef = useRef(null)

  useEffect(() => {
    if (!map) return undefined

    const source = new VectorSource()
    const layer = new VectorLayer({
      source,
      // Its own canvas, so the dark-mode tile filter skips it.
      className: 'analysis-highlight-layer',
      // Above the drawings and the amber analysis area, below the vertex markers.
      zIndex: 18,
      style: [
        // White casing first: the cyan reads on light and dark basemaps alike.
        new Style({
          stroke: new Stroke({ color: '#ffffff', width: 9, lineCap: 'round', lineJoin: 'round' }),
          image: new CircleStyle({ radius: 13, stroke: new Stroke({ color: '#ffffff', width: 5 }) }),
        }),
        new Style({
          stroke: new Stroke({ color: '#00D1FF', width: 4, lineCap: 'round', lineJoin: 'round' }),
          // Deliberately faint: the highlight must not hide the drawing it marks.
          fill: new Fill({ color: 'rgba(0, 209, 255, 0.12)' }),
          image: new CircleStyle({ radius: 13, stroke: new Stroke({ color: '#00D1FF', width: 3 }) }),
        }),
      ],
    })

    sourceRef.current = source
    map.addLayer(layer)

    return () => {
      map.removeLayer(layer)
      source.clear()
      sourceRef.current = null
    }
  }, [map])

  useEffect(() => {
    const source = sourceRef.current
    if (!source) return

    source.clear()
    // A clone, not the drawing's own geometry object: sharing it would make the
    // highlight layer and the drawings layer render the same instance, and any
    // later edit would silently move both.
    if (geometry) source.addFeature(new Feature(geometry.clone()))
  }, [geometry])
}
