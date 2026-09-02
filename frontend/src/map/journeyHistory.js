/**
 * Kişisel yolculuk GEÇMİŞİNİN saf çekirdeği: sunum modeli, durum etiketleri,
 * hata metinleri ve tutanağın planlayıcı taslağına çevrimi.
 *
 * <b>Kaydedilmiş yolculuklarla (Faz 7) KARIŞTIRILMAMALIDIR.</b> Orası yeniden
 * kullanılabilir bir NİYETTİR: kullanıcı adlandırır, yeniden adlandırır, siler.
 * Burası olmuş bir şeyin tutanağıdır ve değiştirilemez — bu modülde ad
 * doğrulaması, favori ya da silme kuralı YOKTUR ve olmamalıdır.
 *
 * <b>Hiçbir ölçüm burada HESAPLANMAZ.</b> Mesafe ve süre sunucudan geldiği gibi
 * biçimlendirilir; tarayıcıda ikinci bir süre tahmini ya da yüzde üretilmez.
 * Biçimlendirme mevcut ulaşım yardımcılarını yeniden kullanır: aynı uygulamada
 * iki farklı mesafe/süre dili olmamalıdır.
 *
 * <b>Gösterim TARİHSELDİR.</b> Adlar tutanağın kendi kopyalarından okunur;
 * geçmişi çizmek için hiçbir canlı POI/durak/hat kaydına gidilmez.
 */

import { formatDateTime } from './datetime.js'
import {
  JOURNEY_PROFILE_IDS,
  journeyDraftFromDefinition,
  journeyModeLabel,
} from './journeyPlanning.js'
import { journeyProfileLabel } from './journeyPresentation.js'
import { JOURNEY_SIMULATION_STATUS } from './journeySimulationState.js'
import { formatRouteDistance, formatRouteDuration } from './transportPathPresentation.js'

/**
 * Geçmişte YALNIZCA terminal durumlar bulunur.
 *
 * Değerler canlı sözleşmenin kendi adlarıdır (`JOURNEY_SIMULATION_STATUS`);
 * geçmiş için ikinci bir durum dili uydurmak, aynı olguyu iki kelimeyle
 * anlatmak olurdu. <code>Running</code> bilinçle DIŞARIDADIR: çalışan bir
 * yolculuk geçmiş değildir.
 */
export const HISTORY_STATUSES = Object.freeze({
  COMPLETED: JOURNEY_SIMULATION_STATUS.COMPLETED,
  CANCELLED: JOURNEY_SIMULATION_STATUS.CANCELLED,
})

/**
 * Rozet etiketleri — KISA, çünkü bir liste satırında okunurlar.
 *
 * Canlı panelin terminal başlıkları ("Yolculuk tamamlandı") tam cümledir ve
 * orada doğrudur: orası tek bir yolculuğun sonucudur. Listede ise satır zaten
 * bir yolculuğu anlatır ve cümle tekrarı gürültü olurdu.
 */
const STATUS_LABELS = Object.freeze({
  [HISTORY_STATUSES.COMPLETED]: 'Tamamlandı',
  [HISTORY_STATUSES.CANCELLED]: 'İptal Edildi',
})

/** Bilinmeyen bir durum çökertmez; tarafsız bir metinle geçilir. */
export function historyStatusLabel(status) {
  return STATUS_LABELS[status] ?? 'Sona erdi'
}

/**
 * Rozetin görsel tonu.
 *
 * <b>Renk TEK BAŞINA bilgi taşımaz</b> — etiket her zaman metinle birlikte
 * çizilir. Ton yalnızca taramayı hızlandırır.
 */
export function historyStatusTone(status) {
  if (status === HISTORY_STATUSES.COMPLETED) return 'done'
  if (status === HISTORY_STATUSES.CANCELLED) return 'stopped'
  return 'neutral'
}

/** Süzgeç sekmeleri: hepsi / tamamlanan / iptal edilen. */
export const HISTORY_FILTERS = Object.freeze([
  Object.freeze({ id: 'all', label: 'Tümü', status: null }),
  Object.freeze({ id: 'completed', label: 'Tamamlandı', status: HISTORY_STATUSES.COMPLETED }),
  Object.freeze({ id: 'cancelled', label: 'İptal Edildi', status: HISTORY_STATUSES.CANCELLED }),
])

export function historyFilterStatus(filterId) {
  return HISTORY_FILTERS.find((filter) => filter.id === filterId)?.status ?? null
}

export const JOURNEY_HISTORY_MESSAGES = Object.freeze({
  notFound: 'Yolculuk kaydı bulunamadı.',
  loadFailed: 'Yolculuk geçmişi yüklenemedi. Lütfen tekrar deneyin.',
  detailFailed: 'Yolculuk kaydı açılamadı. Lütfen tekrar deneyin.',
  reuseFailed: 'Bu yolculuk yeniden oluşturulamadı.',
  forbidden: 'Bu işlem için yetkiniz bulunmuyor.',
  empty: 'Henüz tamamlanmış veya iptal edilmiş bir yolculuğunuz yok.',
  emptyFiltered: 'Bu süzgeçle eşleşen bir yolculuk yok.',
})

/**
 * HTTP durumunu ve sunucunun GÜVENLİ mesajını kullanıcı metnine çevirir.
 *
 * <b>Ham gövde asla doğrudan gösterilmez.</b> 400/404/409 kullanıcının kendi
 * kaydıyla ilgilidir ve sunucunun Türkçe metni orada en yararlı olandır
 * ("… adlı POI artık mevcut değil"); diğer sınıflarda sabit metin kullanılır ki
 * altyapı terimleri hiçbir yoldan sızmasın.
 */
export function journeyHistoryErrorMessage(status, serverMessage = '', fallback = '') {
  const safe = typeof serverMessage === 'string' ? serverMessage.trim() : ''
  const unknown = fallback || JOURNEY_HISTORY_MESSAGES.loadFailed

  if (status === 403) return JOURNEY_HISTORY_MESSAGES.forbidden
  if (status === 404) return safe || JOURNEY_HISTORY_MESSAGES.notFound
  if (status === 400 || status === 409) return safe || unknown

  return unknown
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null
}

/**
 * Liste satırının SUNUM modeli.
 *
 * <b>Süre MOTORUN ölçtüğü seyahat süresidir</b>, başlangıç ve bitiş damgaları
 * arasındaki fark DEĞİL: kişisel simülasyon bir demo çarpanıyla oynatılır ve
 * duvar saati farkı 460 metrelik bir sürüşü "11 saniye" diye gösterirdi.
 * Damgalar yolculuğun NE ZAMAN yapıldığını anlatır; süre NE KADAR sürdüğünü.
 * İkisi ayrı sorulardır ve ayrı alanlarda gösterilir.
 */
export function journeyHistorySummary(row) {
  if (!row || row.id == null) return null

  const profileId = JOURNEY_PROFILE_IDS.includes(row.profile) ? row.profile : null
  const origin = row.originName || null
  const destination = row.destinationName || null

  const distanceMeters = finiteNumber(row.distanceMeters)
  const coveredMeters = finiteNumber(row.coveredDistanceMeters)
  const isCompleted = row.terminalStatus === HISTORY_STATUSES.COMPLETED

  return Object.freeze({
    id: Number(row.id),

    /* Tarihsel çalıştırma kimliği taşınır ama YENİDEN KULLANILMAZ: yeniden
       yapma isteği yalnızca kaydın kendi kimliğini gönderir. */
    simulationId: row.simulationId ?? null,
    status: row.terminalStatus ?? null,
    statusLabel: historyStatusLabel(row.terminalStatus),
    statusTone: historyStatusTone(row.terminalStatus),
    isCompleted,
    modeLabel: journeyModeLabel(row.mode),
    profileId,
    // Profil METİNLE gösterilir; yalnız ikon, ekran okuyucuya hiçbir şey söylemez.
    profileLabel: profileId ? journeyProfileLabel(profileId) : '—',
    routeName: row.routeDisplayName || null,
    originName: origin,
    destinationName: destination,
    /* Uç özeti YOKSA uydurulmaz: kaydın özeti o zaman hattın kendisidir. */
    endpointsLabel: origin && destination
      ? `${origin} → ${destination}`
      : (row.routeDisplayName || ''),
    startedLabel: formatDateTime(row.startedAt),
    endedLabel: formatDateTime(row.endedAt),
    durationLabel: formatRouteDuration(row.durationSeconds),
    distanceLabel: formatRouteDistance(distanceMeters),

    /* Yarıda durdurulan yolculukta "ne kadarını yaptım" ayrı bir olgudur ve
       yalnızca orada gösterilir: tamamlanan bir yolculukta aynı iki sayıyı yan
       yana yazmak gürültü olurdu. */
    coveredLabel: isCompleted || coveredMeters === null
      ? null
      : formatRouteDistance(coveredMeters),
    pointCount: Number.isFinite(row.pointCount) ? row.pointCount : 0,
  })
}

export function journeyHistoryList(rows) {
  /* Sıra SUNUCUNUNDUR (en son biten en üstte) ve tarayıcıda yeniden
     sıralanmaz: iki farklı sıralama kuralı, sayfalar arasında satır tekrarı ya
     da kaybı demekti. */
  return (Array.isArray(rows) ? rows : []).map(journeyHistorySummary).filter(Boolean)
}

/**
 * Sunucunun sayfa yanıtının SUNUM modeli.
 *
 * <b>"Devamı var mı" sorusunu tarayıcı TAHMİN ETMEZ:</b> cevap sunucunun
 * toplam sayısındadır. Sayfayı doldurup "belki vardır" demek, son sayfada boş
 * bir "daha fazla" düğmesi bırakırdı.
 */
export function journeyHistoryPage(body) {
  const page = Number.isFinite(body?.page) ? body.page : 1
  const totalPages = Number.isFinite(body?.totalPages) ? body.totalPages : 0

  return Object.freeze({
    items: journeyHistoryList(body?.items),
    page,
    pageSize: Number.isFinite(body?.pageSize) ? body.pageSize : 0,
    totalCount: Number.isFinite(body?.totalCount) ? body.totalCount : 0,
    totalPages,
    hasMore: page < totalPages,
  })
}

/**
 * Ayrıntı görünümünün SUNUM modeli.
 *
 * Noktalar TUTANAĞIN kendi kopyalarından okunur; hiçbir canlı kayda
 * gidilmez. Kanonik kimlikler modelde taşınmaz çünkü ekranda işleri yoktur —
 * onları yalnızca sunucu, yeniden yapma yolunda okur.
 */
export function journeyHistoryDetail(detail) {
  const summary = journeyHistorySummary(detail)
  if (!summary) return null

  const points = Array.isArray(detail.points)
    ? [...detail.points].sort((left, right) => (left?.sequence ?? 0) - (right?.sequence ?? 0))
    : []

  return Object.freeze({
    ...summary,
    points: points.map((point) => Object.freeze({
      key: `${point.sequence}-${point.source}-${point.referenceId}`,
      sequence: point.sequence,
      // Ad TARİHSELDİR: kayıt sonradan yeniden adlandırılsa bile değişmez.
      name: point.displayName || '—',
      roleLabel: roleLabel(point.role),
    })),
  })
}

const ROLE_LABELS = Object.freeze({
  origin: 'Başlangıç',
  via: 'Ara nokta',
  destination: 'Varış',
})

function roleLabel(role) {
  return ROLE_LABELS[role] ?? 'Nokta'
}

/**
 * Tarihsel bir yolculuğu PLANLAYICI TASLAĞINA çevirir.
 *
 * <b>Bu bir başlatma DEĞİLDİR</b> ve eski çalıştırmayı diriltmez: taslakta bir
 * çalıştırma kimliği yoktur. Tarihsel adlar yalnızca yuvada ETİKET olarak
 * yaşar ve isteğe hiç girmez — sunucu noktayı kanonik kimliğinden çözer.
 *
 * <b>Kural burada TEKRARLANMAZ:</b> "bir tanım nasıl taslağa döner" sorusunun
 * sahibi planlayıcıdır ve kaydedilmiş yolculuklar da aynı kuralı kullanır.
 */
export function journeyHistoryDraft(detail) {
  if (!detail || detail.id == null) return null

  return journeyDraftFromDefinition(detail)
}
