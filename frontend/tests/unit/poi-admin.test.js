import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CLOSED,
  UNSPECIFIED,
  dayText,
  hasSchedule,
  summarize,
  weekSchedule,
} from '../../src/poi/workHours.js'
import {
  MAX_INDENT_DEPTH,
  categoryStatus,
  indentOf,
  optionLabel,
  parentOptions,
} from '../../src/components/admin/poiCategories.js'

/* --- Mesai saatleri ---------------------------------------------------------
   Ölçülen şey ham JSON'un okunabilir metne çevrilmesi ve — daha önemlisi —
   verilmeyen hiçbir saatin UYDURULMAMASIDIR. */

const open = (o, c) => ({ closed: false, open: o, close: c })
const shut = () => ({ closed: true })

test('a day is unspecified, closed, or a range — and never invented', () => {
  assert.equal(dayText(undefined), UNSPECIFIED)
  assert.equal(dayText(null), UNSPECIFIED)
  assert.equal(dayText(shut()), CLOSED)
  assert.equal(dayText(open('09:00', '18:00')), '09:00 – 18:00')

  // Yarım veri bir aralık DEĞİLDİR; eksik ucu tamamlamak uydurmak olurdu.
  assert.equal(dayText({ closed: false, open: '09:00' }), UNSPECIFIED)
  assert.equal(dayText({ closed: false, close: '18:00' }), UNSPECIFIED)

  // Kapalı gün, saat taşısa bile kapalıdır: çelişkili satır saat göstermez.
  assert.equal(dayText({ closed: true, open: '09:00', close: '18:00' }), CLOSED)
})

test('the detail view always lists seven Turkish days in week order', () => {
  const week = weekSchedule({ monday: open('09:00', '18:00'), sunday: shut() })

  assert.equal(week.length, 7)
  assert.deepEqual(
    week.map((day) => day.label),
    ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'],
  )
  assert.equal(week[0].text, '09:00 – 18:00')
  assert.equal(week[6].text, CLOSED)
  // Gönderilmeyen gün "bilinmiyor"dur, kapalı değil.
  assert.equal(week[1].text, UNSPECIFIED)
})

test('an absent or empty schedule summarizes as unspecified', () => {
  assert.equal(hasSchedule(null), false)
  assert.equal(hasSchedule({}), false)
  assert.equal(summarize(null), UNSPECIFIED)
  assert.equal(summarize({}), UNSPECIFIED)
})

test('a uniform week collapses into one line', () => {
  const everyDay = Object.fromEntries(
    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
      .map((key) => [key, open('09:00', '18:00')]),
  )

  assert.equal(summarize(everyDay), 'Her gün 09:00 – 18:00')
})

test('a weekday pattern is summarized only when the data actually says so', () => {
  const weekdays = {
    monday: open('09:00', '18:00'),
    tuesday: open('09:00', '18:00'),
    wednesday: open('09:00', '18:00'),
    thursday: open('09:00', '18:00'),
    friday: open('09:00', '18:00'),
  }

  // Hafta sonu BİLDİRİLMEMİŞ: özet onun hakkında hiçbir şey iddia etmez.
  assert.equal(summarize(weekdays), 'Hafta içi 09:00 – 18:00')

  assert.equal(
    summarize({ ...weekdays, saturday: shut(), sunday: shut() }),
    'Hafta içi 09:00 – 18:00, hafta sonu kapalı',
  )

  assert.equal(
    summarize({ ...weekdays, saturday: open('10:00', '16:00'), sunday: open('10:00', '16:00') }),
    'Hafta içi 09:00 – 18:00, hafta sonu 10:00 – 16:00',
  )
})

test('an irregular schedule falls back to the first declared day plus a count', () => {
  assert.equal(summarize({ monday: open('09:00', '18:00') }), 'Pazartesi 09:00 – 18:00')

  assert.equal(
    summarize({ monday: open('09:00', '18:00'), wednesday: open('10:00', '20:00') }),
    'Pazartesi 09:00 – 18:00 +1 gün',
  )

  // Hafta içi düzensizse "Hafta içi …" ÜRETİLMEZ.
  assert.equal(
    summarize({
      monday: open('09:00', '18:00'),
      tuesday: open('11:00', '19:00'),
      wednesday: open('09:00', '18:00'),
      thursday: open('09:00', '18:00'),
      friday: open('09:00', '18:00'),
    }),
    'Pazartesi 09:00 – 18:00 +4 gün',
  )
})

test('a summary never contains raw JSON punctuation', () => {
  const rendered = summarize({ monday: open('09:00', '18:00'), sunday: shut() })

  for (const token of ['{', '}', '"', 'closed', 'monday']) {
    assert.ok(!rendered.includes(token), `summary leaked "${token}"`)
  }
})

/* --- Kategori yardımcıları --------------------------------------------------- */

test('deleted takes precedence over inactive in the status badge', () => {
  assert.deepEqual(categoryStatus({ isActive: true, isDeleted: false }), { label: 'Aktif', tone: 'success' })
  assert.deepEqual(categoryStatus({ isActive: false, isDeleted: false }), { label: 'Pasif', tone: 'warning' })
  assert.deepEqual(categoryStatus({ isActive: false, isDeleted: true }), { label: 'Silinmiş', tone: 'danger' })
  // Silinmiş ama "aktif" işaretli bir satır da silinmiştir.
  assert.deepEqual(categoryStatus({ isActive: true, isDeleted: true }), { label: 'Silinmiş', tone: 'danger' })
})

test('indentation is capped so a deep branch cannot overflow the row', () => {
  assert.equal(indentOf({ depth: 0 }), 0)
  assert.equal(indentOf({ depth: 3 }), 3)
  assert.equal(indentOf({}), 0)
  assert.equal(indentOf({ depth: 99 }), MAX_INDENT_DEPTH)
})

const TREE = [
  { id: 1, name: 'Yeme-İçme', parentId: null, path: 'Yeme-İçme', depth: 0, isActive: true, isDeleted: false },
  { id: 2, name: 'Restoran', parentId: 1, path: 'Yeme-İçme / Restoran', depth: 1, isActive: true, isDeleted: false },
  { id: 3, name: 'Kafe', parentId: 1, path: 'Yeme-İçme / Kafe', depth: 1, isActive: false, isDeleted: false },
  { id: 4, name: 'Kaldırıldı', parentId: null, path: 'Kaldırıldı', depth: 0, isActive: true, isDeleted: true },
  { id: 5, name: 'Alışveriş', parentId: null, path: 'Alışveriş', depth: 0, isActive: true, isDeleted: false },
]

test('inactive and deleted categories are never offered as parents', () => {
  // Sunucu da ikisini reddeder; listede tutmak garanti hatalı bir seçenek olurdu.
  assert.deepEqual(parentOptions(TREE).map((c) => c.id), [1, 2, 5])
})

test('a category is never offered as its own parent', () => {
  assert.ok(!parentOptions(TREE, TREE[0]).some((c) => c.id === 1))
  assert.ok(!parentOptions(TREE, TREE[1]).some((c) => c.id === 2))
})

test('descendants are excluded when the path data supports it', () => {
  /* Alt ağaç elemesi bir KOLAYLIKTIR: yol ön ekinden türetilir ve emin
     olunamayan durumda seçenek listede kalır — döngü kararının sahibi
     sunucudur. */
  assert.deepEqual(parentOptions(TREE, TREE[0]).map((c) => c.id), [5])

  // Yaprak düzenlenirken kardeşi ve kökü hâlâ seçilebilir.
  assert.deepEqual(parentOptions(TREE, TREE[1]).map((c) => c.id), [1, 5])
})

test('dropdown labels carry the full path so siblings stay distinguishable', () => {
  assert.equal(optionLabel(TREE[0]), 'Yeme-İçme')
  assert.equal(optionLabel(TREE[1]), 'Yeme-İçme / Restoran')
  // Yol yoksa ada düşer; boş etiket üretilmez.
  assert.equal(optionLabel({ name: 'Adsız yol', path: '' }), 'Adsız yol')
})
