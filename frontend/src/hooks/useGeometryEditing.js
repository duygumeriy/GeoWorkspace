import { useCallback, useEffect, useRef } from 'react'
import Collection from 'ol/Collection'
import Modify from 'ol/interaction/Modify'
import Translate from 'ol/interaction/Translate'

/**
 * Geometry editing for exactly one already-saved feature.
 *
 * Uses OpenLayers' native interactions rather than a hand-rolled vertex editor:
 *
 *   - `Modify`    drags vertices — the whole story for a line or a polygon, and
 *                 the way a point is moved precisely.
 *   - `Translate` drags the shape as a whole, which is what "move this pin"
 *                 means for a point.
 *
 * Both are built over a one-element `Collection` rather than the layer's source,
 * so only the record under edit can be reshaped: a stray drag near a neighbour
 * cannot silently modify a different drawing.
 *
 * ## Cancelling
 *
 * The original geometry is cloned the moment editing starts and restored by
 * `cancel()`. `Modify` mutates the feature's geometry in place, so without that
 * snapshot "İptal" could only be honoured by refetching from the server — this
 * way it is instant and works offline too.
 *
 * The hook never talks to the API. Saving is the caller's job; this hook only
 * owns the interactions and the undo snapshot.
 *
 * @param {import('ol/Map').default | null} map
 * @param {{ active: boolean, feature: import('ol/Feature').default | null,
 *           onChange?: () => void }} options
 */
export default function useGeometryEditing(map, { active, feature, onChange = null }) {
  /** Geometry as it was when editing began; the input to "İptal". */
  const originalRef = useRef(null)
  /** True once the user has actually moved something. */
  const dirtyRef = useRef(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!map || !active || !feature) return undefined

    const geometry = feature.getGeometry()
    if (!geometry) return undefined

    // Snapshot BEFORE any interaction can touch it.
    originalRef.current = geometry.clone()
    dirtyRef.current = false

    const features = new Collection([feature])
    const markDirty = () => {
      dirtyRef.current = true
      onChangeRef.current?.()
    }

    const modify = new Modify({ features })
    modify.on('modifyend', markDirty)
    map.addInteraction(modify)

    /* Translate is added for points only. On a line or polygon it would let a
       drag move the entire shape when the user was aiming for a vertex, which
       reads as the edit going wrong; there, Modify alone is the precise tool. */
    const isPoint = geometry.getType() === 'Point'
    let translate = null

    if (isPoint) {
      translate = new Translate({ features })
      translate.on('translateend', markDirty)
      map.addInteraction(translate)
    }

    return () => {
      modify.un('modifyend', markDirty)
      map.removeInteraction(modify)
      modify.dispose?.()

      if (translate) {
        translate.un('translateend', markDirty)
        map.removeInteraction(translate)
        translate.dispose?.()
      }
    }
  }, [map, active, feature])

  /**
   * Puts the geometry back the way it was when editing started.
   * Safe to call when nothing was moved — it is then a no-op.
   */
  const cancel = useCallback(() => {
    const original = originalRef.current
    if (original && feature && dirtyRef.current) {
      // setCoordinates keeps the same geometry instance the layer already
      // renders, so the map updates without re-adding the feature.
      feature.getGeometry()?.setCoordinates(original.getCoordinates())
    }
    originalRef.current = null
    dirtyRef.current = false
  }, [feature])

  /** Drops the snapshot after a successful save — the new shape is now current. */
  const commit = useCallback(() => {
    originalRef.current = null
    dirtyRef.current = false
  }, [])

  return { cancel, commit }
}
