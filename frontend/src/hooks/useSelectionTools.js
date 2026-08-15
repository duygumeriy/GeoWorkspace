import { useEffect, useRef } from 'react'
import Draw from 'ol/interaction/Draw'
import DragBox from 'ol/interaction/DragBox'
import DragPan from 'ol/interaction/DragPan'
import Style from 'ol/style/Style'
import Stroke from 'ol/style/Stroke'
import Fill from 'ol/style/Fill'
import CircleStyle from 'ol/style/Circle'
import { fromExtent } from 'ol/geom/Polygon'

/** Cyan, matching the selection halo, and clearly not a drawing colour. */
const SELECTION_SKETCH_COLOR = '#00D1FF'

const sketchStyle = new Style({
  stroke: new Stroke({ color: SELECTION_SKETCH_COLOR, width: 2, lineDash: [7, 5] }),
  fill: new Fill({ color: 'rgba(0, 209, 255, 0.10)' }),
  image: new CircleStyle({
    radius: 4,
    fill: new Fill({ color: SELECTION_SKETCH_COLOR }),
    stroke: new Stroke({ color: '#ffffff', width: 1.5 }),
  }),
})

/**
 * Spatial selection: drag a box, or draw a free polygon, to select drawings.
 *
 * Nothing here ever touches the persisted drawings source. Both interactions
 * are created *without* a `source`, so the shape the user drags or draws lives
 * only in the interaction's own sketch overlay and disappears the moment it is
 * finished — it is never added to a layer, never given a client key, and never
 * POSTed. A selection polygon is a query, not a drawing.
 *
 * @param {import('ol/Map').default | null} map
 * @param {{ tool: 'box'|'polygon'|null,
 *           onSelect: (keys: string[], options: { additive: boolean }) => void,
 *           selectKeysIn: (polygon: import('ol/geom/Polygon').default) => string[] }} options
 */
export default function useSelectionTools(map, { tool, onSelect, selectKeysIn }) {
  // Handlers are read at event time so changing selection state never tears
  // down and rebuilds a live interaction mid-drag.
  const handlersRef = useRef({ onSelect, selectKeysIn })
  handlersRef.current = { onSelect, selectKeysIn }

  /* --- Box selection ------------------------------------------------------- */

  useEffect(() => {
    if (!map || tool !== 'box') return undefined

    const dragBox = new DragBox({ className: 'selection-drag-box' })

    // Plain drag has to mean "draw a box" here, so panning stands down for as
    // long as the tool is active and is restored on the way out.
    const dragPans = map
      .getInteractions()
      .getArray()
      .filter((interaction) => interaction instanceof DragPan && interaction.getActive())
    dragPans.forEach((interaction) => interaction.setActive(false))

    dragBox.on('boxend', (event) => {
      const additive = isAdditive(event.mapBrowserEvent?.originalEvent)
      // The box is an extent; as a polygon it goes through the same precise
      // containment test as a free-drawn area selection.
      const keys = handlersRef.current.selectKeysIn?.(fromExtent(dragBox.getGeometry().getExtent())) ?? []
      handlersRef.current.onSelect?.(keys, { additive })
    })

    map.addInteraction(dragBox)

    return () => {
      map.removeInteraction(dragBox)
      dragBox.dispose()
      dragPans.forEach((interaction) => interaction.setActive(true))
    }
  }, [map, tool])

  /* --- Area (polygon) selection -------------------------------------------- */

  useEffect(() => {
    if (!map || tool !== 'polygon') return undefined

    // No `source`: the finished polygon is handed to us in the event and then
    // ceases to exist. This is what keeps it out of tbl_polygon and off the map.
    const draw = new Draw({ type: 'Polygon', style: sketchStyle })

    draw.on('drawend', (event) => {
      const geometry = event.feature.getGeometry()
      const keys = handlersRef.current.selectKeysIn?.(geometry) ?? []
      // A drawn shape cannot carry modifier keys reliably (the last click is a
      // double-click), so area selection always replaces the selection.
      handlersRef.current.onSelect?.(keys, { additive: false })
    })

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') draw.abortDrawing()
    }
    document.addEventListener('keydown', handleKeyDown)

    map.addInteraction(draw)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      map.removeInteraction(draw)
      draw.dispose()
    }
  }, [map, tool])
}

/** Shift (all platforms), Cmd (macOS) or Ctrl (Windows/Linux) means "add to selection". */
export function isAdditive(originalEvent) {
  if (!originalEvent) return false
  return Boolean(originalEvent.shiftKey || originalEvent.metaKey || originalEvent.ctrlKey)
}
