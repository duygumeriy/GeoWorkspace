import assert from 'node:assert/strict'
import test from 'node:test'
import {
  COORDINATE_EPSILON,
  coordinatesEqual,
  formatCoordinateInput,
  isValidCoordinate,
  parseCoordinateInput,
  validateCoordinatePair,
} from '../../src/poi/poiCoordinates.js'

/**
 * Düzenlenebilir POI konumunun sözleşmesi.
 *
 * Ölçülen üç şey var: EPSG:4326 sınırları, kısmi/bozuk girdinin ASLA bir sayıya
 * dönüşmemesi, ve "değişti mi" sorusunun kayan nokta gürültüsüne dayanıklı
 * olması. Doğrulamanın sahibi sunucudur; buradaki kural onun aynısıdır ve
 * garanti reddedilecek bir isteği açmamak içindir.
 */

/* --- Ayrıştırma -------------------------------------------------------------- */

test('a well-formed number is parsed exactly', () => {
  assert.equal(parseCoordinateInput('32.8597'), 32.8597)
  assert.equal(parseCoordinateInput('-179.5'), -179.5)
  assert.equal(parseCoordinateInput('0'), 0)
  // Ondalık ayırıcı olarak virgül de kabul edilir: Türkçe klavyenin varsayılanı.
  assert.equal(parseCoordinateInput('32,8597'), 32.8597)
})

test('partial or malformed input never becomes a number', () => {
  /* Hiçbiri 0'a DÜŞÜRÜLMEZ: yarım yazılmış bir sayı yüzünden POI'nin Gine
     Körfezi'ne atlaması, kullanıcının hiç istemediği bir taşıma olurdu. */
  for (const text of ['', '   ', '-', '.', 'abc', '32.8.5', '1e5', 'NaN', 'Infinity', null, undefined]) {
    assert.equal(parseCoordinateInput(text), null, `"${text}" bir sayı sayılmamalı`)
  }
})

/* --- Sınırlar ---------------------------------------------------------------- */

test('EPSG:4326 limits are enforced on both axes', () => {
  assert.equal(isValidCoordinate({ longitude: 180, latitude: 90 }), true)
  assert.equal(isValidCoordinate({ longitude: -180, latitude: -90 }), true)

  assert.equal(isValidCoordinate({ longitude: 180.1, latitude: 0 }), false)
  assert.equal(isValidCoordinate({ longitude: 0, latitude: 90.1 }), false)
  assert.equal(isValidCoordinate({ longitude: Number.NaN, latitude: 0 }), false)
  assert.equal(isValidCoordinate({ longitude: Number.POSITIVE_INFINITY, latitude: 0 }), false)
})

test('a half coordinate is not a location', () => {
  // Çift olarak sınanır: yalnızca boylamı geçerli bir nokta bir yer göstermez.
  assert.equal(isValidCoordinate({ longitude: 32.8597 }), false)
  assert.equal(isValidCoordinate({ latitude: 39.9334 }), false)
  assert.equal(isValidCoordinate(null), false)
})

test('each axis reports its own error', () => {
  const { valid, errors } = validateCoordinatePair({ longitude: 500, latitude: 500 })

  assert.equal(valid, false)
  assert.ok(errors.longitude)
  assert.ok(errors.latitude)
})

/* --- Eşitlik ----------------------------------------------------------------- */

test('equality is numeric and noise-tolerant, never object identity', () => {
  const a = { longitude: 32.8597, latitude: 39.9334 }

  // Ayrı nesneler, aynı konum.
  assert.equal(coordinatesEqual(a, { ...a }), true)

  // Projeksiyon gidiş-dönüşünün son basamak gürültüsü bir taşıma DEĞİLDİR.
  assert.equal(
    coordinatesEqual(a, { longitude: 32.8597 + COORDINATE_EPSILON / 10, latitude: 39.9334 }),
    true,
  )

  // Eşiğin üstündeki fark gerçek bir taşımadır.
  assert.equal(coordinatesEqual(a, { longitude: 32.8598, latitude: 39.9334 }), false)
  assert.equal(coordinatesEqual(a, null), false)
  assert.equal(coordinatesEqual(null, null), true)
})

test('the epsilon is far below any deliberate move and far above bit noise', () => {
  /* ~1.1 cm. Bir sürüklemenin en küçüğü bile metrelercedir; kayan nokta
     gürültüsü ise 1e-9'un altındadır. Tarih/saat mantığıyla ilgisi yoktur. */
  assert.ok(COORDINATE_EPSILON > 0)
  assert.ok(COORDINATE_EPSILON <= 1e-6)
})

/* --- Gösterim ---------------------------------------------------------------- */

test('the input shows useful precision and drops trailing zeros', () => {
  assert.equal(formatCoordinateInput(32.8597), '32.8597')
  assert.equal(formatCoordinateInput(0), '0')
  assert.equal(formatCoordinateInput(undefined), '')

  /* Kalıcı değer yuvarlanmaz; bu yalnızca kutuya yazılan metindir. Metin, aynı
     konumu ANLAMCA temsil etmeye devam eder. */
  const raw = 32.859712345678
  assert.equal(
    coordinatesEqual(
      { longitude: raw, latitude: 0 },
      { longitude: Number(formatCoordinateInput(raw)), latitude: 0 },
    ),
    true,
  )
})
