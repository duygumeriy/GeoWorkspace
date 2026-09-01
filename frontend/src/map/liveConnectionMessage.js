/**
 * Canlı kanal arızalarının KULLANICI metni.
 *
 * <b>Ham istisna mesajı arayüze çıkmaz.</b> SignalR pazarlık hatası tarayıcıda
 * "Failed to complete negotiation with the server: TypeError: Failed to fetch"
 * olarak gelir; bu cümle kullanıcıya hiçbir şey anlatmaz, üstelik altyapı
 * ayrıntısını (uç adı, taşıma türü) arayüze taşır. Teknik ayrıntı
 * GELİŞTİRİCİYE aittir ve konsola yazılır.
 *
 * <b>Mevcut hata sunumu dili korunur:</b> tek cümle, Türkçe, eylem önerili.
 */

/** Bağlantının hiç kurulamadığını anlatan desenler. */
const CONNECTION_FAILURE = /negotiation|failed to fetch|networkerror|websocket|econnrefused|load failed/i

export const LIVE_CONNECTION_MESSAGE = 'Canlı bağlantı kurulamadı. Sunucu bağlantısını kontrol edin.'

/**
 * @param {unknown} error yakalanan istisna
 * @param {string} fallback bağlantı dışı bir hata için gösterilecek metin
 * @returns {string} kullanıcıya gösterilecek güvenli cümle
 */
export function liveConnectionMessage(error, fallback) {
  const raw = typeof error?.message === 'string' ? error.message : ''

  /* Teknik ayrıntı KAYBOLMAZ: geliştirici konsolunda tam haliyle durur. */
  if (raw && typeof console !== 'undefined') {
    console.error('[canlı bağlantı]', error)
  }

  return CONNECTION_FAILURE.test(raw) ? LIVE_CONNECTION_MESSAGE : (raw || fallback)
}
