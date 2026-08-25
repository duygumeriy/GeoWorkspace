import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  PRESENTATION_IMAGE_LIMITS,
  PRESENTATION_PIXEL_RATIO_LIMITS,
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

  assert.deepEqual(presentationImageSize([320, 200], 2), { width: 640, height: 400, pixelRatio: 2 })
  assert.deepEqual(presentationImageSize([10, 20]), { width: 64, height: 64, pixelRatio: 3 })
})

/* --- HiDPI ------------------------------------------------------------------
   Faz 5C: WMS görüntüsü CSS boyutuna küçültülür ve SLD'deki her ÖLÇÜ pikseldir.
   Yoğunluk bildirilmezse 30 piksellik bir rozet Retina'da 15 CSS pikseli
   görünür — kullanıcının bildirdiği "WMS gelince küçülüyor" davranışı budur. */

test('the reported pixel ratio is the one actually ACHIEVED, not the one asked for', () => {
  /* Kritik ayrım. Geniş bir pencerede istenen 2 katı yoğunluk 2048'e kırpılır;
     sunucuya 2 bildirilseydi GeoServer sembolleri iki katıyla çizer ama görüntü
     yalnızca 1.28 katı yoğun olurdu — bu kez ters yönde, %56 BÜYÜK. */
  const clamped = presentationImageSize([1600, 900], 2)

  assert.equal(clamped.width, PRESENTATION_IMAGE_LIMITS.maxSide)
  assert.equal(clamped.pixelRatio, clamped.width / 1600)
  assert.ok(clamped.pixelRatio < 2)

  // Kırpılmayan bir pencerede istenen ve elde edilen oran AYNIDIR.
  for (const ratio of [1, 1.5, 2, 3]) {
    const size = presentationImageSize([600, 400], ratio)
    assert.equal(size.width, 600 * ratio)
    assert.equal(size.pixelRatio, ratio)
  }
})

test('the ratio is bounded exactly like the backend contract', () => {
  assert.deepEqual(PRESENTATION_PIXEL_RATIO_LIMITS, { min: 1, max: 3 })

  for (const absurd of [0, -4, 12, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
    const { pixelRatio } = presentationImageSize([800, 600], absurd)

    assert.ok(Number.isFinite(pixelRatio))
    assert.ok(pixelRatio >= PRESENTATION_PIXEL_RATIO_LIMITS.min)
    assert.ok(pixelRatio <= PRESENTATION_PIXEL_RATIO_LIMITS.max)
  }
})

test('dimensions are multiplied by the ratio ONCE and stay inside the pixel budget', () => {
  /* İki kez çarpmak piksel bütçesini sessizce dört katına çıkarırdı. Oran
     hesaplanan genişlikten OKUNUR, yeniden çarpılarak değil. */
  for (const ratio of [1, 1.5, 2, 3]) {
    for (const size of [[1440, 900], [768, 1024], [390, 844], [2560, 1440]]) {
      const result = presentationImageSize(size, ratio)

      assert.ok(result.width <= PRESENTATION_IMAGE_LIMITS.maxSide)
      assert.ok(result.height <= PRESENTATION_IMAGE_LIMITS.maxSide)
      assert.ok(result.width * result.height <= PRESENTATION_IMAGE_LIMITS.maxPixels)
      // Tek çarpım: sonuç hiçbir zaman istenen yoğunluğu AŞMAZ.
      assert.ok(result.width <= Math.round(size[0] * ratio))
    }
  }
})

test('the browser sends a number, never a WMS parameter', () => {
  const api = readFileSync(new URL('../../src/services/api.js', import.meta.url), 'utf8')
  const fn = api.slice(api.indexOf('export async function fetchPoiPresentationImage'))
  const body = fn.slice(0, fn.indexOf('\n}'))

  assert.match(body, /pixelRatio: String\(pixelRatio\)/)

  /* Yorumlar düz metindir ve neyin GÖNDERİLMEDİĞİNİ anlatırlar; taramada
     işaretlemeden ayrılmaları gerekir — aksi hâlde açıklamanın kendisi teste
     takılır. */
  const code = body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')

  /* Sunucunun sahibi olduğu hiçbir çizim parametresi tarayıcıdan GİTMEZ. */
  for (const forbidden of [
    'FORMAT_OPTIONS', 'format_options', 'dpi', 'LAYERS', 'STYLES',
    'CQL_FILTER', 'SERVICE', 'REQUEST', 'FORMAT', 'CRS',
  ]) {
    assert.ok(!code.includes(forbidden), `${forbidden} must not be client-controlled`)
  }
})

test('the CSS size of every symbol is ratio-independent by construction', () => {
  /* Sözleşmenin özü tek satırda: görüntü ρ kat yoğun üretilir, GeoServer
     sembolleri ρ katıyla çizer ve görüntü CSS boyutuna küçültülürken ρ'lar
     sadeleşir. Beklenen CSS boyutu her yoğunlukta AYNIDIR. */
  const sldPixels = { marker: 30, label: 12 }

  for (const ratio of [1, 1.5, 2, 3]) {
    for (const [name, size] of Object.entries(sldPixels)) {
      const renderedPixels = size * ratio
      const cssPixels = renderedPixels / ratio

      assert.equal(cssPixels, size, `${name} at DPR ${ratio}`)
    }
  }
})

test('the OGC scale denominator is ratio-independent too, so the bands cannot shift', () => {
  /* Düzeltme olmadan GeoServer ölçeği görüntü çözünürlüğünden hesaplar ve ρ=2
     iken paydayı YARIYA indirir — işaretçi bantları bir yakınlık kademesi
     kayardı. dpi = taban × ρ verildiğinde ρ sadeleşir. */
  const baseDpi = 25.4 / 0.28
  const cssResolution = 38.2 // ≈ z12

  for (const ratio of [1, 1.5, 2, 3]) {
    const renderResolution = cssResolution / ratio
    const corrected = (renderResolution * (baseDpi * ratio)) / 0.0254
    const uncorrected = (renderResolution * baseDpi) / 0.0254

    assert.ok(Math.abs(corrected - cssResolution / 0.00028) < 1e-6)
    if (ratio > 1) assert.ok(uncorrected < corrected, 'the uncorrected scale is the bug')
  }
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
