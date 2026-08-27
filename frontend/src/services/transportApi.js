import { authFetch } from './api.js'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export function fetchTransportRoutes() {
  return authFetch('/api/transport/routes')
}

export function fetchTransportRouteStops(routeId) {
  return authFetch(`/api/transport/routes/${routeId}/stops`)
}

export function fetchOwnTransportStops() {
  return authFetch('/api/transport/stops/mine')
}

export function fetchDeletedTransportStops() {
  return authFetch('/api/transport/stops/trash')
}

export function fetchDeletedTransportRoutes() {
  return authFetch('/api/transport/routes/trash')
}

export function createTransportRoute({ name, colorHex }) {
  return authFetch('/api/transport/routes', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, colorHex }),
  })
}

export function updateTransportRoute(id, { name, colorHex }) {
  return authFetch(`/api/transport/routes/${id}`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, colorHex }),
  })
}

export function deleteTransportRoute(id) {
  return authFetch(`/api/transport/routes/${id}`, { method: 'DELETE' })
}

export function reorderTransportRouteStops(routeId, stopIds) {
  return authFetch(`/api/transport/routes/${routeId}/stops/order`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ stopIds }),
  })
}

export function createTransportStop({ name, routeId, longitude, latitude }) {
  return authFetch('/api/transport/stops', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, routeId, longitude, latitude }),
  })
}

export function updateTransportStop(id, { name, routeId, longitude, latitude }) {
  return authFetch(`/api/transport/stops/${id}`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, routeId, longitude, latitude }),
  })
}

export function deleteTransportStop(id) {
  return authFetch(`/api/transport/stops/${id}`, { method: 'DELETE' })
}

export function restoreTransportStop(id) {
  return authFetch(`/api/transport/stops/${id}/restore`, { method: 'POST' })
}

export function restoreTransportRoute(id) {
  return authFetch(`/api/transport/routes/${id}/restore`, { method: 'POST' })
}
