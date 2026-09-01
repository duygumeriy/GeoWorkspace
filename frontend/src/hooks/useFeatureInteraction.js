import { useEffect, useState } from 'react'
import { measureArea, measureLength, formatArea, formatLength } from '../map/measure.js'
import { DRAWING_TYPES } from '../map/drawingTypes.js'
import { isAdditive } from './useSelectionTools.js'

/** Ignore near-misses but stay forgiving on touch. */
const HIT_TOLERANCE = 6

/**
 * Click-to-select and hover-to-preview on the drawings layer.
 *
 * Uses the map's own pixel hit detection rather than a `Select` interaction, so
 * the layer keeps rendering through its style function (which is what makes
 * per-feature styles and the layer toggles work) and selection stays a plain
 * piece of React state.
 *
 * Multi-selection rides on the same click: Shift (any platform), Cmd (macOS) or
 * Ctrl (Windows/Linux) turns the click into "add/remove this one" instead of
 * "make this the selection". The decision itself lives in the workspace hook —
 * here we only report which modifier state the click carried.
 *
 * @param {import('ol/Map').default | null} map
 * @param {{ enabled: boolean, hoverEnabled: boolean,
 *           onSelect: (key: string|null, options: { additive: boolean }) => void }} options
 */
export default function useFeatureInteraction(map, { enabled, hoverEnabled, onSelect }) {
  const [hovered, setHovered] = useState(null)

  useEffect(() => {
    if (!map || !enabled) return undefined

    const findFeature = (pixel) =>
      map.forEachFeatureAtPixel(pixel, (feature, layer) => (layer?.getClassName?.().includes('drawing-layer') ? feature : null), {
        hitTolerance: HIT_TOLERANCE,
      })

    const handleClick = (event) => {
      const feature = findFeature(event.pixel)
      // Clicking empty map clears the selection — the usual GIS behaviour,
      // unless a modifier says the user is deliberately building a selection.
      onSelect(feature ? feature.getId() : null, { additive: isAdditive(event.originalEvent) })
    }

    map.on('singleclick', handleClick)
    return () => map.un('singleclick', handleClick)
  }, [map, enabled, onSelect])

  // Hover tooltip is a desktop affordance only; `hoverEnabled` is false when
  // the device has no fine pointer, where hover state is unreliable.
  useEffect(() => {
    if (!map || !enabled || !hoverEnabled) {
      setHovered(null)
      return undefined
    }

    /* İmleç SAHİPLİĞİ: yalnızca kendi yazdığımız değer geri alınır. Her
       hareketde koşulsuz boş dizeye çekmek, imleci o an başka bir kip
       (örneğin yolculuk noktası seçimi) tutuyorsa onu sessizce ezerdi. */
    let ownsCursor = false

    const handleMove = (event) => {
      if (event.dragging) return

      const feature = map.forEachFeatureAtPixel(
        event.pixel,
        (candidate, layer) => (layer?.getClassName?.().includes('drawing-layer') ? candidate : null),
        { hitTolerance: HIT_TOLERANCE },
      )

      const target = map.getTargetElement()
      if (target) {
        if (feature) {
          target.style.cursor = 'pointer'
          ownsCursor = true
        } else if (ownsCursor) {
          target.style.cursor = ''
          ownsCursor = false
        }
      }

      setHovered(feature ? describeHover(feature, event.pixel) : null)
    }

    const handleOut = () => setHovered(null)

    map.on('pointermove', handleMove)
    map.getTargetElement()?.addEventListener('pointerleave', handleOut)

    return () => {
      map.un('pointermove', handleMove)
      map.getTargetElement()?.removeEventListener('pointerleave', handleOut)
      if (ownsCursor && map.getTargetElement()) {
        map.getTargetElement().style.cursor = ''
        ownsCursor = false
      }
    }
  }, [map, enabled, hoverEnabled])

  return { hovered }
}

/** Builds the small "Polygon #12 / Alan: 2,81 km²" tooltip payload. */
function describeHover(feature, pixel) {
  const type = feature.get('drawingType')
  const geometry = feature.getGeometry()
  const config = DRAWING_TYPES[type]
  if (!config) return null

  let detail = ''
  if (type === 'line') detail = `Uzunluk: ${formatLength(measureLength(geometry))}`
  else if (type === 'polygon') detail = `Alan: ${formatArea(measureArea(geometry))}`

  return {
    title: `${config.label} #${feature.get('databaseId')}`,
    detail,
    pixel,
  }
}
