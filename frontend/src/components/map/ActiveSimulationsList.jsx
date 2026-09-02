/**
 * AKTİF SİMÜLASYONLAR listesi (Faz 4A).
 *
 * <b>Yalnızca çizer.</b> Hangi satırların görüneceğine, sıralarına ve izleme
 * etiketlerine saf <code>activeSimulationsPresentation</code> karar verir; bu
 * bileşen ikinci bir kural kitabı tutmaz. Rol adı, kullanıcı adı ya da
 * yönetici bayrağı hiçbir biçimde okunmaz.
 *
 * <b>Bu bir YÖNETİM yüzeyi DEĞİLDİR.</b> Satırlar Duraklat / Devam Ettir /
 * Sıfırla taşımaz ve toplu yaşam döngüsü seçimi sunmaz: mevcut yaşam döngüsü
 * denetimleri SEÇİLİ hattın bağlamında kalır. Çoklu hat yönetimi ayrı bir
 * fazın konusudur ve buraya sızdırılmaz.
 *
 * <b>Üç eylem üç ayrı kavramdır:</b>
 * <ul>
 *   <li><b>Satıra tıklamak</b> hattı SEÇER — ayrıntı/denetim bağlamını açar.
 *       İzlemeyi değiştirmez, takibi ele geçirmez.</li>
 *   <li><b>İzle / İzlemeyi Bırak</b> yalnızca haritadaki ARACI açıp kapatır.
 *       Simülasyona dokunmaz ve satırı seçmez.</li>
 *   <li><b>Arama</b> yalnızca NE ÇİZİLECEĞİNİ süzer: aktif kümeyi, izleme
 *       seçimini ve canlı abonelikleri hiç etkilemez.</li>
 * </ul>
 */
export default function ActiveSimulationsList({
  active = null,
  onSearchChange,
  onSelectRoute,
  onToggleWatch,
  onWatchAll,
  onClearWatch,
  onRetry,
}) {
  if (!active) return null

  return (
    <div className="journey-active" aria-label="Aktif hat simülasyonları">
      <div className="journey-active-toolbar">
        <input
          type="search"
          className="journey-active-search"
          value={active.search}
          placeholder="Hat adına göre ara"
          aria-label="Aktif simülasyonlarda hat adına göre ara"
          onChange={(event) => onSearchChange?.(event.target.value)}
        />
        <div className="journey-active-bulk">
          {/* TÜMÜNÜ İZLE yalnızca O ANDA aktif olanları kapsar; sonradan
              başlayan hatlar otomatik izlenmez. */}
          <button
            type="button"
            className="journey-secondary"
            disabled={!active.canWatchAll}
            onClick={onWatchAll}
          >
            Tümünü İzle
          </button>
          {/* İZLEMEYİ TEMİZLE yalnızca işaretçileri kaldırır: hiçbir
              simülasyon durmaz, aktif liste değişmez, seçim korunur. */}
          <button
            type="button"
            className="journey-secondary"
            disabled={!active.canClearWatch}
            onClick={onClearWatch}
          >
            İzlemeyi Temizle
          </button>
        </div>
      </div>

      {active.loading && (
        <p className="journey-note" role="status">Aktif simülasyonlar yükleniyor…</p>
      )}

      {/* Hata varken "hiç aktif simülasyon yok" DENMEZ: bilinmeyen bir şey
          "yok" diye sunulamaz ve bayat veri güncel gibi gösterilmez. */}
      {active.error && (
        <div className="journey-feedback">
          <p className="journey-error" role="alert">{active.error}</p>
          <button type="button" className="journey-secondary" onClick={onRetry}>
            Yeniden dene
          </button>
        </div>
      )}

      {active.isEmpty && (
        <p className="journey-note" role="status">
          Şu anda aktif hat simülasyonu bulunmuyor.
        </p>
      )}

      {/* Arama sonucu boş olmak, aktif simülasyon OLMAMASI değildir. */}
      {!active.isEmpty && active.totalCount > 0 && active.visibleCount === 0 && (
        <p className="journey-note" role="status">
          Aramayla eşleşen aktif hat yok.
        </p>
      )}

      {active.visibleCount > 0 && (
        <ul className="journey-active-list">
          {active.rows.map((row) => (
            <li
              key={`${row.routeId}:${row.simulationId}`}
              className={`journey-active-row ${row.isSelected ? 'is-selected' : ''}`.trim()}
            >
              {/* Satır SEÇİMİ ile İZLEME denetimi ayrı düğmelerdir: iç içe
                  geçmiş tıklama alanları, kullanıcının vermediği bir kararı
                  uygulamaya davettir. */}
              <button
                type="button"
                className="journey-active-select"
                aria-pressed={row.isSelected}
                onClick={() => onSelectRoute?.(row.routeId)}
              >
                <span className="journey-active-name">
                  {row.routeColor && (
                    <span
                      className="journey-shared-swatch"
                      style={{ backgroundColor: row.routeColor }}
                      aria-hidden="true"
                    />
                  )}
                  <strong>{row.routeName}</strong>
                </span>
                <span className="journey-active-meta">
                  {row.statusLabel} · {row.progressLabel}
                  {row.isFollowed && ' · Takipte'}
                </span>
              </button>

              <button
                type="button"
                className={`journey-active-watch ${row.isWatched ? 'is-watched' : ''}`.trim()}
                aria-pressed={row.isWatched}
                onClick={() => onToggleWatch?.(row.routeId)}
              >
                {row.watchLabel}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
