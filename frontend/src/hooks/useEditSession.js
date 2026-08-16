import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addVertexAfter as addVertexAfterAt,
  addVertexBefore as addVertexBeforeAt,
  areaOf,
  buildMapGeometry,
  extendLine,
  fromMapGeometry,
  isSameCoords,
  lengthOf,
  moveVertex as moveVertexBy,
  perimeterOf,
  removeVertex as removeVertexAt,
  segmentsOf,
  setLineTargetLength,
  setVertex as setVertexAt,
  shortenLine,
  splitSegment as splitSegmentAt,
  toMapCoordinates,
  validateCoords,
} from '../map/geometryEdit.js'
import { normalizeHex, primaryColorOf } from '../map/drawingTypes.js'
import { geometryToWkt4326 } from '../map/drawing.js'

/**
 * The edit session: one drawing's editable state, from "Düzenle" to
 * "Kaydet" / "İptal".
 *
 * ## Single source of truth
 *
 * Everything that can change a drawing writes into ONE place — `state.coords`,
 * a list of `[lon, lat]` vertices in EPSG:4326:
 *
 *     map Modify / Translate ─┐
 *     manual coordinate input ├─> state.coords ─> feature geometry (3857)
 *     add / delete / reorder  │                     └─> live preview + metrics
 *     extend / shorten / target
 *     undo / redo / reset     ─┘
 *
 * The OpenLayers geometry is a *rendering* of that list, refreshed by the effect
 * below, never a second copy that has to be reconciled. Dragging a vertex on the
 * map and typing a longitude therefore cannot overwrite one another: both land
 * in the same array, and both go onto the same undo stack.
 *
 * ## Nothing is written until "Kaydet"
 *
 * No operation here talks to the API. `İptal` and `Orijinale Döndür` restore the
 * snapshot taken when the session opened, which is why both are instant and
 * neither needs a request.
 *
 * @param {{ feature: import('ol/Feature').default | null,
 *           descriptor: object | null,
 *           active: boolean }} options
 */
export default function useEditSession({ feature, descriptor, active }) {
  /**
   * The whole session in one object:
   *   `{ key, type, original, draft, coords, past, future }`
   *
   * Keeping it as a single state value is what makes undo/redo and the dirty
   * check trivial — each is a plain comparison of snapshots rather than a set of
   * separate states that could fall out of step.
   */
  const [state, setState] = useState(null)

  /** Latest coords, readable from callbacks that must not close over state. */
  const coordsRef = useRef(null)
  coordsRef.current = state?.coords ?? null

  /* --- Opening and closing the session ------------------------------------ */

  const recordKey = descriptor?.key ?? null

  useEffect(() => {
    if (!active || !feature || !descriptor) {
      setState(null)
      return
    }

    // Re-seeding on every `descriptor` change would throw away what the user has
    // typed (the descriptor is a fresh object on each sync). The session is
    // therefore keyed to the record and seeded exactly once per record.
    setState((current) => {
      if (current?.key === recordKey) return current

      const type = descriptor.type
      const coords = fromMapGeometry(type, feature.getGeometry())

      const draft = {
        name: descriptor.name ?? '',
        description: descriptor.description ?? '',
        category: descriptor.category ?? '',
        tags: [...(descriptor.tags ?? [])],
        color: primaryColorOf(descriptor.style),
      }

      return {
        key: recordKey,
        type,
        // The snapshot "İptal" and "Orijinale Döndür" both return to.
        original: { draft, coords },
        draft,
        coords,
        past: [],
        future: [],
        /* Which vertex / which edge the user is working on. Selection lives in
           the session, next to the list it indexes, so the panel row and the
           marker on the map cannot disagree about what "Köşe 3" means — there
           is one number, read by both. Only ever one of the two is set: a
           vertex and the edge beside it are different targets and offer
           different actions. */
        selectedVertex: null,
        selectedEdge: null,
      }
    })
  }, [active, feature, descriptor, recordKey])

  /* --- Canonical state -> map geometry -------------------------------------
     The one write path onto the OpenLayers geometry. `setCoordinates` keeps the
     same geometry instance the layer already renders, so the map updates without
     the feature being re-added — and Modify keeps its handles.

     This cannot loop back: `modifyend` / `translateend` only fire for user
     gestures, never for a programmatic coordinate write. */

  const coords = state?.coords
  const type = state?.type

  useEffect(() => {
    if (!feature || !coords || !type) return
    const geometry = feature.getGeometry()
    if (!geometry) return

    const validity = validateCoords(type, coords)
    // A half-typed coordinate ("-" or "3.") must not be pushed onto the map as
    // NaN; the inputs keep showing it and the save button stays disabled until
    // it becomes a real number again.
    if (!validity.ok) return

    geometry.setCoordinates(toMapCoordinates(type, coords))
  }, [feature, coords, type])

  /* --- History -------------------------------------------------------------
     Only geometry goes on the stack. Metadata edits are ordinary text input —
     putting every keystroke on an undo stack would bury the geometry operations
     the user actually wants to step back through. */

  /**
   * Applies a coords transform and records the previous list for undo.
   *
   * @param {{ record?: boolean, select?: number|null }} options `select` pins the
   *   vertex selection to a known position — an insertion passes the index it
   *   just created, so the new point is the one highlighted and the coordinate
   *   boxes underneath already belong to it.
   */
  const commitCoords = useCallback((next, { record = true, select } = {}) => {
    setState((current) => {
      if (!current || !next || isSameCoords(current.coords, next)) return current

      const countChanged = next.length !== current.coords.length

      return {
        ...current,
        coords: next,
        past: record ? [...current.past, current.coords] : current.past,
        // Any new edit invalidates the redo branch.
        future: record ? [] : current.future,
        selectedVertex:
          select === undefined ? clampSelection(current.selectedVertex, next.length) : select,
        /* Inserting or deleting a vertex renumbers every segment after it, so an
           edge picked before the change would now highlight a different edge
           than the one the user chose. Dropping it is the honest answer. */
        selectedEdge: countChanged ? null : current.selectedEdge,
      }
    })
  }, [])

  /**
   * Geometry changed on the map (a dragged vertex, a translated shape).
   *
   * Routed through the same `commitCoords` as every other operation, which is
   * what puts a map drag and a typed coordinate on one undo stack.
   */
  const commitFromMap = useCallback(() => {
    if (!feature || !type) return
    commitCoords(fromMapGeometry(type, feature.getGeometry()))
  }, [feature, type, commitCoords])

  const undo = useCallback(() => {
    setState((current) => {
      if (!current?.past.length) return current
      const coords = current.past.at(-1)
      return {
        ...current,
        coords,
        past: current.past.slice(0, -1),
        future: [...current.future, current.coords],
        ...selectionForLength(current, coords.length),
      }
    })
  }, [])

  const redo = useCallback(() => {
    setState((current) => {
      if (!current?.future.length) return current
      const coords = current.future.at(-1)
      return {
        ...current,
        coords,
        past: [...current.past, current.coords],
        future: current.future.slice(0, -1),
        ...selectionForLength(current, coords.length),
      }
    })
  }, [])

  /**
   * "Orijinale Döndür": back to the session's opening snapshot — geometry and
   * metadata alike. Purely local; the database is never consulted.
   */
  const reset = useCallback(() => {
    setState((current) => {
      if (!current) return current
      return {
        ...current,
        draft: current.original.draft,
        coords: current.original.coords,
        // The reset itself is undoable, so a mis-click is not destructive.
        past: isSameCoords(current.coords, current.original.coords)
          ? current.past
          : [...current.past, current.coords],
        future: [],
        ...selectionForLength(current, current.original.coords.length),
      }
    })
  }, [])

  /**
   * Puts the map geometry back to the session's opening snapshot.
   *
   * "İptal" tears the session down, so the state -> geometry effect above will
   * not run one last time; the restore therefore has to be written here,
   * explicitly, before the session closes. It is a local write — the record in
   * the database was never touched, so nothing has to be re-fetched.
   */
  const revertGeometry = useCallback(() => {
    if (!feature || !state) return
    const geometry = feature.getGeometry()
    if (!geometry) return
    geometry.setCoordinates(toMapCoordinates(state.type, state.original.coords))
  }, [feature, state])

  /**
   * The session's geometry as EPSG:4326 WKT — what "Kaydet" sends.
   *
   * Built from the vertex list rather than read back off the map, so the saved
   * shape is exactly what the editor holds. Reading the feature instead would
   * depend on the state -> geometry effect having already run, which is a race
   * nobody should have to reason about at save time. Polygon rings are closed
   * on the way through, by `toMapCoordinates`.
   */
  const toWkt = useCallback(() => {
    if (!state) return null
    return geometryToWkt4326(buildMapGeometry(state.type, state.coords))
  }, [state])

  /* --- Metadata drafts ----------------------------------------------------- */

  const setDraftField = useCallback((field, value) => {
    setState((current) =>
      current ? { ...current, draft: { ...current.draft, [field]: value } } : current,
    )
  }, [])

  /* --- Vertex operations ---------------------------------------------------- */

  const setVertex = useCallback(
    (index, vertex) => commitCoords(setVertexAt(coordsRef.current ?? [], index, vertex)),
    [commitCoords],
  )

  /* Insertions all report the position they created and select it, so the new
     vertex is the highlighted one on the map and the one the coordinate boxes
     are editing. "Where did the point go?" is answered before it is asked. */

  const addVertexAfter = useCallback(
    (index) => {
      const result = addVertexAfterAt(type, coordsRef.current ?? [], index)
      commitCoords(result.coords, { select: result.index })
    },
    [type, commitCoords],
  )

  const addVertexBefore = useCallback(
    (index) => {
      const result = addVertexBeforeAt(type, coordsRef.current ?? [], index)
      commitCoords(result.coords, { select: result.index })
    },
    [type, commitCoords],
  )

  /** Splits the currently highlighted edge — "Seçili Kenara Köşe Ekle". */
  const splitSelectedEdge = useCallback(() => {
    const edge = state?.selectedEdge
    if (edge == null) return
    const result = splitSegmentAt(type, coordsRef.current ?? [], edge)
    commitCoords(result.coords, { select: result.index })
  }, [type, state?.selectedEdge, commitCoords])

  /** @returns {string|null} the reason when the minimum blocks the removal. */
  const removeVertex = useCallback(
    (index) => {
      const result = removeVertexAt(type, coordsRef.current ?? [], index)
      // The neighbour that slid into the deleted position takes the selection,
      // so the list does not jump back to nothing after every removal.
      if (result.removed) {
        commitCoords(result.coords, { select: clampSelection(index, result.coords.length) })
      }
      return result.reason
    },
    [type, commitCoords],
  )

  const moveVertex = useCallback(
    (index, direction) => {
      const next = moveVertexBy(coordsRef.current ?? [], index, direction)
      // The selection follows the vertex, not the row: the point the user was
      // holding stays highlighted after it swaps places.
      commitCoords(next, { select: clampSelection(index + direction, next.length) })
    },
    [commitCoords],
  )

  /* --- Selection ------------------------------------------------------------
     Setting one clears the other: a vertex and an edge offer different actions,
     and having both lit would leave "add a point here" ambiguous again. */

  const selectVertex = useCallback((index) => {
    setState((current) =>
      current ? { ...current, selectedVertex: index, selectedEdge: null } : current,
    )
  }, [])

  const selectEdge = useCallback((index) => {
    setState((current) =>
      current ? { ...current, selectedEdge: index, selectedVertex: null } : current,
    )
  }, [])

  const clearSelection = useCallback(() => {
    setState((current) =>
      current ? { ...current, selectedVertex: null, selectedEdge: null } : current,
    )
  }, [])

  /* --- Line length tools ----------------------------------------------------
     Each returns the failure reason (or null), so the panel can explain why an
     operation was refused instead of silently doing nothing. */

  const runLineOperation = useCallback(
    (operation) => {
      const result = operation(coordsRef.current ?? [])
      if (result.ok) commitCoords(result.coords)
      return result.ok ? null : result.reason
    },
    [commitCoords],
  )

  const extend = useCallback(
    (end, distance) => runLineOperation((current) => extendLine(current, end, distance)),
    [runLineOperation],
  )

  const shorten = useCallback(
    (end, distance) => runLineOperation((current) => shortenLine(current, end, distance)),
    [runLineOperation],
  )

  const setTargetLength = useCallback(
    (target, fixedEnd) => runLineOperation((current) => setLineTargetLength(current, target, fixedEnd)),
    [runLineOperation],
  )

  /* --- Derived -------------------------------------------------------------- */

  /* All three derive from the vertex list ALONE, never from the whole session:
     selecting a row must not make the area, the length or the vertex count
     flicker through a recomputation the user can see. */

  /** Live measurements, recomputed from the canonical vertex list. */
  const metrics = useMemo(() => {
    if (!coords || !type) return null

    if (type === 'line') return { length: lengthOf(coords), vertexCount: coords.length }
    if (type === 'polygon') {
      return { area: areaOf(coords), perimeter: perimeterOf(coords), vertexCount: coords.length }
    }
    return { vertexCount: coords.length }
  }, [type, coords])

  const validity = useMemo(
    () => (coords && type ? validateCoords(type, coords) : { ok: false, reason: null }),
    [type, coords],
  )

  /** The editable segments, numbered as the panel and the map both label them. */
  const segments = useMemo(
    () => (coords && type ? segmentsOf(type, coords) : []),
    [type, coords],
  )

  /* Read back through the current list rather than trusted as stored: a stale
     index must render as "nothing selected", never as a highlight on the wrong
     vertex. */
  const selectedVertex = clampSelection(state?.selectedVertex ?? null, state?.coords.length ?? 0)
  const selectedEdge = clampSelection(state?.selectedEdge ?? null, segments.length)

  /** Anything at all changed since the session opened? Drives the unsaved guard. */
  const isDirty = useMemo(() => {
    if (!state) return false
    const { draft, original } = state

    return (
      !isSameCoords(state.coords, original.coords) ||
      draft.name !== original.draft.name ||
      draft.description !== original.draft.description ||
      draft.category !== original.draft.category ||
      normalizeHex(draft.color) !== normalizeHex(original.draft.color) ||
      draft.tags.length !== original.draft.tags.length ||
      draft.tags.some((tag, index) => tag !== original.draft.tags[index])
    )
  }, [state])

  /**
   * The name rule the backend enforces, checked here only so the user is not
   * sent on a request that is certain to fail.
   */
  const trimmedName = (state?.draft.name ?? '').trim()
  const canSave = Boolean(state) && validity.ok && trimmedName.length > 0 && trimmedName.length <= 200

  return {
    /** Non-null exactly while a session is open. */
    session: state,
    type,
    coords,
    segments,
    draft: state?.draft ?? null,
    metrics,
    validity,
    isDirty,
    canSave,
    canUndo: Boolean(state?.past.length),
    canRedo: Boolean(state?.future.length),
    // geometry operations — all of them land in the same coords array
    commitFromMap,
    setVertex,
    addVertexAfter,
    addVertexBefore,
    splitSelectedEdge,
    removeVertex,
    moveVertex,
    extend,
    shorten,
    setTargetLength,
    // shared selection — the panel and the map read and write these
    selectedVertex,
    selectedEdge,
    selectVertex,
    selectEdge,
    clearSelection,
    // session controls
    setDraftField,
    undo,
    redo,
    reset,
    revertGeometry,
    toWkt,
  }
}

/**
 * Keeps a selection index inside a list that may have shrunk.
 *
 * Returns `null` for an empty list and pins to the last position otherwise, so
 * deleting the final vertex leaves the new final vertex selected rather than
 * pointing one past the end.
 */
function clampSelection(index, length) {
  if (index == null || length === 0) return null
  return Math.min(Math.max(index, 0), length - 1)
}

/** Selection after a history jump: keep the vertex if it still exists, drop the
 *  edge, whose numbering the jump may have changed entirely. */
function selectionForLength(current, length) {
  return {
    selectedVertex: clampSelection(current.selectedVertex, length),
    selectedEdge: null,
  }
}
