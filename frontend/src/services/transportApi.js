import { authFetch } from './api.js'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export function fetchTransportRoutes() {
  return authFetch('/api/transport/routes')
}

export function fetchTransportRouteStops(routeId) {
  return authFetch(`/api/transport/routes/${routeId}/stops`)
}

export function fetchTransportStops() {
  return authFetch('/api/transport/stops')
}

export function fetchDeletedManagedTransportStops() {
  return authFetch('/api/transport/stops/deleted')
}

export function fetchTransportRoutePath(routeId) {
  return authFetch(`/api/transport/routes/${routeId}/path`)
}

export function fetchTransportRoutePaths() {
  return authFetch('/api/transport/routes/paths')
}

export function generateTransportRoutePath(routeId) {
  return authFetch(`/api/transport/routes/${routeId}/path/generate`, { method: 'POST' })
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

/* --- Simülasyon ---------------------------------------------------------------
   Ayrı bir API katmanı AÇILMAZ: aynı authFetch, aynı hata okuma ve aynı 401/403
   davranışı geçerlidir. Canlı yayın SignalR üzerinden gelir; buradaki iki uç
   "şu an ne oluyor" sorusunun REST karşılığıdır ve sayfa açılışında (rota
   zaten çalışıyor olabilir) tek doğru kaynaktır. */

/** Seçili güzergah için simülasyon başlatır. Yetki: `transport.simulation.start`. */
export function startTransportSimulation(routeId) {
  return authFetch(`/api/transport/simulations/routes/${routeId}/start`, { method: 'POST' })
}

/** Güzergahın çalışan simülasyonunun sunucu otoriteli anlık görüntüsü (yoksa 404). */
export function fetchTransportSimulation(routeId) {
  return authFetch(`/api/transport/simulations/routes/${routeId}`)
}

/* --- Yolculuk planlama (Faz 5B önizleme ucu) ----------------------------------
   Ayrı bir API katmanı ya da ikinci bir token deposu AÇILMAZ: aynı authFetch,
   aynı Authorization başlığı, aynı 401/403 davranışı ve aynı hata okuma
   geçerlidir.

   İSTEK YALNIZCA SEÇİM TAŞIR. Geometri, koordinat, PlanId ya da herhangi bir
   yönlendirme verisi gönderilmez; sunucu geçiş noktalarını kendi verisinden
   çözer ve güzergahı kendisi hesaplar. Tarayıcı OSRM'e hiçbir biçimde
   bağlanmaz — bu uç, yönlendirme motorunun bilindiği TEK sınırdır. */

/**
 * Bir yolculuk planını doğrular ve gerçek güzergah önizlemesini döndürür.
 *
 * Yetki: `transport.view`; istek POI referansı taşıyorsa sunucu ayrıca
 * `poi.view` arar. Uç hiçbir şey YAZMAZ ve simülasyon başlatmaz.
 *
 * `signal` çağıran tarafından daima verilir: eski bir planın geç gelen
 * cevabı, yenisinin sonucunu EZMEMELİDİR.
 */
export function previewJourney(request, { signal } = {}) {
  return authFetch('/api/transport/journeys/preview', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(request),
    signal,
  })
}
