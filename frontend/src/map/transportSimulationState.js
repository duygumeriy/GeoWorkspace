/**
 * Simülasyonun ARAYÜZ tarafındaki saf durumu: normalleştirme, sıralama
 * güvenliği ve hangi denetimin görüneceği.
 *
 * <b>Neden ayrı ve saf.</b> Canlı bir kanalda olayların sırası garanti
 * değildir: geç kalmış bir `SimulationUpdated`, yavaş dönen bir `JoinRoute`
 * cevabı ya da yeniden bağlanma sonrası gelen bir anlık görüntü, ekrandaki
 * daha yeni durumu geri saracak şekilde gelebilir. Bu kararların bir React
 * bileşeninin içine gömülmesi, onları yalnızca tarayıcıda ve elle
 * sınanabilir kılardı; burada saf fonksiyonlar olarak dururlar.
 */

export const SIMULATION_STATUS = Object.freeze({
  RUNNING: 'Running',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
})

const TERMINAL_STATUSES = new Set([SIMULATION_STATUS.COMPLETED, SIMULATION_STATUS.CANCELLED])

const STATUS_LABELS = Object.freeze({
  [SIMULATION_STATUS.RUNNING]: 'Çalışıyor',
  [SIMULATION_STATUS.COMPLETED]: 'Tamamlandı',
  [SIMULATION_STATUS.CANCELLED]: 'İptal edildi',
})

/** Çalıştırma bitti mi? Bitmiş bir çalıştırma "aktif" sayılmaz. */
export function isTerminalSimulationStatus(status) {
  return TERMINAL_STATUSES.has(status)
}

export function simulationStatusLabel(status) {
  return STATUS_LABELS[status] ?? 'Bilinmiyor'
}

function finiteNumber(value) {
  /* `Number(null)` ve `Number('')` SIFIR verir. Bu, "değer yok" ile "değer 0"
     ayrımını yok eder: seçili güzergah yokken routeId sessizce 0. rotaya
     dönüşür ve seçim yapılmamışken denetimler görünürdü. Boş girdi burada
     ayrıştırılmadan önce elenir. */
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function clampPercent(value) {
  const number = finiteNumber(value)
  if (number === null) return 0
  return Math.min(100, Math.max(0, number))
}

/** Zaman damgasını karşılaştırılabilir sayıya çevirir; okunamıyorsa `null`. */
function timestamp(value) {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalize({ simulationId, routeId, status, longitude, latitude, progressPercent, updatedAtUtc }) {
  const id = simulationId ?? null
  const route = finiteNumber(routeId)
  if (!id || route === null) return null

  return Object.freeze({
    simulationId: id,
    routeId: route,
    status: status ?? SIMULATION_STATUS.RUNNING,
    longitude: finiteNumber(longitude) ?? 0,
    latitude: finiteNumber(latitude) ?? 0,
    progressPercent: clampPercent(progressPercent),
    updatedAtUtc: updatedAtUtc ?? null,
  })
}

/**
 * SignalR `SimulationUpdated` yükünü arayüz durumuna çevirir.
 *
 * Sözleşme Faz 2'de tanımlıdır ve yalnızca istemcinin ihtiyacı olanı taşır;
 * burada da fazlası okunmaz.
 */
export function normalizeLiveUpdate(update) {
  if (!update) return null
  return normalize(update)
}

/**
 * REST anlık görüntüsünü (`GET /api/transport/simulations/routes/{id}`) aynı
 * biçime çevirir.
 *
 * REST yanıtı yalnızca ÇALIŞAN bir simülasyon için 200 döner (yoksa 404), bu
 * yüzden durumu `Running`'dir; ilerleme orada oran, canlı yayında yüzdedir ve
 * iki ölçünün arayüzde karışmaması için burada tek biçime indirgenir.
 */
export function normalizeStatusSnapshot(snapshot) {
  if (!snapshot) return null
  return normalize({
    simulationId: snapshot.simulationId,
    routeId: snapshot.routeId,
    status: SIMULATION_STATUS.RUNNING,
    longitude: snapshot.longitude,
    latitude: snapshot.latitude,
    progressPercent: clampPercent((finiteNumber(snapshot.progressRatio) ?? 0) * 100),
    updatedAtUtc: snapshot.capturedAt ?? null,
  })
}

/**
 * Yeni gelen durumu mevcut durumla birleştirir. TEK yazma kuralı budur.
 *
 * Kurallar:
 * <ul>
 *   <li><b>Farklı <code>simulationId</code> yeni bir çalıştırmadır</b> ve
 *       kabul edilir — ilerlemesi daha düşük olsa bile; ancak KANITLANABİLİR
 *       biçimde eskiyse (zaman damgası geriye gidiyorsa) yok sayılır, çünkü o
 *       bir önceki çalıştırmanın gecikmiş olayıdır.</li>
 *   <li><b>Aynı çalıştırmada zaman geriye akmaz:</b> daha eski damgalı olay
 *       yok sayılır.</li>
 *   <li><b>Aynı çalıştırmada ilerleme geri sarmaz.</b></li>
 *   <li><b>Bitiş (tamamlandı/iptal) kazanır:</b> daha eski olmadığı sürece
 *       çalıştırmayı sonlandırır.</li>
 * </ul>
 */
export function mergeSimulationState(current, incoming) {
  if (!incoming) return current
  if (!current) return incoming

  // Durum rota BAŞINA tutulur; başka bir rotanın olayı buraya yazılmaz.
  if (current.routeId !== incoming.routeId) return current

  const incomingTime = timestamp(incoming.updatedAtUtc)
  const currentTime = timestamp(current.updatedAtUtc)
  const isOlder = incomingTime !== null && currentTime !== null && incomingTime < currentTime

  if (incoming.simulationId !== current.simulationId) {
    return isOlder ? current : incoming
  }

  if (isOlder) return current
  if (isTerminalSimulationStatus(incoming.status)) return incoming
  if (incoming.progressPercent < current.progressPercent) return current

  return incoming
}

/**
 * Seçili güzergah için hangi denetimin görüneceği.
 *
 * <b>Yalnızca ETKİN yetki koduna bakar.</b> Rol/kullanıcı kimliğine ya da
 * ayrıcalık bayraklarına dayanan hiçbir kestirme burada YOKTUR ve olmamalıdır:
 * bunlar arayüzü backend'in gerçek kuralından ayrı bir kural kitabına
 * bağlardı. Görünürlük yalnızca DENEYİMDİR — düğmeyi gizlemek yetkilendirme
 * değildir; backend aynı isteğe 403 döndürmeye devam eder.
 */
export function transportSimulationControls({
  routeId = null,
  simulation = null,
  followingRouteId = null,
  canStart = false,
  starting = false,
  following = false,
} = {}) {
  const route = finiteNumber(routeId)
  const active = route !== null
    && simulation != null
    && simulation.routeId === route
    && !isTerminalSimulationStatus(simulation.status)

  const isFollowing = route !== null && followingRouteId === route

  return {
    isActive: active,
    isFollowing,
    // Çalışan bir simülasyon varken başlatma sunulmaz: backend zaten 409 döner.
    showStart: route !== null && canStart === true && !active,
    startDisabled: starting === true,
    showFollow: active && !isFollowing,
    showUnfollow: isFollowing,
    followDisabled: following === true,
    statusLabel: simulation && simulation.routeId === route
      ? simulationStatusLabel(simulation.status)
      : null,
    progressPercent: active ? simulation.progressPercent : null,
    progressLabel: active ? `%${Math.round(simulation.progressPercent)}` : null,
  }
}
