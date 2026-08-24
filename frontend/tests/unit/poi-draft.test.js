import assert from 'node:assert/strict'
import test from 'node:test'
import { isPoiDraftDirty, poiDraftSnapshot } from '../../src/poi/poiDraft.js'
import { workHoursEqual, workHoursToDraft } from '../../src/poi/workHours.js'

/**
 * POI düzenleme taslağının kirlilik kuralı.
 *
 * Ölçülen şey tek bir cümledir: <b>kullanıcının her alanı değiştirmesi
 * beklenmez.</b> Yalnızca adı, yalnızca kategoriyi ya da yalnızca tek bir
 * mesai gününü değiştirmek "Güncelle"yi açar; hiçbir şey değişmediğinde ya da
 * değişiklik tam olarak geri alındığında kapalı kalır.
 */

const POI = {
  id: 5,
  name: 'Kalesi Kafe',
  categoryId: 3,
  workHours: {
    monday: { closed: false, open: '09:00', close: '18:00' },
    sunday: { closed: true },
  },
}

const draftOf = (poi) => poiDraftSnapshot(poi)

test('an untouched draft is not dirty', () => {
  const original = draftOf(POI)
  assert.equal(isPoiDraftDirty(original, { ...original }), false)
})

test('changing ONLY the name is dirty', () => {
  const original = draftOf(POI)
  assert.equal(isPoiDraftDirty(original, { ...original, name: 'Yeni Ad' }), true)
})

test('changing ONLY the category is dirty', () => {
  const original = draftOf(POI)
  // Kategori kimliği karşılaştırılır; kullanıcı mevcut kategoriyi yeniden
  // seçmek zorunda DEĞİLDİR.
  assert.equal(isPoiDraftDirty(original, { ...original, categoryId: 2 }), true)
})

test('changing ONLY one work-hours day is dirty', () => {
  const original = draftOf(POI)
  const workHours = {
    ...original.workHours,
    monday: { enabled: true, closed: false, open: '10:00', close: '18:00' },
  }

  // Bu, canlı hatanın ta kendisiydi: yalnızca saat değişince Güncelle kapalı kalıyordu.
  assert.equal(isPoiDraftDirty(original, { ...original, workHours }), true)
})

test('marking a day closed, or declaring an unspecified day, is dirty', () => {
  const original = draftOf(POI)

  const closedMonday = {
    ...original.workHours,
    monday: { enabled: true, closed: true, open: '', close: '' },
  }
  assert.equal(isPoiDraftDirty(original, { ...original, workHours: closedMonday }), true)

  const declaredTuesday = {
    ...original.workHours,
    tuesday: { enabled: true, closed: false, open: '08:00', close: '12:00' },
  }
  assert.equal(isPoiDraftDirty(original, { ...original, workHours: declaredTuesday }), true)
})

test('touching a day and restoring it exactly is NOT dirty', () => {
  const original = draftOf(POI)

  /* Kullanıcı bir günü açıp kapatabilir ya da saati değiştirip geri
     yazabilir. Ham nesne kıyası bunu "değişti" sayardı; anlamca eşit olan
     program kirli DEĞİLDİR. */
  const roundTripped = {
    ...original.workHours,
    monday: { enabled: true, closed: false, open: '09:00', close: '18:00' },
  }
  assert.equal(isPoiDraftDirty(original, { ...original, workHours: roundTripped }), false)
})

test('changing every field and reverting each one exactly is NOT dirty', () => {
  const original = draftOf(POI)
  const changed = { name: 'Başka', categoryId: 9, workHours: workHoursToDraft({ friday: { closed: true } }) }

  assert.equal(isPoiDraftDirty(original, changed), true)
  // Tam geri dönüş: "Değişiklikleri Geri Al"ın yaptığı şey.
  assert.equal(isPoiDraftDirty(original, { ...original }), false)
})

test('whitespace around the name is not a change', () => {
  const original = draftOf(POI)
  // Ad kaydedilirken kırpılır; kıyas da aynı ölçüde kırpar.
  assert.equal(isPoiDraftDirty(original, { ...original, name: '  Kalesi Kafe  ' }), false)
})

test('a create draft has no original and is always submittable', () => {
  // Oluşturmada karşılaştırılacak bir referans yoktur.
  assert.equal(isPoiDraftDirty(null, { name: 'Yeni', categoryId: 1, workHours: {} }), true)
})

/* --- Anlamsal program karşılaştırması ---------------------------------------- */

test('work-hours equality is semantic, not structural', () => {
  // Alan sırası farkı bir değişiklik değildir.
  assert.equal(
    workHoursEqual({ monday: { open: '09:00', close: '18:00', closed: false } },
                   { monday: { closed: false, close: '18:00', open: '09:00' } }),
    true,
  )

  // Kapalı günün saatleri anlamsızdır ve kıyasa girmez.
  assert.equal(
    workHoursEqual({ monday: { closed: true } }, { monday: { closed: true, open: '09:00', close: '18:00' } }),
    true,
  )

  // Üç durum ayrı kalır: bildirilmemiş ≠ kapalı ≠ saatli.
  assert.equal(workHoursEqual({}, { monday: { closed: true } }), false)
  assert.equal(workHoursEqual({ monday: { closed: true } }, { monday: { closed: false, open: '09:00', close: '18:00' } }), false)
  assert.equal(
    workHoursEqual({ monday: { closed: false, open: '09:00', close: '18:00' } },
                   { monday: { closed: false, open: '09:00', close: '19:00' } }),
    false,
  )
})

/* --- Konum ------------------------------------------------------------------
   POI artık taşınabilir bir kayıttır: konum düzenlenebilir bir alandır ve
   kirlilik hesabının içindedir. Ölçülen iki şey vardır — gerçek bir taşıma
   "Güncelle"yi AÇMALI, kayan nokta gürültüsü ise AÇMAMALIDIR. */

const PLACED = { ...POI, longitude: 32.8597, latitude: 39.9334 }

const placedDraft = (patch = {}) => ({ ...poiDraftSnapshot(PLACED), ...patch })

test('a POI whose coordinate is untouched is not dirty', () => {
  const original = poiDraftSnapshot(PLACED)
  assert.equal(isPoiDraftDirty(original, placedDraft()), false)
})

test('changing ONLY the longitude is dirty', () => {
  const original = poiDraftSnapshot(PLACED)
  assert.equal(isPoiDraftDirty(original, placedDraft({ longitude: 32.86 })), true)
})

test('changing ONLY the latitude is dirty', () => {
  const original = poiDraftSnapshot(PLACED)
  assert.equal(isPoiDraftDirty(original, placedDraft({ latitude: 39.94 })), true)
})

test('a real drag — metres, not bits — is dirty', () => {
  const original = poiDraftSnapshot(PLACED)
  // ~0.0001° ≈ 11 m: kimsenin kazara yapmadığı bir taşıma.
  assert.equal(
    isPoiDraftDirty(original, placedDraft({ longitude: 32.8598, latitude: 39.9335 })),
    true,
  )
})

test('projection round-trip noise is NOT a change', () => {
  const original = poiDraftSnapshot(PLACED)

  /* İşarete yalnızca dokunup bırakmak, 3857 → 4326 gidiş-dönüşünde son
     basamaklarda gürültü bırakır. Ham eşitlik bunu "taşındı" sayardı ve form
     hiçbir şey yapılmadan kirlenirdi. */
  assert.equal(
    isPoiDraftDirty(original, placedDraft({
      longitude: 32.8597 + 1e-10,
      latitude: 39.9334 - 1e-10,
    })),
    false,
  )
})

test('moving the marker and resetting it exactly is NOT dirty', () => {
  const original = poiDraftSnapshot(PLACED)

  assert.equal(isPoiDraftDirty(original, placedDraft({ longitude: 30.1, latitude: 38.2 })), true)
  /* "Değişiklikleri Geri Al"ın yaptığı şey: anlık görüntüdeki konuma dönmek.
     Anlık görüntü koordinatı TAŞIR — taşımasaydı geri alma noktayı sürüklendiği
     yerde bırakırdı. */
  assert.equal(original.longitude, PLACED.longitude)
  assert.equal(original.latitude, PLACED.latitude)
  assert.equal(isPoiDraftDirty(original, placedDraft()), false)
})

test('a screen that does not edit the location cannot be dirtied by it', () => {
  const original = poiDraftSnapshot(PLACED)

  /* Konum alanı SUNMAYAN bir çağıran (koordinat anahtarları hiç yok) bu
     eksende kirlilik üretmez; `undefined` ile bir sayıyı kıyaslamak formu
     açar açmaz kirli gösterirdi. */
  const { longitude, latitude, ...withoutLocation } = placedDraft()
  assert.equal(isPoiDraftDirty(original, withoutLocation), false)
})

/* --- 24 saat açık ------------------------------------------------------------
   Kirlilik kuralı günün DÖRDÜNCÜ durumunu da anlamalıdır: kesintisiz açık olmak
   ile saatli olmak farklı programlardır. */

const ALWAYS_OPEN = {
  ...POI,
  workHours: { monday: { closed: false, open24Hours: true } },
}

test('switching a range day to 24 hours is dirty', () => {
  const original = poiDraftSnapshot(POI)
  const workHours = {
    ...original.workHours,
    monday: { enabled: true, closed: false, open24Hours: true, open: '', close: '' },
  }

  assert.equal(isPoiDraftDirty(original, { ...original, workHours }), true)
})

test('switching a 24-hour day back to a range is dirty', () => {
  const original = poiDraftSnapshot(ALWAYS_OPEN)
  const workHours = {
    ...original.workHours,
    monday: { enabled: true, closed: false, open24Hours: false, open: '09:00', close: '18:00' },
  }

  assert.equal(isPoiDraftDirty(original, { ...original, workHours }), true)
})

test('leaving 24 hours and coming exactly back is NOT dirty', () => {
  const original = poiDraftSnapshot(ALWAYS_OPEN)

  const changed = {
    ...original.workHours,
    monday: { enabled: true, closed: false, open24Hours: false, open: '17:00', close: '01:00' },
  }
  assert.equal(isPoiDraftDirty(original, { ...original, workHours: changed }), true)

  /* "Değişiklikleri Geri Al"ın yaptığı şey. Terk edilen saatler taslakta kalsa
     bile 24 saat açık bir günün saatleri kıyasa GİRMEZ — program aynıdır. */
  const restored = {
    ...original.workHours,
    monday: { enabled: true, closed: false, open24Hours: true, open: '17:00', close: '01:00' },
  }
  assert.equal(isPoiDraftDirty(original, { ...original, workHours: restored }), false)
})

test('24 hours, closed and unspecified are three distinct schedules', () => {
  assert.equal(workHoursEqual({ monday: { closed: false, open24Hours: true } }, { monday: { closed: true } }), false)
  assert.equal(workHoursEqual({ monday: { closed: false, open24Hours: true } }, {}), false)
  assert.equal(
    workHoursEqual(
      { monday: { closed: false, open24Hours: true } },
      { monday: { closed: false, open: '00:00', close: '23:59' } },
    ),
    false,
  )
  // Alanı taşımayan eski gövde kendisiyle eşittir.
  assert.equal(
    workHoursEqual(
      { monday: { closed: false, open: '09:00', close: '18:00' } },
      { monday: { closed: false, open24Hours: false, open: '09:00', close: '18:00' } },
    ),
    true,
  )
})
