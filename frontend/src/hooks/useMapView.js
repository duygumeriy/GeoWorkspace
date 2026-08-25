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
import { TURKEY_CENTER_LON_LAT, TURKEY_ZOOM } from '../map/turkey.js'
import {
  POI_FOCUS_ANIMATION_MS,
  POI_FOCUS_TARGET_ZOOM,
  POINT_ZOOM,
  focusZoomFor,
} from '../map/mapView.js'
import useReducedMotion from './useReducedMotion.js'

/* Türkiye açılış görünümü tek yerde tanımlıdır (`map/turkey.js`) ve buradan
   yeniden dışa aktarılır: mevcut çağıranların içe aktarma yolu değişmez, ama
   sayılar artık yönetim panelindeki coğrafi yetki haritasıyla paylaşılır. */
export { TURKEY_CENTER_LON_LAT, TURKEY_ZOOM } from '../map/turkey.js'

const FIT_PADDING = [80, 80, 120, 80]

/* Yakınlık KARARI burada değil, `map/mapView.js`'dedir: saf bir sayı hesabıdır
   ve OpenLayers'a da React'e de ihtiyaç duymaz. Bu kanca hareketin kendisini
   (görünüm nesnesi, animasyon, süre) sahiplenir ve kararı oradan okur —
   böylece kuralın tek bir üretim uygulaması olur. */

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
   * Bir noktaya odaklanır: ortalar ve GEREKİYORSA yakınlaştırır.
   *
   * <b><see cref="panTo"/>'dan farkı yakınlıktır.</b> Ülke ölçeğinde açılmış
   * bir haritada listeden bir POI'ye tıklamak, ekranın ortasında hâlâ ayırt
   * edilemeyen bir nokta bırakırdı: "gittim" demek, oraya bakabilmek
   * demektir. Buna karşılık zaten daha yakındaysa kullanıcı GERİ ÇEKİLMEZ —
   * hedef `max(mevcut, POINT_ZOOM)`'dur, sabit bir yakınlık değil. Sokak
   * ölçeğinde çalışan biri, bir satıra tıkladı diye kaybettiği bağlamı
   * yeniden kurmak zorunda kalmamalıdır.
   */
  const focusPoint = useCallback(
    (coordinate, { minZoom = POINT_ZOOM } = {}) => {
      const view = map?.getView()
      if (!view || !coordinate) return

      view.animate({ center: coordinate, zoom: focusZoomFor(view.getZoom(), minZoom), duration: duration() })
    },
    [map, duration],
  )

  /**
   * Bir POI'ye odaklanır: HEDEF bir yakınlığa yerleşir.
   *
   * <b>POI kamerasının TEK uygulaması budur.</b> Arama sonucuna tıklamak da
   * POI Bilgisi panelindeki "Zoom Yap" da buradan geçer; iki ayrı yol, aynı
   * eylemin iki farklı yerde bitmesi ve birinin sessizce ayrışması demek
   * olurdu.
   *
   * <b><see cref="focusPoint"/>'ten farkı "geri çekilebilmesi"dir</b> ve bu,
   * global davranışı değiştirmemek için AYRI bir yol olarak durur. `focusPoint`
   * asla uzaklaşmaz — POI'lerim, envanter ve çizim gezinmesi bu kurala
   * güvenir ve orada doğrudur.
   *
   * Bir POI'ye gitmek başka bir eylemdir: kullanıcı bilerek oraya gider ve her
   * seferinde aynı yerde bitmelidir. 19. seviyede çalışırken başka bir POI
   * arayan biri hedefe 19'da götürülseydi, POI'yi çevresiz ve kullanışsız bir
   * yakınlıkta görürdü. Bu yüzden yakınlık bir alt sınır değil, sabit bir
   * hedeftir ve gerekirse UZAKLAŞIR.
   *
   * Tek aşamalı bir <c>animate</c> yeterlidir: OpenLayers merkez ve yakınlığı
   * birlikte yumuşatır, dolayısıyla ayrı bir "uzaklaş → taşı → yaklaş"
   * koreografisi gereksiz karmaşıklık olurdu.
   *
   * <b>Seçime ve panele DOKUNMAZ.</b> Yaptığı tek şey kamerayı taşımaktır;
   * "Zoom Yap"a basan kullanıcı açık duran bilgi panelini kaybetmemelidir.
   */
  const focusPoi = useCallback(
    (coordinate) => {
      const view = map?.getView()
      if (!view || !coordinate) return

      view.animate({
        center: coordinate,
        // Alt sınır DEĞİL, hedef: gerekirse UZAKLAŞIR.
        zoom: POI_FOCUS_TARGET_ZOOM,
        duration: reducedMotion ? 0 : POI_FOCUS_ANIMATION_MS,
      })
    },
    [map, reducedMotion],
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

  return {
    goToTurkey,
    fitExtent,
    panTo,
    focusPoint,
    focusPoi,
    ensureVisible,
    goToMyLocation,
    reducedMotion,
  }
}
