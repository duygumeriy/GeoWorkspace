import { ChevronDown, ChevronUp, Loader2, PencilLine, Play, RotateCcw } from 'lucide-react'
import { HISTORY_FILTERS, JOURNEY_HISTORY_MESSAGES } from '../../map/journeyHistory.js'

/**
 * Kişisel ürünün "Geçmiş" bölümü.
 *
 * <b>Ayrı bir SAYFA değildir.</b> Tutanaklar aynı çalışma alanının içinde,
 * planlama ve kayıtların yanında yaşar: yaptığı yolculuğa bakmak için
 * kullanıcının haritadan çıkması gerekmemelidir.
 *
 * <b>İş kuralı burada YOKTUR.</b> Sunum modeli saf `journeyHistory` modülünden
 * gelir; bileşen yalnızca çizer ve kullanıcı niyetini KAYIT KİMLİĞİYLE yukarı
 * bildirir. Her eylem kimliği taşır: hangi satırın "seçili" olduğuna bakan bir
 * durum yoktur, dolayısıyla bayat bir seçim yanlış kaydı açamaz ya da yeniden
 * başlatamaz.
 *
 * <b>Gösterim TARİHSELDİR.</b> Adlar tutanağın kendi kopyalarındandır; burada
 * hiçbir POI, durak ya da hat kaydı okunmaz. Silinmiş bir POI'yi içeren
 * yolculuk bu yüzden hâlâ açılabilir.
 *
 * <b>Tutanak DEĞİŞTİRİLEMEZ.</b> Bölümde ad, favori ya da silme eylemi yoktur
 * ve olmamalıdır — olmuş bir şeyin kaydı düzenlenmez.
 */
export default function JourneyHistorySection({
  items = [],
  filterId = 'all',
  loading = false,
  loadingMore = false,
  loaded = false,
  hasMore = false,
  error = '',
  detail = null,
  detailId = null,
  busyId = null,
  onFilterChange,
  onOpenDetail,
  onCloseDetail,
  onReuse,
  onLoadIntoPlanner,
  onLoadMore,
  onRetry,
}) {
  const isEmpty = loaded && !loading && items.length === 0
  const isFiltered = filterId !== 'all'

  return (
    <div className="journey-history">
      {/* Süzgeç: yalnızca ucuz ve indeksli tek eksen. Tarih aralığı ve
          arama bilinçli olarak YOKTUR. */}
      <div className="journey-tabs" role="group" aria-label="Yolculuk durumu süzgeci">
        {HISTORY_FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            aria-pressed={filterId === filter.id}
            className={`journey-tab ${filterId === filter.id ? 'is-active' : ''}`.trim()}
            onClick={() => onFilterChange?.(filter.id)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="journey-feedback">
          <p className="journey-error" role="alert">{error}</p>
          {onRetry && (
            <button type="button" className="journey-secondary" onClick={onRetry}>
              <RotateCcw size={14} aria-hidden="true" />
              Tekrar dene
            </button>
          )}
        </div>
      )}

      {/* Yükleniyor durumu METİNLE de söylenir: dönen bir ikon, ekran
          okuyucuya hiçbir şey anlatmaz. */}
      {loading && (
        <p className="journey-note" role="status">
          <Loader2 size={14} className="journey-spin" aria-hidden="true" />
          {' '}Yolculuk geçmişi yükleniyor…
        </p>
      )}

      {isEmpty && !error && (
        <p className="journey-note">
          {isFiltered ? JOURNEY_HISTORY_MESSAGES.emptyFiltered : JOURNEY_HISTORY_MESSAGES.empty}
        </p>
      )}

      {items.length > 0 && (
        <ul className="journey-history-list">
          {items.map((item) => {
            const busy = busyId === item.id
            const isOpen = detailId === item.id && detail != null

            return (
              <li key={item.id} className="journey-history-row" aria-busy={busy}>
                <div className="journey-history-head">
                  {/* Durum METİNDİR; renk yalnızca taramayı hızlandırır ve
                      tek başına hiçbir bilgi taşımaz. */}
                  <span className={`journey-history-badge tone-${item.statusTone}`}>
                    {item.statusLabel}
                  </span>
                  <span className="journey-history-when">{item.endedLabel}</span>
                </div>

                <p className="journey-history-route">{item.endpointsLabel || '—'}</p>

                <p className="journey-history-meta">
                  {/* Profil METİNLE gösterilir; yalnız ikon yeterli değildir. */}
                  <span>{item.profileLabel}</span>
                  <span aria-hidden="true"> · </span>
                  <span>{item.modeLabel}</span>
                  <span aria-hidden="true"> · </span>
                  <span>{item.durationLabel}</span>
                  <span aria-hidden="true"> · </span>
                  <span>{item.distanceLabel}</span>
                  {/* Yarıda durdurulan yolculukta "ne kadarını yaptım" ayrı bir
                      olgudur ve yalnızca orada gösterilir. */}
                  {item.coveredLabel && (
                    <>
                      <span aria-hidden="true"> · </span>
                      <span>{item.coveredLabel} gidildi</span>
                    </>
                  )}
                </p>

                <div className="journey-history-actions">
                  <button
                    type="button"
                    className="journey-secondary"
                    disabled={busy}
                    aria-expanded={isOpen}
                    onClick={() => (isOpen ? onCloseDetail?.() : onOpenDetail?.(item.id))}
                    aria-label={`${item.endpointsLabel || 'Yolculuk'} yolculuğunun ayrıntısını ${isOpen ? 'kapat' : 'aç'}`}
                  >
                    {isOpen
                      ? <ChevronUp size={14} aria-hidden="true" />
                      : <ChevronDown size={14} aria-hidden="true" />}
                    Detay
                  </button>

                  {/* YENİDEN KULLAN, ayrıntıyı açmaktan AYRI bir karardır: bu
                      düğme sunucuda YENİ bir çalıştırma başlatır ve tarihsel
                      kaydı değiştirmez. */}
                  <button
                    type="button"
                    className="journey-primary"
                    disabled={busy}
                    onClick={() => onReuse?.(item.id)}
                    aria-label={`${item.endpointsLabel || 'Yolculuk'} yolculuğunu yeniden yap`}
                  >
                    <Play size={14} aria-hidden="true" />
                    Yeniden Yap
                  </button>
                </div>

                {isOpen && (
                  <JourneyHistoryDetail
                    detail={detail}
                    onLoadIntoPlanner={() => onLoadIntoPlanner?.(item.id)}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* "Devamı var mı" sorusunu SUNUCU yanıtlar; sayfa doluluğuna bakıp
          tahmin etmek, son sayfada boş bir düğme bırakırdı. */}
      {hasMore && (
        <button
          type="button"
          className="journey-secondary journey-history-more"
          disabled={loadingMore}
          aria-busy={loadingMore}
          onClick={onLoadMore}
        >
          {loadingMore
            ? <Loader2 size={14} className="journey-spin" aria-hidden="true" />
            : null}
          {loadingMore ? 'Yükleniyor…' : 'Daha fazla göster'}
        </button>
      )}
    </div>
  )
}

/**
 * Tek bir tutanağın DEĞİŞMEZ ayrıntısı, satırın içinde açılır.
 *
 * Ayrı bir modal AÇILMAZ: geçmişte incelenecek şey birkaç satırlık bir
 * özettir ve haritayı kaplayan bir katman ona değmez. İç kimlikler
 * (çalıştırma kimliği) GÖSTERİLMEZ — kullanıcıya hiçbir şey anlatmaz.
 */
function JourneyHistoryDetail({ detail, onLoadIntoPlanner }) {
  if (!detail) return null

  return (
    <div className="journey-history-detail">
      <dl className="journey-history-facts">
        <div>
          <dt>Başlangıç</dt>
          <dd>{detail.startedLabel}</dd>
        </div>
        <div>
          <dt>Bitiş</dt>
          <dd>{detail.endedLabel}</dd>
        </div>
        <div>
          <dt>Süre</dt>
          <dd>{detail.durationLabel}</dd>
        </div>
        <div>
          <dt>Mesafe</dt>
          <dd>{detail.distanceLabel}</dd>
        </div>
        {detail.routeName && (
          <div>
            <dt>Hat</dt>
            <dd>{detail.routeName}</dd>
          </div>
        )}
      </dl>

      {detail.points.length > 0 && (
        <ol className="journey-history-points">
          {detail.points.map((point) => (
            <li key={point.key}>
              <span className="journey-history-role">{point.roleLabel}</span>
              {/* Ad TARİHSELDİR: kayıt sonradan yeniden adlandırılsa bile
                  burada o günkü adı durur. */}
              <span className="journey-history-point-name">{point.name}</span>
            </li>
          ))}
        </ol>
      )}

      {/* YÜKLEMEK BAŞLATMAK DEĞİLDİR: bu eylem yalnızca planlayıcı taslağını
          doldurur ve kullanıcıyı planlama bölümüne götürür — yolculuğu
          değiştirip öyle başlatmak isteyen kullanıcının yolu budur. Satırdaki
          "Yeniden Yap" ise doğrudan yeni bir çalıştırma kurar. İki eylem
          bilinçle ayrıdır ve ikisi de tarihsel kaydı DEĞİŞTİRMEZ.

          Rozet yığını olmasın diye satırda değil, açılmış ayrıntının içinde
          durur. */}
      <button
        type="button"
        className="journey-secondary journey-history-load"
        onClick={onLoadIntoPlanner}
        aria-label={`${detail.endpointsLabel || 'Yolculuk'} yolculuğunu planlayıcıya yükle`}
      >
        <PencilLine size={14} aria-hidden="true" />
        Planlayıcıya Yükle
      </button>
    </div>
  )
}
