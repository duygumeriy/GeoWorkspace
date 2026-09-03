import { DRAWING_TYPE_IDS } from './drawingTypes.js'

/**
 * Pure visibility state for persisted map records.
 *
 * A collection of hidden canonical identities is the only authority. Parent,
 * category and geometry-group checkboxes are projections of their child IDs;
 * they never own a second boolean that could disagree with the children.
 * Selection, filtering and map rendering deliberately do not appear here.
 */

export const VISIBILITY_STATE = Object.freeze({
  checked: 'checked',
  unchecked: 'unchecked',
  indeterminate: 'indeterminate',
})

const DRAWING_TYPES = new Set(DRAWING_TYPE_IDS)
const DRAWING_IDENTITY_PATTERN = /^([^:]+):(\d+)$/

/** Database-backed record IDs are positive integers throughout this project. */
export function normalizeRecordId(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && value.trim() === '') return null

  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** Invalid and duplicate values cannot enter canonical membership. */
export function canonicalRecordIds(values) {
  const ids = new Set()
  for (const value of values ?? []) {
    const id = normalizeRecordId(value)
    if (id != null) ids.add(id)
  }
  return [...ids]
}

/** Returns a clean copy, never the caller's Set. */
export function canonicalHiddenIds(hiddenIds) {
  return new Set(canonicalRecordIds(hiddenIds))
}

export function isRecordVisible(hiddenIds, recordId) {
  const id = normalizeRecordId(recordId)
  return id != null && !canonicalHiddenIds(hiddenIds).has(id)
}

export function showRecord(hiddenIds, recordId) {
  const next = canonicalHiddenIds(hiddenIds)
  const id = normalizeRecordId(recordId)
  if (id != null) next.delete(id)
  return next
}

export function hideRecord(hiddenIds, recordId) {
  const next = canonicalHiddenIds(hiddenIds)
  const id = normalizeRecordId(recordId)
  if (id != null) next.add(id)
  return next
}

export function toggleRecord(hiddenIds, recordId) {
  const next = canonicalHiddenIds(hiddenIds)
  const id = normalizeRecordId(recordId)
  if (id == null) return next
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/** Only supplied canonical group IDs are changed; rendered/filter rows are irrelevant. */
export function showRecords(hiddenIds, recordIds) {
  const next = canonicalHiddenIds(hiddenIds)
  for (const id of canonicalRecordIds(recordIds)) next.delete(id)
  return next
}

/** Only supplied canonical group IDs are changed; unrelated preferences survive. */
export function hideRecords(hiddenIds, recordIds) {
  const next = canonicalHiddenIds(hiddenIds)
  for (const id of canonicalRecordIds(recordIds)) next.add(id)
  return next
}

/** Drops preferences for records no longer present while preserving identity when unchanged. */
export function reconcileHiddenIds(hiddenIds, recordIds) {
  const current = canonicalHiddenIds(hiddenIds)
  const canonical = new Set(canonicalRecordIds(recordIds))
  const next = new Set([...current].filter((id) => canonical.has(id)))
  const inputIsCanonicalSet = hiddenIds instanceof Set && hiddenIds.size === current.size
  return inputIsCanonicalSet && next.size === current.size ? hiddenIds : next
}

/**
 * Empty groups are deliberately unchecked, not "all visible" by vacuous truth.
 * This gives an empty parent a safe, non-actionable visual state.
 */
export function visibilityState(recordIds, hiddenIds) {
  const ids = canonicalRecordIds(recordIds)
  const hidden = canonicalHiddenIds(hiddenIds)
  const visibleCount = ids.reduce((count, id) => count + (hidden.has(id) ? 0 : 1), 0)
  const totalCount = ids.length
  const checked = totalCount > 0 && visibleCount === totalCount
  const indeterminate = visibleCount > 0 && visibleCount < totalCount

  return {
    state: indeterminate
      ? VISIBILITY_STATE.indeterminate
      : checked
        ? VISIBILITY_STATE.checked
        : VISIBILITY_STATE.unchecked,
    checked,
    indeterminate,
    visibleCount,
    totalCount,
  }
}

/** POI IDs whose canonical category is in an already-resolved category scope. */
export function poiIdsInCategoryScope(pois, categoryScopeIds) {
  const categoryIds = new Set(canonicalRecordIds(categoryScopeIds))
  if (categoryIds.size === 0) return []

  return canonicalRecordIds(
    (pois ?? [])
      .filter((poi) => categoryIds.has(normalizeRecordId(poi?.categoryId)))
      .map((poi) => poi?.id),
  )
}

/**
 * Builds a scope without inventing hierarchy semantics. Phase 2 can pass the
 * repository's existing `isDescendantOf` helper; without it, only the exact
 * category is included.
 */
export function poiCategoryScopeIds(categories, categoryId, isDescendant = null) {
  const rootId = normalizeRecordId(categoryId)
  if (rootId == null) return []

  const ids = [rootId]
  if (typeof isDescendant !== 'function') return ids

  for (const category of categories ?? []) {
    const candidateId = normalizeRecordId(category?.id)
    if (candidateId != null && candidateId !== rootId && isDescendant(candidateId, rootId)) {
      ids.push(candidateId)
    }
  }
  return canonicalRecordIds(ids)
}

/** Stable persisted drawing identity; numeric IDs collide across three tables. */
export function drawingIdentity(type, recordId) {
  const id = normalizeRecordId(recordId)
  return DRAWING_TYPES.has(type) && id != null ? `${type}:${id}` : null
}

export function normalizeDrawingIdentity(value) {
  if (typeof value !== 'string') return null
  const match = DRAWING_IDENTITY_PATTERN.exec(value.trim())
  return match ? drawingIdentity(match[1], match[2]) : null
}

export function canonicalDrawingIdentities(values) {
  const identities = new Set()
  for (const value of values ?? []) {
    const identity = normalizeDrawingIdentity(value)
    if (identity != null) identities.add(identity)
  }
  return [...identities]
}

/** Accepts the existing drawing descriptors: `{ type, databaseId }`. */
export function drawingIdentities(drawings, type = null) {
  return canonicalDrawingIdentities(
    (drawings ?? [])
      .filter((drawing) => type == null || drawing?.type === type)
      .map((drawing) => drawingIdentity(drawing?.type, drawing?.databaseId ?? drawing?.id)),
  )
}

export function canonicalHiddenDrawingIds(hiddenIds) {
  return new Set(canonicalDrawingIdentities(hiddenIds))
}

export function isDrawingVisible(hiddenIds, identity) {
  const id = normalizeDrawingIdentity(identity)
  return id != null && !canonicalHiddenDrawingIds(hiddenIds).has(id)
}

export function showDrawing(hiddenIds, identity) {
  const next = canonicalHiddenDrawingIds(hiddenIds)
  const id = normalizeDrawingIdentity(identity)
  if (id != null) next.delete(id)
  return next
}

export function hideDrawing(hiddenIds, identity) {
  const next = canonicalHiddenDrawingIds(hiddenIds)
  const id = normalizeDrawingIdentity(identity)
  if (id != null) next.add(id)
  return next
}

export function toggleDrawing(hiddenIds, identity) {
  const next = canonicalHiddenDrawingIds(hiddenIds)
  const id = normalizeDrawingIdentity(identity)
  if (id == null) return next
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export function showDrawings(hiddenIds, identities) {
  const next = canonicalHiddenDrawingIds(hiddenIds)
  for (const id of canonicalDrawingIdentities(identities)) next.delete(id)
  return next
}

export function hideDrawings(hiddenIds, identities) {
  const next = canonicalHiddenDrawingIds(hiddenIds)
  for (const id of canonicalDrawingIdentities(identities)) next.add(id)
  return next
}

export function reconcileHiddenDrawingIds(hiddenIds, identities) {
  const current = canonicalHiddenDrawingIds(hiddenIds)
  const canonical = new Set(canonicalDrawingIdentities(identities))
  const next = new Set([...current].filter((id) => canonical.has(id)))
  const inputIsCanonicalSet = hiddenIds instanceof Set && hiddenIds.size === current.size
  return inputIsCanonicalSet && next.size === current.size ? hiddenIds : next
}

export function drawingVisibilityState(identities, hiddenIds) {
  const canonical = canonicalDrawingIdentities(identities)
  const hidden = canonicalHiddenDrawingIds(hiddenIds)
  const visibleCount = canonical.reduce((count, id) => count + (hidden.has(id) ? 0 : 1), 0)
  const totalCount = canonical.length
  const checked = totalCount > 0 && visibleCount === totalCount
  const indeterminate = visibleCount > 0 && visibleCount < totalCount

  return {
    state: indeterminate
      ? VISIBILITY_STATE.indeterminate
      : checked
        ? VISIBILITY_STATE.checked
        : VISIBILITY_STATE.unchecked,
    checked,
    indeterminate,
    visibleCount,
    totalCount,
  }
}
