import { authFetch } from './api.js'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export function fetchTransportRoutes() {
  return authFetch('/api/transport/routes')
}

export function fetchTransportRouteStops(routeId) {
  return authFetch(`/api/transport/routes/${routeId}/stops`)
}

export function fetchTransportStops() {
  return authFetch('/api/transport/stops')
}

export function fetchDeletedManagedTransportStops() {
  return authFetch('/api/transport/stops/deleted')
}

export function fetchTransportRoutePath(routeId) {
  return authFetch(`/api/transport/routes/${routeId}/path`)
}

export function fetchTransportRoutePaths() {
  return authFetch('/api/transport/routes/paths')
}

export function generateTransportRoutePath(routeId) {
  return authFetch(`/api/transport/routes/${routeId}/path/generate`, { method: 'POST' })
}

export function fetchOwnTransportStops() {
  return authFetch('/api/transport/stops/mine')
}

export function fetchDeletedTransportStops() {
  return authFetch('/api/transport/stops/trash')
}

export function fetchDeletedTransportRoutes() {
  return authFetch('/api/transport/routes/trash')
}

export function createTransportRoute({ name, colorHex }) {
  return authFetch('/api/transport/routes', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, colorHex }),
  })
}

export function updateTransportRoute(id, { name, colorHex }) {
  return authFetch(`/api/transport/routes/${id}`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, colorHex }),
  })
}

export function deleteTransportRoute(id) {
  return authFetch(`/api/transport/routes/${id}`, { method: 'DELETE' })
}

export function reorderTransportRouteStops(routeId, stopIds) {
  return authFetch(`/api/transport/routes/${routeId}/stops/order`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ stopIds }),
  })
}

export function createTransportStop({ name, routeId, longitude, latitude }) {
  return authFetch('/api/transport/stops', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, routeId, longitude, latitude }),
  })
}

export function updateTransportStop(id, { name, routeId, longitude, latitude }) {
  return authFetch(`/api/transport/stops/${id}`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, routeId, longitude, latitude }),
  })
}

export function deleteTransportStop(id) {
  return authFetch(`/api/transport/stops/${id}`, { method: 'DELETE' })
}

export function restoreTransportStop(id) {
  return authFetch(`/api/transport/stops/${id}/restore`, { method: 'POST' })
}

export function restoreTransportRoute(id) {
  return authFetch(`/api/transport/routes/${id}/restore`, { method: 'POST' })
}

/* --- Simülasyon ---------------------------------------------------------------
   Ayrı bir API katmanı AÇILMAZ: aynı authFetch, aynı hata okuma ve aynı 401/403
   davranışı geçerlidir. Canlı yayın SignalR üzerinden gelir; buradaki iki uç
   "şu an ne oluyor" sorusunun REST karşılığıdır ve sayfa açılışında (rota
   zaten çalışıyor olabilir) tek doğru kaynaktır. */

/** Seçili güzergah için simülasyon başlatır. Yetki: `transport.simulation.start`. */
export function startTransportSimulation(routeId) {
  return authFetch(`/api/transport/simulations/routes/${routeId}/start`, { method: 'POST' })
}

/** Güzergahın çalışan simülasyonunun sunucu otoriteli anlık görüntüsü (yoksa 404). */
export function fetchTransportSimulation(routeId) {
  return authFetch(`/api/transport/simulations/routes/${routeId}`)
}

/**
 * O anda AKTİF olan TÜM paylaşılan çalıştırmalar. Yetki: `transport.view`.
 *
 * <b>Neden tek bir uç.</b> Aktif kümeyi her rotayı tek tek sorarak çıkarmak,
 * hat sayısıyla doğru orantılı bir istek yağmuru ve "hangi hat vardı"
 * bilgisinin tarayıcıda kurulması demekti. Küme sunucunun bildiği bir OLGUDUR
 * ve tek okumayla gelir.
 *
 * <b>OKUMA yetkisidir.</b> Çalışan hatları görmek, onları başlatabilmek ya da
 * durdurabilmekle aynı yetenek değildir; bu uç yaşam döngüsü yetkisi İSTEMEZ.
 *
 * <b>Yoklama YOKTUR.</b> Bu uç yalnızca İKİ nedenle çağrılır: açılışta bir kez
 * ve keşif sinyali "aktif küme değişmiş olabilir" dediğinde. Zamanlayıcıyla
 * tekrar çağrılmaz — ilerleme ve durum mevcut SignalR akışından gelir.
 */
export function fetchActiveTransportSimulations({ signal } = {}) {
  return authFetch('/api/transport/simulations/active', { signal })
}

/**
 * PAYLAŞILAN bir hattın BELİRLİ çalıştırmasını herkes için durdurur.
 * Yetki: `transport.simulation.stop`.
 *
 * <b>İki kimlik de zorunludur ve bu yalnızca bir doğrulama değildir.</b>
 * Yalnızca rota göndermek "şu hatta ne çalışıyorsa durdur" demek olurdu: A
 * çalıştırması bitip yerine B başladıysa, hâlâ A'yı gösteren eski bir sekme
 * B'yi — başka kullanıcıların canlı izlediği çalıştırmayı — durdururdu. Sunucu
 * kimliği doğrulayamazsa komutu REDDEDER; tarayıcı "en güncel olanı durdur"
 * diyemez.
 *
 * Yanıt, gözlemcilere yayınlanan OTORİTER terminal güncellemenin aynısıdır;
 * istemci terminal durumu yerel olarak UYDURMAZ.
 */
/**
 * Çalışan hattı DURAKLATIR. Terminal DEĞİLDİR; aynı çalıştırma sürdürülebilir.
 * Yetki: `transport.simulation.stop` (yaşam döngüsü otoritesi).
 */
export function pauseTransportSimulation(routeId, simulationId, { signal } = {}) {
  return authFetch(
    `/api/transport/simulations/routes/${routeId}/${simulationId}/pause`,
    { method: 'POST', signal },
  )
}

/** Duraklatılmış hattı KALDIĞI YERDEN sürdürür. Yeni çalıştırma BAŞLATMAZ. */
export function resumeTransportSimulation(routeId, simulationId, { signal } = {}) {
  return authFetch(
    `/api/transport/simulations/routes/${routeId}/${simulationId}/resume`,
    { method: 'POST', signal },
  )
}

export function stopTransportSimulation(routeId, simulationId, { signal } = {}) {
  return authFetch(
    `/api/transport/simulations/routes/${routeId}/${simulationId}/stop`,
    { method: 'POST', signal },
  )
}

/* --- Toplu yaşam döngüsü (Faz 4B) ---------------------------------------------
   Ayrı bir API katmanı, ikinci bir fetch sarmalayıcı ya da ikinci bir hata
   okuyucu AÇILMAZ: aynı authFetch, aynı Authorization başlığı, aynı 401/403
   davranışı.

   HEDEFLER İKİ KİMLİĞİ BİRDEN TAŞIR. Yalnızca rota göndermek "şu hatlarda ne
   çalışıyorsa onlara uygula" demek olurdu; toplu olmak bu zorunluluğu
   gevşetmez — tersine, tek bir istekle birden çok yayını etkilediği için daha
   da bağlayıcı kılar.

   Komutlar HTTP'dir; sonuç ve ilerleme mevcut SignalR akışından gelir. Yeni
   bir hub, yeni bir bağlantı ya da yoklama YOKTUR. */

function batchLifecycle(action, targets, { signal } = {}) {
  return authFetch(`/api/transport/simulations/batch/${action}`, {
    method: 'POST',
    headers: JSON_HEADERS,
    /* Gövde YALNIZCA seçimi taşır: durum, ilerleme ya da "hangi komut geçerli"
       kararı GÖNDERİLMEZ — sunucu onları kendi otoriter durumundan çözer. */
    body: JSON.stringify({ targets }),
    signal,
  })
}

/** Seçili çalıştırmaları duraklatır. Yetki: `transport.simulation.stop`. */
export function pauseTransportSimulations(targets, options) {
  return batchLifecycle('pause', targets, options)
}

/** Seçili çalıştırmaları kaldıkları yerden sürdürür. */
export function resumeTransportSimulations(targets, options) {
  return batchLifecycle('resume', targets, options)
}

/** Seçili çalıştırmaları sonlandırır; yerlerine yenisi KONMAZ. */
export function resetTransportSimulations(targets, options) {
  return batchLifecycle('reset', targets, options)
}

/**
 * Seçili çalıştırmaları sonlandırır ve her biri için %0'dan YENİ bir
 * çalıştırma başlatır.
 *
 * <b>Tarayıcı "önce sıfırla, sonra başlat" YAPMAZ.</b> İki istek arasında hat
 * bir an boş kalır ve başka bir kullanıcının başlatması yuvayı kapabilirdi;
 * değiştirme sunucuda TEK atomik adımdır.
 *
 * Yetki İKİ koddur: `transport.simulation.stop` VE
 * `transport.simulation.start`.
 */
export function restartTransportSimulations(targets, options) {
  return batchLifecycle('restart', targets, options)
}

/* --- Yolculuk planlama (Faz 5B önizleme ucu) ----------------------------------
   Ayrı bir API katmanı ya da ikinci bir token deposu AÇILMAZ: aynı authFetch,
   aynı Authorization başlığı, aynı 401/403 davranışı ve aynı hata okuma
   geçerlidir.

   İSTEK YALNIZCA SEÇİM TAŞIR. Geometri, koordinat, PlanId ya da herhangi bir
   yönlendirme verisi gönderilmez; sunucu geçiş noktalarını kendi verisinden
   çözer ve güzergahı kendisi hesaplar. Tarayıcı OSRM'e hiçbir biçimde
   bağlanmaz — bu uç, yönlendirme motorunun bilindiği TEK sınırdır. */

/**
 * Bir yolculuk planını doğrular ve gerçek güzergah önizlemesini döndürür.
 *
 * Yetki: `transport.view`; istek POI referansı taşıyorsa sunucu ayrıca
 * `poi.view` arar. Uç hiçbir şey YAZMAZ ve simülasyon başlatmaz.
 *
 * `signal` çağıran tarafından daima verilir: eski bir planın geç gelen
 * cevabı, yenisinin sonucunu EZMEMELİDİR.
 */
export function previewJourney(request, { signal } = {}) {
  return authFetch('/api/transport/journeys/preview', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(request),
    signal,
  })
}

/* --- Kişisel yolculuk simülasyonu (Faz 5D) ------------------------------------
   GÜVEN SINIRI: gövde YALNIZCA yolculuk niyetidir — önizlemenin planId'si,
   geometrisi, mesafesi, süresi ya da manevraları GÖNDERİLMEZ. Sunucu yolculuğu
   kendi verisinden yeniden planlar; önizleme tavsiye niteliğinde arayüz
   verisidir ve hiçbir yetki taşımaz.

   Aynı authFetch, aynı Authorization başlığı, aynı 401/403 davranışı. */

/**
 * Yolculuk niyetinden sunucuya ait bir simülasyon başlatır.
 *
 * Dönen yanıt istemcinin YENİ gerçeğidir: geometri ve ölçümler önizlemedekinden
 * farklı olabilir ve farklı olması beklenen bir sonuçtur.
 */
export function startJourneySimulation(intent, { signal } = {}) {
  return authFetch('/api/transport/journeys/simulations', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(intent),
    signal,
  })
}

/** Çağıranın KENDİ aktif yolculuğu (yoksa 404). Yenileme sonrası kurtarma yolu. */
export function fetchCurrentJourneySimulation({ signal } = {}) {
  return authFetch('/api/transport/journeys/simulations/current', { signal })
}

/** Çağıranın kendi çalıştırmasını durdurur. */
export function stopJourneySimulation(simulationId, { signal } = {}) {
  return authFetch(`/api/transport/journeys/simulations/${simulationId}/stop`, {
    method: 'POST',
    signal,
  })
}

/* --- Kaydedilmiş kişisel yolculuklar (Faz 7) ----------------------------------
   Sahibine ÖZEL yolculuk TANIMLARI. Aynı authFetch, aynı Authorization
   başlığı, aynı 401/403 davranışı; ikinci bir API katmanı ya da ikinci bir
   token deposu AÇILMAZ.

   Bu uçlar SIRADAN REST'tir: burada SignalR yoktur, canlı kanal yoktur ve
   hiçbir zamanlayıcı kurulmaz. Kaydedilmiş bir yolculuk canlı bir simülasyon
   DEĞİLDİR.

   Sahip kimliği HİÇBİR istekte taşınmaz: sunucu onu doğrulanmış JWT'den okur.
   Yol üzerinde bir kullanıcı kimliği göndermek, tahminle başkasının kaydına
   açılan bir kapı olurdu. */

/** Çağıranın KENDİ kayıtları; hafif liste (geometri/manevra taşımaz). */
export function fetchSavedJourneys({ signal } = {}) {
  return authFetch('/api/transport/journeys/saved', { signal })
}

/** Tek bir kaydın tam tanımı; başkasınınki için 404. */
export function fetchSavedJourney(savedJourneyId, { signal } = {}) {
  return authFetch(`/api/transport/journeys/saved/${savedJourneyId}`, { signal })
}

/**
 * Planlanan yolculuğu bir TANIM olarak kaydeder.
 *
 * Gövde, önizleme/başlatma ile AYNI niyet sözleşmesini taşır; simülasyon
 * kimliği, geometri ya da ölçüm GÖNDERİLMEZ. Kaydetmek bir simülasyon
 * BAŞLATMAZ.
 */
export function createSavedJourney({ name, isFavorite = false, journey }, { signal } = {}) {
  return authFetch('/api/transport/journeys/saved', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, isFavorite, journey }),
    signal,
  })
}

/**
 * Ad ve/veya yıldızı günceller.
 *
 * Gönderilmeyen alan DEĞİŞMEZ; yıldız düğmesi bu yüzden adı taşımak zorunda
 * kalmaz. Yıldız DEĞER olarak gönderilir, "tersine çevir" olarak değil.
 */
export function updateSavedJourney(savedJourneyId, { name, isFavorite } = {}, { signal } = {}) {
  const body = {}
  if (name !== undefined) body.name = name
  if (isFavorite !== undefined) body.isFavorite = isFavorite

  return authFetch(`/api/transport/journeys/saved/${savedJourneyId}`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
    signal,
  })
}

/** Kaydı kalıcı olarak siler; çalışan bir yolculuğa dokunmaz. */
export function deleteSavedJourney(savedJourneyId, { signal } = {}) {
  return authFetch(`/api/transport/journeys/saved/${savedJourneyId}`, {
    method: 'DELETE',
    signal,
  })
}

/**
 * Kayıttan YENİ bir kişisel simülasyon başlatır.
 *
 * Eski çalıştırma DİRİLTİLMEZ: yanıt her çağrıda yeni bir `simulationId` taşır
 * ve güzergah kayıtlı bir geometriden okunmaz, sunucuda yeniden hesaplanır.
 */
export function reuseSavedJourney(savedJourneyId, { signal } = {}) {
  return authFetch(`/api/transport/journeys/saved/${savedJourneyId}/reuse`, {
    method: 'POST',
    signal,
  })
}

/* --- Kişisel yolculuk geçmişi (Faz 8) -----------------------------------------
   SONA ERMİŞ çalıştırmaların değişmez tutanağı. Aynı authFetch, aynı
   Authorization başlığı, aynı 401/403 davranışı.

   OLUŞTURMA UCU YOKTUR ve olmamalıdır: "bu yolculuğu yaptım" iddiası
   tarayıcıdan kabul edilmez. Tutanağın tek kaynağı sunucunun kendi terminal
   geçişidir; istemci onu yalnızca OKUR.

   DEĞİŞTİRME ve SİLME de yoktur: geçmiş adlandırılamaz, düzenlenemez,
   favorilenemez. Kullanıcının kendi tanımlarını adlandırdığı ürün ayrıdır
   (`/saved`) ve iki kavram bilinçle karıştırılmaz.

   Burada SignalR yoktur ve hiçbir zamanlayıcı kurulmaz: kaydedilmiş bir
   tutanak canlı bir simülasyon DEĞİLDİR. */

/**
 * Çağıranın KENDİ geçmişinin bir sayfası; en son biten en üstte.
 *
 * Sayfalama isteğe bağlı değildir: kullanıcı sınırlı sayıda tanım saklar ama
 * sınırsız sayıda yolculuk yapar.
 */
export function fetchJourneyHistory({ page, pageSize, status } = {}, { signal } = {}) {
  const query = new URLSearchParams()
  if (page != null) query.set('page', String(page))
  if (pageSize != null) query.set('pageSize', String(pageSize))
  // Boş süzgeç GÖNDERİLMEZ: sunucu bilinmeyen bir durumu reddeder.
  if (status) query.set('status', status)

  const suffix = query.toString()
  return authFetch(`/api/transport/journeys/history${suffix ? `?${suffix}` : ''}`, { signal })
}

/** Tek bir kaydın değişmez ayrıntısı; başkasınınki için 404. */
export function fetchJourneyHistoryDetail(journeyHistoryId, { signal } = {}) {
  return authFetch(`/api/transport/journeys/history/${journeyHistoryId}`, { signal })
}

/**
 * Geçmişteki yolculuğu YENİDEN yapar: yeni bir kişisel simülasyon başlatır.
 *
 * Eski çalıştırma DİRİLTİLMEZ: istek yalnızca KAYDIN kimliğini taşır, tarihsel
 * `simulationId` gönderilmez ve yanıt her çağrıda yeni bir kimlik döndürür.
 * Güzergah da kayıtlı bir geometriden okunmaz, sunucuda yeniden hesaplanır.
 */
export function reuseJourneyHistory(journeyHistoryId, { signal } = {}) {
  return authFetch(`/api/transport/journeys/history/${journeyHistoryId}/reuse`, {
    method: 'POST',
    signal,
  })
}
