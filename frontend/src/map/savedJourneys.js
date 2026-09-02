/**
 * Kaydedilmiş kişisel yolculukların SAF çekirdeği: ad doğrulaması, liste
 * sunumu, hata metinleri ve kaydın planlayıcı taslağına çevrimi.
 *
 * <b>Neden React'ten ayrı.</b> Bunların hiçbiri bir DOM'a ihtiyaç duymaz;
 * bileşenin içine gömülselerdi ne testten ne gözden geçirmeden geçerlerdi.
 * Kanca (`useSavedJourneys`) yalnızca bu kuralları REST yaşam döngüsüne bağlar.
 *
 * <b>Kaydedilen şey NİYETTİR.</b> Burada hiçbir çalıştırma kimliği, ilerleme,
 * konum, geometri ya da süre üretilmez ve taşınmaz — kaydedilmiş bir yolculuk
 * canlı bir simülasyon DEĞİLDİR ve canlı durumla aynı yerde yaşamaz.
 */

import { formatDateTime } from './datetime.js'
import {
  DEFAULT_JOURNEY_PROFILE,
  JOURNEY_MODES,
  JOURNEY_PROFILE_IDS,
  WAYPOINT_SOURCES,
  createWaypointSlot,
  waypointReference,
} from './journeyPlanning.js'
import { journeyProfileLabel } from './journeyPresentation.js'

/** Backend `SavedJourney.MaxNameLength` ile aynı sınır. */
export const MAX_SAVED_JOURNEY_NAME_LENGTH = 120

const MODE_LABELS = Object.freeze({
  [JOURNEY_MODES.ROUTE_FULL]: 'Hat',
  [JOURNEY_MODES.ROUTE_SEGMENT]: 'Hat Bölümü',
  [JOURNEY_MODES.WAYPOINTS]: 'Serbest',
})

export function savedJourneyModeLabel(mode) {
  return MODE_LABELS[mode] ?? '—'
}

export const SAVED_JOURNEY_MESSAGES = Object.freeze({
  nameRequired: 'Yolculuk için bir ad girin.',
  nameTooLong: `Yolculuk adı en fazla ${MAX_SAVED_JOURNEY_NAME_LENGTH} karakter olabilir.`,
  notFound: 'Kaydedilen yolculuk bulunamadı.',
  loadFailed: 'Kaydedilen yolculuklar yüklenemedi. Lütfen tekrar deneyin.',
  saveFailed: 'Yolculuk kaydedilemedi. Lütfen tekrar deneyin.',
  reuseFailed: 'Bu yolculuk yeniden oluşturulamadı.',
  forbidden: 'Bu işlem için yetkiniz bulunmuyor.',
  empty: 'Henüz kaydedilmiş bir yolculuğunuz yok.',
})

/**
 * Ad doğrulaması — backend ile AYNI kural, ondan önce.
 *
 * Bağlayıcı denetim sunucudadır; buradaki amaç garanti 400 alacak bir isteği
 * yola çıkarmamaktır.
 */
export function validateSavedJourneyName(value) {
  const name = typeof value === 'string' ? value.trim() : ''

  if (name.length === 0) return { ok: false, error: SAVED_JOURNEY_MESSAGES.nameRequired }
  if (name.length > MAX_SAVED_JOURNEY_NAME_LENGTH) {
    return { ok: false, error: SAVED_JOURNEY_MESSAGES.nameTooLong }
  }

  return { ok: true, name }
}

/**
 * HTTP durumunu ve sunucunun GÜVENLİ mesajını kullanıcı metnine çevirir.
 *
 * <b>Ham gövde asla doğrudan gösterilmez.</b> 400 ve 404 kullanıcının kendi
 * kaydıyla ilgilidir ve sunucunun Türkçe metni orada en yararlı olandır
 * ("… adlı POI artık mevcut değil"); diğer sınıflarda sabit metin kullanılır ki
 * altyapı terimleri hiçbir yoldan sızmasın.
 */
export function savedJourneyErrorMessage(status, serverMessage = '', fallback = '') {
  const safe = typeof serverMessage === 'string' ? serverMessage.trim() : ''
  const unknown = fallback || SAVED_JOURNEY_MESSAGES.reuseFailed

  if (status === 403) return SAVED_JOURNEY_MESSAGES.forbidden
  if (status === 404) return safe || SAVED_JOURNEY_MESSAGES.notFound
  if (status === 400 || status === 409) return safe || unknown

  return unknown
}

/**
 * Liste satırının SUNUM modeli.
 *
 * Hiçbir ölçüm hesaplanmaz ve hiçbir güzergah çizilmez: satır yalnızca kaydın
 * kimliğini, adını, türünü ve uçlarını okutur.
 */
export function savedJourneySummary(row) {
  if (!row || row.id == null) return null

  const profileId = JOURNEY_PROFILE_IDS.includes(row.profile) ? row.profile : null

  /* Uç adları KAYDETME ANINDAKİ kopyalardır ve otorite değildir; kayıt
     yeniden kullanıldığında adı da konumu da sunucu tazeler. */
  const origin = row.originName || null
  const destination = row.destinationName || null

  return Object.freeze({
    id: Number(row.id),
    name: row.name ?? '',
    mode: row.mode ?? null,
    modeLabel: savedJourneyModeLabel(row.mode),
    profileId,
    // Profil METİNLE gösterilir; yalnız ikon, ekran okuyucuya hiçbir şey söylemez.
    profileLabel: profileId ? journeyProfileLabel(profileId) : '—',
    isFavorite: Boolean(row.isFavorite),
    routeName: row.routeDisplayName || null,
    pointCount: Number.isFinite(row.pointCount) ? row.pointCount : 0,
    originName: origin,
    destinationName: destination,
    /* Uç özeti YOKSA uydurulmaz: tam-hat kaydında nokta saklanmaz ve o
       kaydın özeti hattın kendisidir. */
    endpointsLabel: origin && destination ? `${origin} → ${destination}` : (row.routeDisplayName || ''),
    modifiedLabel: formatDateTime(row.modifiedDate),
  })
}

export function savedJourneyList(rows) {
  /* Sıra SUNUCUNUNDUR (önce favoriler, sonra en son değişen) ve tarayıcıda
     yeniden sıralanmaz: iki farklı sıralama kuralı, aynı listenin iki farklı
     görünümü demekti. */
  return (Array.isArray(rows) ? rows : []).map(savedJourneySummary).filter(Boolean)
}

/**
 * Bir eylemin hedefini, listenin O ANKİ hâlinden DONDURUR.
 *
 * <b>Bayat niyete karşı koruma.</b> "A seçildi → onay açıldı → B seçildi →
 * onaylandı" dizisinde eylem hâlâ A'ya uygulanmalıdır. Diyalog çözüldüğünde
 * listedeki seçime bakan bir kod, kullanıcının bakmadığı bir kaydı silerdi.
 * Bu yüzden hedef bir KOPYADIR: sonradan liste değişse, satır yenilense ya da
 * kayıt listeden düşse bile taşıdığı kimlik aynı kalır.
 *
 * Aynı ilke projede başka yerlerde de uygulanır; burada yalnızca kaydedilmiş
 * yolculuklar için tekrarlanır.
 */
export function savedJourneyTarget(items, savedJourneyId) {
  if (savedJourneyId == null) return null

  const id = Number(savedJourneyId)
  const match = (Array.isArray(items) ? items : []).find((item) => item?.id === id)

  if (!match) return null

  return Object.freeze({ id, name: match.name ?? '' })
}

/**
 * Kaydedilmiş bir yolculuğu PLANLAYICI TASLAĞINA çevirir.
 *
 * <b>Bu bir başlatma DEĞİLDİR.</b> Yalnızca formu doldurur: hiçbir simülasyon
 * kurulmaz, hiçbir kanal açılmaz ve harita takibi değişmez. Kullanıcı yüklenen
 * yolculuğu inceleyip sonra açıkça başlatır.
 *
 * Yuvalar YENİ anahtarlarla kurulur: eski taslağın anahtarlarını devralmak,
 * silahlı bir yuvanın kazara yeni listede yaşamaya devam etmesi demekti.
 */
export function savedJourneyDraft(saved) {
  if (!saved || saved.id == null) return null

  const mode = Object.values(JOURNEY_MODES).includes(saved.mode) ? saved.mode : null
  if (!mode) return null

  const profile = JOURNEY_PROFILE_IDS.includes(saved.profile) ? saved.profile : DEFAULT_JOURNEY_PROFILE
  const points = Array.isArray(saved.points) ? [...saved.points].sort((a, b) => a.sequence - b.sequence) : []

  if (mode === JOURNEY_MODES.ROUTE_FULL) {
    return { mode, profile, routeId: saved.routeId ?? null, fromStopId: null, toStopId: null, waypoints: null }
  }

  if (mode === JOURNEY_MODES.ROUTE_SEGMENT) {
    if (points.length !== 2) return null
    return {
      mode,
      profile,
      routeId: saved.routeId ?? null,
      fromStopId: Number(points[0].referenceId),
      toStopId: Number(points[1].referenceId),
      waypoints: null,
    }
  }

  if (points.length < 2) return null

  return {
    mode,
    profile,
    routeId: null,
    fromStopId: null,
    toStopId: null,
    waypoints: points.map((point) => createWaypointSlot(waypointReference({
      source: point.source === WAYPOINT_SOURCES.POI ? WAYPOINT_SOURCES.POI : WAYPOINT_SOURCES.STOP,
      id: point.referenceId,
      /* Etiket YALNIZCA ekranda gösterilir ve isteğe hiç girmez; sunucu
         noktayı kimliğinden çözer. */
      label: point.displayName ?? '',
    }))),
  }
}
