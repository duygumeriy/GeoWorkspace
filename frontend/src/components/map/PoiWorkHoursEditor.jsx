import { DAY_KEYS, DAY_LABELS, isOvernightRange } from '../../poi/workHours.js'

/**
 * Haftalık mesai düzenleyicisi.
 *
 * <b>Hiçbir gün varsayılan olarak doldurulmaz.</b> Yedi gün de "bildirilmemiş"
 * başlar; kullanıcı bir günü açıkça etkinleştirmedikçe o gün gövdeye hiç
 * girmez. Her günü 09:00–18:00 ile başlatmak, kullanıcının söylemediği bir
 * şeyi veriye yazmak olurdu.
 *
 * <b>Dört durum ayrı ayrı temsil edilir</b> ve hiçbiri diğerine indirgenmez —
 * bu ayrım sunucu sözleşmesinde de vardır:
 *   • bildirilmemiş — anahtar hiç gönderilmez
 *   • kapalı        — `{ closed: true }`
 *   • 24 saat açık  — `{ closed: false, open24Hours: true }`
 *   • saatli        — `{ closed: false, open, close }`
 *
 * "Kapalı" ile "24 Saat Açık" BİRBİRİNİ DIŞLAR ve ikisi de saat alanlarını
 * kaldırır: gönderilmeyecek bir değeri istemek, kendi içinde çelişen bir form
 * olurdu. 24 saat açık olmak eşit saatlerle (00:00 – 00:00) YAZILMAZ; o
 * gösterim geçersizdir ve kalmaya devam eder.
 *
 * <b>Gece aşan aralık geçerlidir</b> ve satır bunu sessizce değil, kendi
 * cümlesiyle söyler: 17:00 – 01:00 girildiğinde "ertesi gün kapanır" ipucu
 * çıkar. İpucu hata biçimli DEĞİLDİR çünkü ortada bir hata yoktur.
 *
 * Saatler yerel <c>&lt;input type="time"&gt;</c> ile alınır: dolgulu HH:mm
 * üretir, klavye ve ekran okuyucuyla çalışır ve mobilde platformun kendi saat
 * seçicisini açar.
 */
export default function PoiWorkHoursEditor({ draft, errors, disabled, onChange }) {
  const update = (key, patch) => onChange({ ...draft, [key]: { ...draft[key], ...patch } })

  return (
    <fieldset className="poi-hours" disabled={disabled}>
      <legend>Mesai Saatleri</legend>
      <p className="poi-hours-hint">
        Yalnızca bildirmek istediğiniz günleri işaretleyin. İşaretlenmeyen günler
        “belirtilmemiş” olarak kalır.
      </p>

      <ul className="poi-hours-list">
        {DAY_KEYS.map((key) => {
          const day = draft[key]
          const error = errors?.[key]

          return (
            <li key={key} className={`poi-hours-day ${day.enabled ? 'is-enabled' : ''}`}>
              <label className="poi-hours-toggle">
                <input
                  type="checkbox"
                  checked={day.enabled}
                  onChange={(e) => update(key, { enabled: e.target.checked })}
                />
                <span>{DAY_LABELS[key]}</span>
              </label>

              {day.enabled && (
                <div className="poi-hours-fields">
                  <div className="poi-hours-modes">
                    <label className="poi-hours-closed">
                      <input
                        type="checkbox"
                        checked={day.closed}
                        /* Karşılıklı dışlama TEK yönlü bir kural değildir:
                           biri açıldığında diğeri KAPANIR, böylece
                           "kapalı ve 24 saat açık" durumu hiç oluşmaz. */
                        onChange={(e) =>
                          update(key, { closed: e.target.checked, open24Hours: false })
                        }
                      />
                      <span>Kapalı</span>
                    </label>

                    <label className="poi-hours-closed">
                      <input
                        type="checkbox"
                        checked={Boolean(day.open24Hours)}
                        /* Erişilebilir ad GÜNE ÖZGÜDÜR: yedi özdeş "24 Saat
                           Açık" kutusu, ekran okuyucuda hangi güne ait
                           olduğunu söylemezdi. Saat alanları da aynı kalıbı
                           kullanır. */
                        aria-label={`${DAY_LABELS[key]} 24 saat açık`}
                        onChange={(e) =>
                          update(key, { open24Hours: e.target.checked, closed: false })
                        }
                      />
                      <span>24 Saat Açık</span>
                    </label>
                  </div>

                  {/* Kapalı ya da 24 saat açık günde saat alanları hiç
                      çizilmez: gönderilmeyecek bir değeri istemek, kendi
                      içinde çelişen bir form olurdu. Kullanıcı bu durumlardan
                      çıktığında yazdığı saatler taslakta DURUYORDUR ve geri
                      gelir — "Kapalı"nın bugünkü davranışının aynısı. */}
                  {!day.closed && !day.open24Hours && (
                    <div className="poi-hours-times">
                      <label>
                        <span>Açılış</span>
                        <input
                          type="time"
                          value={day.open}
                          onChange={(e) => update(key, { open: e.target.value })}
                          aria-label={`${DAY_LABELS[key]} açılış saati`}
                        />
                      </label>
                      <label>
                        <span>Kapanış</span>
                        <input
                          type="time"
                          value={day.close}
                          onChange={(e) => update(key, { close: e.target.value })}
                          aria-label={`${DAY_LABELS[key]} kapanış saati`}
                        />
                      </label>
                    </div>
                  )}

                  {/* Gece aşımı bir HATA DEĞİLDİR: aralık geçerlidir ve
                      yalnızca ne anlama geldiği söylenir. Kırmızı bir uyarı
                      olsaydı, kullanıcı doğru girdiği bir saati düzeltmeye
                      çalışırdı. */}
                  {!day.closed && !day.open24Hours && isOvernightRange(day.open, day.close) && (
                    <p className="poi-hours-overnight">{day.close} — ertesi gün kapanır</p>
                  )}

                  {error && <p className="poi-hours-error" role="alert">{error}</p>}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </fieldset>
  )
}
