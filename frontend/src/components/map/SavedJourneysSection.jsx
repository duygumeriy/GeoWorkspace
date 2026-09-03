import { Loader2, Pencil, Play, RotateCcw, Star, Trash2 } from 'lucide-react'
import { SAVED_JOURNEY_MESSAGES } from '../../map/savedJourneys.js'

/**
 * Kişisel ürünün "Kaydedilenler" bölümü.
 *
 * <b>Ayrı bir SAYFA değildir.</b> Kayıtlar aynı çalışma alanının içinde,
 * planlama bölümünün yanında yaşar: yolculuğu kuran yüzeyle onu saklayan yüzey
 * arasında gezinmek için haritadan çıkmak gerekmemelidir.
 *
 * <b>İş kuralı burada YOKTUR.</b> Sunum modeli saf `savedJourneys` modülünden
 * gelir; bileşen yalnızca çizer ve kullanıcı niyetini KAYIT KİMLİĞİYLE yukarı
 * bildirir. Her eylem kimliği taşır: hangi satırın "seçili" olduğuna bakan bir
 * durum yoktur, dolayısıyla bayat bir seçim yanlış kaydı silemez.
 *
 * <b>Satırda düğme yığını yoktur:</b> kullan, yeniden adlandır, sil ve yıldız.
 * Hepsi klavyeyle çalışan sıradan düğmelerdir ve her birinin erişilebilir adı
 * kaydın ADINI içerir — "Sil" tek başına, ekran okuyucuda hangi satırda
 * olduğunu söylemezdi.
 */
export default function SavedJourneysSection({
  items = [],
  loading = false,
  loaded = false,
  error = '',
  busyId = null,
  onUse,
  onLoad,
  onRename,
  onDelete,
  onToggleFavorite,
  onRetry,
}) {
  const isEmpty = loaded && !loading && items.length === 0

  return (
    <div className="journey-saved">
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
          {' '}Kaydedilen yolculuklar yükleniyor…
        </p>
      )}

      {isEmpty && !error && (
        <p className="journey-note">{SAVED_JOURNEY_MESSAGES.empty}</p>
      )}

      {items.length > 0 && (
        <ul className="journey-saved-list">
          {items.map((item) => {
            const busy = busyId === item.id
            return (
              <li key={item.id} className="journey-saved-row" aria-busy={busy}>
                <div className="journey-saved-head">
                  {/* Yıldız SATIRI SEÇMEZ ve yolculuğu başlatmaz: kendi
                      düğmesidir, durumu `aria-pressed` ile bildirilir. */}
                  <button
                    type="button"
                    className={`journey-star ${item.isFavorite ? 'is-on' : ''}`.trim()}
                    aria-pressed={item.isFavorite}
                    disabled={busy}
                    onClick={() => onToggleFavorite?.(item.id, !item.isFavorite)}
                    aria-label={item.isFavorite
                      ? `“${item.name}” favorilerden çıkar`
                      : `“${item.name}” favorilere ekle`}
                  >
                    <Star size={15} aria-hidden="true" />
                  </button>

                  <button
                    type="button"
                    className="journey-saved-name"
                    disabled={busy}
                    onClick={() => onLoad?.(item.id)}
                    aria-label={`“${item.name}” yolculuğunu planlayıcıya yükle`}
                  >
                    {item.name}
                  </button>
                </div>

                <p className="journey-saved-meta">
                  {/* Profil METİNLE gösterilir; yalnız ikon yeterli değildir. */}
                  <span>{item.profileLabel}</span>
                  <span aria-hidden="true"> · </span>
                  <span>{item.modeLabel}</span>
                  {item.endpointsLabel && (
                    <>
                      <span aria-hidden="true"> · </span>
                      <span>{item.endpointsLabel}</span>
                    </>
                  )}
                </p>

                <p className="journey-saved-time">{item.modifiedLabel}</p>

                <div className="journey-saved-actions">
                  {/* KULLAN, yüklemekten AYRI bir karardır: bu düğme sunucuda
                      YENİ bir çalıştırma başlatır. */}
                  <button
                    type="button"
                    className="journey-primary"
                    disabled={busy}
                    onClick={() => onUse?.(item.id)}
                    aria-label={`“${item.name}” yolculuğunu yeniden kullan`}
                  >
                    <Play size={14} aria-hidden="true" />
                    Kullan
                  </button>
                  <button
                    type="button"
                    className="journey-secondary"
                    disabled={busy}
                    onClick={() => onRename?.(item.id)}
                    aria-label={`“${item.name}” yolculuğunu yeniden adlandır`}
                  >
                    <Pencil size={14} aria-hidden="true" />
                    Adlandır
                  </button>
                  <button
                    type="button"
                    className="journey-danger"
                    disabled={busy}
                    onClick={() => onDelete?.(item.id)}
                    aria-label={`“${item.name}” yolculuğunu sil`}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    Sil
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
