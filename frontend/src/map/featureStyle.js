import Style from 'ol/style/Style'
import Fill from 'ol/style/Fill'
import Stroke from 'ol/style/Stroke'
import CircleStyle from 'ol/style/Circle'
import { DRAWING_TYPES, normalizeStyle } from './drawingTypes.js'

/**
 * Turns the style metadata stored in PostGIS into OpenLayers styles.
 *
 * This is the only place in the app that builds Stroke / Fill / CircleStyle,
 * so a feature drawn now and a feature reloaded from the database after a
 * refresh always go through identical code.
 */

/**
 * Semantic line style -> OpenLayers `lineDash`.
 *
 * The backend only ever stores the semantic word ('dashed'); the pixel pattern
 * is a rendering concern and is decided here. Patterns scale with the stroke
 * width so a 10px dashed line does not read as solid.
 */
export function lineDashFor(lineStyle, strokeWidth = 3) {
  const scale = Math.max(1, strokeWidth / 3)
  const px = (value) => Math.round(value * scale)

  switch (lineStyle) {
    case 'dashed':
      return [px(10), px(7)]
    case 'dotted':
      return [px(1), px(6)]
    case 'dashdot':
      return [px(12), px(6), px(1), px(6)]
    default:
      return undefined // solid
  }
}

/** Dotted lines need round caps, otherwise the 1px dots render as slivers. */
function lineCapFor(lineStyle) {
  return lineStyle === 'dotted' ? 'round' : 'butt'
}

/** `#RRGGBB` + alpha -> `rgba(...)`, the only form OpenLayers Fill accepts here. */
export function hexToRgba(hex, alpha) {
  const value = typeof hex === 'string' ? hex.replace('#', '') : ''
  if (value.length !== 6) return `rgba(124, 92, 255, ${alpha ?? 1})`

  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha ?? 1})`
}

/** Cyan halo used for the selected feature; readable on both light and dark tiles. */
const SELECTION_HALO = 'rgba(0, 209, 255, 0.55)'

/**
 * Builds the render style for one feature.
 *
 * @param {string} typeId              point | line | polygon
 * @param {object} style               style metadata as stored/returned by the API
 * @param {{ selected?: boolean }} [options]
 * @returns {import('ol/style/Style').default[]}
 */
export function createFeatureStyle(typeId, style, options = {}) {
  const safe = normalizeStyle(typeId, style)
  const selected = Boolean(options.selected)

  const styles = []
  if (selected) styles.push(selectionHaloStyle(typeId, safe))

  if (typeId === 'point') {
    // Stroke must never swallow the dot: cap it relative to the radius.
    const outline = Math.min(safe.strokeWidth, Math.max(1, Math.round(safe.pointRadius / 2)))
    styles.push(
      new Style({
        image: new CircleStyle({
          radius: safe.pointRadius,
          fill: new Fill({ color: safe.fillColor ?? safe.strokeColor }),
          stroke: new Stroke({ color: safe.strokeColor, width: outline }),
        }),
      }),
    )
    return styles
  }

  const stroke = new Stroke({
    color: safe.strokeColor,
    width: safe.strokeWidth,
    lineDash: lineDashFor(safe.lineStyle, safe.strokeWidth),
    lineCap: lineCapFor(safe.lineStyle),
  })

  styles.push(
    new Style({
      stroke,
      // Only polygons carry a fill; `fillOpacity` is null for lines.
      fill: DRAWING_TYPES[typeId].supports.fillOpacity
        ? new Fill({ color: hexToRgba(safe.fillColor, safe.fillOpacity) })
        : undefined,
    }),
  )

  return styles
}

/** Wider translucent underlay that marks the current selection. */
function selectionHaloStyle(typeId, safe) {
  if (typeId === 'point') {
    return new Style({
      image: new CircleStyle({
        radius: safe.pointRadius + 6,
        fill: new Fill({ color: SELECTION_HALO }),
      }),
    })
  }

  return new Style({
    stroke: new Stroke({ color: SELECTION_HALO, width: safe.strokeWidth + 8, lineCap: 'round' }),
  })
}

/**
 * Layer-level style function: reads each feature's own metadata, so one vector
 * layer can render features with completely different styles.
 *
 * Selection is a Set rather than a single key: every selected feature gets the
 * same halo, so a selection of four reads as one group instead of one "real"
 * selection plus three others. Hover is a separate, lighter treatment applied
 * by the cursor and the tooltip, so the two never blur together.
 *
 * @param {() => { selectedKeys: Set<string>, visibility: Record<string, boolean> }} getRenderState
 */
export function createLayerStyleFunction(getRenderState) {
  return (feature) => {
    const typeId = feature.get('drawingType')
    if (!DRAWING_TYPES[typeId]) return undefined

    const { selectedKeys, visibility } = getRenderState?.() ?? {}

    // Layer toggle: returning no style hides the feature and also removes it
    // from hit detection, so a hidden layer cannot be clicked or hovered.
    // The record itself stays in the source and in the database.
    if (visibility && visibility[typeId] === false) return undefined

    // `previewStyle` is set while the style panel is open and lets the user see
    // a change before it is committed; it is never sent to the API on its own.
    const style = feature.get('previewStyle') ?? feature.get('style')

    return createFeatureStyle(typeId, style, { selected: Boolean(selectedKeys?.has(feature.getId())) })
  }
}
