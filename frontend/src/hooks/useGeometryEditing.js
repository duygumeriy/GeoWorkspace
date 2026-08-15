import { useEffect, useRef } from 'react'
import Collection from 'ol/Collection'
import Modify from 'ol/interaction/Modify'
import Translate from 'ol/interaction/Translate'

/** The two ways the map itself can reshape a drawing. */
export const GEOMETRY_EDIT_MODES = Object.freeze({
  /** Drag individual vertices — precise reshaping. */
  vertex: 'vertex',
  /** Drag the whole shape without deforming it. */
  translate: 'translate',
})

/**
 * The map half of an edit session: the OpenLayers interactions, nothing else.
 *
 *   - `Modify`    drags vertices, and adds an intermediate one when a segment is
 *                 dragged — the native behaviour is kept because it is the
 *                 fastest way to add a point where the user is already looking.
 *   - `Translate` drags the shape as a whole, leaving its form untouched.
 *
 * Exactly one is live at a time, chosen by `mode`, so a drag can never be
 * ambiguous: in "Köşeleri Düzenle" a drag always means a vertex, in "Tüm
 * Geometriyi Taşı" it always means the whole shape. Both are built over a
 * one-element `Collection` rather than the layer's source, so only the record
 * under edit can be reshaped — a stray drag near a neighbour cannot silently
 * modify a different drawing.
 *
 * ## No state of its own
 *
 * This hook holds no geometry snapshot and no dirty flag. When a gesture ends it
 * calls `onCommit`, and the edit session reads the new geometry, converts it to
 * EPSG:4326 and puts it on the same undo stack as every manual operation. That
 * is what keeps map editing and the coordinate editor working on ONE geometry
 * rather than two that have to be kept in step. Cancelling and resetting belong
 * to the session for the same reason.
 *
 * @param {import('ol/Map').default | null} map
 * @param {{ active: boolean,
 *           feature: import('ol/Feature').default | null,
 *           mode?: string,
 *           onCommit?: () => void }} options
 */
export default function useGeometryEditing(map, { active, feature, mode = GEOMETRY_EDIT_MODES.vertex, onCommit = null }) {
  // Read at gesture-end time, so changing the handler never rebuilds the
  // interaction — doing that mid-drag would abort the drag.
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit

  useEffect(() => {
    if (!map || !active || !feature?.getGeometry()) return undefined

    const features = new Collection([feature])
    const commit = () => onCommitRef.current?.()

    /* One interaction per mode. Adding both and toggling `setActive` would leave
       two objects competing for the same pointer events; building only the one
       the mode asks for keeps the exclusivity structural. */
    const interaction =
      mode === GEOMETRY_EDIT_MODES.translate ? new Translate({ features }) : new Modify({ features })

    const endEvent = mode === GEOMETRY_EDIT_MODES.translate ? 'translateend' : 'modifyend'

    interaction.on(endEvent, commit)
    map.addInteraction(interaction)

    return () => {
      interaction.un(endEvent, commit)
      map.removeInteraction(interaction)
      interaction.dispose?.()
    }
  }, [map, active, feature, mode])
}
