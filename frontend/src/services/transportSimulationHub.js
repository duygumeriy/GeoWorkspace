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
      /* <b>Kimlik BAŞLIKTA/SORGUDA taşınır, ÇEREZDE değil.</b> `@microsoft/signalr`
         varsayılan olarak `withCredentials: true` ile pazarlık isteği atar;
         tarayıcı o durumda yanıtta `Access-Control-Allow-Credentials` arar ve
         sunucunun köken listesi bunu vermediği için isteği bloklar — kullanıcıya
         "Failed to complete negotiation with the server: TypeError: Failed to
         fetch" olarak görünen şey buydu.

         Doğru düzeltme sunucunun CORS'unu çerezlere açmak DEĞİL, çerez
         göndermeyi kapatmaktır: bu üründe oturum bir bearer token'dır ve
         `accessTokenFactory` ile taşınır. */
      withCredentials: false,
    })
    .withAutomaticReconnect()
    .configureLogging(LogLevel.Warning)
    .build()
}

/**
 * Uygulamanın kullandığı istemci: gerçek bağlantı + Faz 3 yaşam döngüsü +
 * Faz 4A aktif keşfi.
 *
 * Keşif sinyali AYNI bağlantı üzerinden gelir; ikinci bir hub, ikinci bir
 * bağlantı ya da ayrı bir "keşif istemcisi" AÇILMAZ.
 */
export function createTransportSimulationHubClient({ onUpdate, onError, onActiveSetChanged } = {}) {
  return createTransportSimulationClient({
    createConnection: createTransportSimulationConnection,
    onUpdate,
    onError,
    onActiveSetChanged,
  })
}
