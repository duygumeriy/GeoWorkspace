import assert from 'node:assert/strict'
import test from 'node:test'
import {
  HEATMAP_IMAGE_LIMITS,
  HEATMAP_LAYER_Z_INDEX,
  HEATMAP_STOPS,
  heatmapBbox,
  heatmapImageSize,
} from '../../src/map/heatmap.js'

test('request sizing is deterministic and respects every backend limit', () => {
  for (const [size, ratio] of [
    [[1440, 900], 1],
    [[390, 844], 2],
    [[10, 20], 1],
    [[8000, 6000], 4],
  ]) {
    const result = heatmapImageSize(size, ratio)
    assert.ok(result.width >= HEATMAP_IMAGE_LIMITS.minSide)
    assert.ok(result.height >= HEATMAP_IMAGE_LIMITS.minSide)
    assert.ok(result.width <= HEATMAP_IMAGE_LIMITS.maxSide)
    assert.ok(result.height <= HEATMAP_IMAGE_LIMITS.maxSide)
    assert.ok(result.width * result.height <= HEATMAP_IMAGE_LIMITS.maxPixels)
  }

  assert.deepEqual(heatmapImageSize([320, 200], 2), { width: 640, height: 400 })
  assert.deepEqual(heatmapImageSize([10, 20]), { width: 64, height: 64 })
})

test('bbox accepts only a finite ordered map extent', () => {
  assert.equal(heatmapBbox([1, 2, 3, 4]), '1,2,3,4')
  assert.equal(heatmapBbox([3, 2, 1, 4]), null)
  assert.equal(heatmapBbox([1, 2, Number.NaN, 4]), null)
})

test('layer order and legend values match the Phase 4 contract', () => {
  assert.ok(HEATMAP_LAYER_Z_INDEX > 4)
  assert.ok(HEATMAP_LAYER_Z_INDEX < 10)
  assert.deepEqual(
    HEATMAP_STOPS.map(({ value, color }) => [value, color]),
    [
      [0, 'transparent'],
      [0.25, '#2C7BB6'],
      [0.5, '#00A6CA'],
      [0.75, '#F9D057'],
      [1, '#D7191C'],
    ],
  )
})
