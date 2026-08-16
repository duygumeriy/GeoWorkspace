import Feature from 'ol/Feature'
import Point from 'ol/geom/Point'
import LineString from 'ol/geom/LineString'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import Style from 'ol/style/Style'
import Fill from 'ol/style/Fill'
import Stroke from 'ol/style/Stroke'
import CircleStyle from 'ol/style/Circle'
import Text from 'ol/style/Text'
import { fromLonLat } from 'ol/proj'
import { segmentsOf } from './geometryEdit.js'

/**
 * The numbered vertex markers drawn over a drawing while it is being edited.
 *
 * This layer exists to answer one question the old editor left the user to
 * guess: **which point on the map is "Köşe 3"?** Every vertex is drawn with the
 * same number the panel gives it, so the two surfaces name the same thing, and
 * clicking either one selects it in both.
 *
 * It is a pure *rendering* of the edit session's vertex list — it holds no
 * geometry of its own and nothing here can change a drawing. The session stays
 * the single source of truth; this is a second view of it, not a second copy.
 *
 * The layer only exists while an edit session is open, so ordinary browsing is
 * never cluttered with editing furniture.
 */

/**
 * Own canvas, so the dark-mode basemap filter in MapPage.css can skip it — the
 * markers must stay legible rather than being inverted with the tiles.
 */
export const VERTEX_LAYER_CLASSNAME = 'vertex-layer'

/** Amber: distinct from the drawings' own palette and from the cyan selection
 *  halo, and readable on both light and dark tiles. */
const ACCENT = '#F59E0B'
const MARKER_FILL = '#FFFFFF'
const MARKER_INK = '#111827'

/** Click slop, in screen pixels — generous enough for a fingertip. */
const VERTEX_HIT_PX = 14
const EDGE_HIT_PX = 12

const LABEL_FONT = "600 11px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"

/* --- Styles ----------------------------------------------------------------
   Built once and reused. The selected marker is bigger AND a different colour:
   size alone is easy to miss at a glance, colour alone disappears for anyone who
   cannot separate amber from white. */

const vertexStyleCache = new Map()

function vertexStyle(label, selected) {
  const key = `${label}|${selected}`
  const cached = vertexStyleCache.get(key)
  if (cached) return cached

  const style = new Style({
    image: new CircleStyle({
      radius: selected ? 12 : 9,
      fill: new Fill({ color: selected ? ACCENT : MARKER_FILL }),
      stroke: new Stroke({ color: selected ? MARKER_FILL : MARKER_INK, width: selected ? 3 : 1.5 }),
    }),
    text: new Text({
      text: label,
      font: LABEL_FONT,
      fill: new Fill({ color: MARKER_INK }),
      // Web fonts render the digits slightly high in the circle otherwise.
      offsetY: 0.5,
    }),
    zIndex: selected ? 2 : 1,
  })

  vertexStyleCache.set(key, style)
  return style
}

/** White casing under an amber core: the highlight reads on any basemap. */
const selectedEdgeStyle = [
  new Style({ stroke: new Stroke({ color: MARKER_FILL, width: 10, lineCap: 'round' }), zIndex: 0 }),
  new Style({ stroke: new Stroke({ color: ACCENT, width: 5, lineCap: 'round' }), zIndex: 0 }),
]

/* --- Layer ----------------------------------------------------------------- */

/**
 * Creates the (empty) overlay layer. Features are pushed in by
 * `syncOverlayFeatures` whenever the session's vertex list changes.
 */
export function createVertexOverlayLayer() {
  const source = new VectorSource()
  const layer = new VectorLayer({
    source,
    className: VERTEX_LAYER_CLASSNAME,
    // Above the drawings and the pending shape, below the location marker.
    zIndex: 20,
    // Purely decorative: hit testing is done in pixel space by `hitTestOverlay`,
    // which stays exact regardless of how the markers happen to be drawn.
    style: (feature) =>
      feature.get('kind') === 'edge'
        ? selectedEdgeStyle
        : vertexStyle(feature.get('label'), feature.get('selected')),
  })

  return { source, layer }
}

/**
 * Rewrites the overlay to match a vertex list.
 *
 * The whole source is replaced rather than diffed: the list is short, and a
 * rebuild cannot drift out of step with the session the way an incremental
 * update could after an undo or a delete.
 *
 * @param {import('ol/source/Vector').default} source
 * @param {string} type point | line | polygon
 * @param {number[][]} coords EPSG:4326 vertex list
 * @param {{ selectedVertex: number|null, selectedEdge: number|null }} selection
 */
export function syncOverlayFeatures(source, type, coords, { selectedVertex, selectedEdge }) {
  source.clear()
  if (!coords?.length || type === 'point') return

  // The highlighted edge goes in first so the numbered markers sit on top of it.
  if (selectedEdge != null) {
    const segment = segmentsOf(type, coords)[selectedEdge]
    if (segment) {
      source.addFeature(
        new Feature({
          kind: 'edge',
          geometry: new LineString([fromLonLat(segment.start), fromLonLat(segment.end)]),
        }),
      )
    }
  }

  coords.forEach((vertex, index) => {
    source.addFeature(
      new Feature({
        kind: 'vertex',
        label: String(index + 1),
        selected: index === selectedVertex,
        geometry: new Point(fromLonLat(vertex)),
      }),
    )
  })
}

/* --- Hit testing -----------------------------------------------------------
   Done in screen pixels against the session's own coordinates rather than
   through `forEachFeatureAtPixel`. Two reasons: the result is the session's
   vertex INDEX (which is what selection is) rather than an overlay feature that
   would have to be mapped back to one, and the slop is expressed in the units
   the user actually experiences — a fixed number of pixels at every zoom. */

/**
 * What the user clicked on, if anything.
 *
 * Vertices win ties against edges: every vertex lies on two edges, so testing
 * edges first would make a vertex unclickable.
 *
 * @returns {{ kind: 'vertex'|'edge', index: number }|null}
 */
export function hitTestOverlay(map, pixel, type, coords) {
  if (!map || !pixel || !coords?.length || type === 'point') return null

  const points = coords.map((vertex) => map.getPixelFromCoordinate(fromLonLat(vertex)))
  if (points.some((point) => !point)) return null

  let best = null
  const consider = (candidate, distance, limit) => {
    if (distance <= limit && (!best || distance < best.distance)) {
      best = { ...candidate, distance }
    }
  }

  points.forEach((point, index) => {
    consider({ kind: 'vertex', index }, distanceBetweenPixels(point, pixel), VERTEX_HIT_PX)
  })
  if (best) return { kind: best.kind, index: best.index }

  segmentsOf(type, coords).forEach((segment) => {
    const distance = distanceToSegment(pixel, points[segment.from], points[segment.to])
    consider({ kind: 'edge', index: segment.index }, distance, EDGE_HIT_PX)
  })

  return best ? { kind: best.kind, index: best.index } : null
}

function distanceBetweenPixels(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

/** Shortest distance from a point to a line segment, all in pixels. */
function distanceToSegment(point, start, end) {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const lengthSquared = dx * dx + dy * dy

  // A zero-length segment (two coincident vertices) is just its endpoint.
  if (lengthSquared === 0) return distanceBetweenPixels(point, start)

  // Projection of the point onto the segment, clamped to its ends.
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared),
  )

  return distanceBetweenPixels(point, [start[0] + t * dx, start[1] + t * dy])
}
