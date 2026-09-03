import ActiveSimulationManagementBar from './ActiveSimulationManagementBar.jsx'

/**
 * AKTİF SİMÜLASYONLAR listesi (Faz 4A + 4B).
 *
 * <b>Yalnızca çizer.</b> Hangi satırların görüneceğine, sıralarına ve izleme
 * etiketlerine saf <code>activeSimulationsPresentation</code> karar verir; bu
 * bileşen ikinci bir kural kitabı tutmaz. Rol adı, kullanıcı adı ya da
 * yönetici bayrağı hiçbir biçimde okunmaz.
 *
 * <b>SATIR BİR ARAÇ ÇUBUĞU DEĞİLDİR.</b> Her satıra üç yaşam döngüsü komutu
 * koymak, dar harita panelinde ad, durum, ilerleme, izleme ve o komutları aynı
 * genişlikte yarıştırıyor ve etiketleri üst üste bindiriyordu. Satır artık TEK
 * bir eylem taşır — İzle — ve yetkili kullanıcı için bir de yönetim onay
 * kutusu. Yaşam döngüsü komutları SEÇİMİN üzerinde çalışır; tek bir çalıştırma
 * için de aynı yol kullanılır, böylece ikinci bir komut yüzeyi doğmaz.
 *
 * <b>Sıradan izleyici için hiçbir şey değişmedi.</b> Yönetim alanları sunum
 * modelinde yetkisiz kullanıcı için HİÇ VAR OLMAZ; liste onun gözünde Faz
 * 4A'daki gibi salt okuma yüzeyidir.
 *
 * <b>DÖRT eylem dört ayrı kavramdır:</b>
 * <ul>
 *   <li><b>Satıra tıklamak</b> hattı SEÇER — ayrıntı/denetim bağlamını açar.
 *       İzlemeyi değiştirmez, takibi ele geçirmez, yönetim seçimi yapmaz.</li>
 *   <li><b>İzle / İzlemeyi Bırak</b> yalnızca haritadaki ARACI açıp kapatır.
 *       Simülasyona dokunmaz ve satırı seçmez.</li>
 *   <li><b>Yönetim seçimi</b> (onay kutusu) yalnızca TOPLU KOMUT HEDEFİ
 *       belirler: araç çizdirmez, hattı seçmez, kamerayı almaz ve sunucuya
 *       hiçbir istek göndermez.</li>
 *   <li><b>Arama</b> yalnızca NE ÇİZİLECEĞİNİ süzer: aktif kümeyi, izleme
 *       seçimini, yönetim seçimini ve canlı abonelikleri hiç etkilemez.</li>
 * </ul>
 *
 * <b>Onay kutusu ile İzle düğmesi AYRI hedeflerdir</b> ve iç içe geçmez:
 * kutuya tıklamak satırı SEÇMEZ. Bunun için olayın yayılması durdurulur —
 * kullanıcının vermediği bir kararı uygulamamak, kod kısalığından önce gelir.
 */
export default function ActiveSimulationsList({
  active = null,
  onSearchChange,
  onSelectRoute,
  onToggleWatch,
  onWatchAll,
  onClearWatch,
  onRetry,
  /* YÖNETİM (Faz 4B). Hepsi isteğe bağlıdır: yetkisiz kullanıcıda sunum modeli
     zaten `canManage: false` der ve hiçbiri çağrılmaz. */
  onToggleManaged,
  onSelectAllActive,
  onClearSelection,
  onRunBatchAction,
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

      {/* YÖNETİM araç çubuğu İZLEME araç çubuğundan AYRI bir bloktur. */}
      <ActiveSimulationManagementBar
        management={active.management}
        onSelectAllActive={onSelectAllActive}
        onClearSelection={onClearSelection}
        onRunAction={onRunBatchAction}
      />

      {/* Toplu komutun sonucu DÜRÜSTÇE gösterilir: kısmen uygulanmış bir yığın
          "tamamlandı" diye sunulmaz. Ham JSON ya da iç hata metni ÇIKMAZ. */}
      {active.batchError && (
        <p className="journey-error" role="alert">{active.batchError}</p>
      )}
      {!active.batchError && active.batchSummary && (
        <p className="journey-note" role="status">{active.batchSummary}</p>
      )}

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
              {/* YÖNETİM SEÇİMİ. Bir onay kutusudur ve İZLE düğmesiyle
                  karıştırılmasın diye AÇIKÇA etiketlenir: "İzle" haritada
                  araç açar, bu ise komut hedefi belirler. Tıklama satırı
                  SEÇMEZ — olay yayılımı burada durur. */}
              {row.canManage && (
                <label
                  className="journey-active-manage"
                  /* Görünür metin YOKTUR ama anlam kaybolmaz: kutu, seçim
                     sayacını ve seçim kısa yollarını taşıyan yönetim
                     çubuğuyla aynı bağlamda durur, üstüne gelince adını söyler
                     ve ekran okuyucuya tam cümleyi verir. Her satıra bir
                     etiket basmak, dar panelde hat adının yerini yerdi. */
                  title="Yönetim seçimi"
                  onClick={(event) => event.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={row.isManaged}
                    /* Uçuş hâlindeki bir komutun hedefini seçimden çıkarmak,
                       kullanıcıya iptal ettiği izlenimini verirdi — oysa istek
                       çoktan yola çıkmıştır. Kilit YALNIZCA o satırdadır. */
                    disabled={row.isBusy}
                    aria-label={`${row.routeName} hattını yönetim seçimine ekle`}
                    onChange={() => onToggleManaged?.(row.routeId)}
                  />
                </label>
              )}

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
