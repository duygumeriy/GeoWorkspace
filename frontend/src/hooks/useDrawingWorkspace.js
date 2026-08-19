import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Draw from 'ol/interaction/Draw'
import { createEmpty, extend, isEmpty } from 'ol/extent'
import {
  bulkDeleteDrawings,
  bulkStyleDrawings,
  createDrawing,
  deleteDrawing,
  fetchDrawings,
  readApiError,
  restoreDrawings,
  updateDrawing,
  updateDrawingStyle,
} from '../services/api.js'
import {
  createDrawingLayer,
  createPendingDrawingLayer,
  featureToDescriptor,
  geometryToWkt4326,
  nextClientKey,
  recordToFeature,
  tagFeature,
  wkt4326ToFeature,
} from '../map/drawing.js'
import {
  DRAWING_TYPES,
  DRAWING_TYPE_IDS,
  applyStylePatch,
  colorPatchFor,
  defaultStyleFor,
  isSameStyle,
  normalizeStyle,
} from '../map/drawingTypes.js'
import { featureKeysInSelection } from '../map/spatialSelect.js'
import useHistory from './useHistory.js'

/** Every geometry type starts visible. */
const ALL_VISIBLE = Object.freeze({ point: true, line: true, polygon: true })

const EMPTY_SELECTION = Object.freeze(new Set())

/** Turkish plural-aware count phrase: "3 çizim". */
function countLabel(count) {
  return `${count} çizim`
}

/**
 * Owns everything about persisted drawings: the vector layer, the Draw
 * interaction, selection, per-type visibility, the style each tool will use
 * next, and the undo/redo command stack.
 *
 * The OpenLayers source is the single source of truth for geometry; React state
 * holds plain descriptors derived from it so panels can render without reaching
 * into OpenLayers objects.
 *
 * The *active tool* is deliberately NOT owned here — it comes in from
 * `useWorkspaceMode`, which is the one place that decides what the map is
 * currently doing. This hook only reacts to it.
 *
 * @param {import('ol/Map').default | null} map
 * @param {{ showToast: Function, activeDrawTool: string|null, canViewDrawings?: boolean,
 *           onPolygonSaved?: (record: { wkt: string, databaseId: number, name: string }) => void }} deps
 *   `onPolygonSaved` fires once a polygon record exists in the database, which
 *   is what triggers the intersection analysis for it.
 *
 *   `canViewDrawings` mirrors the `drawings.view` the list endpoints require.
 *   Without it the three GETs would each come back 403 and the map would open
 *   on an error it could do nothing about, so the load is simply not attempted
 *   — the permission is re-checked server-side either way.
 */
export default function useDrawingWorkspace(
  map,
  { showToast, activeDrawTool = null, canViewDrawings = true, onPolygonSaved = null },
) {
  const sourceRef = useRef(null)
  const layerRef = useRef(null)
  /** Separate source for the shape awaiting its attributes; never persisted. */
  const pendingSourceRef = useRef(null)
  const pendingLayerRef = useRef(null)
  /** The live Draw interaction, so the popup can suspend it without rebuilding. */
  const drawRef = useRef(null)

  const [drawings, setDrawings] = useState([])
  /** Canonical selection: a set of stable client keys, of any size. */
  const [selectedKeys, setSelectedKeys] = useState(EMPTY_SELECTION)
  const [visibility, setVisibility] = useState(ALL_VISIBLE)
  const [loadingDrawings, setLoadingDrawings] = useState(false)
  /** Non-null when the last load failed; drives the panel's error state. */
  const [loadError, setLoadError] = useState(null)
  const [savingCount, setSavingCount] = useState(0)

  /**
   * The shape drawn but not yet saved: `{ type, wkt, clientKey, style }`.
   * Non-null exactly while the attribute popup is open. Nothing has been sent
   * to the API at this point — the record only comes into existence when the
   * user confirms the popup.
   */
  const [pendingDrawing, setPendingDrawing] = useState(null)

  /** Style each tool applies to the *next* drawing it creates. */
  const [toolStyles, setToolStyles] = useState(() => ({
    point: defaultStyleFor('point'),
    line: defaultStyleFor('line'),
    polygon: defaultStyleFor('polygon'),
  }))

  const history = useHistory()
  const pushHistory = history.push

  // The layer style function runs outside React, so it reads live values from
  // refs rather than closed-over state.
  const renderStateRef = useRef({ selectedKeys: EMPTY_SELECTION, visibility: ALL_VISIBLE })
  renderStateRef.current = { selectedKeys, visibility }

  // Read at drawend time. Kept in a ref so changing a tool's style never
  // re-creates the Draw interaction — doing so mid-drawing would abort it.
  const toolStylesRef = useRef(toolStyles)
  toolStylesRef.current = toolStyles

  const refreshLayer = useCallback(() => {
    layerRef.current?.changed()
  }, [])

  /** Rebuilds the React-side descriptor list from the OpenLayers source. */
  const syncDrawings = useCallback(() => {
    const source = sourceRef.current
    if (!source) return
    setDrawings(source.getFeatures().map(featureToDescriptor))
  }, [])

  const featureByKey = useCallback((key) => sourceRef.current?.getFeatureById(key) ?? null, [])

  /** Features for a list of keys, skipping any that have since disappeared. */
  const featuresByKeys = useCallback(
    (keys) => [...keys].map((key) => featureByKey(key)).filter(Boolean),
    [featureByKey],
  )

  /* --- Layer lifecycle ---------------------------------------------------- */

  useEffect(() => {
    if (!map) return undefined

    const { source, layer } = createDrawingLayer(() => renderStateRef.current)
    sourceRef.current = source
    layerRef.current = layer
    map.addLayer(layer)

    const pending = createPendingDrawingLayer()
    pendingSourceRef.current = pending.source
    pendingLayerRef.current = pending.layer
    map.addLayer(pending.layer)

    return () => {
      map.removeLayer(layer)
      source.clear()
      sourceRef.current = null
      layerRef.current = null

      map.removeLayer(pending.layer)
      pending.source.clear()
      pendingSourceRef.current = null
      pendingLayerRef.current = null
    }
  }, [map])

  // Selection and visibility are render inputs; nudge the layer when they change.
  useEffect(() => {
    refreshLayer()
  }, [selectedKeys, visibility, refreshLayer])

  /* --- Load ----------------------------------------------------------------
     The backend returns ONLY the current user's active, non-deleted records,
     so what lands on the map is already the right set — there is no ownership
     filtering to redo here.

     Extracted into a callback (rather than living inside the effect) so the
     "Tekrar Dene" button in the Çizimlerim panel can re-run exactly the same
     load after a failure, instead of the user having to reload the page. */

  const loadDrawings = useCallback(async () => {
    /* Yetki yoksa istek hiç açılmaz. Haritanın kendisi `map.view` ile açılır ve
       çizim VERİSİNİ görmek ayrı bir yetkidir; ikisini birbirine bağlamak,
       yalnızca haritayı görebilen birine üç tane 403 göstermek olurdu. */
    if (!canViewDrawings) {
      sourceRef.current?.clear()
      setDrawings([])
      setLoadError(null)
      setLoadingDrawings(false)
      return false
    }

    setLoadingDrawings(true)
    setLoadError(null)

    try {
      const groups = await Promise.all(
        DRAWING_TYPE_IDS.map(async (type) => {
          const res = await fetchDrawings(type)
          if (!res.ok) throw new Error(await readApiError(res, `${DRAWING_TYPES[type].plural} yüklenemedi`))
          return { type, items: await res.json() }
        }),
      )

      const source = sourceRef.current
      if (!source) return false

      source.clear()
      for (const { type, items } of groups) {
        for (const item of items) {
          const feature = recordToFeature(type, item)
          if (feature) source.addFeature(feature)
        }
      }
      syncDrawings()
      return true
    } catch (error) {
      // A failed load must not take the map down; drawing still works.
      setLoadError(error?.message || 'Kayıtlı çizimler yüklenemedi.')
      showToast('error', 'Kayıtlı çizimler yüklenemedi. Harita kullanılabilir durumda.')
      return false
    } finally {
      setLoadingDrawings(false)
    }
  }, [showToast, syncDrawings, canViewDrawings])

  useEffect(() => {
    if (!map) return undefined

    let cancelled = false
    loadDrawings().then(() => {
      // The source is cleared on unmount anyway; this only avoids a state
      // update on a torn-down map.
      if (cancelled) return
    })

    return () => {
      cancelled = true
    }
  }, [map, loadDrawings])

  /* --- Selection ---------------------------------------------------------- */

  const clearSelection = useCallback(() => setSelectedKeys(EMPTY_SELECTION), [])

  const setSelection = useCallback((keys) => {
    setSelectedKeys(keys.length ? new Set(keys) : EMPTY_SELECTION)
  }, [])

  /** Adds keys to the current selection without dropping what is already there. */
  const addToSelection = useCallback((keys) => {
    if (!keys.length) return
    setSelectedKeys((current) => new Set([...current, ...keys]))
  }, [])

  const toggleSelection = useCallback((key) => {
    setSelectedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next.size ? next : EMPTY_SELECTION
    })
  }, [])

  /**
   * The single entry point for click-driven selection, used by the map and by
   * the drawings list alike so the two can never drift apart.
   *
   * @param {string|null} key      null means "clicked empty map"
   * @param {{ additive?: boolean }} options Shift/Cmd/Ctrl was held
   */
  const selectFeature = useCallback(
    (key, { additive = false } = {}) => {
      if (!key) {
        // Empty-map click clears — unless a modifier says the user is building
        // up a selection, where a stray click must not undo their work.
        if (!additive) clearSelection()
        return
      }
      if (additive) toggleSelection(key)
      else setSelectedKeys(new Set([key]))
    },
    [clearSelection, toggleSelection],
  )

  const isVisible = useCallback(
    (feature) => visibility[feature.get('drawingType')] !== false,
    [visibility],
  )

  /** "Tüm Görünenleri Seç": everything on screen, nothing from a hidden layer. */
  const selectAllVisible = useCallback(() => {
    const source = sourceRef.current
    if (!source) return 0
    const keys = source.getFeatures().filter(isVisible).map((feature) => feature.getId())
    setSelection(keys)
    return keys.length
  }, [isVisible, setSelection])

  /** Keys a selection polygon covers, restricted to visible layers. */
  const selectKeysIn = useCallback(
    (polygon) => featureKeysInSelection(sourceRef.current, polygon, isVisible),
    [isVisible],
  )

  const toggleVisibility = useCallback((typeId) => {
    setVisibility((current) => ({ ...current, [typeId]: !current[typeId] }))
  }, [])

  // A feature that just left the screen must leave the selection too: a hidden
  // feature keeps no halo, cannot be clicked, and must never end up in a bulk
  // delete the user cannot see the target of. The database is not touched.
  useEffect(() => {
    setSelectedKeys((current) => {
      if (current.size === 0) return current
      const kept = [...current].filter(
        (key) => visibility[sourceRef.current?.getFeatureById(key)?.get('drawingType')] !== false,
      )
      if (kept.length === current.size) return current
      return kept.length ? new Set(kept) : EMPTY_SELECTION
    })
  }, [visibility])

  /* --- Low-level operations shared by direct actions and history ----------- */

  /**
   * POSTs a geometry and puts the resulting feature on the map.
   * Used by the attribute popup's save, by undoing a delete and by redoing a
   * create — all three hand over the same shape of snapshot.
   */
  const persistCreate = useCallback(
    async ({ type, wkt, style, name, description, category, tags, clientKey }) => {
      const res = await createDrawing(type, wkt, { name, style, description, category, tags })
      if (!res.ok) throw new Error(await readApiError(res, 'Çizim kaydedilemedi'))

      const saved = await res.json()
      const source = sourceRef.current
      if (!source) return null

      // Built from the server's answer, so the feature on the map carries the
      // geometry, style and audit fields the database actually stored.
      const feature = recordToFeature(type, saved, clientKey)
      if (!feature) throw new Error('Çizim haritaya eklenemedi.')

      tagFeature(feature, type, saved, clientKey ?? feature.getId())
      if (!source.getFeatureById(feature.getId())) source.addFeature(feature)

      syncDrawings()
      return feature
    },
    [syncDrawings],
  )

  /** DELETEs a record and removes its feature from the map. */
  const persistDelete = useCallback(
    async (clientKey) => {
      const feature = featureByKey(clientKey)
      if (!feature) return false

      const type = feature.get('drawingType')
      const res = await deleteDrawing(type, feature.get('databaseId'))
      // A record already gone server-side still has to leave the map.
      if (!res.ok && res.status !== 404) {
        throw new Error(await readApiError(res, 'Çizim silinemedi'))
      }

      sourceRef.current?.removeFeature(feature)
      setSelectedKeys((current) => {
        if (!current.has(clientKey)) return current
        const next = new Set(current)
        next.delete(clientKey)
        return next.size ? next : EMPTY_SELECTION
      })
      syncDrawings()
      return true
    },
    [featureByKey, syncDrawings],
  )

  /** PATCHes style only and writes the server's answer back onto the feature. */
  const persistStyle = useCallback(
    async (clientKey, style) => {
      const feature = featureByKey(clientKey)
      if (!feature) return false

      const type = feature.get('drawingType')
      const res = await updateDrawingStyle(type, feature.get('databaseId'), style)
      if (!res.ok) throw new Error(await readApiError(res, 'Stil güncellenemedi'))

      const saved = await res.json()
      feature.set('style', normalizeStyle(type, saved.style))
      feature.set('modifiedDate', saved.modifiedDate)
      feature.unset('previewStyle')
      refreshLayer()
      syncDrawings()
      return true
    },
    [featureByKey, refreshLayer, syncDrawings],
  )

  /**
   * The detail popup's "Kaydet": name, colour and geometry in ONE request.
   *
   * The feature is then rebuilt from the server's answer rather than from what
   * was sent, so anything the backend normalised or rejected-and-kept (a
   * trimmed name, a clamped stroke width, the stored geometry) is what ends up
   * on the map. That is also why the geometry is re-read from the returned WKT
   * even though `Modify` already moved it locally — map and database cannot
   * drift apart.
   *
   * @param {{ name?: string, style?: object, wkt?: string }} changes
   */
  const persistUpdate = useCallback(
    async (clientKey, changes) => {
      const feature = featureByKey(clientKey)
      if (!feature) return false

      const type = feature.get('drawingType')
      const res = await updateDrawing(type, feature.get('databaseId'), changes)
      if (!res.ok) throw new Error(await readApiError(res, 'Çizim güncellenemedi'))

      const saved = await res.json()

      // Geometry comes back reprojected to the map's 3857 by wkt4326ToFeature.
      const savedGeometry = wkt4326ToFeature(saved.wkt)?.getGeometry()
      if (savedGeometry) feature.setGeometry(savedGeometry)

      feature.set('name', saved.name ?? '')
      // Metadata comes back from the server for the same reason the geometry
      // does: what the database normalised (trimmed description, canonical
      // category, de-duplicated tags) is what the map must show.
      feature.set('description', saved.description ?? '')
      feature.set('category', saved.category ?? '')
      feature.set('tags', Array.isArray(saved.tags) ? saved.tags : [])
      feature.set('style', normalizeStyle(type, saved.style))
      feature.set('modifiedDate', saved.modifiedDate)
      feature.unset('previewStyle')

      refreshLayer()
      syncDrawings()
      return true
    },
    [featureByKey, refreshLayer, syncDrawings],
  )

  /* --- Atomic bulk primitives ---------------------------------------------
     Each of these is ONE request. Database ids are resolved from the live
     features at call time rather than captured in a closure, because undoing a
     delete re-inserts the row under a new id — the stable client key survives
     that, the id does not. */

  /** One transactional DELETE for every key; the map only changes on success. */
  const persistBulkDelete = useCallback(
    async (clientKeys) => {
      const features = featuresByKeys(clientKeys)
      if (features.length === 0) return false

      const res = await bulkDeleteDrawings(
        features.map((feature) => ({ type: feature.get('drawingType'), id: feature.get('databaseId') })),
      )
      if (!res.ok) throw new Error(await readApiError(res, 'Çizimler silinemedi'))

      const source = sourceRef.current
      for (const feature of features) source.removeFeature(feature)

      clearSelection()
      syncDrawings()
      return true
    },
    [featuresByKeys, clearSelection, syncDrawings],
  )

  /**
   * Undo of a delete: asks the server to reopen the rows it soft-deleted.
   *
   * Only `{ type, id }` is sent. The geometry, name, style and owner all come
   * back from the row the database still holds, which is why an admin undoing
   * another user's deletion cannot silently take ownership of it. The snapshot
   * is used solely to put each feature back under its original client key so
   * the map's selection and history stay coherent.
   */
  const persistRestore = useCallback(
    async (snapshots) => {
      if (snapshots.length === 0) return false

      const res = await restoreDrawings(
        snapshots.map(({ type, databaseId }) => ({ type, id: databaseId })),
      )
      if (!res.ok) throw new Error(await readApiError(res, 'Çizimler geri getirilemedi'))

      const body = await res.json()
      const source = sourceRef.current
      if (!source) return false

      // The API answers in request order, so index i belongs to snapshot i.
      body.items.forEach((item, index) => {
        const snapshot = snapshots[index]
        // Built from the server's record, so ownership metadata on the map
        // matches the database — the owner/non-owner UI stays correct.
        const feature = recordToFeature(snapshot.type, item.drawing, snapshot.clientKey)
        if (feature && !source.getFeatureById(feature.getId())) source.addFeature(feature)
      })

      syncDrawings()
      return true
    },
    [syncDrawings],
  )

  /**
   * One transactional style update.
   *
   * @param {string[]} clientKeys
   * @param {{ shared?: object|null, styleByKey?: Record<string, object>|null }} options
   *   `shared` applies the same partial patch to everything (the "Stil Uygula"
   *   case); `styleByKey` gives each record its own full style, which is how
   *   undo restores four differently-styled features in a single call.
   */
  const persistBulkStyle = useCallback(
    async (clientKeys, { shared = null, styleByKey = null } = {}) => {
      const features = featuresByKeys(clientKeys)
      if (features.length === 0) return false

      const items = features.map((feature) => {
        const item = { type: feature.get('drawingType'), id: feature.get('databaseId') }
        const perItem = styleByKey?.[feature.getId()]
        if (perItem) item.style = perItem
        return item
      })

      const res = await bulkStyleDrawings(items, shared)
      if (!res.ok) throw new Error(await readApiError(res, 'Stiller güncellenemedi'))

      const body = await res.json()
      body.items.forEach((item, index) => {
        const feature = features[index]
        if (!feature) return
        feature.set('style', normalizeStyle(item.type, item.drawing.style))
        feature.set('modifiedDate', item.drawing.modifiedDate)
        feature.unset('previewStyle')
      })

      refreshLayer()
      syncDrawings()
      return true
    },
    [featuresByKeys, refreshLayer, syncDrawings],
  )

  /** Wraps a history handler so any failure surfaces as a toast, never a crash. */
  const guarded = useCallback(
    (action, failureMessage) => async () => {
      try {
        await action()
        return true
      } catch (error) {
        showToast('error', error?.message || failureMessage)
        return false
      }
    },
    [showToast],
  )

  /* --- Drawing ------------------------------------------------------------ */

  useEffect(() => {
    if (!map || !activeDrawTool) return undefined

    const pendingSource = pendingSourceRef.current
    if (!pendingSource) return undefined

    const type = DRAWING_TYPES[activeDrawTool]
    // The finished shape lands in the PENDING source, not the persisted one:
    // nothing exists in the database until the attribute popup is confirmed.
    const draw = new Draw({ source: pendingSource, type: type.geometryType })
    drawRef.current = draw
    map.addInteraction(draw)

    draw.on('drawstart', () => {
      // Starting a fresh shape abandons any earlier unconfirmed one.
      pendingSource.clear()
    })

    draw.on('drawend', (event) => {
      const feature = event.feature
      // Real reprojection 3857 -> 4326; the on-map geometry stays 3857.
      const wkt = geometryToWkt4326(feature.getGeometry())
      const style = toolStylesRef.current[activeDrawTool]
      const clientKey = nextClientKey()

      // Tagged only enough to render: the shape shows in the tool's style while
      // the popup is open, and the popup's colour updates it live.
      feature.setId(clientKey)
      feature.set('drawingType', activeDrawTool)
      feature.set('style', style)

      // Nothing is POSTed here. The popup is now the only way forward: confirm
      // saves, cancel throws the geometry away.
      setPendingDrawing({ type: activeDrawTool, wkt, clientKey, style })
    })

    return () => {
      map.removeInteraction(draw)
      draw.dispose()
      drawRef.current = null
    }
    // `activeDrawTool` comes from useWorkspaceMode; switching tools there tears
    // this interaction down and builds the new one, which is exactly what makes
    // the style panel's type tabs change what the map actually draws.
  }, [map, activeDrawTool])

  // While the popup is open the map must not start another shape underneath it.
  // The interaction is only suspended, never rebuilt, so the tool stays exactly
  // as the user left it and drawing resumes the moment the popup closes.
  useEffect(() => {
    drawRef.current?.setActive(!pendingDrawing)
  }, [pendingDrawing])

  /** Drops the unsaved shape and closes the popup. Never touches the database. */
  const cancelPendingDrawing = useCallback(() => {
    pendingSourceRef.current?.clear()
    setPendingDrawing(null)
  }, [])

  /** Live colour preview on the unsaved shape while the popup is open. */
  const previewPendingColor = useCallback((color) => {
    const feature = pendingSourceRef.current?.getFeatures()[0]
    if (!feature) return

    const typeId = feature.get('drawingType')
    const patch = colorPatchFor(typeId, color)
    if (!patch) return

    feature.set('style', applyStylePatch(typeId, feature.get('style'), patch))
    pendingLayerRef.current?.changed()
  }, [])

  /**
   * "Kaydet" in the attribute popup: this is the only place a drawn shape
   * becomes a record. Name and colour travel with the geometry in one POST.
   *
   * @param {{ name: string, color: string, description?: string,
   *           category?: string, tags?: string[] }} attributes
   *   Metadata is optional: the popup keeps it behind "Daha fazla seçenek", so
   *   the common case still sends only a name and a colour.
   * @returns {Promise<boolean>} false leaves the popup open so the user can fix
   *   the input instead of losing the shape they just drew.
   */
  const savePendingDrawing = useCallback(
    async ({ name, color, description = '', category = '', tags = [] }) => {
      const pending = pendingDrawing
      if (!pending) return false

      const patch = colorPatchFor(pending.type, color)
      if (!patch) {
        showToast('error', 'Renk #RRGGBB formatında olmalıdır.')
        return false
      }

      const trimmedName = (name ?? '').trim()
      if (!trimmedName) {
        showToast('error', 'İsim alanı boş bırakılamaz.')
        return false
      }

      const style = applyStylePatch(pending.type, pending.style, patch)
      const type = DRAWING_TYPES[pending.type]
      const { wkt, clientKey } = pending
      const snapshot = {
        type: pending.type,
        wkt,
        style,
        name: trimmedName,
        description,
        category,
        tags,
        clientKey,
      }

      setSavingCount((count) => count + 1)

      try {
        const feature = await persistCreate(snapshot)

        // The record exists now, so the pending shape has been replaced by the
        // persisted one and its temporary copy must go.
        pendingSourceRef.current?.clear()
        setPendingDrawing(null)
        showToast('success', `${type.label} "${trimmedName}" kaydedildi.`)

        pushHistory({
          label: `${type.label} çizimi`,
          // Undo a create by deleting it; redo by posting the same snapshot.
          undo: guarded(() => persistDelete(clientKey), 'Geri alınamadı.'),
          redo: guarded(() => persistCreate(snapshot), 'İleri alınamadı.'),
        })

        // A saved polygon is the trigger for the intersection analysis. Its own
        // record id goes along so the polygon is not counted as its own match.
        if (pending.type === 'polygon' && feature) {
          onPolygonSaved?.({ wkt, databaseId: feature.get('databaseId'), name: trimmedName })
        }

        return true
      } catch (error) {
        // The geometry stays on the pending layer and the popup stays open, so
        // a failed save never costs the user the shape they drew.
        showToast('error', error?.message || 'Kaydedilemedi. Lütfen tekrar deneyin.')
        return false
      } finally {
        setSavingCount((count) => Math.max(0, count - 1))
      }
    },
    [pendingDrawing, persistCreate, persistDelete, pushHistory, guarded, showToast, onPolygonSaved],
  )

  // Any change of draw tool — leaving draw mode via Esc or the analysis tool,
  // or switching from point to line — abandons an unconfirmed shape. Otherwise
  // the popup would outlive the interaction that produced it and go on asking
  // about a shape drawn with a tool that is no longer selected.
  useEffect(() => {
    cancelPendingDrawing()
  }, [activeDrawTool, cancelPendingDrawing])

  /* --- Public actions ----------------------------------------------------- */

  /** Live preview while the style panel is open; nothing is persisted yet. */
  const previewStyle = useCallback(
    (key, style) => {
      const feature = featureByKey(key)
      if (!feature) return
      if (style) feature.set('previewStyle', style)
      else feature.unset('previewStyle')
      refreshLayer()
    },
    [featureByKey, refreshLayer],
  )

  /** Bulk preview: each feature keeps its own style except the patched fields. */
  const previewStylePatch = useCallback(
    (keys, patch) => {
      for (const feature of featuresByKeys(keys)) {
        if (!patch) {
          feature.unset('previewStyle')
          continue
        }
        const type = feature.get('drawingType')
        feature.set('previewStyle', applyStylePatch(type, feature.get('style'), patch))
      }
      refreshLayer()
    },
    [featuresByKeys, refreshLayer],
  )

  /** "Uygula": commits the previewed style through the API and records history. */
  const applyStyle = useCallback(
    async (key, style) => {
      const feature = featureByKey(key)
      if (!feature) return false

      const type = feature.get('drawingType')
      const before = feature.get('style')
      const after = normalizeStyle(type, style)

      if (isSameStyle(before, after)) {
        feature.unset('previewStyle')
        refreshLayer()
        return true
      }

      try {
        await persistStyle(key, after)
        showToast('success', 'Stil güncellendi.')
        pushHistory({
          label: 'Stil değişikliği',
          undo: guarded(() => persistStyle(key, before), 'Geri alınamadı.'),
          redo: guarded(() => persistStyle(key, after), 'İleri alınamadı.'),
        })
        return true
      } catch (error) {
        // Roll the preview back so the map keeps showing the persisted style.
        feature.unset('previewStyle')
        refreshLayer()
        showToast('error', error?.message || 'Stil güncellenemedi.')
        return false
      }
    },
    [featureByKey, persistStyle, refreshLayer, pushHistory, guarded, showToast],
  )

  /**
   * "Stil Uygula" for a multi-selection.
   *
   * Undo cannot replay one style backwards here, because the features started
   * out looking different from each other. So each record's full previous style
   * is snapshotted and undo sends them back per item — still one atomic call.
   */
  const applyStylePatchToSelection = useCallback(
    async (keys, patch) => {
      const features = featuresByKeys(keys)
      if (features.length === 0 || !patch || Object.keys(patch).length === 0) return false

      const clientKeys = features.map((feature) => feature.getId())
      const previous = Object.fromEntries(
        features.map((feature) => [feature.getId(), normalizeStyle(feature.get('drawingType'), feature.get('style'))]),
      )

      try {
        await persistBulkStyle(clientKeys, { shared: patch })
        showToast('success', `${countLabel(features.length)} için stil güncellendi.`)
        pushHistory({
          label: `${countLabel(features.length)} stil değişikliği`,
          undo: guarded(() => persistBulkStyle(clientKeys, { styleByKey: previous }), 'Geri alınamadı.'),
          redo: guarded(() => persistBulkStyle(clientKeys, { shared: patch }), 'İleri alınamadı.'),
        })
        return true
      } catch (error) {
        previewStylePatch(clientKeys, null)
        showToast('error', error?.message || 'Stiller güncellenemedi.')
        return false
      }
    },
    [featuresByKeys, persistBulkStyle, previewStylePatch, pushHistory, guarded, showToast],
  )

  /**
   * The detail popup's "Kaydet": persists name, colour and geometry together.
   *
   * The previous values are snapshotted first so the change joins the same
   * undo/redo stack as everything else — an edit is no less reversible than a
   * style change or a delete. The snapshot is taken from the live feature
   * (including its current geometry as WKT), which is exactly what a later
   * `persistUpdate` needs to put things back.
   *
   * @param {{ name?: string, style?: object, wkt?: string }} changes
   */
  const updateFeature = useCallback(
    async (key, changes) => {
      const feature = featureByKey(key)
      if (!feature) return false

      const type = feature.get('drawingType')
      /* The snapshot has to cover EVERY field the update can change. Leaving
         metadata out would make undo a partial restore: the name and geometry
         would go back while the new description silently stayed. Sending the
         old values explicitly (including empty strings and an empty tag list)
         is also what lets undo *clear* a field the edit had filled in. */
      const before = {
        name: feature.get('name') ?? '',
        description: feature.get('description') ?? '',
        category: feature.get('category') ?? '',
        tags: [...(feature.get('tags') ?? [])],
        style: feature.get('style'),
        wkt: geometryToWkt4326(feature.getGeometry()),
      }

      setSavingCount((count) => count + 1)
      try {
        await persistUpdate(key, changes)
        showToast('success', `${DRAWING_TYPES[type].label} güncellendi.`)
        pushHistory({
          label: `${DRAWING_TYPES[type].label} düzenleme`,
          undo: guarded(() => persistUpdate(key, before), 'Geri alınamadı.'),
          redo: guarded(() => persistUpdate(key, changes), 'İleri alınamadı.'),
        })
        return true
      } catch (error) {
        showToast('error', error?.message || 'Çizim güncellenemedi.')
        return false
      } finally {
        setSavingCount((count) => Math.max(0, count - 1))
      }
    },
    [featureByKey, persistUpdate, pushHistory, guarded, showToast],
  )

  /** Deletes a feature, keeping a full snapshot so undo can recreate it. */
  const removeFeature = useCallback(
    async (key) => {
      const feature = featureByKey(key)
      if (!feature) return false

      const type = feature.get('drawingType')
      // databaseId is what undo actually needs: the row survives the delete,
      // so restoring is "reopen id N", not "create something like it again".
      const snapshot = {
        type,
        databaseId: feature.get('databaseId'),
        clientKey: key,
      }

      try {
        await persistDelete(key)
        showToast('success', `${DRAWING_TYPES[type].label} silindi.`)
        pushHistory({
          label: `${DRAWING_TYPES[type].label} silme`,
          undo: guarded(() => persistRestore([snapshot]), 'Geri alınamadı.'),
          redo: guarded(() => persistDelete(key), 'İleri alınamadı.'),
        })
        return true
      } catch (error) {
        showToast('error', error?.message || 'Çizim silinemedi.')
        return false
      }
    },
    [featureByKey, persistDelete, persistRestore, pushHistory, guarded, showToast],
  )

  /**
   * Deletes a whole selection in one transaction.
   *
   * Deletion is soft server-side, so undo only needs each row's identity: the
   * geometry, name, style and owner are still in the database and come back
   * untouched. The snapshot therefore carries just `databaseId` plus the
   * original client key, which is what lets the restored feature reappear
   * under the same key. Because both directions are single atomic calls, there
   * is no intermediate state in which the map and the database disagree.
   */
  const removeFeatures = useCallback(
    async (keys) => {
      const features = featuresByKeys(keys)
      if (features.length === 0) return false

      const snapshots = features.map((feature) => ({
        type: feature.get('drawingType'),
        databaseId: feature.get('databaseId'),
        clientKey: feature.getId(),
      }))
      const clientKeys = snapshots.map((snapshot) => snapshot.clientKey)

      try {
        await persistBulkDelete(clientKeys)
        showToast('success', `${countLabel(snapshots.length)} silindi.`)
        pushHistory({
          label: `${countLabel(snapshots.length)} silme`,
          undo: guarded(() => persistRestore(snapshots), 'Geri alınamadı.'),
          // Soft delete keeps the row, so the ids never change across
          // undo/redo cycles — redo can reuse the very same keys.
          redo: guarded(() => persistBulkDelete(clientKeys), 'İleri alınamadı.'),
        })
        return true
      } catch (error) {
        showToast('error', error?.message || 'Çizimler silinemedi.')
        return false
      }
    },
    [featuresByKeys, persistBulkDelete, persistRestore, pushHistory, guarded, showToast],
  )

  const historyUndo = history.undo
  const historyRedo = history.redo

  const undo = useCallback(async () => {
    const result = await historyUndo()
    if (result.ok && !result.skipped) showToast('info', `Geri alındı: ${result.command.label}`)
  }, [historyUndo, showToast])

  const redo = useCallback(async () => {
    const result = await historyRedo()
    if (result.ok && !result.skipped) showToast('info', `İleri alındı: ${result.command.label}`)
  }, [historyRedo, showToast])

  /** Sets the style a tool will use for its next drawing. */
  const setToolStyle = useCallback((typeId, style) => {
    setToolStyles((current) => ({ ...current, [typeId]: normalizeStyle(typeId, style) }))
  }, [])

  /** Extent of all currently visible features, or null when there is nothing. */
  const visibleExtent = useCallback(() => {
    const source = sourceRef.current
    if (!source) return null

    const extent = createEmpty()
    for (const feature of source.getFeatures()) {
      if (visibility[feature.get('drawingType')] === false) continue
      extend(extent, feature.getGeometry().getExtent())
    }
    return isEmpty(extent) ? null : extent
  }, [visibility])

  const extentOf = useCallback(
    (key) => featureByKey(key)?.getGeometry()?.getExtent() ?? null,
    [featureByKey],
  )

  /** Combined extent of several features — "Seçime Odaklan". */
  const extentOfKeys = useCallback(
    (keys) => {
      const features = featuresByKeys(keys)
      if (features.length === 0) return null

      const extent = createEmpty()
      for (const feature of features) extend(extent, feature.getGeometry().getExtent())
      return isEmpty(extent) ? null : extent
    },
    [featuresByKeys],
  )

  /* --- Derived selection views -------------------------------------------- */

  const selectedFeatures = useMemo(
    () => drawings.filter((item) => selectedKeys.has(item.key)),
    [drawings, selectedKeys],
  )

  const selectionCount = selectedFeatures.length

  /** Only meaningful for a selection of exactly one — the detail panel's input. */
  const selectedFeature = selectionCount === 1 ? selectedFeatures[0] : null

  /** Per-type tally shown in the multi-selection summary. */
  const selectionCounts = useMemo(() => {
    const counts = { point: 0, line: 0, polygon: 0 }
    for (const item of selectedFeatures) counts[item.type] += 1
    return counts
  }, [selectedFeatures])

  /** Grouped counts + records for the "Çizimler" panel. */
  const drawingGroups = useMemo(
    () =>
      DRAWING_TYPE_IDS.map((typeId) => ({
        type: DRAWING_TYPES[typeId],
        items: drawings.filter((item) => item.type === typeId),
      })),
    [drawings],
  )

  /** How many features are on screen right now — enables "Tüm Görünenleri Seç". */
  const visibleCount = useMemo(
    () => drawings.filter((item) => visibility[item.type] !== false).length,
    [drawings, visibility],
  )

  return {
    // state
    drawings,
    drawingGroups,
    selectedKeys,
    selectedFeature,
    selectedFeatures,
    selectionCount,
    selectionCounts,
    visibility,
    visibleCount,
    loadingDrawings,
    loadError,
    reloadDrawings: loadDrawings,
    isSaving: savingCount > 0,
    toolStyles,
    pendingDrawing,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    // selection actions
    selectFeature,
    setSelection,
    addToSelection,
    toggleSelection,
    clearSelection,
    selectAllVisible,
    selectKeysIn,
    // drawing actions
    toggleVisibility,
    previewStyle,
    previewStylePatch,
    applyStyle,
    applyStylePatchToSelection,
    updateFeature,
    removeFeature,
    removeFeatures,
    setToolStyle,
    undo,
    redo,
    // attribute popup (drawend -> popup -> save/cancel)
    savePendingDrawing,
    cancelPendingDrawing,
    previewPendingColor,
    // geometry helpers
    featureByKey,
    visibleExtent,
    extentOf,
    extentOfKeys,
  }
}
