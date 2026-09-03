import { maneuverDirection, maneuverInstruction } from './journeyManeuvers.js'
import { isTerminalSimulationStatus } from './transportSimulationState.js'
import { formatRouteDistance } from './transportPathPresentation.js'

/**
 * PAYLAŞILAN hattın navigasyon SUNUMU (Faz 5).
 *
 * <b>Burada hiçbir navigasyon kararı verilmez.</b> Hangi manevrada olunduğuna,
 * ne zaman bir sonrakine geçildiğine ve sonrakine ne kadar kaldığına SUNUCU
 * karar verir; bu dosya yalnızca gelmiş olguyu Türkçeye ve okunabilir bir
 * düzene çevirir. Özellikle YAPILMAYANLAR:
 * <ul>
 *   <li>çizgi açısına, kıvrıma ya da segment vektörüne bakıp dönüş çıkarmak;</li>
 *   <li>ilerleme yüzdesinden adım ilerletmek;</li>
 *   <li>harita koordinatlarından mesafe/süre tahmin etmek;</li>
 *   <li>eksik bir manevra listesini uydurmak.</li>
 * </ul>
 * Bunlardan herhangi biri, motorun bilmediği bir gerçeği kullanıcıya
 * bildirmek olurdu — üstelik yanlış bir talimat, hiç talimat olmamasından
 * daha kötüdür.
 *
 * <b>ADIM KİMLİĞİ SIRADIR, DİZİ KONUMU DEĞİL.</b> Sunucu bir sıra numarası
 * gönderir ve adım daima o değere göre ARANIR; <code>steps[sequence]</code>
 * varsayımı, sunucu adımları farklı numaralandırdığı ya da liste süzüldüğü
 * gün sessizce yanlış talimat gösterirdi.
 *
 * <b>Kişisel yolculuktan yalnızca SAF SUNUM ödünç alınır.</b>
 * <code>journeyManeuvers</code> durumsuz bir sözlüktür: girdi manevra meta
 * verisi, çıktı metindir. İki ürünün yaşam döngüsü, durumu ve yetkileri AYRI
 * kalır — ortak olan tek şey "turn + left" ifadesinin Türkçesidir.
 */

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/**
 * Sunucudan gelen adım listesini kanonik biçime çevirir.
 *
 * Okunamayan satır DÜŞÜRÜLÜR: sırası olmayan bir adım aranamaz ve varlığı
 * yalnızca yanlış eşleşme riskidir.
 */
export function normalizeNavigationSteps(payload) {
  if (!Array.isArray(payload)) return []

  const seen = new Set()
  const steps = []

  for (const item of payload) {
    const sequence = finiteNumber(item?.sequence)
    if (sequence === null) continue
    // Sıra YOL BAŞINA tekildir; sunucu değişmezi burada da korunur.
    if (seen.has(sequence)) continue
    seen.add(sequence)

    steps.push(Object.freeze({
      sequence,
      maneuverType: typeof item?.maneuverType === 'string' ? item.maneuverType : '',
      maneuverModifier: typeof item?.maneuverModifier === 'string' ? item.maneuverModifier : null,
      name: typeof item?.name === 'string' && item.name.trim() ? item.name.trim() : null,
      distanceMeters: finiteNumber(item?.distanceMeters),
      durationSeconds: finiteNumber(item?.durationSeconds),
    }))
  }

  return steps.sort((left, right) => left.sequence - right.sequence)
}

/**
 * Adımı SIRA DEĞERİNE göre bulur.
 *
 * <b>Dizi konumu kullanılmaz.</b> Tek satırlık bir kısayol (<code>steps[n]</code>)
 * bugün doğru sonucu verse bile, sıranın dizinle eşit olduğu varsayımını
 * sessizce sözleşmeye dönüştürürdü.
 */
export function findStepBySequence(steps, sequence) {
  const target = finiteNumber(sequence)
  if (target === null || !Array.isArray(steps)) return null
  return steps.find((step) => step.sequence === target) ?? null
}

/**
 * Sıraya göre BİR SONRAKİ adım.
 *
 * Sonraki, "sequence + 1" DEĞİLDİR: sunucu numaralarda boşluk bırakabilir.
 * Aranan şey, mevcut sıradan büyük olan EN KÜÇÜK sıradır.
 */
export function findNextStep(steps, sequence) {
  const target = finiteNumber(sequence)
  if (target === null || !Array.isArray(steps)) return null

  return steps
    .filter((step) => step.sequence > target)
    .sort((left, right) => left.sequence - right.sequence)[0] ?? null
}

/* --- ÇALIŞTIRMA KİMLİĞİNE BAĞLI SAKLAMA -------------------------------------
   Adım listesi SABİTTİR ve okuma yolundan gelir; canlı akış yalnızca sırayı
   taşır. Liste bu yüzden ayrı bir kutuda tutulur — ama ÇALIŞTIRMA KİMLİĞİYLE
   birlikte: A biter ve aynı hatta B başlarsa, B'nin sırası A'nın adım
   listesinde aranırsa kullanıcıya başka bir yolculuğun talimatı gösterilirdi. */

/** Okumadan gelen navigasyonu kimlik damgasıyla yazar. */
export function applyNavigationSnapshot(navigationByRoute = {}, snapshot = null) {
  const routeId = finiteNumber(snapshot?.routeId)
  const simulationId = snapshot?.simulationId ?? null

  if (routeId === null || !simulationId) return navigationByRoute

  return {
    ...navigationByRoute,
    [routeId]: Object.freeze({
      simulationId,
      /* "Adım var mı" sorusunun cevabı listenin uzunluğu DEĞİLDİR: keşif
         listesi hattı taşırken adımları bilinçle boş bırakır. Sunucu bu yüzden
         ayrı bir olgu gönderir ve burada olduğu gibi saklanır. */
      hasSteps: snapshot?.hasNavigationSteps === true,
      steps: Object.freeze(normalizeNavigationSteps(snapshot?.navigationSteps)),
    }),
  }
}

/**
 * Navigasyon kayıtlarını SUNUCU GERÇEĞİYLE uzlaştırır.
 *
 * İzleme ve yönetim seçimiyle AYNI iki kural: çalıştırma artık aktif değilse
 * ya da hattaki çalıştırma DEĞİŞTİYSE kayıt düşer. Yerine geçen B, A'nın adım
 * listesini DEVRALMAZ.
 */
export function reconcileNavigation(navigationByRoute = {}, byRoute = {}) {
  const next = {}
  let changed = false

  for (const key of Object.keys(navigationByRoute)) {
    const routeId = finiteNumber(key)
    const entry = navigationByRoute[key]
    const state = routeId === null ? null : byRoute[routeId] ?? null

    /* İKİ koşul birden aranır ve ikincisi ATLANMAMALIDIR: çalıştırma hâlâ
       AKTİF olmalı VE kimlik tutmalıdır. Yalnızca kimliğe bakmak, sıfırlanmış
       (terminal) bir çalıştırmanın adım listesini bellekte tutardı — izleme ve
       yönetim seçimi zaten aynı iki koşulu arar; navigasyonun onlardan farklı
       davranması, aynı uzlaştırma ilkesinin ikinci bir tanımı olurdu. */
    if (state && entry && !isTerminalSimulationStatus(state.status)
      && state.simulationId === entry.simulationId) {
      next[routeId] = entry
    } else {
      changed = true
    }
  }

  return changed ? next : navigationByRoute
}

/* --- SUNUM ------------------------------------------------------------------- */

/** Mesafe cümlesi: "280 m sonra". Değer SUNUCUDAN gelir. */
function distanceLead(distanceMeters) {
  const meters = finiteNumber(distanceMeters)
  if (meters === null || meters < 0) return null
  return `${formatRouteDistance(meters)} sonra`
}

function toRow(step, lead) {
  if (!step) return null

  return Object.freeze({
    sequence: step.sequence,
    /* Metin, mevcut ve SAF manevra sözlüğünden gelir. Ham motor değeri
       (`turn_right`, `slight left`, `roundabout`) kullanıcıya ASLA
       gösterilmez. */
    instruction: maneuverInstruction(step),
    direction: maneuverDirection(step),
    name: step.name,
    /* Yön ipucu ikon/etiket içindir; ham değil, sınıflandırılmıştır. */
    text: lead ? `${lead} ${maneuverInstruction(step).toLocaleLowerCase('tr')}` : maneuverInstruction(step),
  })
}

/** Navigasyon verisi olmayan hat için tek ve SAKİN cümle. */
export const NAVIGATION_UNAVAILABLE_TEXT = 'Navigasyon adımları bu rota için mevcut değil.'

/**
 * SEÇİLİ hattın navigasyon bölümü.
 *
 * <b>Navigasyon SEÇİLİ bağlama aittir.</b> İzlemek (haritada araç), takip
 * etmek (kamera) ve yönetim seçimi (komut hedefi) bu bölümü ne açar ne kapatır;
 * hangi hattın ayrıntısına bakıldığı tek belirleyicidir.
 *
 * <b>Üç durum AÇIKÇA ayrılır</b> ve hiçbiri diğerinin yerine geçmez:
 * çalıştırma yok, manevra yok, manevra var.
 */
export function sharedNavigationPresentation({
  routeId = null,
  simulation = null,
  navigation = null,
} = {}) {
  const id = finiteNumber(routeId)
  if (id === null) return null

  // Çalıştırma seçili hatta ait değilse navigasyon da yoktur.
  if (!simulation || simulation.routeId !== id) return null

  /* KAYIT ÇALIŞTIRMAYA BAĞLIDIR. Kimlik tutmuyorsa liste bayattır ve
     KULLANILMAZ: yerine geçmiş bir çalıştırmanın sırasını eski listede aramak,
     başka bir yolculuğun talimatını göstermek olurdu. */
  const entry = navigation && navigation.simulationId === simulation.simulationId
    ? navigation
    : null

  const steps = entry?.steps ?? []
  const available = steps.length > 0

  if (!available) {
    return Object.freeze({
      routeId: id,
      simulationId: simulation.simulationId,
      available: false,
      /* Manevrası olmayan bir hat NORMALDİR; altyapı hatası DEĞİLDİR ve öyle
         sunulmaz. Liste henüz okunmadıysa da aynı sakin cümle gösterilir —
         yarım bir gerçek uydurulmaz. */
      message: NAVIGATION_UNAVAILABLE_TEXT,
      current: null,
      next: null,
    })
  }

  /* SIRA SUNUCUDAN gelir ve adım ona göre ARANIR. */
  const current = findStepBySequence(steps, simulation.currentStepSequence)
  const next = current ? findNextStep(steps, current.sequence) : null

  return Object.freeze({
    routeId: id,
    simulationId: simulation.simulationId,
    available: true,
    message: '',
    current: toRow(current, null),
    /* Sonraki manevraya kalan mesafe de SUNUCUNUNDUR; burada yalnızca
       biçimlendirilir. Değer yoksa (varış) cümle mesafesiz kalır. */
    next: toRow(next, distanceLead(simulation.distanceToNextManeuverMeters)),
  })
}
