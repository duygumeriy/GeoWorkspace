import WKT from 'ol/format/WKT'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { createLayerStyleFunction } from './featureStyle.js'
import { defaultStyleFor, normalizeStyle } from './drawingTypes.js'

/** Map/view projection used by OpenLayers. */
export const MAP_PROJECTION = 'EPSG:3857'

/** Projection of every WKT crossing the API boundary (PostGIS columns are 4326). */
export const DATA_PROJECTION = 'EPSG:4326'

/**
 * OpenLayers layer className. Gives the vector layer its own canvas so the
 * dark-mode tile reskin filter in MapPage.css can skip it (see the
 * `.drawing-layer canvas { filter: none }` rule) and drawings keep their colors.
 */
export const DRAWING_LAYER_CLASSNAME = 'drawing-layer'

/** Same trick for the throwaway measurement layer. */
export const MEASURE_LAYER_CLASSNAME = 'measure-layer'

/** And for the throwaway inventory-analysis polygon. */
export const ANALYSIS_LAYER_CLASSNAME = 'analysis-layer'

const wktFormat = new WKT()

/**
 * The persisted drawings layer. A style *function* (not a fixed style) is used
 * so every feature renders from its own metadata.
 *
 * @param {() => { selectedKeys: Set<string>, visibility: Record<string, boolean> }} getRenderState
 */
export function createDrawingLayer(getRenderState) {
  const source = new VectorSource()
  const layer = new VectorLayer({
    source,
    className: DRAWING_LAYER_CLASSNAME,
    style: createLayerStyleFunction(getRenderState),
    // Keeps drawings above the basemap and below the measurement overlay.
    zIndex: 10,
  })

  return { source, layer }
}

/**
 * Layer holding the shape that has been drawn but not yet saved — the one the
 * attribute popup is asking about.
 *
 * It is deliberately a *separate* source from the persisted drawings: an
 * unsaved shape must never appear in the drawings list, in "Tüm Görünenleri
 * Seç", in a box selection or in a bulk delete, and cancelling must not have to
 * remember to pull it back out of the shared source. It renders through the
 * same style function, so the preview looks exactly like the saved record will.
 */
export function createPendingDrawingLayer() {
  const source = new VectorSource()
  const layer = new VectorLayer({
    source,
    className: DRAWING_LAYER_CLASSNAME,
    // The pending shape is always fully visible and never selected.
    style: createLayerStyleFunction(() => ({ selectedKeys: new Set(), visibility: {} })),
    // Just above the persisted drawings so the pending shape stays legible.
    zIndex: 12,
  })

  return { source, layer }
}

/**
 * Map geometry (EPSG:3857) -> WKT string (EPSG:4326).
 *
 * `writeGeometry` clones internally before transforming when `featureProjection`
 * is set, so the geometry rendered on the map is never mutated — it stays 3857.
 * This is a real reprojection, not a relabelling of 3857 numbers as 4326.
 */
export function geometryToWkt4326(geometry) {
  return wktFormat.writeGeometry(geometry, {
    dataProjection: DATA_PROJECTION,
    featureProjection: MAP_PROJECTION,
  })
}

/**
 * WKT string (EPSG:4326) -> OpenLayers feature reprojected to the map (3857).
 * Returns null for anything unreadable so one bad row cannot break the layer.
 */
export function wkt4326ToFeature(wkt) {
  try {
    return wktFormat.readFeature(wkt, {
      dataProjection: DATA_PROJECTION,
      featureProjection: MAP_PROJECTION,
    })
  } catch {
    return null
  }
}

let clientKeyCounter = 0

/**
 * Client-side feature key.
 *
 * Deliberately NOT derived from the database id: undoing a delete re-inserts
 * the row and PostgreSQL hands out a brand-new id. Keeping a stable client key
 * means selection, history commands and layer lookups survive that swap — the
 * database id is tracked separately as a plain property.
 */
export function nextClientKey() {
  clientKeyCounter += 1
  return `feat-${clientKeyCounter}`
}

/**
 * Attaches the backend identity and metadata to a feature. Everything the
 * selected-feature panel and the style renderer need lives on the feature
 * itself, so no parallel lookup table has to be kept in sync.
 *
 * @param {string} [clientKey] reuse an existing key when recreating a feature
 */
export function tagFeature(feature, type, record, clientKey) {
  feature.setId(clientKey ?? feature.getId() ?? nextClientKey())
  feature.set('drawingType', type)
  feature.set('databaseId', record.id)
  feature.set('style', normalizeStyle(type, record.style ?? defaultStyleFor(type)))
  feature.set('name', record.name ?? '')
  /* Metadata. Description and category may legitimately be absent, so they are
     normalised to '' rather than left undefined — the panels and the filter
     pipeline then never have to distinguish "missing" from "empty". Tags are
     always an array for the same reason; the API also guarantees one. */
  feature.set('description', record.description ?? '')
  feature.set('category', record.category ?? '')
  feature.set('tags', Array.isArray(record.tags) ? record.tags : [])
  feature.set('createdDate', record.createdDate ?? null)
  feature.set('modifiedDate', record.modifiedDate ?? null)
  feature.set('createdBy', record.createdBy ?? '')
  // Owner id drives the UI's edit/delete affordances. The backend enforces the
  // same rule independently, so this is presentation only.
  feature.set('createdByUserId', record.createdByUserId ?? null)
  feature.unset('previewStyle')
  return feature
}

/** Turns an API record into a ready-to-add, fully tagged feature (or null). */
export function recordToFeature(type, record, clientKey) {
  const feature = wkt4326ToFeature(record.wkt)
  return feature ? tagFeature(feature, type, record, clientKey) : null
}

/** Plain, React-friendly snapshot of a feature for list/detail panels. */
export function featureToDescriptor(feature) {
  return {
    key: feature.getId(),
    type: feature.get('drawingType'),
    databaseId: feature.get('databaseId'),
    name: feature.get('name') ?? '',
    description: feature.get('description') ?? '',
    category: feature.get('category') ?? '',
    tags: feature.get('tags') ?? [],
    style: feature.get('style'),
    createdDate: feature.get('createdDate'),
    modifiedDate: feature.get('modifiedDate'),
    createdBy: feature.get('createdBy') ?? '',
    createdByUserId: feature.get('createdByUserId') ?? null,
  }
}
