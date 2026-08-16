import { useCallback, useEffect, useRef } from 'react'
import Feature from 'ol/Feature'
import Point from 'ol/geom/Point'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import Style from 'ol/style/Style'
import Fill from 'ol/style/Fill'
import Stroke from 'ol/style/Stroke'
import CircleStyle from 'ol/style/Circle'
import { fromLonLat } from 'ol/proj'
import useReducedMotion from './useReducedMotion.js'

/** Türkiye'nin yaklaşık coğrafi merkezi (Longitude, Latitude) — the initial view. */
export const TURKEY_CENTER_LON_LAT = [35.2433, 38.9637]
export const TURKEY_ZOOM = 6

const FIT_PADDING = [80, 80, 120, 80]
const POINT_ZOOM = 15

/**
 * Camera moves shared by the quick actions and the selected-feature panel.
 *
 * Every animation is skipped when the user prefers reduced motion — the view
 * jumps straight to its destination instead.
 */
export default function useMapView(map, { showToast } = {}) {
  const reducedMotion = useReducedMotion()
  const locationLayerRef = useRef(null)

  /** Duration honoring prefers-reduced-motion. */
  const duration = useCallback(() => (reducedMotion ? 0 : 500), [reducedMotion])

  const goToTurkey = useCallback(() => {
    const view = map?.getView()
    if (!view) return
    view.animate({
      center: fromLonLat(TURKEY_CENTER_LON_LAT),
      zoom: TURKEY_ZOOM,
      duration: duration(),
    })
  }, [map, duration])

  /** Fits an extent; a zero-area extent (a single point) gets a sensible zoom. */
  const fitExtent = useCallback(
    (extent) => {
      const view = map?.getView()
      if (!view || !extent) return

      const isPointLike = extent[0] === extent[2] && extent[1] === extent[3]
      if (isPointLike) {
        view.animate({ center: [extent[0], extent[1]], zoom: POINT_ZOOM, duration: duration() })
        return
      }

      view.fit(extent, {
        padding: FIT_PADDING,
        duration: duration(),
        maxZoom: 17,
      })
    },
    [map, duration],
  )

  /**
   * Centres on a coordinate **without changing the zoom** — "Haritada Göster"
   * for a single vertex.
   *
   * Deliberately not a `fit`: zooming in on one vertex would throw the rest of
   * the shape off screen, and the user has just been shown a number whose whole
   * purpose is to be located within the shape. The panel's "Haritada Ortala"
   * is still there for framing the whole drawing.
   */
  const panTo = useCallback(
    (coordinate) => {
      const view = map?.getView()
      if (!view || !coordinate) return
      view.animate({ center: coordinate, duration: duration() })
    },
    [map, duration],
  )

  /**
   * Pans only if the coordinate is off screen (or crowded against an edge).
   *
   * Used when a selection is made from the PANEL: moving the map every time a
   * row is clicked would be motion sickness for a vertex that was already in
   * plain sight. A selection made on the map never calls this — the user is
   * looking straight at it.
   */
  const ensureVisible = useCallback(
    (coordinate) => {
      const view = map?.getView()
      const size = map?.getSize()
      if (!view || !size || !coordinate) return

      const pixel = map.getPixelFromCoordinate(coordinate)
      // Keeps the target clear of the docked panel and the map's own controls.
      const margin = 72
      const isVisible =
        pixel &&
        pixel[0] >= margin &&
        pixel[1] >= margin &&
        pixel[0] <= size[0] - margin &&
        pixel[1] <= size[1] - margin

      if (!isVisible) view.animate({ center: coordinate, duration: duration() })
    },
    [map, duration],
  )

  /** Temporary "you are here" marker; never written to the database. */
  const showLocationMarker = useCallback(
    (coordinate) => {
      if (!map) return

      if (!locationLayerRef.current) {
        const source = new VectorSource()
        const layer = new VectorLayer({
          source,
          className: 'location-layer',
          zIndex: 30,
          style: new Style({
            image: new CircleStyle({
              radius: 8,
              fill: new Fill({ color: 'rgba(0, 209, 255, 0.9)' }),
              stroke: new Stroke({ color: '#ffffff', width: 3 }),
            }),
          }),
        })
        locationLayerRef.current = layer
        map.addLayer(layer)
      }

      const source = locationLayerRef.current.getSource()
      source.clear()
      source.addFeature(new Feature(new Point(coordinate)))
    },
    [map],
  )

  const goToMyLocation = useCallback(() => {
    if (!map) return

    if (!navigator.geolocation) {
      showToast?.('error', 'Tarayıcınız konum özelliğini desteklemiyor.')
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coordinate = fromLonLat([position.coords.longitude, position.coords.latitude])
        showLocationMarker(coordinate)
        map.getView().animate({ center: coordinate, zoom: 14, duration: duration() })
        showToast?.('success', 'Konumunuza gidildi.')
      },
      (error) => {
        showToast?.(
          'error',
          error?.code === error?.PERMISSION_DENIED
            ? 'Konum izni verilmedi.'
            : 'Konum bilgisi alınamadı.',
        )
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }, [map, showLocationMarker, duration, showToast])

  useEffect(
    () => () => {
      if (map && locationLayerRef.current) {
        map.removeLayer(locationLayerRef.current)
        locationLayerRef.current = null
      }
    },
    [map],
  )

  return { goToTurkey, fitExtent, panTo, ensureVisible, goToMyLocation, reducedMotion }
}
