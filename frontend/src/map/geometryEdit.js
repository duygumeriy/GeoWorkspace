import { fromLonLat, toLonLat } from 'ol/proj'
import { getArea, getDistance, offset } from 'ol/sphere'
import Point from 'ol/geom/Point'
import LineString from 'ol/geom/LineString'
import Polygon from 'ol/geom/Polygon'

/**
 * The geometry engine behind the advanced editor.
 *
 * Everything here is a **pure function over a vertex list**. One representation
 * is used throughout the edit session:
 *
 *     coords = [[lon, lat], [lon, lat], ...]   // EPSG:4326, degrees
 *
 * and it is the session's single source of truth. The map's OpenLayers geometry
 * (EPSG:3857) and the numbers in the coordinate inputs are both *projections* of
 * this list — never a second copy of it. That is what lets a vertex dragged on
 * the map, a longitude typed into a box and a "Uzat" operation all be the same
 * edit rather than three states that have to be reconciled.
 *
 * Conventions:
 *
 *  - **Point**   exactly one vertex.
 *  - **Line**    at least two vertices.
 *  - **Polygon** at least three *unique* vertices, ring left **open**. The user
 *    is never asked to repeat the first vertex at the end; closure is applied
 *    only when a real geometry is built (`toMapCoordinates`) or WKT is written.
 *
 * All distances are geodesic (WGS84 ellipsoid mean radius via `ol/sphere`), not
 * planar screen maths — a metre has to be a metre at Turkey's latitude, where
 * Web Mercator is ~28% off.
 */

/** Minimum unique vertices a type can be saved with. */
export const MIN_VERTICES = Object.freeze({ point: 1, line: 2, polygon: 3 })

/** Longitude/latitude bounds the backend also enforces. */
export const LON_RANGE = Object.freeze({ min: -180, max: 180 })
export const LAT_RANGE = Object.freeze({ min: -90, max: 90 })

/** Decimal places shown in inputs. Presentation only — state keeps full precision. */
export const DISPLAY_PRECISION = 6

/* --- Projection boundary --------------------------------------------------
   The ONLY place 4326 <-> 3857 conversion happens for edited geometry. Both
   directions go through OpenLayers' real reprojection (`fromLonLat`/`toLonLat`),
   never a relabelling of numbers. */

/**
 * Map geometry (3857) -> canonical vertex list (4326).
 * Polygon rings come back with the closing duplicate removed.
 */
export function fromMapGeometry(type, geometry) {
  if (!geometry) return []

  if (type === 'point') return [toLonLat(geometry.getCoordinates())]

  if (type === 'line') return geometry.getCoordinates().map((coordinate) => toLonLat(coordinate))

  const ring = geometry.getCoordinates()?.[0] ?? []
  const lonLat = ring.map((coordinate) => toLonLat(coordinate))
  return dropClosingVertex(lonLat)
}

/**
 * Canonical vertex list (4326) -> coordinates in the map projection (3857),
 * shaped for the geometry type. Polygon rings are closed here.
 */
export function toMapCoordinates(type, coords) {
  if (type === 'point') return fromLonLat(coords[0])
  if (type === 'line') return coords.map((coordinate) => fromLonLat(coordinate))
  return [closeRing(coords).map((coordinate) => fromLonLat(coordinate))]
}

/**
 * Builds a standalone OpenLayers geometry (in the map projection) from the
 * canonical vertex list.
 *
 * Used when the session has to hand its geometry to something that expects a
 * real geometry — writing WKT for the API, above all. Going through this rather
 * than reading the feature back off the map means the saved shape is the
 * session's list, not whatever the map happens to be showing: a coordinate
 * typed a moment ago is included even if the render that would have pushed it
 * onto the map has not run yet.
 */
export function buildMapGeometry(type, coords) {
  const coordinates = toMapCoordinates(type, coords)

  if (type === 'point') return new Point(coordinates)
  if (type === 'line') return new LineString(coordinates)
  return new Polygon(coordinates)
}

/** Drops a trailing vertex that merely repeats the first one. */
function dropClosingVertex(ring) {
  if (ring.length < 2) return ring
  const [first] = ring
  const last = ring[ring.length - 1]
  return isSameVertex(first, last) ? ring.slice(0, -1) : ring
}

/**
 * Re-closes an open ring for persistence.
 *
 * The editor shows unique vertices (A, B, C, D); a valid polygon needs the ring
 * to return to its start (A, B, C, D, A). Doing it here — once, at the boundary
 * — is what keeps the UI from ever asking the user to type the first coordinate
 * twice.
 */
export function closeRing(coords) {
  if (coords.length === 0) return coords
  const [first] = coords
  const last = coords[coords.length - 1]
  return isSameVertex(first, last) ? coords : [...coords, [...first]]
}

function isSameVertex(a, b) {
  return Boolean(a) && Boolean(b) && a[0] === b[0] && a[1] === b[1]
}

/* --- Validation ------------------------------------------------------------ */

export function isValidLon(value) {
  return Number.isFinite(value) && value >= LON_RANGE.min && value <= LON_RANGE.max
}

export function isValidLat(value) {
  return Number.isFinite(value) && value >= LAT_RANGE.min && value <= LAT_RANGE.max
}

export function isValidVertex(vertex) {
  return Array.isArray(vertex) && isValidLon(vertex[0]) && isValidLat(vertex[1])
}

/**
 * Whether a vertex list can be saved as the given type.
 *
 * Only the cheap structural rules live here: every coordinate in range, and
 * enough vertices for the type. Topological validity (a polygon whose edges
 * cross) is the backend's call — NetTopologySuite is the authority and the
 * client must not develop a second, subtly different opinion of "valid".
 *
 * @returns {{ ok: boolean, reason: string|null }}
 */
export function validateCoords(type, coords) {
  const minimum = MIN_VERTICES[type] ?? 1

  if (!Array.isArray(coords) || coords.length < minimum) {
    return { ok: false, reason: reasonForMinimum(type, minimum) }
  }

  if (!coords.every(isValidVertex)) {
    return { ok: false, reason: 'Koordinatlar geçerli aralıkta olmalıdır (boylam -180..180, enlem -90..90).' }
  }

  return { ok: true, reason: null }
}

function reasonForMinimum(type, minimum) {
  if (type === 'polygon') return `Poligon en az ${minimum} köşe içermelidir.`
  if (type === 'line') return `Çizgi en az ${minimum} nokta içermelidir.`
  return 'Nokta bir koordinat içermelidir.'
}

/* --- Vertex operations -----------------------------------------------------
   Each returns a NEW list; nothing is mutated in place. That is what makes the
   undo stack a list of plain snapshots rather than a log of reversible edits. */

/** Replaces one vertex. Out-of-range values are stored as-is so the input can
 *  show what the user typed; `validateCoords` is what blocks the save. */
export function setVertex(coords, index, vertex) {
  if (index < 0 || index >= coords.length) return coords
  return coords.map((current, position) => (position === index ? [...vertex] : current))
}

/**
 * Inserts a vertex after `index`, placed at the midpoint of the segment it
 * splits, so a new point appears exactly on the existing line rather than at an
 * arbitrary spot the user then has to hunt for.
 */
export function addVertex(coords, index) {
  if (coords.length === 0) return coords

  const position = Math.min(Math.max(index, 0), coords.length - 1)
  const current = coords[position]
  // After the last vertex there is no following one to average with, so the new
  // vertex extends past the end along the previous segment instead.
  const next = coords[position + 1] ?? extrapolate(coords, position)

  const inserted = [(current[0] + next[0]) / 2, (current[1] + next[1]) / 2]
  return [...coords.slice(0, position + 1), inserted, ...coords.slice(position + 1)]
}

/** A point just beyond the end of the line, used when appending a vertex. */
function extrapolate(coords, lastIndex) {
  const last = coords[lastIndex]
  const previous = coords[lastIndex - 1]
  if (!previous) return [last[0] + 0.01, last[1]]
  return [last[0] + (last[0] - previous[0]), last[1] + (last[1] - previous[1])]
}

/**
 * Removes a vertex, refusing to go below the type's minimum.
 * @returns {{ coords: Array, removed: boolean, reason: string|null }}
 */
export function removeVertex(type, coords, index) {
  const minimum = MIN_VERTICES[type] ?? 1

  if (coords.length <= minimum) {
    return { coords, removed: false, reason: reasonForMinimum(type, minimum) }
  }
  if (index < 0 || index >= coords.length) {
    return { coords, removed: false, reason: null }
  }

  return { coords: coords.filter((_, position) => position !== index), removed: true, reason: null }
}

/** Moves a vertex one place up or down — the reorder control's only operation. */
export function moveVertex(coords, index, direction) {
  const target = index + direction
  if (index < 0 || index >= coords.length || target < 0 || target >= coords.length) return coords

  const next = [...coords]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

/* --- Geodesic measurement -------------------------------------------------- */

/** Great-circle distance between two [lon, lat] vertices, in metres. */
export function distanceBetween(a, b) {
  return getDistance(a, b)
}

/** Total geodesic length of a vertex list, in metres. */
export function lengthOf(coords) {
  let total = 0
  for (let index = 1; index < coords.length; index += 1) {
    total += getDistance(coords[index - 1], coords[index])
  }
  return total
}

/** Geodesic perimeter of a polygon's (open) ring, in metres. */
export function perimeterOf(coords) {
  return coords.length < 3 ? 0 : lengthOf(closeRing(coords))
}

/** Geodesic area of a polygon's (open) ring, in square metres. */
export function areaOf(coords) {
  if (coords.length < 3) return 0
  // Measured in 4326 directly: `getArea` reprojects internally when told which
  // projection the geometry is in, so no 3857 round-trip is needed.
  const polygon = new Polygon([closeRing(coords)])
  return Math.abs(getArea(polygon, { projection: 'EPSG:4326' }))
}

/**
 * Initial great-circle bearing from `a` to `b`, in radians.
 *
 * `ol/sphere` gives distance and `offset` (destination from a bearing) but no
 * bearing, so the standard forward-azimuth formula is used. Working on the
 * sphere rather than on screen pixels is what makes "250 metre uzat" mean the
 * same thing at every latitude.
 */
export function bearingBetween(a, b) {
  const toRad = Math.PI / 180
  const lat1 = a[1] * toRad
  const lat2 = b[1] * toRad
  const deltaLon = (b[0] - a[0]) * toRad

  const y = Math.sin(deltaLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon)

  return Math.atan2(y, x)
}

/* --- Line length tools -----------------------------------------------------
   "Uç" is always one of 'start' | 'end'. Extending moves the terminal vertex
   outward along the terminal segment's bearing rather than appending a new one:
   the vertex count stays put, the shape is unchanged, and shortening is its
   exact inverse. */

/**
 * Lengthens a line from one end by `distance` metres, along the direction the
 * terminal segment already points in.
 *
 * @returns {{ ok: boolean, coords: Array, reason: string|null }}
 */
export function extendLine(coords, end, distance) {
  if (coords.length < 2) return fail(coords, 'Çizgi en az 2 nokta içermelidir.')
  if (!Number.isFinite(distance) || distance <= 0) return fail(coords, 'Mesafe sıfırdan büyük olmalıdır.')

  const next = [...coords]

  if (end === 'start') {
    // Bearing points outward: from the second vertex through the first.
    const bearing = bearingBetween(next[1], next[0])
    next[0] = offset(next[0], distance, bearing)
  } else {
    const last = next.length - 1
    const bearing = bearingBetween(next[last - 1], next[last])
    next[last] = offset(next[last], distance, bearing)
  }

  return { ok: true, coords: next, reason: null }
}

/**
 * Shortens a line from one end by `distance` metres.
 *
 * When the requested amount is longer than the terminal segment, whole segments
 * are consumed until the remainder fits — so shortening a multi-segment line by
 * more than its last leg behaves as one continuous walk along the line rather
 * than failing. The interior geometry that survives is left untouched.
 *
 * Shortening by the full length (or more) is refused: a line has to keep at
 * least two vertices, and a zero-length line is not a drawing.
 */
export function shortenLine(coords, end, distance) {
  if (coords.length < 2) return fail(coords, 'Çizgi en az 2 nokta içermelidir.')
  if (!Number.isFinite(distance) || distance <= 0) return fail(coords, 'Mesafe sıfırdan büyük olmalıdır.')

  const total = lengthOf(coords)
  if (distance >= total) {
    return fail(coords, 'Kısaltma miktarı çizginin toplam uzunluğundan küçük olmalıdır.')
  }

  // Walking from the start is the same algorithm reversed, so the list is
  // flipped, shortened from its end, and flipped back.
  const reversed = end === 'start'
  const working = reversed ? [...coords].reverse() : [...coords]

  let remaining = distance

  while (working.length >= 2) {
    const last = working.length - 1
    const segment = getDistance(working[last - 1], working[last])

    if (remaining < segment) {
      // The cut lands inside this segment: pull the endpoint back along it.
      const bearing = bearingBetween(working[last], working[last - 1])
      working[last] = offset(working[last], remaining, bearing)
      break
    }

    // The whole segment is consumed; its endpoint disappears.
    remaining -= segment
    working.pop()

    // Exactly on a vertex — nothing left to trim.
    if (remaining === 0) break
  }

  const result = reversed ? working.reverse() : working
  return { ok: true, coords: result, reason: null }
}

/**
 * Rewrites a line to a target total length, holding one end still.
 *
 * Longer than now  -> the free end is pushed out along its terminal bearing.
 * Shorter than now -> the free end is pulled in, consuming segments as needed.
 *
 * @param {'start'|'end'} fixedEnd the end that must not move
 */
export function setLineTargetLength(coords, target, fixedEnd) {
  if (coords.length < 2) return fail(coords, 'Çizgi en az 2 nokta içermelidir.')
  if (!Number.isFinite(target) || target <= 0) return fail(coords, 'Hedef uzunluk sıfırdan büyük olmalıdır.')

  const current = lengthOf(coords)
  const difference = target - current

  // Sub-millimetre differences are floating-point noise, not an edit.
  if (Math.abs(difference) < 0.001) return { ok: true, coords, reason: null }

  const movingEnd = fixedEnd === 'start' ? 'end' : 'start'

  return difference > 0
    ? extendLine(coords, movingEnd, difference)
    : shortenLine(coords, movingEnd, -difference)
}

function fail(coords, reason) {
  return { ok: false, coords, reason }
}

/* --- Formatting ------------------------------------------------------------ */

/**
 * Fixed-decimal text for a coordinate input.
 *
 * Presentation only: the session keeps whatever precision the map or the user
 * produced, and this never writes back into state. Rounding the stored value
 * would silently move a vertex every time the panel re-rendered.
 */
export function formatCoordinate(value) {
  return Number.isFinite(value) ? value.toFixed(DISPLAY_PRECISION) : ''
}

/** "32.859700, 39.933400" — the copy-to-clipboard format. */
export function formatVertexForCopy(vertex) {
  return `${formatCoordinate(vertex[0])}, ${formatCoordinate(vertex[1])}`
}

/** One vertex per line, for "Tüm Koordinatları Kopyala". */
export function formatCoordsForCopy(coords) {
  return coords.map(formatVertexForCopy).join('\n')
}

/** True when two vertex lists are identical — the session's dirty check. */
export function isSameCoords(a, b) {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  return a.every((vertex, index) => vertex[0] === b[index][0] && vertex[1] === b[index][1])
}
