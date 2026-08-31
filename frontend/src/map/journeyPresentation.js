import { formatRouteDistance, formatRouteDuration } from './transportPathPresentation.js'
import { JOURNEY_MODES, JOURNEY_PROFILES } from './journeyPlanning.js'

/**
 * Önizleme yanıtının kullanıcıya gösterilecek biçimi.
 *
 * <b>Hiçbir ölçüm burada HESAPLANMAZ.</b> Mesafe ve süre sunucudan geldiği
 * gibi biçimlendirilir; tarayıcıda alternatif bir süre tahmini, bir hız
 * katsayısı ya da bir çarpan YOKTUR. Yürüyüş/bisiklet için sürüş süresini
 * çarpmak bir yaklaşım değil uydurma olurdu — rota geometrisi de moda göre
 * değişir.
 *
 * Biçimlendirme mevcut ulaşım yardımcılarını yeniden kullanır: aynı
 * uygulamada iki farklı mesafe/süre dili olmamalıdır.
 */

const PROFILE_LABELS = new Map(JOURNEY_PROFILES.map((profile) => [profile.id, profile.label]))

export function journeyProfileLabel(id) {
  return PROFILE_LABELS.get(id) ?? '—'
}

/**
 * Profil bir hatanın DEĞİL, yapılandırmanın sonucu olarak kullanılamıyor
 * olabilir. Mesaj kullanıcı diliyle yazılır: "OSRM", "profil motoru",
 * "endpoint" gibi altyapı terimleri arayüze çıkmaz.
 */
export function unavailableProfileMessage(profileId) {
  const label = journeyProfileLabel(profileId)
  return `${label} rotası şu anda kullanılamıyor. Sunucuda ${label.toLowerCase()} için rota hesaplama hazır değil.`
}

/**
 * Sunucudan gelen özeti panele hazırlar.
 *
 * `geometrySource` kasıtlı olarak KULLANICI metnine çevrilmez; teknik bir
 * ayrımdır ve normal akışta panelde yer tutmaz. Yalnızca ayıklama amacıyla
 * ham hâliyle taşınır.
 */
export function journeyPreviewSummary(preview) {
  const summary = preview?.summary
  if (!summary) return null

  const waypoints = Array.isArray(preview.waypoints) ? preview.waypoints : []
  const origin = waypoints[0] ?? null
  const destination = waypoints.length > 1 ? waypoints[waypoints.length - 1] : null

  return {
    mode: summary.mode ?? null,
    profileId: summary.requestedProfile ?? null,
    profileLabel: journeyProfileLabel(summary.requestedProfile),
    distance: formatRouteDistance(summary.distanceMeters),
    duration: formatRouteDuration(summary.durationSeconds),
    routeName: summary.routeName ?? null,
    originName: origin?.name ?? '—',
    destinationName: destination?.name ?? '—',
    viaCount: Math.max(0, waypoints.length - 2),
    stepCount: Number.isFinite(summary.stepCount) ? summary.stepCount : 0,
    // Teknik alan: panelde etiket olarak gösterilmez.
    geometrySource: summary.geometrySource ?? null,
    /* Kalıcı güzergahı yeniden kullanan bir tam-hat önizlemesinde manevra
       olmaması GEÇERLİDİR ve hata gibi sunulmaz. */
    stepsUnavailableIsExpected:
      summary.mode === JOURNEY_MODES.ROUTE_FULL && summary.geometrySource === 'persistedRoutePath',
  }
}

export const JOURNEY_ERROR_MESSAGES = Object.freeze({
  invalidSelection: 'Seçiminiz geçersiz. Lütfen noktaları kontrol edin.',
  unavailableEntity: 'Seçtiğiniz noktalardan biri artık kullanılamıyor. Listeyi yenileyip tekrar deneyin.',
  engineUnavailable: 'Rota hesaplama şu anda kullanılamıyor. Lütfen biraz sonra tekrar deneyin.',
  timeout: 'Rota hesaplama zamanında yanıt vermedi. Lütfen tekrar deneyin.',
  noRoute: 'Seçilen noktalar arasında bir rota bulunamadı.',
  unknown: 'Rota hesaplanamadı. Lütfen tekrar deneyin.',
})

/**
 * HTTP durumunu ve sunucunun GÜVENLİ mesajını kullanıcı metnine çevirir.
 *
 * <b>Ham gövde asla doğrudan gösterilmez</b> ve sunucu mesajı yalnızca
 * doğrulama sınıfında (400) kullanılır — orada metin kullanıcının kendi
 * seçimini anlatır. Diğer sınıflarda sabit metin tercih edilir ki altyapı
 * terimleri (adres, port, motor adı) hiçbir yoldan sızmasın.
 */
export function journeyErrorMessage(status, serverMessage = '') {
  const safe = typeof serverMessage === 'string' ? serverMessage.trim() : ''

  if (status === 404) return JOURNEY_ERROR_MESSAGES.unavailableEntity
  if (status === 504) return JOURNEY_ERROR_MESSAGES.timeout
  if (status === 502) return JOURNEY_ERROR_MESSAGES.engineUnavailable
  if (status === 409) return safe || JOURNEY_ERROR_MESSAGES.unknown
  if (status === 403) return 'Bu işlem için yetkiniz bulunmuyor.'

  if (status === 400) {
    /* 400 kullanıcının SEÇİMİYLE ilgilidir; sunucunun Türkçe doğrulama
       metni burada en yararlı olandır ve güvenli sözleşmedendir. */
    return safe || JOURNEY_ERROR_MESSAGES.invalidSelection
  }

  return JOURNEY_ERROR_MESSAGES.unknown
}
