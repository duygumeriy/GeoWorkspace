/**
 * The normal (persisted) drawing presentation raster.
 *
 * Phase 5 moves the *general display* of saved drawings to WMS: the browser
 * asks the application's own authenticated endpoint for a PNG per geometry
 * type and stacks the three images over the basemap. The WFS-backed vector
 * features stay loaded and keep owning interaction — selection, the popup,
 * Modify, Translate and the analysis links all still work on real features.
 *
 * `heatmap.js` deliberately keeps its own copy of the size/bbox helpers: the
 * heatmap is a finished, separately-tested Phase 3/4 path and Phase 5 does not
 * touch it. The two share the backend's limits, not a module.
 */

/* Render order. The geographic-scope overlay sits at 4 and the heatmap at 6;
   the interaction vectors stay at 10 and the pending shape at 12.
   The three presentation rasters therefore live in 7–9, which keeps the
   heatmap BELOW the drawings exactly as it is today — placing them under the
   heatmap would have inverted the existing stack and let the density blobs
   paint over the user's own shapes. Points draw last so a point is never
   buried under a polygon it sits inside. */
export const PRESENTATION_Z_INDEX = Object.freeze({
  polygon: 7,
  line: 8,
  point: 9,
})

/** Same debounce as the heatmap: one request per settled viewport, not per frame. */
export const PRESENTATION_REQUEST_DEBOUNCE_MS = 180

/** Mirrors WmsRenderContract on the backend; the server re-checks all of it. */
export const PRESENTATION_IMAGE_LIMITS = Object.freeze({
  minSide: 64,
  maxSide: 2048,
  maxPixels: 4_194_304,
})

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

/**
 * A sharp request size that never exceeds the backend contract. The aspect
 * ratio is preserved while the max-side and total-pixel limits are applied;
 * very small viewports still satisfy the 64px minimum.
 */
export function presentationImageSize(mapSize, devicePixelRatio = 1) {
  const [cssWidth = 0, cssHeight = 0] = mapSize ?? []
  const ratio = clamp(Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1, 1, 2)
  let width = Math.max(PRESENTATION_IMAGE_LIMITS.minSide, Math.round(cssWidth * ratio))
  let height = Math.max(PRESENTATION_IMAGE_LIMITS.minSide, Math.round(cssHeight * ratio))

  const scale = Math.min(
    1,
    PRESENTATION_IMAGE_LIMITS.maxSide / width,
    PRESENTATION_IMAGE_LIMITS.maxSide / height,
    Math.sqrt(PRESENTATION_IMAGE_LIMITS.maxPixels / (width * height)),
  )

  width = clamp(Math.floor(width * scale), PRESENTATION_IMAGE_LIMITS.minSide, PRESENTATION_IMAGE_LIMITS.maxSide)
  height = clamp(Math.floor(height * scale), PRESENTATION_IMAGE_LIMITS.minSide, PRESENTATION_IMAGE_LIMITS.maxSide)
  return { width, height }
}

export function presentationBbox(extent) {
  if (!Array.isArray(extent) || extent.length !== 4 || !extent.every(Number.isFinite)) return null
  if (extent[0] >= extent[2] || extent[1] >= extent[3]) return null
  return extent.join(',')
}
