import { useEffect } from 'react'
import { TRANSPORT_STOP_KIND, TRANSPORT_STOP_LAYER_CLASSNAME } from '../map/transport.js'

const HIT_TOLERANCE = 8

export default function useTransportStopInteraction(map, { enabled, hoverEnabled, onSelect }) {
  useEffect(() => {
    if (!map || !enabled) return undefined
    const findStop = (pixel) => map.forEachFeatureAtPixel(
      pixel,
      (feature, layer) =>
        layer?.getClassName?.().includes(TRANSPORT_STOP_LAYER_CLASSNAME)
        && feature.get('featureKind') === TRANSPORT_STOP_KIND
          ? feature
          : null,
      { hitTolerance: HIT_TOLERANCE },
    )
    const handleClick = (event) => {
      const feature = findStop(event.pixel)
      onSelect(feature?.get('transportStop') ?? null)
    }
    map.on('singleclick', handleClick)
    return () => map.un('singleclick', handleClick)
  }, [map, enabled, onSelect])

  useEffect(() => {
    if (!map || !enabled || !hoverEnabled) return undefined
    let ownsCursor = false
    const handleMove = (event) => {
      if (event.dragging) return
      const found = map.forEachFeatureAtPixel(
        event.pixel,
        (feature, layer) =>
          layer?.getClassName?.().includes(TRANSPORT_STOP_LAYER_CLASSNAME)
          && feature.get('featureKind') === TRANSPORT_STOP_KIND,
        { hitTolerance: HIT_TOLERANCE },
      )
      if (found) {
        map.getTargetElement().style.cursor = 'pointer'
        ownsCursor = true
      } else if (ownsCursor) {
        map.getTargetElement().style.cursor = ''
        ownsCursor = false
      }
    }
    map.on('pointermove', handleMove)
    return () => {
      map.un('pointermove', handleMove)
      if (ownsCursor && map.getTargetElement()) map.getTargetElement().style.cursor = ''
    }
  }, [map, enabled, hoverEnabled])
}
