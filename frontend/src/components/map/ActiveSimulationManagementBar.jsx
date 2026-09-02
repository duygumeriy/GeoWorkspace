/**
 * YÖNETİM SEÇİMİ araç çubuğu (Faz 4B).
 *
 * <b>Yalnızca çizer.</b> Hangi eylemin görüneceğine, kaç hedefi kapsadığına ve
 * yıkıcı olup olmadığına saf <code>activeSimulationManagement</code> karar
 * verir; bu bileşen ikinci bir kural kitabı tutmaz. Rol adı, kullanıcı adı ya
 * da yönetici bayrağı hiçbir biçimde okunmaz — görünürlük ETKİN yetki
 * kodundan türer ve yalnızca DENEYİMDİR: backend yetkisiz isteğe 403
 * döndürmeye devam eder.
 *
 * <b>İKİ HÂLİ VARDIR ve bu ayrım tasarımın kendisidir:</b>
 * <ul>
 *   <li><b>Seçim yokken</b> yalnızca tek bir sessiz kısa yol gösterilir:
 *       <i>Aktifleri Seç</i>. Dört yıkıcı komutu hiçbir hedefi yokken sürekli
 *       çizmek, dar harita panelini kullanıcının basamayacağı düğmelerle
 *       doldurmak demekti.</li>
 *   <li><b>Seçim varken</b> tek bir kompakt eylem çubuğu açılır: kaç
 *       çalıştırmanın seçili olduğu, seçimi değiştirmenin yolları ve YALNIZCA
 *       uygun hedefi olan komutlar.</li>
 * </ul>
 *
 * <b>İZLEME araç çubuğundan AYRIDIR</b> ve öyle görünür: o haritada araç açar,
 * bu ise sunucudaki çalıştırmalara komut gönderir. İkisini aynı satıra koymak,
 * kullanıcıdan bir düğmenin hangisini yaptığını tahmin etmesini istemek
 * olurdu.
 *
 * <b>Yıkıcı eylemler komutu doğrudan GÖNDERMEZ:</b> tıklama yalnızca onayı
 * açar ve niyet o anda dondurulur.
 */
export default function ActiveSimulationManagementBar({
  management = null,
  onSelectAllActive,
  onClearSelection,
  onRunAction,
}) {
  if (!management?.canManage) return null

  /* SEÇİM YOK: tek bir sessiz kısa yol. Seçilecek aktif çalıştırma da yoksa
     hiçbir şey çizilmez — boş bir listenin üstünde duran bir düğme, olmayan
     bir işi vaat ederdi. */
  if (!management.hasSelection) {
    if (!management.canSelectAllActive) return null

    return (
      <div className="journey-manage is-idle">
        <button
          type="button"
          className="journey-manage-hint"
          onClick={onSelectAllActive}
        >
          Aktifleri Seç
        </button>
      </div>
    )
  }

  return (
    <div className="journey-manage" aria-label="Seçili simülasyonlar için toplu işlemler">
      <div className="journey-manage-head">
        {/* Sayaç bir ROZET değil, seçimin büyüklüğüdür. */}
        <span className="journey-manage-count" role="status">
          {management.selectionLabel}
        </span>
        <div className="journey-manage-select">
          {/* AKTİFLERİ SEÇ yalnızca O ANDA aktif olanları kapsar; sonradan
              başlayan hatlar kendiliğinden seçilmez. */}
          {management.canSelectAllActive && (
            <button type="button" className="journey-manage-hint" onClick={onSelectAllActive}>
              Aktifleri Seç
            </button>
          )}
          {/* SEÇİMİ TEMİZLE yalnızca seçimi düşürür: hiçbir simülasyon durmaz,
              hiçbir işaretçi kaybolmaz, hiçbir hat seçimden çıkmaz. */}
          <button type="button" className="journey-manage-hint" onClick={onClearSelection}>
            Seçimi Temizle
          </button>
        </div>
      </div>

      {/* Yalnızca UYGUN hedefi olan komutlar çizilir: "(0)" taşıyan kapalı bir
          düğme hiç üretilmez. */}
      {management.actions.length > 0 && (
        <div className="journey-manage-actions">
          {management.actions.map((action) => (
            <button
              key={action.operation}
              type="button"
              className={[
                'journey-manage-action',
                action.destructive ? 'is-destructive' : '',
                `is-${action.operation}`,
              ].filter(Boolean).join(' ')}
              disabled={action.busy}
              aria-busy={action.busy}
              onClick={() => onRunAction?.(action.operation)}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
