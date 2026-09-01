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

/* --- Kişisel yolculuk simülasyonu (Faz 5E-B · Dilim 7B) ----------------------
   Aynı defter, aynı `kind` ayırt edicisi, aynı güvenli sunum sözleşmesi:
   ikinci bir aktivite ekranı ya da ikinci bir çözümleyici kurulmaz. */

/** Kanonik profil → Türkçe. Otobüs/transit YOKTUR. */
const JOURNEY_PROFILE_LABELS = {
  Driving: 'Araç',
  Walking: 'Yaya',
  Cycling: 'Bisiklet',
}

/** Kanonik kip → Türkçe. */
const JOURNEY_MODE_LABELS = {
  RouteFull: 'Tam güzergâh',
  RouteSegment: 'İki durak arası',
  Waypoints: 'Özel rota',
}

const JOURNEY_KINDS = new Set(['JourneyStarted', 'JourneyCancelled', 'JourneyCompleted'])

/**
 * Yolculuk olayının okunabilir bağlamı.
 *
 * <b>Ham JSON asla gösterilmez.</b> Tanınmayan bir kip/profil değeri satırı
 * bozmaz: o parça sessizce atlanır ve geriye anlamlı olan alanlar kalır. Hiçbir
 * alan tanınmıyorsa <code>null</code> döner ve satır yalnızca kendi Türkçe
 * işlem adıyla görünür.
 */
export function journeyActivityContext(details) {
  const value = parseDetails(details)
  if (!JOURNEY_KINDS.has(value?.kind)) return null

  const parts = []

  const profile = JOURNEY_PROFILE_LABELS[value.profile]
  if (profile) parts.push(`Profil: ${profile}`)

  const mode = JOURNEY_MODE_LABELS[value.mode]
  if (mode) parts.push(`Tür: ${mode}`)

  if (Number.isFinite(value.routeId)) parts.push(`Hat #${value.routeId}`)
  if (Number.isInteger(value.waypointCount)) parts.push(`${value.waypointCount} nokta`)

  /* Yüzde SUNUCUNUN değeridir; burada yalnızca gösterim için yuvarlanır ve
     kırpılır — ikinci bir ilerleme hesabı yoktur. */
  if (Number.isFinite(value.progressPercent)) {
    const percent = Math.round(Math.min(100, Math.max(0, value.progressPercent)))
    parts.push(`Tamamlanma: %${percent}`)
  }

  if (Number.isFinite(value.distanceMeters)) parts.push(formatRouteDistance(value.distanceMeters))
  if (Number.isFinite(value.durationSeconds)) parts.push(formatRouteDuration(value.durationSeconds))

  return parts.length > 0 ? parts.join(' · ') : null
}

/**
 * Aktivite satırının bağlamı — hangi ürün olursa olsun.
 *
 * Sayfa tek bir yardımcı çağırır; yeni bir olay ailesi eklemek sayfayı
 * değiştirmeyi gerektirmez.
 */
export function activityContext(details) {
  return transportActivityContext(details) ?? journeyActivityContext(details)
}
