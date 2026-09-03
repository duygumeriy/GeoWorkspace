import Feature from 'ol/Feature.js'
import Point from 'ol/geom/Point.js'
import LineString from 'ol/geom/LineString.js'
import WKT from 'ol/format/WKT.js'
import VectorLayer from 'ol/layer/Vector.js'
import VectorSource from 'ol/source/Vector.js'
import { Circle as CircleStyle, Fill, RegularShape, Stroke, Style, Text } from 'ol/style.js'
import { fromLonLat } from 'ol/proj.js'

export const TRANSPORT_STOP_KIND = 'transport-stop'
export const TRANSPORT_ROUTE_KIND = 'transport-route'
export const TRANSPORT_ROUTE_PATH_KIND = 'transport-route-path'
export const TRANSPORT_STOP_LAYER_CLASSNAME = 'transport-stop-layer'
export const TRANSPORT_ROUTE_LAYER_CLASSNAME = 'transport-route-layer'
export const TRANSPORT_ROUTE_PATH_LAYER_CLASSNAME = 'transport-route-path-layer'

export const MIN_ROUTE_ARROWS = 3
export const MAX_ROUTE_ARROWS = 28
export const ROUTE_ARROW_SPACING_PIXELS = 90

const FALLBACK_COLOR = '#2563EB'
const lineStyles = new Map()
const stopStyles = new Map()
const wkt = new WKT()

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
        width: emphasis === 'selected' ? 7 : emphasis === 'hovered' ? 6 : 4,
      }),
      zIndex: emphasis === 'selected' ? 20 : emphasis === 'hovered' ? 16 : 1,
    }))
  }
  return lineStyles.get(key)
}

function previewStyle(colorHex, emphasis = 'normal') {
  const color = safeColor(colorHex)
  const key = `${color}:${emphasis}:preview`
  if (!lineStyles.has(key)) {
    lineStyles.set(key, new Style({
      stroke: new Stroke({
        color: emphasis === 'dimmed' ? `${color}55` : color,
        width: emphasis === 'selected' ? 7 : emphasis === 'hovered' ? 6 : 4,
        lineDash: [7, 7],
      }),
      zIndex: emphasis === 'selected' ? 15 : emphasis === 'hovered' ? 12 : 0,
    }))
  }
  return lineStyles.get(key)
}

export function routeArrowCount(length, resolution = 1) {
  if (!Number.isFinite(length) || length <= 0 || !Number.isFinite(resolution) || resolution <= 0) return 0
  const screenLength = length / resolution
  return Math.min(MAX_ROUTE_ARROWS, Math.max(MIN_ROUTE_ARROWS, Math.floor(screenLength / ROUTE_ARROW_SPACING_PIXELS)))
}

export function routeArrowRotation(from, to) {
  const direction = Math.atan2(to[1] - from[1], to[0] - from[0])
  // RegularShape starts pointing up and its positive rotation is clockwise.
  return Math.PI / 2 - direction
}

export function routeArrowPlacements(line, resolution = 1) {
  const count = routeArrowCount(line?.getLength?.(), resolution)
  if (count === 0) return []
  return Array.from({ length: count }, (_, index) => {
    const fraction = (index + 1) / (count + 1)
    const before = line.getCoordinateAt(Math.max(0, fraction - 0.002))
    const after = line.getCoordinateAt(Math.min(1, fraction + 0.002))
    return {
      coordinate: line.getCoordinateAt(fraction),
      rotation: routeArrowRotation(before, after),
    }
  })
}

function pathStyles(feature, resolution, emphasis) {
  const color = safeColor(feature.get('colorHex'))
  const styles = []
  if (emphasis === 'selected') {
    styles.push(new Style({
      stroke: new Stroke({ color: '#FFFFFFCC', width: 8 }),
      zIndex: 18,
    }))
  }
  styles.push(routeStyle(color, emphasis))
  const arrowColor = emphasis === 'dimmed' ? `${color}55` : color
  for (const arrow of routeArrowPlacements(feature.getGeometry(), resolution)) {
    styles.push(new Style({
      geometry: new Point(arrow.coordinate),
      image: new RegularShape({
        points: 3,
        radius: emphasis === 'selected' || emphasis === 'hovered' ? 8 : 7,
        fill: new Fill({ color: arrowColor }),
        stroke: new Stroke({ color: '#FFFFFF', width: 1.5 }),
        rotation: arrow.rotation,
      }),
      zIndex: emphasis === 'selected' ? 22 : emphasis === 'hovered' ? 17 : 3,
    }))
  }
  return styles
}

function stopStyle(colorHex, selected, emphasis = 'normal', sequenceOrder = '', terminal = 'middle') {
  const key = `${safeColor(colorHex)}:${selected ? 'selected' : 'normal'}:${emphasis}:${sequenceOrder}:${terminal}`
  if (!stopStyles.has(key)) {
    const color = safeColor(colorHex)
    const displayColor = emphasis === 'dimmed' ? `${color}55` : color
    const emphasized = emphasis === 'selected'
    const radius = selected ? 13 : emphasized ? 12 : 11
    const image = terminal === 'middle'
      ? new CircleStyle({
        radius,
        fill: new Fill({ color: displayColor }),
        stroke: new Stroke({ color: '#FFFFFF', width: 2.5 }),
      })
      : new RegularShape({
        points: terminal === 'start' ? 3 : 4,
        radius: radius + (terminal === 'start' ? 2 : 0),
        angle: terminal === 'start' ? 0 : Math.PI / 4,
        fill: new Fill({ color: displayColor }),
        stroke: new Stroke({ color: '#FFFFFF', width: 2.5 }),
      })
    const styles = []
    if (selected) {
      styles.push(new Style({
        image: new CircleStyle({
          radius: 18,
          fill: new Fill({ color: '#FFFFFFCC' }),
          stroke: new Stroke({ color: '#111827', width: 3 }),
        }),
        zIndex: 28,
      }))
    }
    styles.push(new Style({
      image,
      text: new Text({
        text: String(sequenceOrder),
        font: '700 11px system-ui, sans-serif',
        fill: new Fill({ color: '#FFFFFF' }),
        stroke: new Stroke({ color: '#111827', width: 2 }),
      }),
      zIndex: selected ? 30 : emphasized ? 20 : 5,
    }))
    stopStyles.set(key, styles)
  }
  return stopStyles.get(key)
}

export function createTransportLayers(
  selectedStopId = () => null,
  selectedRouteId = () => null,
  routesVisible = () => true,
  stopsVisible = () => true,
  routeVisible = () => true,
  hoveredRouteId = () => null,
  stopVisible = () => true,
) {
  const routeSource = new VectorSource()
  const pathSource = new VectorSource()
  const stopSource = new VectorSource()

  const selectionEmphasisFor = (routeId) => {
    const selected = selectedRouteId()
    if (routeId === selected) return 'selected'
    return selected == null ? 'normal' : 'dimmed'
  }

  const emphasisFor = (routeId) => {
    const selection = selectionEmphasisFor(routeId)
    if (selection === 'selected') return selection
    if (routeId === hoveredRouteId()) return 'hovered'
    return selection
  }

  const routeLayer = new VectorLayer({
    source: routeSource,
    className: TRANSPORT_ROUTE_LAYER_CLASSNAME,
    style: (feature) => {
      const emphasis = emphasisFor(feature.get('routeId'))
      // Master and child choices hide every geometry representation, including
      // a selected route. Stops retain their own independent focus behavior.
      if (!routesVisible() || !routeVisible(feature.get('routeId'))) return undefined
      return previewStyle(feature.get('colorHex'), emphasis)
    },
  })

  const pathLayer = new VectorLayer({
    source: pathSource,
    className: TRANSPORT_ROUTE_PATH_LAYER_CLASSNAME,
    style: (feature, resolution) => {
      const emphasis = emphasisFor(feature.get('routeId'))
      if (!routesVisible() || !routeVisible(feature.get('routeId'))) return undefined
      return pathStyles(feature, resolution, emphasis)
    },
  })

  const stopLayer = new VectorLayer({
    source: stopSource,
    className: TRANSPORT_STOP_LAYER_CLASSNAME,
    style: (feature) => {
      if (!stopVisible(feature.get('stopId'))) return undefined
      const selected = feature.get('stopId') === selectedStopId()
      /* Duraklar kapalıyken Duraklarım odağı yalnızca seçili durağı
         geçici gösterir; kullanıcının kalıcı tercihi değişmez. */
      if (!stopsVisible() && !selected) return undefined
      return stopStyle(
        feature.get('colorHex'),
        selected,
        selectionEmphasisFor(feature.get('routeId')),
        feature.get('sequenceOrder'),
        feature.get('terminal'),
      )
    },
  })

  return { routeSource, routeLayer, pathSource, pathLayer, stopSource, stopLayer }
}

function currentPathFeature(route, path) {
  if (!path?.geometryWkt || path.isStale === true) return null
  try {
    const feature = wkt.readFeature(path.geometryWkt, {
      dataProjection: 'EPSG:4326',
      featureProjection: 'EPSG:3857',
    })
    if (feature.getGeometry()?.getType() !== 'LineString') return null
    feature.setProperties({
      type: TRANSPORT_ROUTE_PATH_KIND,
      featureKind: TRANSPORT_ROUTE_PATH_KIND,
      routeId: route.id,
      routeName: route.name,
      colorHex: route.colorHex,
      distanceMeters: path.distanceMeters,
      durationSeconds: path.durationSeconds,
      generatedAt: path.generatedAt,
    })
    feature.setId(`transport-route-path-${route.id}`)
    return feature
  } catch {
    return null
  }
}

export function transportFeatures(routes, stops, paths = []) {
  const routesById = new Map(routes.map((route) => [route.id, route]))
  const pathsByRoute = new Map(paths.map((path) => [path.routeId, path]))
  const orderedByRoute = new Map()
  const stopFeatures = []

  for (const stop of stops) {
    const route = routesById.get(stop.routeId)
    if (!route) continue

    const normalized = { ...stop, routeName: stop.routeName || route.name, colorHex: route.colorHex }
    const list = orderedByRoute.get(route.id) ?? []
    list.push(normalized)
    orderedByRoute.set(route.id, list)

  }

  for (const [routeId, routeStops] of orderedByRoute) {
    routeStops.sort((left, right) => left.sequenceOrder - right.sequenceOrder || left.id - right.id)
    routeStops.forEach((stop, index) => {
      const terminal = index === 0 ? 'start' : index === routeStops.length - 1 ? 'end' : 'middle'
      const feature = new Feature({
        geometry: new Point(fromLonLat([stop.longitude, stop.latitude])),
        featureKind: TRANSPORT_STOP_KIND,
        stopId: stop.id,
        routeId,
        colorHex: stop.colorHex,
        sequenceOrder: stop.sequenceOrder,
        terminal,
        transportStop: { ...stop, terminal },
      })
      feature.setId(`transport-stop-${stop.id}`)
      stopFeatures.push(feature)
    })
  }

  const routeFeatures = []
  const pathFeatures = []
  for (const route of routes) {
    const pathFeature = currentPathFeature(route, pathsByRoute.get(route.id))
    if (pathFeature) {
      pathFeatures.push(pathFeature)
      continue
    }
    const ordered = (orderedByRoute.get(route.id) ?? [])
      .sort((left, right) => left.sequenceOrder - right.sequenceOrder || left.id - right.id)
    if (ordered.length < 2) continue

    const feature = new Feature({
      geometry: new LineString(ordered.map((stop) => fromLonLat([stop.longitude, stop.latitude]))),
      featureKind: TRANSPORT_ROUTE_KIND,
      type: TRANSPORT_ROUTE_KIND,
      routeId: route.id,
      routeName: route.name,
      colorHex: route.colorHex,
      isPreview: true,
      previewReason: pathsByRoute.get(route.id)?.isStale === true ? 'stale' : 'not-generated',
    })
    feature.setId(`transport-route-${route.id}`)
    routeFeatures.push(feature)
  }

  return { routeFeatures, pathFeatures, stopFeatures }
}

function createTransportTemporaryStopLayer(className) {
  const source = new VectorSource()
  const layer = new VectorLayer({
    source,
    className,
    style: stopStyle(FALLBACK_COLOR, true, 'normal', '•', 'middle'),
  })
  return { source, layer }
}

export function createTransportPendingLayer() {
  return createTransportTemporaryStopLayer('transport-stop-pending-layer')
}

export function createTransportRelocationLayer() {
  return createTransportTemporaryStopLayer('transport-stop-relocation-layer')
}
