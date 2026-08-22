export const HEATMAP_LAYER_Z_INDEX = 6
export const HEATMAP_DEFAULT_OPACITY = 0.75
export const HEATMAP_REQUEST_DEBOUNCE_MS = 180

export const HEATMAP_IMAGE_LIMITS = Object.freeze({
  minSide: 64,
  maxSide: 2048,
  maxPixels: 4_194_304,
})

export const HEATMAP_STOPS = Object.freeze([
  { value: 0, label: '0', color: 'transparent' },
  { value: 0.25, label: '0.25', color: '#2C7BB6' },
  { value: 0.5, label: '0.50', color: '#00A6CA' },
  { value: 0.75, label: '0.75', color: '#F9D057' },
  { value: 1, label: '1', color: '#D7191C' },
])

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

/**
 * Produces a sharp request size without ever exceeding the backend contract.
 * The aspect ratio is preserved while max-side and total-pixel limits are
 * applied; very small viewports still satisfy the 64px minimum.
 */
export function heatmapImageSize(mapSize, devicePixelRatio = 1) {
  const [cssWidth = 0, cssHeight = 0] = mapSize ?? []
  const ratio = clamp(Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1, 1, 2)
  let width = Math.max(HEATMAP_IMAGE_LIMITS.minSide, Math.round(cssWidth * ratio))
  let height = Math.max(HEATMAP_IMAGE_LIMITS.minSide, Math.round(cssHeight * ratio))

  const scale = Math.min(
    1,
    HEATMAP_IMAGE_LIMITS.maxSide / width,
    HEATMAP_IMAGE_LIMITS.maxSide / height,
    Math.sqrt(HEATMAP_IMAGE_LIMITS.maxPixels / (width * height)),
  )

  width = clamp(Math.floor(width * scale), HEATMAP_IMAGE_LIMITS.minSide, HEATMAP_IMAGE_LIMITS.maxSide)
  height = clamp(Math.floor(height * scale), HEATMAP_IMAGE_LIMITS.minSide, HEATMAP_IMAGE_LIMITS.maxSide)
  return { width, height }
}

export function heatmapBbox(extent) {
  if (!Array.isArray(extent) || extent.length !== 4 || !extent.every(Number.isFinite)) return null
  if (extent[0] >= extent[2] || extent[1] >= extent[3]) return null
  return extent.join(',')
}
