import { useCallback, useEffect, useRef, useState } from 'react'
import { readApiError } from '../services/api.js'
import { fetchTransportRoutePaths, fetchTransportRoutes, fetchTransportRouteStops } from '../services/transportApi.js'
import { createTransportLayers, transportFeatures } from '../map/transport.js'
import { boundingExtent } from 'ol/extent.js'

const EMPTY_HIDDEN_ROUTE_IDS = Object.freeze([])

export default function useTransportLayer(map, {
  permitted,
  selectedStopId,
  selectedRouteId = null,
  hoveredRouteId = null,
  routesVisible = true,
  stopsVisible = true,
  hiddenRouteIds = EMPTY_HIDDEN_ROUTE_IDS,
  showToast,
  onSnapshot,
}) {
  const routeSourceRef = useRef(null)
  const pathSourceRef = useRef(null)
  const stopSourceRef = useRef(null)
  const stopLayerRef = useRef(null)
  const routeLayerRef = useRef(null)
  const pathLayerRef = useRef(null)
  const selectedStopIdRef = useRef(selectedStopId)
  const selectedRouteIdRef = useRef(selectedRouteId)
  const hoveredRouteIdRef = useRef(hoveredRouteId)
  const routesVisibleRef = useRef(routesVisible)
  const stopsVisibleRef = useRef(stopsVisible)
  const hiddenRouteIdsRef = useRef(new Set(hiddenRouteIds))
  selectedStopIdRef.current = selectedStopId
  selectedRouteIdRef.current = selectedRouteId
  hoveredRouteIdRef.current = hoveredRouteId
  routesVisibleRef.current = routesVisible
  stopsVisibleRef.current = stopsVisible
  hiddenRouteIdsRef.current = new Set(hiddenRouteIds)
  const requestIdRef = useRef(0)
  const [routes, setRoutes] = useState([])
  const [stops, setStops] = useState([])
  const [paths, setPaths] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!map) return undefined
    const layers = createTransportLayers(
      () => selectedStopIdRef.current,
      () => selectedRouteIdRef.current,
      () => routesVisibleRef.current,
      () => stopsVisibleRef.current,
      (routeId) => !hiddenRouteIdsRef.current.has(routeId),
      () => hoveredRouteIdRef.current,
    )
    routeSourceRef.current = layers.routeSource
    pathSourceRef.current = layers.pathSource
    stopSourceRef.current = layers.stopSource
    stopLayerRef.current = layers.stopLayer
    routeLayerRef.current = layers.routeLayer
    pathLayerRef.current = layers.pathLayer
    map.addLayer(layers.routeLayer)
    map.addLayer(layers.pathLayer)
    map.addLayer(layers.stopLayer)

    return () => {
      map.removeLayer(layers.stopLayer)
      map.removeLayer(layers.pathLayer)
      map.removeLayer(layers.routeLayer)
      layers.stopSource.clear()
      layers.routeSource.clear()
      layers.pathSource.clear()
      routeSourceRef.current = null
      pathSourceRef.current = null
      stopSourceRef.current = null
      stopLayerRef.current = null
      routeLayerRef.current = null
      pathLayerRef.current = null
    }
  }, [map])

  useEffect(() => {
    stopLayerRef.current?.changed()
    routeLayerRef.current?.changed()
    pathLayerRef.current?.changed()
  }, [selectedStopId, selectedRouteId, hoveredRouteId, routesVisible, stopsVisible, hiddenRouteIds])

  const load = useCallback(async () => {
    if (!map || !permitted) return
    const requestId = ++requestIdRef.current
    setLoading(true)

    try {
      const [routesResponse, pathsResponse] = await Promise.all([
        fetchTransportRoutes(),
        fetchTransportRoutePaths().catch(() => null),
      ])
      if (!routesResponse.ok) throw new Error(await readApiError(routesResponse, 'Ulaşım güzergahları yüklenemedi.'))
      if (!pathsResponse?.ok) {
        throw new Error(pathsResponse
          ? await readApiError(pathsResponse, 'Ulaşım rota bilgileri yüklenemedi.')
          : 'Ulaşım rota bilgileri yüklenemedi.')
      }
      const nextRoutes = (await routesResponse.json()).filter((route) => route.isActive === true)
      const activeIds = new Set(nextRoutes.map((route) => route.id))
      const nextPaths = (await pathsResponse.json()).filter((path) => activeIds.has(path.routeId))
      const stopResponses = await Promise.all(nextRoutes.map((route) => fetchTransportRouteStops(route.id)))
      for (const response of stopResponses) {
        if (!response.ok) throw new Error(await readApiError(response, 'Ulaşım durakları yüklenemedi.'))
      }
      const nextStops = (await Promise.all(stopResponses.map((response) => response.json()))).flat()
      if (requestId !== requestIdRef.current) return

      const features = transportFeatures(nextRoutes, nextStops, nextPaths)
      routeSourceRef.current?.clear()
      routeSourceRef.current?.addFeatures(features.routeFeatures)
      pathSourceRef.current?.clear()
      pathSourceRef.current?.addFeatures(features.pathFeatures)
      stopSourceRef.current?.clear()
      stopSourceRef.current?.addFeatures(features.stopFeatures)
      setRoutes(nextRoutes)
      setStops(nextStops)
      setPaths(nextPaths)
      const snapshot = { routes: nextRoutes, stops: nextStops, paths: nextPaths }
      onSnapshot?.(snapshot)
      return snapshot
    } catch (error) {
      if (requestId === requestIdRef.current) {
        showToast?.('error', error.message || 'Ulaşım verileri yüklenemedi.')
      }
      return null
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [map, permitted, showToast, onSnapshot])

  const focusRoute = useCallback((routeId) => {
    if (!map || routeId == null) return false
    const currentPath = pathSourceRef.current?.getFeatures().find((feature) => feature.get('routeId') === Number(routeId))
    if (currentPath) {
      map.getView().fit(currentPath.getGeometry().getExtent(), { padding: [48, 48, 48, 48], duration: 350, maxZoom: 16 })
      return true
    }
    const coordinates = stopSourceRef.current?.getFeatures()
      .filter((feature) => feature.get('routeId') === Number(routeId))
      .map((feature) => feature.getGeometry().getCoordinates()) ?? []
    if (coordinates.length === 0) return false
    if (coordinates.length === 1) {
      map.getView().animate({ center: coordinates[0], zoom: Math.max(map.getView().getZoom() ?? 0, 15), duration: 300 })
      return true
    }
    map.getView().fit(boundingExtent(coordinates), { padding: [48, 48, 48, 48], duration: 350, maxZoom: 16 })
    return true
  }, [map])

  const focusStop = useCallback((stopId) => {
    if (!map || stopId == null) return false
    const feature = stopSourceRef.current?.getFeatures().find((item) => item.get('stopId') === Number(stopId))
    if (!feature) return false
    map.getView().animate({
      center: feature.getGeometry().getCoordinates(),
      zoom: Math.max(map.getView().getZoom() ?? 0, 16),
      duration: 300,
    })
    return true
  }, [map])

  const applyStopOrder = useCallback((routeId, orderedStops) => {
    if (routeId == null || !Array.isArray(orderedStops)) return
    const ordered = [...orderedStops].sort((left, right) => left.sequenceOrder - right.sequenceOrder || left.id - right.id)
    const byId = new Map(ordered.map((stop, index) => [stop.id, {
      sequenceOrder: stop.sequenceOrder,
      terminal: index === 0 ? 'start' : index === ordered.length - 1 ? 'end' : 'middle',
    }]))
    for (const feature of stopSourceRef.current?.getFeatures() ?? []) {
      if (feature.get('routeId') !== Number(routeId)) continue
      const next = byId.get(feature.get('stopId'))
      if (!next) continue
      feature.set('sequenceOrder', next.sequenceOrder, true)
      feature.set('terminal', next.terminal, true)
      feature.set('transportStop', { ...feature.get('transportStop'), ...next }, true)
    }
    stopLayerRef.current?.changed()
  }, [])

  useEffect(() => {
    if (map && permitted) {
      load()
      return
    }
    requestIdRef.current += 1
    routeSourceRef.current?.clear()
    pathSourceRef.current?.clear()
    stopSourceRef.current?.clear()
    setRoutes([])
    setStops([])
    setPaths([])
    setLoading(false)
  }, [map, permitted, load])

  return {
    routes,
    activeRoutes: routes,
    stops,
    paths,
    loading,
    refresh: load,
    focusRoute,
    focusStop,
    applyStopOrder,
  }
}
