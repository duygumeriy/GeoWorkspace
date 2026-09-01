import { useEffect } from 'react'
import { claimJourneyPickCursor, resolveJourneyPick } from '../map/journeyInteraction.js'

/**
 * Haritadan geçiş noktası seçimi.
 *
 * <b>Yalnızca bir yuva SİLAHLIYKEN çalışır.</b> `active` false olduğu sürece
 * hiçbir dinleyici kurulmaz ve haritanın normal davranışı — durak seçimi,
 * güzergah tıklaması, araç balonu, POI paneli — hiç değişmeden sürer.
 * Silahlıyken çağıran taraf o işleyicileri kapatır, böylece öncelik kayıt
 * sırasına değil AÇIK bir moda bağlı kalır ve geri alınabilir olur.
 */
export default function useJourneyWaypointPicking(map, {
  active = false,
  allowPoi = false,
  isStopSelectable,
  onPick,
} = {}) {
  useEffect(() => {
    if (!map || !active) return undefined

    const handleClick = (event) => {
      const reference = resolveJourneyPick(map, event.pixel, { allowPoi, isStopSelectable })
      /* Boşluğa tıklamak yuvayı BOŞALTMAZ: kullanıcı seçimini kaybetmeden
         ıskalayabilmelidir. */
      if (reference) onPick?.(reference)
    }

    map.on('singleclick', handleClick)

    /* İmleç ÖDÜNÇ alınır, sıfırlanmaz: kip bittiğinde önceki değer aynen geri
       verilir. Kip sürerken onu ezebilecek tek kod (çizim katmanının hover
       imleci) çağıran tarafta kapalıdır. */
    const releaseCursor = claimJourneyPickCursor(map.getTargetElement())

    return () => {
      map.un('singleclick', handleClick)
      releaseCursor()
    }
  }, [map, active, allowPoi, isStopSelectable, onPick])
}
