import assert from 'node:assert/strict'
import test from 'node:test'
import {
  POI_FEATURE_KIND,
  POI_LAYER_Z_INDEX,
  POI_PENDING_LAYER_Z_INDEX,
  featureToPoi,
  formatLonLat,
  poiToFeature,
  toLonLat4326,
} from '../../src/map/poi.js'
import {
  buildWorkHoursPayload,
  emptyWorkHoursDraft,
  validateWorkHoursDraft,
} from '../../src/poi/workHours.js'

/* --- Projeksiyon ------------------------------------------------------------
   Backend EPSG:4326 boylam/enlem döner, harita EPSG:3857 çalışır. Dönüşüm
   OpenLayers'a bırakılır; burada ölçülen şey gidiş-dönüşün kaybettiği bir şey
   OLMADIĞIDIR. */

test('a backend lon/lat lands at the right map coordinate and survives the round trip', () => {
  const feature = poiToFeature({ id: 1, name: 'Ankara', longitude: 32.8597, latitude: 39.9334 })
  const coordinate = feature.getGeometry().getCoordinates()

  // Web Mercator metreleri: derece DEĞİL — elle Mercator matematiği yazılmadı.
  assert.ok(Math.abs(coordinate[0]) > 1000)
  assert.ok(Math.abs(coordinate[1]) > 1000)

  const back = toLonLat4326(coordinate)
  assert.ok(Math.abs(back.longitude - 32.8597) < 1e-9)
  assert.ok(Math.abs(back.latitude - 39.9334) < 1e-9)
})

test('the round trip is not rounded away', () => {
  /* Gönderilen konumun doğruluğu TAM kalmalıdır; yuvarlama yalnızca ekranda
     gösterim içindir. */
  const longitude = 32.859712345
  const latitude = 39.933498765

  const back = toLonLat4326(poiToFeature({ id: 2, longitude, latitude }).getGeometry().getCoordinates())

  assert.notEqual(back.longitude, Number(longitude.toFixed(5)))
  assert.ok(Math.abs(back.longitude - longitude) < 1e-9)
  assert.ok(Math.abs(back.latitude - latitude) < 1e-9)
})

test('display formatting is compact and never crashes on missing values', () => {
  assert.equal(formatLonLat(32.8597, 39.9334), '32.85970, 39.93340')
  assert.equal(formatLonLat(undefined, 39), '—')
  assert.equal(formatLonLat(Number.NaN, 39), '—')
})

test('an unusable coordinate produces no feature at all', () => {
  assert.equal(poiToFeature({ id: 3, longitude: null, latitude: 39 }), null)
  assert.equal(poiToFeature({ id: 4, longitude: Number.NaN, latitude: 39 }), null)
  assert.equal(poiToFeature(null), null)
})

/* --- Feature metadata ------------------------------------------------------- */

test('a POI feature is discriminable and carries no creator or security data', () => {
  const feature = poiToFeature({
    id: 5,
    name: 'Kafe',
    categoryId: 3,
    categoryName: 'Kafe',
    categoryPath: 'Yeme-İçme / Kafe',
    workHours: { monday: { closed: false, open: '09:00', close: '18:00' } },
    longitude: 32.85,
    latitude: 39.93,
  })

  // Ayırt edici: çizim feature'ları `drawingType` taşır, POI bunu.
  assert.equal(feature.get('featureKind'), POI_FEATURE_KIND)
  assert.equal(feature.get('drawingType'), undefined)
  assert.equal(feature.get('poiId'), 5)

  /* Harita sözleşmesinde oluşturan bilgisi zaten yoktur; feature'a da
     konmaz — feature'lar istemci belleğinde serbestçe okunabilir. */
  for (const key of ['creatorUsername', 'creatorUserId', 'userId', 'createdBy', 'isDeleted']) {
    assert.equal(feature.get(key), undefined, `feature leaked "${key}"`)
  }

  const view = featureToPoi(feature)
  assert.deepEqual(Object.keys(view).sort(), [
    'categoryName', 'categoryPath', 'id', 'latitude', 'longitude', 'name', 'workHours',
  ])
})

test('POI layers sit above the drawings and below the transient overlays', () => {
  /* Mevcut yığın: çizimler 10, bekleyen çizim 12, envanter analizi 15.
     POI küçük bir noktadır; büyük bir poligonun altında kalırsa tıklanamaz. */
  assert.ok(POI_LAYER_Z_INDEX > 12)
  assert.ok(POI_PENDING_LAYER_Z_INDEX > POI_LAYER_Z_INDEX)
  assert.ok(POI_PENDING_LAYER_Z_INDEX < 15)
})

/* --- Mesai taslağı → gövde --------------------------------------------------- */

test('an untouched draft declares nothing at all', () => {
  const draft = emptyWorkHoursDraft()

  // Hiçbir gün varsayılan olarak doldurulmaz ve hiçbiri "Kapalı" sayılmaz.
  assert.equal(Object.values(draft).every((day) => !day.enabled && !day.closed), true)
  assert.equal(buildWorkHoursPayload(draft), null)
  assert.deepEqual(validateWorkHoursDraft(draft), {})
})

test('an untouched day stays out of the payload entirely', () => {
  const draft = emptyWorkHoursDraft()
  draft.monday = { enabled: true, closed: false, open: '09:00', close: '18:00' }

  const payload = buildWorkHoursPayload(draft)

  assert.deepEqual(Object.keys(payload), ['monday'])
  // "Belirtilmemiş" bir gün "Kapalı"ya DÖNÜŞMEZ.
  assert.equal('tuesday' in payload, false)
})

test('a closed day submits closed:true and no hours', () => {
  const draft = emptyWorkHoursDraft()
  draft.sunday = { enabled: true, closed: true, open: '09:00', close: '18:00' }

  assert.deepEqual(buildWorkHoursPayload(draft), { sunday: { closed: true } })
})

test('an open day submits strict HH:mm', () => {
  const draft = emptyWorkHoursDraft()
  draft.friday = { enabled: true, closed: false, open: '09:00', close: '18:30' }

  assert.deepEqual(buildWorkHoursPayload(draft), {
    friday: { closed: false, open: '09:00', close: '18:30' },
  })
})

test('a malformed time is rejected and never repaired', () => {
  for (const [open, close] of [['9:00', '18:00'], ['09:5', '18:00'], ['24:00', '18:00'], ['12:60', '18:00'], ['', '18:00']]) {
    const draft = emptyWorkHoursDraft()
    draft.monday = { enabled: true, closed: false, open, close }

    const errors = validateWorkHoursDraft(draft)
    assert.ok(errors.monday, `"${open}" should be rejected`)

    /* Onarım YAPILMAZ: "9:00" sessizce "09:00"a çevrilseydi, sözleşmenin
       geçersiz saydığı bir girdiyi geçerli kılmış olurduk. */
    assert.equal(buildWorkHoursPayload(draft).monday.open, open)
  }
})

test('an opening time that is not before closing is blocked client-side', () => {
  for (const [open, close] of [['18:00', '09:00'], ['09:00', '09:00']]) {
    const draft = emptyWorkHoursDraft()
    draft.monday = { enabled: true, closed: false, open, close }
    assert.ok(validateWorkHoursDraft(draft).monday)
  }
})

test('a closed day is never blocked by time validation', () => {
  const draft = emptyWorkHoursDraft()
  draft.monday = { enabled: true, closed: true, open: 'nonsense', close: '' }

  assert.deepEqual(validateWorkHoursDraft(draft), {})
})

/* --- Katman / kaynak yaşam döngüsü -------------------------------------------
   Tarayıcı testi katman NESNESİNİN içini göremez; sözleşme burada ölçülür:
   katman harita ömrü boyunca ayakta kalır, yetki değişimi ise KAYNAĞI
   boşaltır. */

test('one layer and one source serve every POI', async () => {
  const { createPoiLayer } = await import('../../src/map/poi.js')
  const { source, layer } = createPoiLayer(() => null)

  source.addFeatures([
    poiToFeature({ id: 1, name: 'A', longitude: 32, latitude: 39 }),
    poiToFeature({ id: 2, name: 'B', longitude: 33, latitude: 40 }),
  ])

  assert.equal(source.getFeatures().length, 2)
  assert.equal(layer.getSource(), source)
})

test('a permission change empties the data, not the layer object', async () => {
  const { createPoiLayer } = await import('../../src/map/poi.js')
  const { source, layer } = createPoiLayer(() => null)

  source.addFeature(poiToFeature({ id: 1, name: 'A', longitude: 32, latitude: 39 }))
  assert.equal(source.getFeatures().length, 1)

  /* Yetki alındığında kancanın yaptığı şey budur: kaynak boşalır, katman
     nesnesi ve tuvali yerinde kalır. Katmanı her seferinde yıkıp yeniden
     kurmak, OpenLayers nesnelerini çoğaltır ve dinleyici sızdırırdı. */
  source.clear()

  assert.equal(source.getFeatures().length, 0)
  assert.equal(layer.getSource(), source)
})
