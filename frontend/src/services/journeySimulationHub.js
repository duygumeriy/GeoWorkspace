import { HubConnectionBuilder, HttpTransportType, LogLevel } from '@microsoft/signalr'
import { apiBaseUrl, getAccessToken } from './api.js'

/**
 * Kişisel yolculuk kanalının bağlantısı.
 *
 * <b>Hat kanalıyla AYNI kalıp, AYRI yol.</b> Taban adres ve token okuma mevcut
 * altyapıdan gelir — ikinci bir kimlik deposu ya da ikinci bir taban adres
 * TANIMLANMAZ. Ayrı bir hub yolu olması bilinçlidir: paylaşılan hat yayınıyla
 * aynı bağlantıyı kullanmak, iki farklı yetkilendirme anlamı olan iki ürünü
 * aynı gruplara sokardı.
 */
export const JOURNEY_SIMULATION_HUB_PATH = '/hubs/journey-simulation'

export function journeySimulationHubUrl(baseUrl = apiBaseUrl()) {
  return `${String(baseUrl).replace(/\/+$/, '')}${JOURNEY_SIMULATION_HUB_PATH}`
}

/**
 * Gerçek SignalR bağlantısı.
 *
 * Token her bağlanma/yeniden bağlanma denemesinde `accessTokenFactory` ile
 * YENİDEN sorulur; bir kez kopyalanıp saklanmaz. WebSocket el sıkışması
 * Authorization başlığı taşıyamadığı için backend bu token'ı yalnızca hub
 * yolunda sorgu dizesinden okur.
 */
export function createJourneySimulationConnection() {
  return new HubConnectionBuilder()
    .withUrl(journeySimulationHubUrl(), {
      accessTokenFactory: () => getAccessToken() ?? '',
      transport: HttpTransportType.WebSockets | HttpTransportType.LongPolling,
    })
    .withAutomaticReconnect()
    .configureLogging(LogLevel.Warning)
    .build()
}
