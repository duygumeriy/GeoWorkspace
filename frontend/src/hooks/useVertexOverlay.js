import { useEffect, useRef } from 'react'
import { validateCoords } from '../map/geometryEdit.js'
import { createVertexOverlayLayer, hitTestOverlay, syncOverlayFeatures } from '../map/vertexOverlay.js'

/**
 * Puts numbered vertex markers on the map for the drawing being edited, and
 * turns a click on one into a selection.
 *
 * This is the map half of the panel/map link. The other half is the vertex list
 * in the geometry editor; both read `selectedVertex` / `selectedEdge` from the
 * edit session and both write back through the same setters, so "Köşe 3" means
 * the same vertex in the list, on the map, and in the coordinate boxes. There is
 * no second selection state to keep in step.
 *
 * The layer is created when a session opens and removed when it closes, so
 * ordinary browsing never shows editing furniture.
 *
 * @param {import('ol/Map').default | null} map
 * @param {{ active: boolean, type: string|null, coords: number[][]|null,
 *           selectedVertex: number|null, selectedEdge: number|null,
 *           onSelectVertex: (index: number) => void,
 *           onSelectEdge: (index: number) => void,
 *           onClearSelection: () => void }} options
 */
export default function useVertexOverlay(
  map,
  { active, type, coords, selectedVertex, selectedEdge, onSelectVertex, onSelectEdge, onClearSelection },
) {
  const sourceRef = useRef(null)

  /* Click handling reads through refs so that changing a handler — or moving a
     single vertex — never tears the listener down. Rebinding on every coordinate
     change would drop the click that is already in flight. */
  const stateRef = useRef({ type, coords, onSelectVertex, onSelectEdge, onClearSelection })
  stateRef.current = { type, coords, onSelectVertex, onSelectEdge, onClearSelection }

  /* --- The layer ----------------------------------------------------------- */

  useEffect(() => {
    if (!map || !active) return undefined

    const { source, layer } = createVertexOverlayLayer()
    sourceRef.current = source
    map.addLayer(layer)

    return () => {
      map.removeLayer(layer)
      source.clear()
      sourceRef.current = null
    }
  }, [map, active])

  /* --- Markers follow the session ------------------------------------------
     Re-rendered from the vertex list on every change, so a coordinate typed into
     the panel moves its marker in the same frame the geometry moves. */

  useEffect(() => {
    const source = sourceRef.current
    if (!source) return

    /* An out-of-range coordinate is held in the session so the save can be
       blocked and the error shown, but it must not be projected: `fromLonLat`
       of latitude 999 is not a place on the map. The markers hold their last
       good positions, exactly as the drawing's own geometry does. */
    if (!validateCoords(type, coords ?? []).ok) return

    syncOverlayFeatures(source, type, coords, { selectedVertex, selectedEdge })
  }, [active, type, coords, selectedVertex, selectedEdge])

  /* --- Map -> panel selection -----------------------------------------------
     A plain click, never a drag: OpenLayers withholds `singleclick` after a drag
     gesture, so reshaping a vertex with Modify does not also re-select things.

     Map listeners run before the interactions and are not blocked by them, so
     this coexists with the live Modify/Translate interaction rather than
     competing with it for the same pointer events. */

  useEffect(() => {
    if (!map || !active) return undefined

    const handleClick = (event) => {
      const { type: currentType, coords: currentCoords } = stateRef.current
      if (!currentCoords?.length) return

      const hit = hitTestOverlay(map, event.pixel, currentType, currentCoords)

      // Clicking well clear of the geometry drops the selection — the only way
      // to get back to "nothing selected" without leaving the session.
      if (!hit) stateRef.current.onClearSelection?.()
      else if (hit.kind === 'vertex') stateRef.current.onSelectVertex?.(hit.index)
      else stateRef.current.onSelectEdge?.(hit.index)
    }

    map.on('singleclick', handleClick)
    return () => map.un('singleclick', handleClick)
  }, [map, active])
}
