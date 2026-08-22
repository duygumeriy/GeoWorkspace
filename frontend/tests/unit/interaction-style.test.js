import assert from 'node:assert/strict'
import test from 'node:test'
import { createFeatureStyle, createInteractionOnlyStyle } from '../../src/map/featureStyle.js'

/**
 * Phase 5: once the WMS raster owns a type's normal appearance, its vector
 * features must become invisible WITHOUT leaving hit detection. OpenLayers
 * replaces fill and stroke colours during its hit-detection pass, so a
 * zero-alpha colour is invisible on the map and still fully clickable — but
 * only if a Fill/Stroke object actually exists. Returning no style at all is
 * what removes a feature from hit detection, and that is reserved for a
 * layer the user has switched off.
 */

const isTransparent = (color) => /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)$/.test(color)

test('an interaction-only point keeps a fill, so it stays hit-detectable', () => {
  const [style] = createInteractionOnlyStyle('point', { pointRadius: 9, strokeWidth: 4 })
  const image = style.getImage()

  assert.ok(image, 'the point must still have an image to hit-test against')
  assert.equal(image.getRadius(), 9, 'the clickable radius must not change')
  assert.ok(image.getFill(), 'a transparent fill is required, not a missing fill')
  assert.ok(isTransparent(image.getFill().getColor()))
  assert.ok(isTransparent(image.getStroke().getColor()))
})

test('an interaction-only line keeps its stroke width, so the click target is unchanged', () => {
  const [style] = createInteractionOnlyStyle('line', { strokeWidth: 7, lineStyle: 'dashed' })

  assert.ok(style.getStroke())
  assert.equal(style.getStroke().getWidth(), 7)
  assert.ok(isTransparent(style.getStroke().getColor()))
  assert.equal(style.getFill(), null, 'a line has no fill to hit-test')
})

test('an interaction-only polygon keeps a fill, so clicking inside it still selects it', () => {
  const [style] = createInteractionOnlyStyle('polygon', { strokeWidth: 2, fillOpacity: 0.4 })

  assert.ok(style.getFill(), 'without a fill only the outline would be clickable')
  assert.ok(isTransparent(style.getFill().getColor()))
  assert.ok(isTransparent(style.getStroke().getColor()))
})

test('the normal style is untouched and still renders the persisted appearance', () => {
  const styles = createFeatureStyle('polygon', {
    strokeColor: '#DC2626',
    strokeWidth: 5,
    fillColor: '#059669',
    fillOpacity: 0.5,
    lineStyle: 'dashed',
  })

  const [style] = styles
  assert.equal(style.getStroke().getColor(), '#DC2626')
  assert.equal(style.getStroke().getWidth(), 5)
  assert.equal(style.getFill().getColor(), 'rgba(5, 150, 105, 0.5)')
  assert.deepEqual(style.getStroke().getLineDash(), [17, 12])
})
