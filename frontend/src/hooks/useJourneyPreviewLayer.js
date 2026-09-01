import { useEffect, useRef } from 'react'
import { createJourneyPreviewLayer, syncJourneyPreviewFeature } from '../map/journeyPreviewLayer.js'
import { journeyFitPadding } from '../map/journeyLayout.js'

/**
 * Yolculuk önizlemesini MEVCUT haritaya çizer.
 *
 * <b>İkinci bir harita kurulmaz</b> ve mevcut ulaşım kaynakları yazılabilir
 * önizleme deposu olarak KULLANILMAZ: kanca kendi vektör katmanını ekler,
 * söküldüğünde geri alır. Kararların tamamı saf
 * <code>journeyPreviewLayer.js</code> içindedir.
 *
 * <b>Kamera yalnızca YENİ bir önizlemede oynar.</b> Uyum
 * <code>previewToken</code>'a bağlıdır — React yeniden çizdiği için ya da
 * panel genişliği değiştiği için harita yeniden konumlanmaz; aksi hâlde
 * kullanıcı her etkileşimde kamerayla güreşirdi. Bu bir önizleme davranışıdır,
 * canlı takip kamerası değildir.
 */
export default function useJourneyPreviewLayer(map, {
  geometryWkt = null,
  previewToken = 0,
  /* Panelin kapladığı alan TEK bir düzen modelinden gelir (`journeyLayout.js`):
     görünür mü ve dar ekran mı. Genişlik burada elle taşınmaz. */
  panelVisible = false,
  compact = false,
  fitDuration = 400,
  maxZoom = 16,
} = {}) {
  const sourceRef = useRef(null)
  const layerRef = useRef(null)
  const fittedTokenRef = useRef(0)

  // Uyum anında okunur; değişimleri kendi başına uyum TETİKLEMEZ.
  const paddingRef = useRef({ panelVisible, compact })
  paddingRef.current = { panelVisible, compact }

  useEffect(() => {
    if (!map) return undefined
    const { source, layer } = createJourneyPreviewLayer()
    sourceRef.current = source
    layerRef.current = layer
    map.addLayer(layer)

    return () => {
      map.removeLayer(layer)
      source.clear()
      sourceRef.current = null
      layerRef.current = null
    }
  }, [map])

  useEffect(() => {
    const source = sourceRef.current
    if (!source) return

    // Her yazım önce temizler: yeniden çizimde ikinci bir çizgi oluşmaz.
    const feature = syncJourneyPreviewFeature(source, geometryWkt)
    layerRef.current?.changed()

    if (!map || !feature) return
    if (previewToken <= 0 || previewToken === fittedTokenRef.current) return

    const extent = feature.getGeometry()?.getExtent()
    if (!extent) return

    fittedTokenRef.current = previewToken
    map.getView().fit(extent, {
      padding: journeyFitPadding(paddingRef.current),
      duration: fitDuration,
      maxZoom,
    })
  }, [map, geometryWkt, previewToken, fitDuration, maxZoom])
}
