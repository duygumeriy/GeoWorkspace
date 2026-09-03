import { foldForSearch } from './drawingFilters.js'
import {
  drawingIdentities,
  drawingVisibilityState,
  isDrawingVisible,
  isRecordVisible,
  poiCategoryScopeIds,
  poiIdsInCategoryScope,
  visibilityState,
} from './layerVisibility.js'
import { DRAWING_TYPE_LIST } from './drawingTypes.js'

export const UNKNOWN_CATEGORY_KEY = 'unknown'

/** Builds category nodes from canonical categoryId/parentId data and an existing ancestry resolver. */
export function buildPoiCategoryTree(pois, categories, hiddenIds, isDescendant) {
  const categoryById = new Map((categories ?? []).map((category) => [Number(category.id), category]))
  const childrenByParent = new Map()

  for (const category of categories ?? []) {
    const parentId = categoryById.has(Number(category.parentId)) ? Number(category.parentId) : null
    const children = childrenByParent.get(parentId) ?? []
    children.push(category)
    childrenByParent.set(parentId, children)
  }

  const nodeFor = (category) => {
    const scopeIds = poiCategoryScopeIds(categories, category.id, isDescendant)
    const poiIds = poiIdsInCategoryScope(pois, scopeIds)
    if (poiIds.length === 0) return null
    const directPois = (pois ?? [])
      .filter((poi) => Number(poi?.categoryId) === Number(category.id))
      .map((poi) => ({ ...poi, visible: isRecordVisible(hiddenIds, poi.id) }))
    const children = (childrenByParent.get(Number(category.id)) ?? []).map(nodeFor).filter(Boolean)
    return {
      key: String(category.id),
      id: Number(category.id),
      label: category.name || category.path || 'Adsız kategori',
      poiIds,
      directPois,
      children,
      count: poiIds.length,
      state: visibilityState(poiIds, hiddenIds),
    }
  }

  const nodes = (childrenByParent.get(null) ?? []).map(nodeFor).filter(Boolean)
  const unknownPois = (pois ?? [])
    .filter((poi) => !categoryById.has(Number(poi?.categoryId)))
    .map((poi) => ({ ...poi, visible: isRecordVisible(hiddenIds, poi.id) }))
  if (unknownPois.length > 0) {
    const ids = unknownPois.map((poi) => poi.id)
    nodes.push({
      key: UNKNOWN_CATEGORY_KEY,
      id: null,
      label: 'Diğer',
      poiIds: ids,
      directPois: unknownPois,
      children: [],
      count: ids.length,
      state: visibilityState(ids, hiddenIds),
    })
  }
  return nodes
}

export function drawingGroups(drawings, hiddenIds) {
  return DRAWING_TYPE_LIST.map((type) => {
    const records = (drawings ?? []).filter((drawing) => drawing.type === type.id)
    const ids = drawingIdentities(records)
    return {
      id: type.id,
      label: type.plural,
      records: records.map((record) => ({
        ...record,
        identity: drawingIdentities([record])[0],
        visible: isDrawingVisible(hiddenIds, drawingIdentities([record])[0]),
      })),
      ids,
      count: ids.length,
      state: drawingVisibilityState(ids, hiddenIds),
    }
  })
}

export function recordRows(records, hiddenIds) {
  return (records ?? []).map((record) => ({ ...record, visible: isRecordVisible(hiddenIds, record.id) }))
}

export function matchesLayerSearch(value, query) {
  const needle = foldForSearch(query ?? '')
  return !needle || foldForSearch(value ?? '').includes(needle)
}

export function filterPoiCategoryTree(nodes, query) {
  if (!foldForSearch(query ?? '')) return nodes ?? []
  const visit = (node) => {
    if (matchesLayerSearch(node.label, query)) return node
    const directPois = node.directPois.filter((poi) => matchesLayerSearch(poi.name, query))
    const children = node.children.map(visit).filter(Boolean)
    return directPois.length || children.length ? { ...node, directPois, children } : null
  }
  return (nodes ?? []).map(visit).filter(Boolean)
}
