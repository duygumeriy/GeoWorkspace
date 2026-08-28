import assert from 'node:assert/strict'
import test from 'node:test'
import {
  TRASH_TYPE_FILTERS,
  buildTrashView,
  trashRecordOf,
} from '../../src/map/trashFilters.js'
import { TYPE_FILTERS } from '../../src/map/drawingFilters.js'

/* Çöp kutusu tek listedir: çizim girişleri `drawing`, POI girişleri `poi`
   taşır ve ikisi de aynı şekle sahiptir. */
const ITEMS = [
  { type: 'point', deletedAt: '2026-08-20T10:00:00Z', drawing: { id: 1, name: 'Ankara noktası' } },
  { type: 'polygon', deletedAt: '2026-08-21T10:00:00Z', drawing: { id: 2, name: 'Bölge' } },
  {
    type: 'poi',
    deletedAt: '2026-08-22T10:00:00Z',
    creatorUsername: 'operator-a',
    poi: { id: 5, name: 'Kalesi Kafe', categoryPath: 'Yeme-İçme / kafe' },
  },
]

test('a soft-deleted POI appears in the same trash as drawings', () => {
  const { items } = buildTrashView(ITEMS, {})

  // En son silinen başta: POI listenin başındadır.
  assert.equal(items[0].type, 'poi')
  assert.equal(items.length, 3)
})

test('the type filter can narrow the list to POIs alone', () => {
  const { items } = buildTrashView(ITEMS, { type: 'poi' })

  assert.equal(items.length, 1)
  assert.equal(trashRecordOf(items[0]).name, 'Kalesi Kafe')
})

test('search reads the record name whichever kind it is', () => {
  assert.equal(buildTrashView(ITEMS, { search: 'kafe' }).items.length, 1)
  assert.equal(buildTrashView(ITEMS, { search: 'ankara' }).items.length, 1)
  // Türkçe-duyarlı katlama, çizim aramasıyla aynı yardımcıdan gelir.
  assert.equal(buildTrashView(ITEMS, { search: 'KALESI' }).items.length, 1)
})

test('POI remains its own trash type alongside legitimate transport types', () => {
  const trashTypes = TRASH_TYPE_FILTERS.map((filter) => filter.id)
  const drawingTypes = TYPE_FILTERS.map((filter) => filter.id)

  assert.equal(trashTypes.filter((id) => id === 'poi').length, 1)
  assert.equal(drawingTypes.includes('poi'), false)
  assert.equal(trashTypes.includes('transport-stop'), true)
  assert.equal(trashTypes.includes('transport-route'), true)
})

test('ordering by deletion time treats both kinds alike', () => {
  const oldest = buildTrashView(ITEMS, { sort: 'oldest' }).items
  assert.deepEqual(oldest.map((item) => trashRecordOf(item).id), [1, 2, 5])
})
