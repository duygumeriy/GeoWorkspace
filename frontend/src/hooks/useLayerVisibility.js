import { useCallback, useMemo, useState } from 'react'
import {
  hideDrawings,
  hideRecords,
  reconcileHiddenDrawingIds,
  reconcileHiddenIds,
  showDrawings,
  showRecords,
  toggleDrawing,
  toggleRecord,
} from '../map/layerVisibility.js'

/** Canonical persisted-record visibility state; selection never enters this hook. */
export default function useLayerVisibility() {
  const [hiddenPoiIds, setHiddenPoiIds] = useState(() => new Set())
  const [hiddenTransportStopIds, setHiddenTransportStopIds] = useState(() => new Set())
  const [hiddenDrawingIds, setHiddenDrawingIds] = useState(() => new Set())

  const setPoiVisible = useCallback((ids, visible) => {
    setHiddenPoiIds((current) => visible ? showRecords(current, ids) : hideRecords(current, ids))
  }, [])
  const togglePoi = useCallback((id) => setHiddenPoiIds((current) => toggleRecord(current, id)), [])

  const setStopVisible = useCallback((ids, visible) => {
    setHiddenTransportStopIds((current) => visible ? showRecords(current, ids) : hideRecords(current, ids))
  }, [])
  const toggleStop = useCallback((id) => setHiddenTransportStopIds((current) => toggleRecord(current, id)), [])

  const setDrawingVisible = useCallback((ids, visible) => {
    setHiddenDrawingIds((current) => visible ? showDrawings(current, ids) : hideDrawings(current, ids))
  }, [])
  const toggleDrawingVisibility = useCallback(
    (id) => setHiddenDrawingIds((current) => toggleDrawing(current, id)),
    [],
  )

  const reconcilePois = useCallback(
    (ids) => setHiddenPoiIds((current) => reconcileHiddenIds(current, ids)),
    [],
  )
  const reconcileStops = useCallback(
    (ids) => setHiddenTransportStopIds((current) => reconcileHiddenIds(current, ids)),
    [],
  )
  const reconcileDrawings = useCallback(
    (ids) => setHiddenDrawingIds((current) => reconcileHiddenDrawingIds(current, ids)),
    [],
  )

  return useMemo(() => ({
    hiddenPoiIds,
    hiddenTransportStopIds,
    hiddenDrawingIds,
    setPoiVisible,
    togglePoi,
    setStopVisible,
    toggleStop,
    setDrawingVisible,
    toggleDrawing: toggleDrawingVisibility,
    reconcilePois,
    reconcileStops,
    reconcileDrawings,
  }), [
    hiddenPoiIds,
    hiddenTransportStopIds,
    hiddenDrawingIds,
    setPoiVisible,
    togglePoi,
    setStopVisible,
    toggleStop,
    setDrawingVisible,
    toggleDrawingVisibility,
    reconcilePois,
    reconcileStops,
    reconcileDrawings,
  ])
}
