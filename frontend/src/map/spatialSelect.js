/**
 * Geometry tests behind box and area selection.
 *
 * OpenLayers gives us `intersectsExtent` and `intersectsCoordinate`, which are
 * enough for points but not for lines and polygons: a diagonal line's bounding
 * box can overlap a selection box the line never touches, and a large polygon
 * can enclose the selection area without any of its own vertices being inside
 * it. Both cases would produce visibly wrong selections.
 *
 * So the real test is done here, on plain coordinate arrays, with no extra
 * dependency: a candidate is selected when it is *contained in* or *crosses*
 * the selection polygon. Everything runs in map units (EPSG:3857), where the
 * selection geometry and the drawings already live, so no reprojection is
 * involved and the comparison is exact.
 *
 * The cheap extent test still runs first — it rejects almost everything at a
 * fraction of the cost, and only survivors reach the precise test.
 */

/**
 * Rings/paths of a geometry as arrays of [x, y].
 *
 * @returns {number[][][]} one entry per ring (polygon) or path (line); a point
 *   yields a single one-coordinate path.
 */
function pathsOf(geometry) {
  switch (geometry.getType()) {
    case 'Point':
      return [[geometry.getCoordinates()]]
    case 'MultiPoint':
      return geometry.getCoordinates().map((coordinate) => [coordinate])
    case 'LineString':
      return [geometry.getCoordinates()]
    case 'MultiLineString':
      return geometry.getCoordinates()
    case 'LinearRing':
      return [geometry.getCoordinates()]
    case 'Polygon':
      return geometry.getCoordinates()
    case 'MultiPolygon':
      return geometry.getCoordinates().flat()
    default:
      return []
  }
}

/** Every [start, end] segment of a geometry's outline. */
function segmentsOf(geometry) {
  const segments = []
  for (const path of pathsOf(geometry)) {
    for (let index = 0; index < path.length - 1; index += 1) {
      segments.push([path[index], path[index + 1]])
    }
  }
  return segments
}

/** Cross product sign of (b - a) x (c - a); 0 when the three are collinear. */
function orientation(a, b, c) {
  const value = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  if (value > 0) return 1
  if (value < 0) return -1
  return 0
}

/** True when point `p` lies on segment `a`-`b`, given they are collinear. */
function onSegment(a, b, p) {
  return (
    Math.min(a[0], b[0]) <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= p[1] &&
    p[1] <= Math.max(a[1], b[1])
  )
}

/** Standard orientation-based segment intersection, touching included. */
function segmentsIntersect([p1, p2], [p3, p4]) {
  const o1 = orientation(p1, p2, p3)
  const o2 = orientation(p1, p2, p4)
  const o3 = orientation(p3, p4, p1)
  const o4 = orientation(p3, p4, p2)

  if (o1 !== o2 && o3 !== o4) return true

  // Collinear overlaps: the general case above misses these.
  if (o1 === 0 && onSegment(p1, p2, p3)) return true
  if (o2 === 0 && onSegment(p1, p2, p4)) return true
  if (o3 === 0 && onSegment(p3, p4, p1)) return true
  if (o4 === 0 && onSegment(p3, p4, p2)) return true

  return false
}

/**
 * Does the selection polygon contain, or is it crossed by, this geometry?
 *
 * The three cases that must all count as "selected":
 *  1. any vertex of the candidate falls inside the selection polygon
 *     (covers fully-contained and partially-contained shapes);
 *  2. any edge of the candidate crosses any edge of the selection polygon
 *     (covers a line passing straight through without a vertex inside);
 *  3. any vertex of the selection polygon falls inside the candidate polygon
 *     (covers a selection drawn entirely inside a large polygon).
 *
 * @param {import('ol/geom/Geometry').default} geometry     candidate, map projection
 * @param {import('ol/geom/Polygon').default}  selection    selection polygon, map projection
 */
export function intersectsSelectionPolygon(geometry, selection) {
  if (!geometry || !selection) return false

  // Cheap rejection first; a miss here can never be a hit below.
  if (!geometry.intersectsExtent(selection.getExtent())) return false

  // 1 — a vertex of the candidate inside the selection.
  for (const path of pathsOf(geometry)) {
    for (const coordinate of path) {
      if (selection.intersectsCoordinate(coordinate)) return true
    }
  }

  // 2 — crossing outlines.
  const selectionSegments = segmentsOf(selection)
  for (const candidateSegment of segmentsOf(geometry)) {
    for (const selectionSegment of selectionSegments) {
      if (segmentsIntersect(candidateSegment, selectionSegment)) return true
    }
  }

  // 3 — selection drawn wholly inside a polygon.
  if (typeof geometry.intersectsCoordinate === 'function' && geometry.getType().includes('Polygon')) {
    for (const path of pathsOf(selection)) {
      for (const coordinate of path) {
        if (geometry.intersectsCoordinate(coordinate)) return true
      }
    }
  }

  return false
}

/**
 * Features a selection polygon picks up.
 *
 * `isSelectable` keeps hidden layers out: a feature whose type is toggled off
 * is not on screen, so a spatial selection must not reach it. The database is
 * never consulted or changed here — this is purely a read over what is drawn.
 *
 * @param {import('ol/source/Vector').default} source
 * @param {import('ol/geom/Polygon').default} selection
 * @param {(feature: import('ol/Feature').default) => boolean} isSelectable
 * @returns {string[]} client keys of the matched features
 */
export function featureKeysInSelection(source, selection, isSelectable) {
  if (!source || !selection) return []

  const keys = []
  // Extent pre-filter comes free from the source's own R-tree index.
  for (const feature of source.getFeaturesInExtent(selection.getExtent())) {
    if (isSelectable && !isSelectable(feature)) continue
    if (intersectsSelectionPolygon(feature.getGeometry(), selection)) keys.push(feature.getId())
  }

  return keys
}
