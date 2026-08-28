import { formatRouteDistance, formatRouteDuration } from './transportPathPresentation.js'

function parseDetails(value) {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function namedResource(name, id, fallback) {
  const safeName = typeof name === 'string' && name.trim() ? name.trim() : fallback
  return id == null ? safeName : `${safeName} #${id}`
}

export function transportActivityContext(details) {
  const value = parseDetails(details)
  if (!value?.kind) return null

  if (value.kind === 'RouteGeneration') {
    const route = namedResource(value.routeName, value.routeId, 'Güzergah')
    if (value.routeGenerated !== true) return `${route} · rota oluşturulamadı`
    const metrics = Number.isFinite(value.distanceMeters) && Number.isFinite(value.durationSeconds)
      ? ` · ${formatRouteDistance(value.distanceMeters)} · ${formatRouteDuration(value.durationSeconds)}`
      : ''
    return `${route} · rota oluşturuldu${metrics}`
  }

  if (value.kind === 'StopReorder') {
    const route = namedResource(value.routeName, value.routeId, 'Güzergah')
    const count = Number.isInteger(value.stopCount) ? ` · ${value.stopCount} durak` : ''
    const order = Array.isArray(value.orderedStopIds) && value.orderedStopIds.length > 0
      ? ` · sıra: ${value.orderedStopIds.map((id) => `#${id}`).join(' → ')}`
      : ''
    const generation = value.routeGenerated === false ? ' · rota yeniden hesaplanamadı' : ''
    return `${route}${count}${order}${generation}`
  }

  if (value.kind === 'StopTransfer') {
    const stop = namedResource(value.stopName, value.stopId, 'Durak')
    const source = namedResource(value.sourceRouteName, value.sourceRouteId, 'Kaynak güzergah')
    const destination = namedResource(value.destinationRouteName, value.destinationRouteId, 'Hedef güzergah')
    return `${stop} · ${source} → ${destination}${value.coordinateChanged ? ' · konum da güncellendi' : ''}`
  }

  if (value.kind === 'StopCoordinateMove') {
    const stop = namedResource(value.stopName, value.stopId, 'Durak')
    const route = namedResource(value.routeName, value.routeId, 'Güzergah')
    return `${stop} · ${route} · konum güncellendi`
  }

  return null
}
