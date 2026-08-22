import { useCallback, useEffect, useRef, useState } from 'react'
import ImageLayer from 'ol/layer/Image'
import ImageStatic from 'ol/source/ImageStatic'
import { fetchHeatmapImage } from '../services/api.js'
import {
  HEATMAP_DEFAULT_OPACITY,
  HEATMAP_LAYER_Z_INDEX,
  HEATMAP_REQUEST_DEBOUNCE_MS,
  heatmapBbox,
  heatmapImageSize,
} from '../map/heatmap.js'

const LOAD_ERROR = 'Isı haritası şu anda yüklenemedi. Haritayı hareket ettirip yeniden deneyin.'

/** Authenticated, view-bound heatmap image lifecycle. */
export default function useHeatmapLayer(map, { enabled, permitted, scopeVersion = '' }) {
  const [opacity, setOpacityState] = useState(HEATMAP_DEFAULT_OPACITY)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [hasImage, setHasImage] = useState(false)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const layerRef = useRef(null)
  const opacityRef = useRef(HEATMAP_DEFAULT_OPACITY)

  const setOpacity = useCallback((next) => {
    const value = Math.min(1, Math.max(0, Number(next)))
    opacityRef.current = value
    setOpacityState(value)
    layerRef.current?.setOpacity(value)
  }, [])

  const refresh = useCallback(() => setRefreshVersion((value) => value + 1), [])

  useEffect(() => {
    if (!map || !enabled || !permitted) {
      setLoading(false)
      setError(null)
      setHasImage(false)
      return undefined
    }

    const layer = new ImageLayer({
      className: 'heatmap-layer',
      opacity: opacityRef.current,
      zIndex: HEATMAP_LAYER_Z_INDEX,
    })
    layer.set('name', 'authenticated-heatmap')
    layerRef.current = layer
    map.addLayer(layer)

    let active = true
    let timer = null
    let requestNumber = 0
    let controller = null
    let currentBlobUrl = null

    const revokeCurrentUrl = () => {
      if (!currentBlobUrl) return
      URL.revokeObjectURL(currentBlobUrl)
      currentBlobUrl = null
    }

    const load = async () => {
      const size = map.getSize()
      const view = map.getView()
      if (!size || size[0] <= 0 || size[1] <= 0 || view.getProjection().getCode() !== 'EPSG:3857') return

      const extent = view.calculateExtent(size)
      const bbox = heatmapBbox(extent)
      if (!bbox) return

      controller?.abort()
      controller = new AbortController()
      const thisRequest = ++requestNumber
      setLoading(true)
      setError(null)

      try {
        const requestSize = heatmapImageSize(size, window.devicePixelRatio)
        const blob = await fetchHeatmapImage({
          bbox,
          ...requestSize,
          signal: controller.signal,
        })
        if (!active || controller.signal.aborted || thisRequest !== requestNumber) return

        const nextBlobUrl = URL.createObjectURL(blob)
        const source = new ImageStatic({
          url: nextBlobUrl,
          imageExtent: [...extent],
          projection: view.getProjection(),
          interpolate: true,
        })

        const previousBlobUrl = currentBlobUrl
        currentBlobUrl = nextBlobUrl
        layer.setSource(source)
        map.render()
        if (previousBlobUrl) URL.revokeObjectURL(previousBlobUrl)
        setHasImage(true)
      } catch (loadError) {
        if (loadError?.name !== 'AbortError' && active && thisRequest === requestNumber) {
          setError(LOAD_ERROR)
        }
      } finally {
        if (active && thisRequest === requestNumber) setLoading(false)
      }
    }

    const scheduleLoad = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(load, HEATMAP_REQUEST_DEBOUNCE_MS)
    }

    map.on('moveend', scheduleLoad)
    map.on('change:size', scheduleLoad)
    scheduleLoad()

    return () => {
      active = false
      requestNumber += 1
      window.clearTimeout(timer)
      controller?.abort()
      map.un('moveend', scheduleLoad)
      map.un('change:size', scheduleLoad)
      map.removeLayer(layer)
      layer.setSource(null)
      layer.dispose()
      revokeCurrentUrl()
      if (layerRef.current === layer) layerRef.current = null
    }
  }, [map, enabled, permitted, refreshVersion, scopeVersion])

  return { opacity, setOpacity, loading, error, hasImage, refresh }
}
