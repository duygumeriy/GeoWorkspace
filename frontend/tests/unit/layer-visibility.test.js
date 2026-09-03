import assert from 'node:assert/strict'
import test from 'node:test'
import { categoryIndex, isDescendantOf } from '../../src/map/locationAnalysis.js'
import {
  VISIBILITY_STATE,
  canonicalHiddenIds,
  drawingIdentities,
  drawingIdentity,
  drawingVisibilityState,
  hideDrawing,
  hideDrawings,
  hideRecord,
  hideRecords,
  isDrawingVisible,
  isRecordVisible,
  poiCategoryScopeIds,
  poiIdsInCategoryScope,
  reconcileHiddenDrawingIds,
  reconcileHiddenIds,
  showDrawing,
  showDrawings,
  showRecord,
  showRecords,
  toggleDrawing,
  toggleRecord,
  visibilityState,
} from '../../src/map/layerVisibility.js'

const POIS = [
  { id: 10, name: 'Hastane', categoryId: 2 },
  { id: 11, name: 'Eczane', categoryId: 3 },
  { id: 12, name: 'Klinik', categoryId: 2 },
  { id: 20, name: 'Kafe', categoryId: 5 },
]

const CATEGORIES = [
  { id: 1, name: 'Sağlık', parentId: null },
  { id: 2, name: 'Hastaneler', parentId: 1 },
  { id: 3, name: 'Eczaneler', parentId: 1 },
  { id: 4, name: 'Yeme İçme', parentId: null },
  { id: 5, name: 'Kafeler', parentId: 4 },
]

const categoryById = categoryIndex(CATEGORIES)
const descendant = (candidateId, ancestorId) => isDescendantOf(categoryById, candidateId, ancestorId)
const healthScope = poiCategoryScopeIds(CATEGORIES, 1, descendant)
const healthPoiIds = poiIdsInCategoryScope(POIS, healthScope)
const cafePoiIds = poiIdsInCategoryScope(POIS, [5])
const allPoiIds = POIS.map((poi) => poi.id)

test('empty hidden set means every canonical ID is visible', () => {
  assert.deepEqual(visibilityState([1, 2, 3], new Set()), {
    state: VISIBILITY_STATE.checked,
    checked: true,
    indeterminate: false,
    visibleCount: 3,
    totalCount: 3,
  })
})

test('hide one creates a new immutable state', () => {
  const original = new Set([2])
  const next = hideRecord(original, 1)
  assert.notEqual(next, original)
  assert.deepEqual([...next], [2, 1])
  assert.deepEqual([...original], [2])
})

test('show one removes only that ID', () => {
  assert.deepEqual([...showRecord(new Set([1, 2, 3]), 2)], [1, 3])
})

test('toggle works in both directions', () => {
  const hidden = toggleRecord(new Set(), '7')
  assert.deepEqual([...hidden], [7])
  assert.deepEqual([...toggleRecord(hidden, 7)], [])
})

test('every operation leaves the original Set untouched', () => {
  const original = new Set([2, 8])
  hideRecord(original, 1)
  showRecord(original, 2)
  toggleRecord(original, 8)
  hideRecords(original, [3, 4])
  showRecords(original, [2, 8])
  assert.deepEqual([...original], [2, 8])
})

test('invalid IDs do not corrupt hidden state', () => {
  const poisoned = new Set([1, Number.NaN, undefined, 'bad', '', -2, 1.5])
  assert.deepEqual([...hideRecord(poisoned, 'not-an-id')], [1])
  assert.deepEqual([...toggleRecord(poisoned, undefined)], [1])
  assert.deepEqual([...canonicalHiddenIds(['2', 2, 3])], [2, 3])
})

test('parent is checked when all children are visible', () => {
  assert.equal(visibilityState([1, 2], new Set()).state, VISIBILITY_STATE.checked)
})

test('parent is unchecked when all children are hidden', () => {
  assert.deepEqual(visibilityState([1, 2], new Set([1, 2])), {
    state: VISIBILITY_STATE.unchecked,
    checked: false,
    indeterminate: false,
    visibleCount: 0,
    totalCount: 2,
  })
})

test('parent is indeterminate when child visibility is mixed', () => {
  assert.equal(visibilityState([1, 2, 3], new Set([2])).state, VISIBILITY_STATE.indeterminate)
})

test('empty group has a deliberate safe unchecked state', () => {
  assert.deepEqual(visibilityState([], new Set()), {
    state: VISIBILITY_STATE.unchecked,
    checked: false,
    indeterminate: false,
    visibleCount: 0,
    totalCount: 0,
  })
})

test('hide-all affects every supplied canonical ID and no unrelated ID', () => {
  assert.deepEqual([...hideRecords(new Set([99]), [1, '2', 3])], [99, 1, 2, 3])
})

test('show-all restores every supplied canonical ID and preserves unrelated IDs', () => {
  assert.deepEqual([...showRecords(new Set([1, 2, 3, 99]), ['1', 2, 3])], [99])
})

test('visibility state has no selection input or side effect', () => {
  const selection = new Set([1])
  const hidden = hideRecord(new Set(), 1)
  assert.deepEqual([...selection], [1])
  assert.deepEqual([...hidden], [1])
})

test('category state derives only from canonical POI IDs in its scope', () => {
  assert.equal(visibilityState(healthPoiIds, new Set()).state, VISIBILITY_STATE.checked)
  assert.deepEqual(healthPoiIds, [10, 11, 12])
})

test('one hidden POI makes its category indeterminate', () => {
  assert.equal(visibilityState(healthPoiIds, new Set([11])).state, VISIBILITY_STATE.indeterminate)
})

test('hide-category hides every canonical POI in the category scope', () => {
  assert.deepEqual([...hideRecords(new Set(), healthPoiIds)], [10, 11, 12])
})

test('show-category shows every canonical POI in the category scope', () => {
  assert.deepEqual([...showRecords(new Set([10, 11, 12, 20]), healthPoiIds)], [20])
})

test('changing one POI immediately changes derived category state', () => {
  const allHidden = hideRecords(new Set(), healthPoiIds)
  assert.equal(visibilityState(healthPoiIds, allHidden).state, VISIBILITY_STATE.unchecked)
  assert.equal(visibilityState(healthPoiIds, showRecord(allHidden, 11)).state, VISIBILITY_STATE.indeterminate)
})

test('one category operation leaves exclusive POIs from another category unchanged', () => {
  const hidden = hideRecords(new Set([20]), healthPoiIds)
  assert.equal(isRecordVisible(hidden, 20), false)
  assert.equal(visibilityState(cafePoiIds, hidden).state, VISIBILITY_STATE.unchecked)
})

test('the parent POI group derives across every category', () => {
  const hidden = hideRecords(new Set(), healthPoiIds)
  assert.equal(visibilityState(allPoiIds, hidden).state, VISIBILITY_STATE.indeterminate)
})

test('parent category scope includes descendant POIs through the existing hierarchy helper', () => {
  assert.deepEqual(healthScope, [1, 2, 3])
  assert.deepEqual(healthPoiIds, [10, 11, 12])
})

test('toggling a child category does not affect sibling POIs', () => {
  const hospitals = poiIdsInCategoryScope(POIS, [2])
  const hidden = hideRecords(new Set(), hospitals)
  assert.equal(isRecordVisible(hidden, 10), false)
  assert.equal(isRecordVisible(hidden, 12), false)
  assert.equal(isRecordVisible(hidden, 11), true)
})

test('parent category becomes indeterminate when descendant branches differ', () => {
  const hospitalIds = poiIdsInCategoryScope(POIS, [2])
  assert.equal(visibilityState(healthPoiIds, hideRecords(new Set(), hospitalIds)).state, VISIBILITY_STATE.indeterminate)
})

test('drawing identities cannot collide across point, line and polygon tables', () => {
  assert.deepEqual(
    [drawingIdentity('point', 12), drawingIdentity('line', 12), drawingIdentity('polygon', 12)],
    ['point:12', 'line:12', 'polygon:12'],
  )
})

test('hiding one drawing does not hide another canonical drawing identity', () => {
  const hidden = hideDrawing(new Set(), 'point:12')
  assert.equal(isDrawingVisible(hidden, 'point:12'), false)
  assert.equal(isDrawingVisible(hidden, 'line:12'), true)
  assert.deepEqual([...showDrawing(hidden, 'point:12')], [])
  assert.deepEqual([...toggleDrawing(hidden, 'line:12')], ['point:12', 'line:12'])
})

test('geometry-type subgroup state derives from individual drawings', () => {
  const drawings = [
    { type: 'point', databaseId: 1 },
    { type: 'point', databaseId: 2 },
    { type: 'line', databaseId: 1 },
  ]
  const pointIds = drawingIdentities(drawings, 'point')
  assert.equal(drawingVisibilityState(pointIds, new Set(['point:2'])).state, VISIBILITY_STATE.indeterminate)
})

test('global Drawings parent derives from every geometry subgroup', () => {
  const ids = drawingIdentities([
    { type: 'point', databaseId: 1 },
    { type: 'line', databaseId: 1 },
    { type: 'polygon', databaseId: 1 },
  ])
  const hidden = hideDrawings(new Set(), ['point:1', 'line:1'])
  assert.equal(drawingVisibilityState(ids, hidden).state, VISIBILITY_STATE.indeterminate)
  assert.deepEqual([...showDrawings(hidden, ids)], [])
})

test('individual stop hidden state behaves independently', () => {
  const hiddenStopIds = hideRecord(new Set(), 41)
  const hiddenRouteIds = new Set([41])
  assert.equal(isRecordVisible(hiddenStopIds, 41), false)
  assert.deepEqual([...showRecord(hiddenStopIds, 41)], [])
  assert.deepEqual([...hiddenRouteIds], [41])
})

test('generic primitive matches the existing route hidden-ID toggle semantics', () => {
  const hidden = toggleRecord(new Set(), 7)
  assert.equal(hidden.has(7), true)
  assert.equal(toggleRecord(hidden, 7).has(7), false)
})

test('filtering records does not mutate canonical hidden state', () => {
  const hidden = new Set([10, 20])
  const filteredRows = POIS.filter((poi) => poi.name.includes('H'))
  assert.deepEqual(filteredRows.map((poi) => poi.id), [10])
  assert.deepEqual([...hidden], [10, 20])
})

test('bulk action uses canonical membership and preserves hidden records outside filtered results', () => {
  const filteredRows = POIS.filter((poi) => poi.id === 10)
  const hidden = hideRecords(new Set([20]), healthPoiIds)
  assert.deepEqual(filteredRows.map((poi) => poi.id), [10])
  assert.deepEqual([...hidden], [20, 10, 11, 12])
  assert.equal(hidden.has(20), true)
})

test('stale numeric hidden IDs are reconciled against canonical records', () => {
  const current = new Set([2, 99])
  assert.deepEqual([...reconcileHiddenIds(current, [1, 2, 3])], [2])
  assert.equal(reconcileHiddenIds(current, [2, 99]), current)
  assert.deepEqual([...reconcileHiddenIds(new Set([2, Number.NaN]), [2])], [2])
})

test('stale composite drawing identities are reconciled without cross-type collisions', () => {
  const current = new Set(['point:2', 'line:2', 'polygon:99'])
  assert.deepEqual([...reconcileHiddenDrawingIds(current, ['point:2', 'line:2'])], ['point:2', 'line:2'])
})
