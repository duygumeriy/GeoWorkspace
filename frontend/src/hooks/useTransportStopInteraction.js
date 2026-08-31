import { useEffect } from 'react'
import {
  TRANSPORT_STOP_KIND,
  TRANSPORT_STOP_LAYER_CLASSNAME,
} from '../map/transport.js'
import { TRANSPORT_CLICK_TARGET, resolveTransportClick } from '../map/transportInteraction.js'

const HIT_TOLERANCE = 8

/**
 * Ulaşım katmanlarının tıklama/işaretçi davranışı.
 *
 * <b>Tek bir tıklama işleyicisi, tek bir öncelik zinciri.</b> Durak ve
 * güzergah isabetleri ayrı dinleyicilere bölünseydi hangisinin önce
 * kazanacağı kayıt sırasına kalırdı; burada sıra AÇIKÇA yazılıdır:
 * araç &gt; durak &gt; hesaplanmış rota &gt; önizleme çizgisi. Daha özgül olan
 * kazanır — çizginin üstündeki bir durak, çizgiye tıklanmış sayılmaz.
 *
 * Araç en üstte olduğu için burada yalnızca "varsa çekil" denir; aracın kendi
 * balonunu açan işleyici <code>useTransportVehicleLayer</code>'dadır ve iki
 * yerde iki farklı isabet kuralı yazılmaz.
 */
export default function useTransportStopInteraction(map, {
  enabled,
  hoverEnabled,
  onSelect,
  onSelectRoute = null,
  isRouteVisible = () => true,
}) {
  useEffect(() => {
    if (!map || !enabled) return undefined

    const handleClick = (event) => {
      /* Öncelik zinciri saf `resolveTransportClick` içindedir; bu kanca
         yalnızca sonucu uygular. Araç kendi balonunu
         `useTransportVehicleLayer` üzerinden açar, bu yüzden burada yalnızca
         çekilinir — iki yerde iki farklı isabet kuralı yazılmaz. */
      const hit = resolveTransportClick(map, event.pixel, { isRouteVisible })

      if (hit.target === TRANSPORT_CLICK_TARGET.VEHICLE) return

      if (hit.target === TRANSPORT_CLICK_TARGET.STOP) {
        onSelect(hit.stop)
        return
      }

      if (hit.target === TRANSPORT_CLICK_TARGET.ROUTE && onSelectRoute) {
        onSelectRoute(hit.routeId)
        return
      }

      // Ne durak ne güzergah: mevcut "seçimi bırak" davranışı korunur.
      onSelect(null)
    }

    map.on('singleclick', handleClick)
    return () => map.un('singleclick', handleClick)
  }, [map, enabled, onSelect, onSelectRoute, isRouteVisible])

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
