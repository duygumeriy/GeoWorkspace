import { journeyStepList } from './journeyManeuvers.js'

/**
 * Adım adım yönlendirmenin SAF sunum modeli.
 *
 * <b>Tarayıcı manevra ÜRETMEZ.</b> Adımlar sunucunun benimsenmiş yolculuk
 * ayrıntılarından gelir, sırası olduğu gibi korunur ve "şu an neredeyiz"
 * sorusunu yine sunucu cevaplar (`currentStepSequence`). Yüzdeye bakıp adım
 * tahmin etmek, sunucunun bildiği gerçeği tarayıcıda yeniden uydurmak olurdu.
 *
 * <b>Panel ve balon AYNI modeli okur.</b> İki ayrı "şu anki adım" hesabı,
 * zamanla iki farklı talimat göstermek demekti.
 *
 * <b>Eksik veri bir HATA DEĞİLDİR.</b> Kalıcı güzergahı yeniden kullanan bir
 * tam-hat yolculuğunda adım listesi yoktur; anlık görüntü henüz gelmemişken de
 * güncel adım bilinmez. İkisi de sessizce boş modele düşer.
 */

/** Adımın yolculuk içindeki durumu — yalnızca sunum içindir. */
export const JOURNEY_STEP_STATES = Object.freeze({
  DONE: 'done',
  CURRENT: 'current',
  UPCOMING: 'upcoming',
})

const EMPTY = Object.freeze({
  steps: Object.freeze([]),
  current: null,
  next: null,
  hasSteps: false,
})

/**
 * Sunucunun adım listesi + güncel sıra numarasından gezinme modeli.
 *
 * <b>Eşleşme SIRA NUMARASIYLA yapılır, dizinle değil.</b> Sunucu sequence'ı
 * kanonik kimliktir; dizine güvenmek, listenin başı kırpıldığında yanlış
 * talimatı "şu an" diye göstermek olurdu.
 *
 * @param {{ steps?: unknown, currentStepSequence?: unknown }} [input]
 * @returns {{ steps: ReadonlyArray<object>, current: object|null, next: object|null, hasSteps: boolean }}
 */
export function journeyNavigationModel({ steps, currentStepSequence } = {}) {
  const list = journeyStepList(steps)
  if (list.length === 0) return EMPTY

  /* Bilinmeyen ya da listede olmayan bir sıra numarası GEÇERLİDİR: güncel adım
     yoktur, uydurulmaz. Hepsi "sırada" olarak gösterilir. */
  const currentIndex = Number.isInteger(currentStepSequence)
    ? list.findIndex((step) => step.sequence === currentStepSequence)
    : -1

  const stateOf = (index) => {
    if (currentIndex < 0) return JOURNEY_STEP_STATES.UPCOMING
    if (index < currentIndex) return JOURNEY_STEP_STATES.DONE
    if (index === currentIndex) return JOURNEY_STEP_STATES.CURRENT
    return JOURNEY_STEP_STATES.UPCOMING
  }

  return {
    steps: list.map((step, index) => ({ ...step, state: stateOf(index) })),
    current: currentIndex >= 0 ? list[currentIndex] : null,
    // Son adımda sıradaki YOKTUR; varış sonrası bir talimat uydurulmaz.
    next: currentIndex >= 0 && currentIndex + 1 < list.length ? list[currentIndex + 1] : null,
    hasSteps: true,
  }
}

/**
 * Bir adımın KENDİ uzunluğu.
 *
 * <b>"Kalan mesafe" DEĞİLDİR</b> ve öyle etiketlenmez: sunucu adım başına
 * kalan mesafe bildirmez, dolayısıyla "250 m sonra dönün" demek bir uydurma
 * olurdu. Değer, manevranın kapsadığı yol parçasının uzunluğudur.
 */
export function journeyStepDistanceLabel(step) {
  const metres = step?.distanceMeters
  if (!Number.isFinite(metres) || metres < 0) return null
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`
}
