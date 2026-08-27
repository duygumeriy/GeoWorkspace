import Feature from 'ol/Feature.js'
import Point from 'ol/geom/Point.js'
import LineString from 'ol/geom/LineString.js'
import VectorLayer from 'ol/layer/Vector.js'
import VectorSource from 'ol/source/Vector.js'
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style.js'
import { fromLonLat } from 'ol/proj.js'

export const TRANSPORT_STOP_KIND = 'transport-stop'
export const TRANSPORT_ROUTE_KIND = 'transport-route'
export const TRANSPORT_STOP_LAYER_CLASSNAME = 'transport-stop-layer'
export const TRANSPORT_ROUTE_LAYER_CLASSNAME = 'transport-route-layer'

const FALLBACK_COLOR = '#2563EB'
const lineStyles = new Map()
const stopStyles = new Map()

function safeColor(value) {
  return /^#[0-9A-F]{6}$/i.test(value ?? '') ? value.toUpperCase() : FALLBACK_COLOR
}

function routeStyle(colorHex, emphasis = 'normal') {
  const color = safeColor(colorHex)
  const key = `${color}:${emphasis}`
  if (!lineStyles.has(key)) {
    lineStyles.set(key, new Style({
      stroke: new Stroke({
        color: emphasis === 'dimmed' ? `${color}55` : color,
        width: emphasis === 'selected' ? 7 : 4,
      }),
      zIndex: emphasis === 'selected' ? 20 : 1,
    }))
  }
  return lineStyles.get(key)
}

function stopStyle(colorHex, selected, emphasis = 'normal') {
  const key = `${safeColor(colorHex)}:${selected ? 'selected' : 'normal'}:${emphasis}`
  if (!stopStyles.has(key)) {
    const color = safeColor(colorHex)
    const displayColor = emphasis === 'dimmed' ? `${color}55` : color
    const emphasized = emphasis === 'selected'
    stopStyles.set(key, [
      new Style({
        image: new CircleStyle({
          radius: selected ? 11 : emphasized ? 10 : 9,
          fill: new Fill({ color: emphasis === 'dimmed' ? '#FFFFFF88' : '#FFFFFF' }),
          stroke: new Stroke({ color: selected ? '#111827' : displayColor, width: selected ? 3 : emphasized ? 3 : 2.5 }),
        }),
        zIndex: emphasized ? 20 : 1,
      }),
      new Style({
        image: new CircleStyle({
          radius: selected ? 5 : emphasized ? 4.5 : 4,
          fill: new Fill({ color: displayColor }),
        }),
        zIndex: emphasized ? 21 : 2,
      }),
    ])
  }
  return stopStyles.get(key)
}

export function createTransportLayers(
  selectedStopId = () => null,
  selectedRouteId = () => null,
  routesVisible = () => true,
  stopsVisible = () => true,
) {
  const routeSource = new VectorSource()
  const stopSource = new VectorSource()

  const emphasisFor = (routeId) => {
    const selected = selectedRouteId()
    if (selected == null) return 'normal'
    return routeId === selected ? 'selected' : 'dimmed'
  }

  const routeLayer = new VectorLayer({
    source: routeSource,
    className: TRANSPORT_ROUTE_LAYER_CLASSNAME,
    style: (feature) => {
      const emphasis = emphasisFor(feature.get('routeId'))
      /* A route explicitly focused from popup/search may be shown temporarily
         while the layer preference stays off, matching focused-stop behavior. */
      if (!routesVisible() && emphasis !== 'selected') return undefined
      return routeStyle(feature.get('colorHex'), emphasis)
    },
  })

  const stopLayer = new VectorLayer({
    source: stopSource,
    className: TRANSPORT_STOP_LAYER_CLASSNAME,
    style: (feature) => {
      const selected = feature.get('stopId') === selectedStopId()
      /* Duraklar kapalıyken Duraklarım odağı yalnızca seçili durağı
         geçici gösterir; kullanıcının kalıcı tercihi değişmez. */
      if (!stopsVisible() && !selected) return undefined
      return stopStyle(feature.get('colorHex'), selected, emphasisFor(feature.get('routeId')))
    },
  })

  return { routeSource, routeLayer, stopSource, stopLayer }
}

export function transportFeatures(routes, stops) {
  const routesById = new Map(routes.map((route) => [route.id, route]))
  const orderedByRoute = new Map()
  const stopFeatures = []

  for (const stop of stops) {
    const route = routesById.get(stop.routeId)
    if (!route) continue

    const normalized = { ...stop, routeName: stop.routeName || route.name, colorHex: route.colorHex }
    const list = orderedByRoute.get(route.id) ?? []
    list.push(normalized)
    orderedByRoute.set(route.id, list)

    const feature = new Feature({
      geometry: new Point(fromLonLat([stop.longitude, stop.latitude])),
      featureKind: TRANSPORT_STOP_KIND,
      stopId: stop.id,
      routeId: route.id,
      colorHex: route.colorHex,
      transportStop: normalized,
    })
    feature.setId(`transport-stop-${stop.id}`)
    stopFeatures.push(feature)
  }

  const routeFeatures = []
  for (const route of routes) {
    const ordered = (orderedByRoute.get(route.id) ?? [])
      .sort((left, right) => left.sequenceOrder - right.sequenceOrder || left.id - right.id)
    if (ordered.length < 2) continue

    const feature = new Feature({
      geometry: new LineString(ordered.map((stop) => fromLonLat([stop.longitude, stop.latitude]))),
      featureKind: TRANSPORT_ROUTE_KIND,
      routeId: route.id,
      colorHex: route.colorHex,
    })
    feature.setId(`transport-route-${route.id}`)
    routeFeatures.push(feature)
  }

  return { routeFeatures, stopFeatures }
}

function createTransportTemporaryStopLayer(className) {
  const source = new VectorSource()
  const layer = new VectorLayer({
    source,
    className,
    style: stopStyle(FALLBACK_COLOR, true),
  })
  return { source, layer }
}

export function createTransportPendingLayer() {
  return createTransportTemporaryStopLayer('transport-stop-pending-layer')
}

export function createTransportRelocationLayer() {
  return createTransportTemporaryStopLayer('transport-stop-relocation-layer')
}
