/**
 * Kişisel yolculuk canlı durumunun SAF kuralları.
 *
 * <b>React'ten ayrı tutulur</b> çünkü buradaki tek soru zamanlamadır:
 * hangi olay kabul edilir, hangisi düşürülür. Bir bileşenin içine gömülmüş
 * "eskiyse yok say" mantığı ne testten geçerdi ne de gözden geçirmeden.
 */

import { journeyNavigationModel } from './journeyNavigation.js'
import { journeyProfileLabel } from './journeyPresentation.js'

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
 * Bir çalıştırmanın arayüze GİRİŞ yolu.
 *
 * <b>Zamanlamadan ya da eksik alanlardan çıkarılmaz</b>: çağıran hangi yoldan
 * geldiğini AÇIKÇA söyler. "Anlık görüntüsü varsa kurtarmadır" gibi bir sezgi,
 * ilk tick'i geç gelen taze bir yolculuğu da kurtarma sayardı.
 */
export const JOURNEY_ADOPTION = Object.freeze({
  /** Kullanıcı bu oturumda "Simülasyonu Başlat" dedi. */
  START: 'start',
  /** Yenileme sonrası sunucudaki mevcut çalıştırma benimsendi. */
  RECOVERY: 'recovery',
})

/**
 * Benimseme kamerayı TALEP EDER Mİ?
 *
 * <b>Gözlemek takip etmek DEĞİLDİR.</b> Kurtarma, sunucuda zaten süren bir
 * yolculuğu izlemeye devam etmektir: SignalR'a yeniden katılınır, araç çizilir,
 * panel canlı duruma döner — ama kullanıcının bıraktığı görüntü kendiliğinden
 * kaydırılmaz. Kamerayı ele geçirmek AÇIK bir eylemdir; yenilemeden sonra o
 * eylem verilmemiştir.
 *
 * Taze başlatma bunun tersidir ve bilinçlidir: kullanıcı yolculuğu o an
 * başlatmıştır, aracı görmek istediği varsayımı onun kendi eyleminden gelir.
 */
export function adoptedJourneyFollow(source) {
  return source === JOURNEY_ADOPTION.START
}

/**
 * Yolculuk arayüzünün ÜÇ evresi.
 *
 * <b><code>simulation != null</code> "canlı" DEMEK DEĞİLDİR.</b> Bir yolculuk
 * bittiğinde ya da iptal edildiğinde sunucunun son anlık görüntüsü hâlâ
 * elimizdedir ve gösterilmeye devam etmelidir — ama artık hareket yoktur,
 * dolayısıyla takip kamerası ve durdurma düğmesi de anlamsızdır. İkisini tek
 * bayrağa bağlamak, biten bir yolculuğun paneli sonsuza dek işgal etmesi
 * demekti: kullanıcı yeniden planlamaya dönemezdi.
 */
export const JOURNEY_PHASES = Object.freeze({
  /** Benimsenmiş bir çalıştırma yok: sıradan planlama formu. */
  PLANNER: 'planner',
  /** Sunucu "Running" diyor: ilerleme, manevra ve takip anlamlıdır. */
  ACTIVE: 'active',
  /** Tamamlandı/iptal edildi: SONUÇ durur, hareket bitmiştir. */
  TERMINAL: 'terminal',
})

/**
 * Evreyi YALNIZCA sunucunun bildirdiği durumdan türetir.
 *
 * İstemci hiçbir zaman "bitti" demez: tamamlanma kararı sunucunundur ve buraya
 * yalnızca okunur. Anlık görüntü henüz gelmemişse çalıştırma benimsenmiştir
 * ama durumu bilinmiyordur — bu, biten bir yolculuk değil, başlayan bir
 * yolculuktur; ACTIVE sayılır.
 */
export function journeyPhase({ simulation, snapshot } = {}) {
  if (!simulation) return JOURNEY_PHASES.PLANNER
  return isTerminalJourneyStatus(snapshot?.status)
    ? JOURNEY_PHASES.TERMINAL
    : JOURNEY_PHASES.ACTIVE
}

/**
 * Terminal başlıkları — durum SUNUCUDAN gelir, tarayıcıda türetilmez.
 *
 * Panel de, kapalıyken görünen kısayol da AYNI metni kullanır: iki yerde iki
 * ayrı Türkçe cümle tutmak, zamanla "tamamlandı" ile "bitti"nin yan yana
 * yaşaması demekti. Bilinmeyen bir terminal durum çökertmez.
 *
 * <b>İPTAL EDİLDİ, "durduruldu" DEĞİL.</b> Aynı sunucu durumu (`Cancelled`)
 * canlı panelde "durduruldu", geçmiş listesinde "İptal Edildi" diye
 * okunuyordu; kullanıcı iki farklı sonuç olduğunu sanabilirdi. Sonucun tek
 * adı vardır. EYLEM adı ayrıdır ve değişmez: kullanıcı yolculuğu "Durdur"
 * düğmesiyle bitirir — yaptığı iş durdurmak, sonucun adı ise iptal edilmiş
 * olmaktır.
 */
export const JOURNEY_TERMINAL_TITLES = Object.freeze({
  [JOURNEY_SIMULATION_STATUS.COMPLETED]: 'Yolculuk tamamlandı',
  [JOURNEY_SIMULATION_STATUS.CANCELLED]: 'Yolculuk iptal edildi',
  default: 'Yolculuk sona erdi',
})

export function journeyTerminalTitle(status) {
  return JOURNEY_TERMINAL_TITLES[status] ?? JOURNEY_TERMINAL_TITLES.default
}

/**
 * Panel kapalıyken/katlanmışken kısayolun anlatacağı durum.
 *
 * <b>Yeni ölçüm HESAPLANMAZ.</b> Yüzde, sunucunun anlık görüntüsündeki
 * değerdir ve yalnızca kırpılıp yuvarlanır; bir tahmin, bir sayaç ya da bir
 * animasyon yoktur. Benimsenmiş çalıştırma yoksa <code>null</code> döner ve
 * kısayol sıradan bir düğme gibi görünür.
 *
 * @returns {{ phase: string, tone: 'active'|'terminal', label: string } | null}
 */
export function journeyStatusIndicator({ simulation, snapshot } = {}) {
  const phase = journeyPhase({ simulation, snapshot })
  if (phase === JOURNEY_PHASES.PLANNER) return null

  if (phase === JOURNEY_PHASES.TERMINAL) {
    return { phase, tone: 'terminal', label: journeyTerminalTitle(snapshot?.status) }
  }

  const percent = Number.isFinite(snapshot?.progressPercent)
    ? Math.round(Math.min(100, Math.max(0, snapshot.progressPercent)))
    : null

  return {
    phase,
    tone: 'active',
    label: percent === null ? 'Yolculuk sürüyor' : `Yolculuk sürüyor · %${percent}`,
  }
}

/** Durumun kısa Türkçe karşılığı; sunucunun değerinden okunur. */
const STATUS_LABELS = Object.freeze({
  [JOURNEY_SIMULATION_STATUS.RUNNING]: 'Sürüyor',
  [JOURNEY_SIMULATION_STATUS.COMPLETED]: 'Tamamlandı',
  /* Geçmiş rozetiyle AYNI kelime: tek bir sunucu durumunun tek bir adı olur. */
  [JOURNEY_SIMULATION_STATUS.CANCELLED]: 'İptal Edildi',
})

export function journeyStatusLabel(status) {
  return STATUS_LABELS[status] ?? 'Bilinmiyor'
}

/**
 * Hareket eden kişisel yolculuk işaretçisinin bilgi balonu modeli.
 *
 * <b>Otorite SUNUCUDUR ve TEK kaynaktır.</b> Yüzde, canlı panelin okuduğu
 * anlık görüntünün ta kendisidir (`journeyLiveModel`); ikinci bir ilerleme
 * formülü — geometri uzunluğu, tarayıcı zamanlayıcısı, adım sayısı, animasyon
 * konumu — YOKTUR. Profil, planlayıcının o anki seçimi değil, benimsenmiş
 * çalıştırmanın <code>requestedProfile</code>'ıdır: başlattıktan sonra panelde
 * profil değiştirmek çalışan yolculuğun balonunu yeniden adlandırmaz.
 *
 * <b>Talimatlar gezinme modelinden gelir</b> — panelin okuduğu AYNI model.
 *
 * @returns {object|null} benimsenmiş çalıştırma yoksa null
 */
export function journeyVehiclePopupModel({ simulation, snapshot } = {}) {
  const live = journeyLiveModel({ simulation, snapshot })
  if (!live) return null

  const navigation = journeyNavigationModel({
    steps: simulation.steps,
    currentStepSequence: live.currentStepSequence,
  })

  return Object.freeze({
    simulationId: live.simulationId,
    profileId: live.profileId,
    profileLabel: journeyProfileLabel(live.profileId),
    // "Araç Yolculuğu" / "Yürüyüş Yolculuğu" / "Bisiklet Yolculuğu".
    title: `${journeyProfileLabel(live.profileId)} Yolculuğu`,
    status: live.status,
    statusLabel: journeyStatusLabel(live.status),
    isTerminal: live.isTerminal,
    /* Yüzde SUNUCUNUN kırpılmış değeridir; biçimlendirme yalnızca gösterim
       güvenliğidir. */
    progressPercent: live.progressPercent,
    progressLabel: `%${Math.round(live.progressPercent)}`,
    longitude: live.longitude,
    latitude: live.latitude,
    currentStep: navigation.current,
    nextStep: navigation.next,
    hasSteps: navigation.hasSteps,
  })
}

/**
 * Haritadaki yolculuk çizgisinin SAHİBİ.
 *
 * Benimsenmiş bir çalıştırma varken (çalışıyor ya da bitmiş) sunucunun
 * otoriter geometrisi kazanır: ekranda duran güzergah, panelde anlatılan
 * yolculuğun ta kendisidir. Kullanıcı sonucu bıraktığında (`dismiss`)
 * <code>simulation</code> düşer ve varsa geçerli önizleme yeniden görünür
 * olur; yoksa harita temizlenir.
 *
 * <b>Geometri KOPYALANMAZ.</b> Burada yalnızca hangi kaynağın okunacağı
 * seçilir; planlayıcı durumuna hiçbir zaman simülasyon geometrisi yazılmaz.
 */
export function journeyDisplayGeometryWkt({ simulation, previewGeometryWkt = null } = {}) {
  return simulation?.geometryWkt ?? previewGeometryWkt ?? null
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
