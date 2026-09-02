import { useEffect } from 'react'
import {
  TRANSPORT_STOP_KIND,
  TRANSPORT_STOP_LAYER_CLASSNAME,
} from '../map/transport.js'
import {
  TRANSPORT_CLICK_ACTIONS,
  resolveTransportClick,
  transportClickOutcome,
} from '../map/transportInteraction.js'

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
  /* BOŞ harita tıklamasında seçili güzergahı bırakır.
     <b>Yalnızca SEÇİMDİR.</b> POI, durak ve çizim seçimleri boş tıklamada zaten
     bırakılıyordu; güzergah bırakılmıyordu ve bu tutarsızlıktı. Bırakmak
     simülasyonu durdurmaz, izlemeyi/takibi kaldırmaz ve yönetim seçimine
     dokunmaz — sonuç tipinde böyle bir alan zaten yoktur. */
  onClearRoute = null,
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

      /* İsabetin SEÇİMDEKİ karşılığı saf `transportClickOutcome`'dadır; bu
         kanca yalnızca uygular. Sonuç tipi hiçbir yaşam döngüsü alanı
         taşımaz, dolayısıyla bir tıklama simülasyon durduramaz. */
      const outcome = transportClickOutcome(hit, { canSelectRoute: Boolean(onSelectRoute) })

      if (outcome.action === TRANSPORT_CLICK_ACTIONS.IGNORE) return

      if (outcome.action === TRANSPORT_CLICK_ACTIONS.SELECT_STOP) {
        onSelect(outcome.stop)
        return
      }

      if (outcome.action === TRANSPORT_CLICK_ACTIONS.SELECT_ROUTE) {
        onSelectRoute(outcome.routeId)
        return
      }

      // Mevcut "durak seçimini bırak" davranışı korunur.
      onSelect(null)

      /* BOŞ harita: seçili güzergah da bırakılır — POI, durak ve çizim
         seçimleriyle aynı kural. Gerçek bir nesneye tıklanmışsa buraya
         gelinmez. */
      if (outcome.clearsRoute) onClearRoute?.()
    }

    map.on('singleclick', handleClick)
    return () => map.un('singleclick', handleClick)
  }, [map, enabled, onSelect, onSelectRoute, onClearRoute, isRouteVisible])

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
