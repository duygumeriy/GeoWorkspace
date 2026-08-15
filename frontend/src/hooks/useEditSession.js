import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addVertex as addVertexAt,
  areaOf,
  buildMapGeometry,
  extendLine,
  fromMapGeometry,
  isSameCoords,
  lengthOf,
  moveVertex as moveVertexBy,
  perimeterOf,
  removeVertex as removeVertexAt,
  setLineTargetLength,
  setVertex as setVertexAt,
  shortenLine,
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

  /** Applies a coords transform and records the previous list for undo. */
  const commitCoords = useCallback((next, { record = true } = {}) => {
    setState((current) => {
      if (!current || !next || isSameCoords(current.coords, next)) return current

      return {
        ...current,
        coords: next,
        past: record ? [...current.past, current.coords] : current.past,
        // Any new edit invalidates the redo branch.
        future: record ? [] : current.future,
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
      return {
        ...current,
        coords: current.past.at(-1),
        past: current.past.slice(0, -1),
        future: [...current.future, current.coords],
      }
    })
  }, [])

  const redo = useCallback(() => {
    setState((current) => {
      if (!current?.future.length) return current
      return {
        ...current,
        coords: current.future.at(-1),
        past: [...current.past, current.coords],
        future: current.future.slice(0, -1),
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

  const addVertex = useCallback(
    (index) => commitCoords(addVertexAt(coordsRef.current ?? [], index)),
    [commitCoords],
  )

  /** @returns {string|null} the reason when the minimum blocks the removal. */
  const removeVertex = useCallback(
    (index) => {
      const result = removeVertexAt(type, coordsRef.current ?? [], index)
      if (result.removed) commitCoords(result.coords)
      return result.reason
    },
    [type, commitCoords],
  )

  const moveVertex = useCallback(
    (index, direction) => commitCoords(moveVertexBy(coordsRef.current ?? [], index, direction)),
    [commitCoords],
  )

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

  /** Live measurements, recomputed from the canonical vertex list. */
  const metrics = useMemo(() => {
    if (!state) return null
    const { type: geometryType, coords: current } = state

    if (geometryType === 'line') {
      return { length: lengthOf(current), vertexCount: current.length }
    }
    if (geometryType === 'polygon') {
      return { area: areaOf(current), perimeter: perimeterOf(current), vertexCount: current.length }
    }
    return { vertexCount: current.length }
  }, [state])

  const validity = useMemo(
    () => (state ? validateCoords(state.type, state.coords) : { ok: false, reason: null }),
    [state],
  )

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
    addVertex,
    removeVertex,
    moveVertex,
    extend,
    shorten,
    setTargetLength,
    // session controls
    setDraftField,
    undo,
    redo,
    reset,
    revertGeometry,
    toWkt,
  }
}
