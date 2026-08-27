import { useCallback, useEffect, useRef, useState } from 'react'
import { readApiError } from '../services/api.js'
import { fetchTransportRoutes, fetchTransportRouteStops } from '../services/transportApi.js'
import { createTransportLayers, transportFeatures } from '../map/transport.js'

export default function useTransportLayer(map, {
  permitted,
  selectedStopId,
  selectedRouteId = null,
  routesVisible = true,
  stopsVisible = true,
  showToast,
}) {
  const routeSourceRef = useRef(null)
  const stopSourceRef = useRef(null)
  const stopLayerRef = useRef(null)
  const routeLayerRef = useRef(null)
  const selectedStopIdRef = useRef(selectedStopId)
  const selectedRouteIdRef = useRef(selectedRouteId)
  const routesVisibleRef = useRef(routesVisible)
  const stopsVisibleRef = useRef(stopsVisible)
  selectedStopIdRef.current = selectedStopId
  selectedRouteIdRef.current = selectedRouteId
  routesVisibleRef.current = routesVisible
  stopsVisibleRef.current = stopsVisible
  const requestIdRef = useRef(0)
  const [routes, setRoutes] = useState([])
  const [stops, setStops] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!map) return undefined
    const layers = createTransportLayers(
      () => selectedStopIdRef.current,
      () => selectedRouteIdRef.current,
      () => routesVisibleRef.current,
      () => stopsVisibleRef.current,
    )
    routeSourceRef.current = layers.routeSource
    stopSourceRef.current = layers.stopSource
    stopLayerRef.current = layers.stopLayer
    routeLayerRef.current = layers.routeLayer
    map.addLayer(layers.routeLayer)
    map.addLayer(layers.stopLayer)

    return () => {
      map.removeLayer(layers.stopLayer)
      map.removeLayer(layers.routeLayer)
      layers.stopSource.clear()
      layers.routeSource.clear()
      routeSourceRef.current = null
      stopSourceRef.current = null
      stopLayerRef.current = null
      routeLayerRef.current = null
    }
  }, [map])

  useEffect(() => {
    stopLayerRef.current?.changed()
    routeLayerRef.current?.changed()
  }, [selectedStopId, selectedRouteId, routesVisible, stopsVisible])

  const load = useCallback(async () => {
    if (!map || !permitted) return
    const requestId = ++requestIdRef.current
    setLoading(true)

    try {
      const routesResponse = await fetchTransportRoutes()
      if (!routesResponse.ok) throw new Error(await readApiError(routesResponse, 'Ulaşım güzergahları yüklenemedi.'))
      const nextRoutes = (await routesResponse.json()).filter((route) => route.isActive === true)
      const stopResponses = await Promise.all(nextRoutes.map((route) => fetchTransportRouteStops(route.id)))
      for (const response of stopResponses) {
        if (!response.ok) throw new Error(await readApiError(response, 'Ulaşım durakları yüklenemedi.'))
      }
      const nextStops = (await Promise.all(stopResponses.map((response) => response.json()))).flat()
      if (requestId !== requestIdRef.current) return

      const features = transportFeatures(nextRoutes, nextStops)
      routeSourceRef.current?.clear()
      routeSourceRef.current?.addFeatures(features.routeFeatures)
      stopSourceRef.current?.clear()
      stopSourceRef.current?.addFeatures(features.stopFeatures)
      setRoutes(nextRoutes)
      setStops(nextStops)
    } catch (error) {
      if (requestId === requestIdRef.current) {
        showToast?.('error', error.message || 'Ulaşım verileri yüklenemedi.')
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [map, permitted, showToast])

  useEffect(() => {
    if (map && permitted) {
      load()
      return
    }
    requestIdRef.current += 1
    routeSourceRef.current?.clear()
    stopSourceRef.current?.clear()
    setRoutes([])
    setStops([])
    setLoading(false)
  }, [map, permitted, load])

  return {
    routes,
    activeRoutes: routes,
    stops,
    loading,
    refresh: load,
  }
}
