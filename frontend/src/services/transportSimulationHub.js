import { HubConnectionBuilder, HttpTransportType, LogLevel } from '@microsoft/signalr'
import { apiBaseUrl, getAccessToken } from './api.js'
import { createTransportSimulationClient } from './transportSimulationClient.js'

/** Faz 2'de tanımlanan hub yolu. Tek yerde durur; iki farklı yol denenmez. */
export const TRANSPORT_SIMULATION_HUB_PATH = '/hubs/transport-simulation'

/**
 * Hub adresi, REST ile AYNI taban adresten türetilir.
 *
 * İkinci bir taban adres (ya da sabit bir `localhost`) tanımlamak, ortam
 * değiştiğinde REST'in çalışıp canlı kanalın sessizce ölmesi demekti.
 */
export function transportSimulationHubUrl(baseUrl = apiBaseUrl()) {
  return `${String(baseUrl).replace(/\/+$/, '')}${TRANSPORT_SIMULATION_HUB_PATH}`
}

/**
 * Gerçek SignalR bağlantısı.
 *
 * <b>Token mevcut oturumdan okunur</b> (<code>getAccessToken</code>) ve
 * `accessTokenFactory` ile HER bağlantı/yeniden bağlanma denemesinde yeniden
 * sorulur; token bir kez kopyalanıp saklanmaz, ikinci bir kimlik deposu
 * oluşmaz. WebSocket el sıkışması Authorization başlığı taşıyamadığı için
 * backend bu token'ı yalnızca hub yolunda sorgu dizesinden okur.
 */
export function createTransportSimulationConnection() {
  return new HubConnectionBuilder()
    .withUrl(transportSimulationHubUrl(), {
      accessTokenFactory: () => getAccessToken() ?? '',
      transport: HttpTransportType.WebSockets | HttpTransportType.LongPolling,
    })
    .withAutomaticReconnect()
    .configureLogging(LogLevel.Warning)
    .build()
}

/** Uygulamanın kullandığı istemci: gerçek bağlantı + Faz 3 yaşam döngüsü. */
export function createTransportSimulationHubClient({ onUpdate, onError } = {}) {
  return createTransportSimulationClient({
    createConnection: createTransportSimulationConnection,
    onUpdate,
    onError,
  })
}
