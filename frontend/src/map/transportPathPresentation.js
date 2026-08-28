export function transportPathStatus(path) {
  if (!path) return { key: 'missing', label: 'Oluşturulmadı', action: 'Rota Oluştur' }
  if (path.isStale) return { key: 'stale', label: 'Güncel değil', action: 'Rotayı Güncelle' }
  return { key: 'current', label: 'Güncel', action: 'Rotayı Yeniden Oluştur' }
}

export function formatRouteDistance(meters) {
  if (!Number.isFinite(meters)) return '—'
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} km`
}

export function formatRouteDuration(seconds) {
  if (!Number.isFinite(seconds)) return '—'
  const total = Math.max(0, Math.round(seconds))
  if (total < 60) return `${total} sn`
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remainder = total % 60
  if (hours > 0) return `${hours} sa${minutes > 0 ? ` ${minutes} dk` : ''}`
  return `${minutes} dk${remainder > 0 ? ` ${remainder} sn` : ''}`
}

export function formatRouteGeneratedAt(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function transportRouteSummary(path, stopCount) {
  const status = transportPathStatus(path)
  return {
    distance: path ? formatRouteDistance(path.distanceMeters) : '—',
    duration: path ? formatRouteDuration(path.durationSeconds) : '—',
    stopCount: Number.isInteger(stopCount) && stopCount >= 0 ? String(stopCount) : '—',
    generatedAt: path ? formatRouteGeneratedAt(path.generatedAt) : '—',
    status,
    metricsAreStale: status.key === 'stale',
  }
}
