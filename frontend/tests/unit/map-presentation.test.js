import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PRESENTATION_IMAGE_LIMITS,
  PRESENTATION_Z_INDEX,
  presentationBbox,
  presentationImageSize,
} from '../../src/map/mapPresentation.js'
import { HEATMAP_LAYER_Z_INDEX } from '../../src/map/heatmap.js'

test('request sizing is deterministic and respects every backend limit', () => {
  for (const [size, ratio] of [
    [[1440, 900], 1],
    [[1280, 800], 1],
    [[768, 1024], 2],
    [[390, 844], 2],
    [[320, 700], 2],
    [[8000, 6000], 4],
  ]) {
    const result = presentationImageSize(size, ratio)
    assert.ok(result.width >= PRESENTATION_IMAGE_LIMITS.minSide)
    assert.ok(result.height >= PRESENTATION_IMAGE_LIMITS.minSide)
    assert.ok(result.width <= PRESENTATION_IMAGE_LIMITS.maxSide)
    assert.ok(result.height <= PRESENTATION_IMAGE_LIMITS.maxSide)
    assert.ok(result.width * result.height <= PRESENTATION_IMAGE_LIMITS.maxPixels)
  }

  assert.deepEqual(presentationImageSize([320, 200], 2), { width: 640, height: 400 })
  assert.deepEqual(presentationImageSize([10, 20]), { width: 64, height: 64 })
})

test('bbox accepts only a finite ordered map extent', () => {
  assert.equal(presentationBbox([1, 2, 3, 4]), '1,2,3,4')
  assert.equal(presentationBbox([3, 2, 1, 4]), null)
  assert.equal(presentationBbox([1, 2, Number.NaN, 4]), null)
  assert.equal(presentationBbox(null), null)
})

test('the presentation rasters sit above the heatmap and below the interaction vectors', () => {
  const values = Object.values(PRESENTATION_Z_INDEX)

  for (const value of values) {
    // The heatmap must stay BELOW the drawings, exactly as it does today.
    assert.ok(value > HEATMAP_LAYER_Z_INDEX)
    // The interaction vector layer is 10 and the pending shape 12.
    assert.ok(value < 10)
  }

  // A point must never end up buried inside a polygon it sits in.
  assert.ok(PRESENTATION_Z_INDEX.polygon < PRESENTATION_Z_INDEX.line)
  assert.ok(PRESENTATION_Z_INDEX.line < PRESENTATION_Z_INDEX.point)
})
