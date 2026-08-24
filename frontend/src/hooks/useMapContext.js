import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createMapContextCoordinator } from '../map/mapContexts.js'

/**
 * Harita bağlamlarının TEK sahibi: aynı anda en fazla bir birincil bağlam
 * açıktır ve yeni bir bağlam açılırken önceki kendiliğinden emekliye ayrılır.
 *
 * ## Tek kavram: `activate`
 *
 * Her bağlamsal yüzey aynı kapıdan geçer:
 *
 *   activate(MAP_CONTEXTS.poiInfo)   // POI'ye tıklandı
 *   activate(MAP_CONTEXTS.heatmap)   // Isı Haritası satırı
 *   close()                           // hiçbir bağlam açık değil
 *
 * `activate` içeride şunu yapar: önceki bağlamın "retire" fonksiyonunu çağırır
 * (varsa), sonra yenisini etkin yapar. Hiçbir çağıran, başka bir bağlamın
 * setter'ını TANIMAZ — bu yüzden yeni bir panel eklemek mevcut panellerin
 * hiçbirine dokunmayı gerektirmez.
 *
 * ## Retire nedir, ne DEĞİLDİR
 *
 * Retire, bir bağlamın PANEL durumunu bırakmasıdır: seçimi düşürmek, seçili
 * POI'yi bırakmak, analiz sonucunu temizlemek gibi. Altındaki harita
 * özelliğini KAPATMAZ. Isı haritası panelinin retire'ı boştur; ısı haritası
 * katmanı `heatmapEnabled` ile yaşar ve panel kapandığında haritada kalmaya
 * devam eder. Aynı şekilde bir kayıt, paneli kapandı diye silinmez.
 *
 * ## Neden ref + state birlikte
 *
 * `activate` çağrıldığı ANDA önceki bağlamı bilmek zorundadır (retire'ı
 * çağırmak için) ama yan etkiler bir state updater'ının içinde çalıştırılamaz —
 * React StrictMode updater'ları iki kez çağırır ve retire iki kez işlerdi.
 * Bu yüzden gerçek değer bir ref'te tutulur, state yalnızca render'ı tetikler.
 *
 * @param {Record<string, (next: string|null) => void>} retirers
 *   Bağlam kimliği → o bağlam UI sahipliğini KAYBEDERKEN çalışacak temizlik.
 *   Fonksiyon, devralan bağlamı argüman olarak alır; durumu paylaşan bir
 *   bağlama devrederken temizlik atlanabilsin diye (bkz. SELECTION_CONTEXTS).
 *   Emekliye ayrılan bağlamın kendisi ASLA `activate`/`close` çağırmamalıdır —
 *   koordinasyonun sahibi bu hook'tur, özyineleme değil.
 */
export default function useMapContext(retirers) {
  const [active, setActive] = useState(null)

  /* Retire tablosu her render'da tazelenir ama koordinatör kimliği sabit
     kalır: tabloyu bağımlılık yapmak, her render'da yeni bir `activate`
     üretir ve onu bağımlılık listesine alan her efekti yeniden çalıştırırdı. */
  const retireRef = useRef(retirers)
  useEffect(() => {
    retireRef.current = retirers
  })

  /* Kural React'te DEĞİL, saf çekirdektedir (`createMapContextCoordinator`);
     burada yalnızca render'a bağlanır. Koordinatör bir kez kurulur — gerçek
     değer onun içinde yaşar, state ise ekranı tazelemek içindir. React
     StrictMode'un iki kez çağırdığı bir state updater'ının içinde emeklilik
     çalıştırmak, temizliği iki kez uygulardı. */
  const coordinatorRef = useRef(null)
  if (!coordinatorRef.current) {
    coordinatorRef.current = createMapContextCoordinator({
      getRetirer: (id) => retireRef.current?.[id],
      onChange: setActive,
    })
  }

  const coordinator = coordinatorRef.current

  const activate = useCallback((next) => coordinator.activate(next), [coordinator])
  const close = useCallback((id) => coordinator.close(id), [coordinator])
  const isActive = useCallback((id) => active === id, [active])

  return useMemo(() => ({ active, activate, close, isActive }), [active, activate, close, isActive])
}
