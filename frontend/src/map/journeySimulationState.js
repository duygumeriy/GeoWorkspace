/**
 * Kişisel yolculuk canlı durumunun SAF kuralları.
 *
 * <b>React'ten ayrı tutulur</b> çünkü buradaki tek soru zamanlamadır:
 * hangi olay kabul edilir, hangisi düşürülür. Bir bileşenin içine gömülmüş
 * "eskiyse yok say" mantığı ne testten geçerdi ne de gözden geçirmeden.
 */

export const JOURNEY_SIMULATION_STATUS = Object.freeze({
  RUNNING: 'Running',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
})

const TERMINAL = Object.freeze([
  JOURNEY_SIMULATION_STATUS.COMPLETED,
  JOURNEY_SIMULATION_STATUS.CANCELLED,
])

export function isTerminalJourneyStatus(status) {
  return TERMINAL.includes(status)
}

function timeOf(snapshot) {
  const parsed = Date.parse(snapshot?.updatedAtUtc ?? '')
  return Number.isFinite(parsed) ? parsed : null
}

function progressOf(snapshot) {
  return Number.isFinite(snapshot?.progressPercent) ? snapshot.progressPercent : null
}

/**
 * Gelen bir anlık görüntü mevcut olanın YERİNE geçmeli mi?
 *
 * <b>Üç kural, üçü de gerekli:</b>
 * <ol>
 *   <li><b>Kimlik.</b> Başka bir çalıştırmanın olayı asla uygulanmaz —
 *       kullanıcı durdurup yenisini başlattığında yolda kalmış bir olay
 *       yeni yolculuğu geri saramaz.</li>
 *   <li><b>Terminal kilidi.</b> Tamamlanmış ya da iptal edilmiş bir yolculuk
 *       ASLA "çalışıyor"a dönmez. SignalR sırayı garanti etmez; geç gelen bir
 *       Running olayı, biten bir yolculuğu yeniden hareket ettirirdi.</li>
 *   <li><b>Zaman/ilerleme gerilemesi.</b> Sırasız iki Running olayından
 *       eskisi uygulanırsa işaretçi geri sıçrar. Zaman okunamıyorsa ilerleme
 *       ikinci bir korumadır.</li>
 * </ol>
 */
export function shouldApplyJourneySnapshot(current, incoming) {
  if (!incoming?.simulationId) return false
  if (!current) return true
  if (current.simulationId !== incoming.simulationId) return false

  // Terminal durum kilitlidir; yalnızca başka bir terminal onu değiştirebilir.
  if (isTerminalJourneyStatus(current.status)) return false

  // Terminal olay her zaman kabul edilir: yolculuğun bittiğini kaçırmamalıyız.
  if (isTerminalJourneyStatus(incoming.status)) return true

  const currentTime = timeOf(current)
  const incomingTime = timeOf(incoming)
  if (currentTime !== null && incomingTime !== null) return incomingTime >= currentTime

  const currentProgress = progressOf(current)
  const incomingProgress = progressOf(incoming)
  if (currentProgress !== null && incomingProgress !== null) return incomingProgress >= currentProgress

  return true
}

/**
 * Mevcut anlık görüntüye yeni olayı uygular; kural geçmezse ESKİSİNİ döndürür.
 *
 * Aynı referansı döndürmek bilinçlidir: React yeniden çizim yapmaz ve
 * "düşürülen olay" hiçbir yan etki üretmez.
 */
export function applyJourneySnapshot(current, incoming) {
  return shouldApplyJourneySnapshot(current, incoming) ? incoming : current
}

/**
 * Canlı panelin okuyacağı sunum modeli.
 *
 * <b>Hiçbir ölçüm burada hesaplanmaz.</b> Kalan mesafe, sunucunun otoriter
 * toplamı ile yine sunucunun bildirdiği kat edilen mesafe arasındaki farktır;
 * bir hız tahmini ya da istemci tarafı süre hesabı YOKTUR.
 */
export function journeyLiveModel({ simulation, snapshot }) {
  if (!simulation || !snapshot) return null

  const total = Number.isFinite(simulation.totalDistanceMeters) ? simulation.totalDistanceMeters : null
  const covered = Number.isFinite(snapshot.distanceCoveredMeters) ? snapshot.distanceCoveredMeters : null
  const progress = Number.isFinite(snapshot.progressPercent) ? Math.min(100, Math.max(0, snapshot.progressPercent)) : 0

  return {
    simulationId: simulation.simulationId,
    status: snapshot.status ?? JOURNEY_SIMULATION_STATUS.RUNNING,
    isTerminal: isTerminalJourneyStatus(snapshot.status),
    profileId: simulation.requestedProfile ?? null,
    effectiveProfile: simulation.effectiveProfile ?? null,
    longitude: snapshot.longitude,
    latitude: snapshot.latitude,
    progressPercent: progress,
    totalDistanceMeters: total,
    totalDurationSeconds: Number.isFinite(simulation.totalDurationSeconds)
      ? simulation.totalDurationSeconds
      : null,
    remainingDistanceMeters: total !== null && covered !== null ? Math.max(0, total - covered) : null,
    /* Manevra YOKSA null kalır ve bu geçerlidir: kalıcı güzergahı yeniden
       kullanan tam-hat yolculuğunda adım verisi yoktur ve uydurulmaz. */
    currentStepSequence: Number.isInteger(snapshot.currentStepSequence)
      ? snapshot.currentStepSequence
      : null,
  }
}
