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
  OPEN_24_HOURS,
  buildWorkHoursPayload,
  dayText,
  emptyWorkHoursDraft,
  formatHourRange,
  isOvernightRange,
  summarize,
  validateWorkHoursDraft,
  workHoursToDraft,
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

test('a POI feature is discriminable and carries only map-safe metadata', () => {
  /* Feature YETENEK taşır, KİMLİK taşımaz.
     `canUpdate` / `canDelete` "bu ÇAĞIRAN bu kayıtta ne yapabilir" der ve
     bilgi panelinin Düzenle/Sil düğmelerini süren tek şeydir; kaydı KİMİN
     eklediğini söylemez. Sahibi taşımak, feature'lar istemci belleğinde
     serbestçe okunabildiği için haritayı sessizce bir personel dizinine
     çevirirdi — bayrak ise aynı arayüzü sızıntısız kurar. Bayraklar bir
     güvenlik sınırı da DEĞİLDİR: PUT/DELETE/restore aynı kararı sunucuda
     yeniden verir. */
  const feature = poiToFeature({
    id: 5,
    name: 'Kafe',
    categoryId: 3,
    categoryName: 'Kafe',
    categoryPath: 'Yeme-İçme / Kafe',
    workHours: { monday: { closed: false, open: '09:00', close: '18:00' } },
    longitude: 32.85,
    latitude: 39.93,
    canUpdate: true,
    canDelete: true,
  })

  // Ayırt edici: çizim feature'ları `drawingType` taşır, POI bunu.
  assert.equal(feature.get('featureKind'), POI_FEATURE_KIND)
  assert.equal(feature.get('drawingType'), undefined)
  assert.equal(feature.get('poiId'), 5)

  const view = featureToPoi(feature)

  // Panelin okuduğu gövde: yetenek bayrakları DÂHİL, kimlik HARİÇ.
  assert.deepEqual(Object.keys(view).sort(), [
    'canDelete',
    'canUpdate',
    /* Kategori KİMLİĞİ de taşınır: düzenleme formu kaydın mevcut
       kategorisini önceden seçili açabilmelidir. Harita sözleşmesinin zaten
       döndürdüğü bir alandır ve sahiplik bilgisi DEĞİLDİR. */
    'categoryId',
    'categoryName',
    'categoryPath',
    'id',
    'latitude',
    'longitude',
    'name',
    'workHours',
  ])

  /* Harita sözleşmesinde oluşturan bilgisi zaten yoktur; feature'a ve
     panele de konmaz. Adlar tek tek sayılır ki testin adı doğrudan
     kanıtlansın. */
  const forbidden = [
    'userId',
    'creatorUserId',
    'creatorUsername',
    'ownerId',
    'ownerUsername',
    'createdBy',
    'createdByUserId',
    // Sunucuya ait durum alanları da haritaya çıkmaz: liste zaten yalnızca
    // aktif ve silinmemiş kayıtları taşır.
    'isDeleted',
    'isActive',
  ]

  for (const key of forbidden) {
    assert.equal(feature.get(key), undefined, `feature leaked "${key}"`)
    assert.ok(!(key in view), `panel view leaked "${key}"`)
  }

  /* Ad KALIBI üzerinden ikinci bir kapı: yukarıdaki listede olmayan yeni bir
     sahiplik alanı (ör. addedByUserId) da geçemesin. Kalıplar bilinçli olarak
     "user/creator/owner"dır — izinli bayraklar (`canUpdate` / `canDelete`)
     hiçbirini içermez, dolayısıyla yanlışlıkla yakalanmazlar. */
  for (const pattern of ['user', 'creator', 'owner']) {
    assert.ok(
      !Object.keys(view).some((key) => key.toLowerCase().includes(pattern)),
      `panel view exposed an identity-shaped field matching "${pattern}"`,
    )
  }
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

/* --- Gece aşan mesai ---------------------------------------------------------
   Sözleşme DEĞİŞTİ: sayıca küçük bir kapanış saati artık geçersiz değil, ERTESİ
   GÜN demektir. Geçersiz olan tek durum aralığın hiç olmamasıdır. */

test('an overnight interval is valid: it closes on the NEXT day', () => {
  for (const [open, close] of [['17:00', '01:00'], ['18:00', '02:00'], ['23:30', '03:00']]) {
    const draft = emptyWorkHoursDraft()
    draft.monday = { enabled: true, closed: false, open, close }

    assert.deepEqual(
      validateWorkHoursDraft(draft),
      {},
      `${open} -> ${close} gerçek bir gece mesaisidir ve reddedilmemelidir`,
    )

    // Saatler OLDUĞU GİBİ gönderilir; ek bir bayrak uydurulmaz.
    assert.deepEqual(buildWorkHoursPayload(draft).monday, { closed: false, open, close })
  }
})

test('equal opening and closing times are rejected — not read as "open 24h"', () => {
  const draft = emptyWorkHoursDraft()
  draft.monday = { enabled: true, closed: false, open: '17:00', close: '17:00' }

  /* Eşitliği 24 saat saymak, veriden türetilemeyen bir anlam uydurmak olurdu:
     24 saat desteği istenirse kendi alanıyla açıkça eklenmelidir. */
  assert.ok(validateWorkHoursDraft(draft).monday)
})

test('an overnight range says so wherever it is summarized', () => {
  assert.equal(isOvernightRange('17:00', '01:00'), true)
  assert.equal(isOvernightRange('09:00', '18:00'), false)
  // Biçimi bozuk bir değer YORUMLANMAZ.
  assert.equal(isOvernightRange('9:00', '01:00'), false)

  assert.equal(formatHourRange('09:00', '18:00'), '09:00 – 18:00')
  assert.ok(formatHourRange('17:00', '01:00').includes('ertesi gün'))

  // Tek biçimlendirici: gün metni ve haftalık özet aynı cümleyi üretir.
  assert.equal(dayText({ closed: false, open: '17:00', close: '01:00' }), formatHourRange('17:00', '01:00'))
  assert.ok(summarize({ monday: { closed: false, open: '17:00', close: '01:00' } }).includes('ertesi gün'))
})

test('an overnight day on Monday does not touch Tuesday', () => {
  const draft = emptyWorkHoursDraft()
  draft.monday = { enabled: true, closed: false, open: '17:00', close: '01:00' }

  const payload = buildWorkHoursPayload(draft)

  /* Pazartesi'nin aralığı Salı 01:00'de kapanır ama Salı'nın KENDİ programı
     bundan etkilenmez: gövdeye Salı hiç girmez. */
  assert.deepEqual(Object.keys(payload), ['monday'])
})

/* --- 24 saat açık ------------------------------------------------------------
   Günün DÖRDÜNCÜ durumu. Kapalı ve saatli aralıktan ayrıdır ve eşit saatlerle
   TEMSİL EDİLMEZ — o gösterim geçersiz kalır. */

test('a 24-hour day is declared explicitly and carries no hours', () => {
  const draft = emptyWorkHoursDraft()
  draft.monday = { enabled: true, closed: false, open24Hours: true, open: '', close: '' }

  // Sahte bir 00:00–23:59 aralığı UYDURULMAZ; bayrak açıkça gider.
  assert.deepEqual(buildWorkHoursPayload(draft), {
    monday: { closed: false, open24Hours: true },
  })
})

test('a 24-hour day has nothing to validate', () => {
  const draft = emptyWorkHoursDraft()
  // Saat alanları boş, hatta bozuk olsa bile: o gün için saat diye bir şey yok.
  draft.monday = { enabled: true, closed: false, open24Hours: true, open: 'saçma', close: '' }

  assert.deepEqual(validateWorkHoursDraft(draft), {})
})

test('24 hours, closed and unspecified stay three different things', () => {
  assert.equal(dayText({ closed: false, open24Hours: true }), OPEN_24_HOURS)
  assert.equal(dayText({ closed: true }), 'Kapalı')
  assert.equal(dayText(undefined), 'Belirtilmemiş')

  // Bozuk bir kayıtta (ikisi de true) "Kapalı" kazanır; sunucu böyle bir
  // gövdeyi zaten reddeder.
  assert.equal(dayText({ closed: true, open24Hours: true }), 'Kapalı')
})

test('a uniform 24-hour week collapses in the shared summary', () => {
  const week = Object.fromEntries(
    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
      .map((key) => [key, { closed: false, open24Hours: true }]),
  )

  assert.equal(summarize(week), `Her gün ${OPEN_24_HOURS}`)
})

test('a 24-hour day is not confused with an overnight one', () => {
  /* 17:00 – 01:00 gece aşan bir aralıktır, 24 saat açık DEĞİLDİR. İkisi ayrı
     kavramlardır ve ayrı metinlerle görünürler. */
  const overnight = dayText({ closed: false, open: '17:00', close: '01:00' })

  assert.ok(overnight.includes('ertesi gün'))
  assert.notEqual(overnight, OPEN_24_HOURS)
})

test('legacy stored days without the 24-hour field hydrate as false', () => {
  /* Alanı hiç taşımayan ESKİ satırlar geçerlidir: jsonb kolonuna yeni bir
     özellik eklemek eski gövdeleri bozmaz. */
  const draft = workHoursToDraft({
    monday: { closed: false, open: '09:00', close: '18:00' },
    sunday: { closed: true },
  })

  assert.equal(draft.monday.open24Hours, false)
  assert.equal(draft.sunday.open24Hours, false)
  // Gövde de aynen geri üretilir; hiçbir alan eklenmez.
  assert.deepEqual(buildWorkHoursPayload(draft), {
    monday: { closed: false, open: '09:00', close: '18:00' },
    sunday: { closed: true },
  })
})

test('a stored 24-hour day hydrates back into the form', () => {
  const draft = workHoursToDraft({ monday: { closed: false, open24Hours: true } })

  assert.equal(draft.monday.enabled, true)
  assert.equal(draft.monday.open24Hours, true)
  assert.equal(draft.monday.closed, false)
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

/* --- Sahiplik yetenekleri ---------------------------------------------------
   Bilgi panelindeki "Düzenle"/"Sil", kaydın SUNUCUDAN gelen yetenek
   bayraklarına bakar. Bayraklar feature üzerinde taşınır, çünkü paneli açan
   yol haritadaki feature'dır; sahiplik kuralı tarayıcıda yeniden
   hesaplanmaz — kaydın SAHİBİ zaten harita sözleşmesinde yoktur. */

test('capability flags survive the feature round trip', () => {
  const own = featureToPoi(poiToFeature({
    id: 1, name: 'Kendi', longitude: 32.8597, latitude: 39.9334, canUpdate: true, canDelete: true,
  }))

  assert.equal(own.canUpdate, true)
  assert.equal(own.canDelete, true)
})

test('a record without capability flags offers nothing (fail-closed)', () => {
  // Eski/dar bir yanıt (analiz sonucu gibi) hiçbir eylem sunmamalıdır.
  const foreign = featureToPoi(poiToFeature({ id: 2, name: 'Yabancı', longitude: 32.87, latitude: 39.94 }))

  assert.equal(foreign.canUpdate, false)
  assert.equal(foreign.canDelete, false)
})

test('a foreign record is still fully visible', () => {
  /* Sahiplik MUTASYONU kısıtlar, GÖRÜNÜRLÜĞÜ değil: yabancı kayıt haritaya ve
     bilgi paneline eksiksiz gelir. */
  const foreign = featureToPoi(poiToFeature({
    id: 3, name: 'Başkasının', categoryPath: 'Yeme-İçme / kafe',
    longitude: 32.87, latitude: 39.94, canUpdate: false, canDelete: false,
  }))

  assert.equal(foreign.name, 'Başkasının')
  assert.equal(foreign.categoryPath, 'Yeme-İçme / kafe')
})
