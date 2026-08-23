import { DAY_KEYS, DAY_LABELS } from '../../poi/workHours.js'

/**
 * Haftalık mesai düzenleyicisi.
 *
 * <b>Hiçbir gün varsayılan olarak doldurulmaz.</b> Yedi gün de "bildirilmemiş"
 * başlar; kullanıcı bir günü açıkça etkinleştirmedikçe o gün gövdeye hiç
 * girmez. Her günü 09:00–18:00 ile başlatmak, kullanıcının söylemediği bir
 * şeyi veriye yazmak olurdu.
 *
 * <b>Üç durum ayrı ayrı temsil edilir</b> ve "Kapalı" ile "Belirtilmemiş"
 * karıştırılmaz — bu ayrım sunucu sözleşmesinde de vardır:
 *   • bildirilmemiş — anahtar hiç gönderilmez
 *   • kapalı        — `{ closed: true }`
 *   • açık          — `{ closed: false, open, close }`
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
                  <label className="poi-hours-closed">
                    <input
                      type="checkbox"
                      checked={day.closed}
                      onChange={(e) => update(key, { closed: e.target.checked })}
                    />
                    <span>Kapalı</span>
                  </label>

                  {/* Kapalı günde saat alanları hiç çizilmez: gönderilmeyecek
                      bir değeri istemek, kendi içinde çelişen bir form olurdu. */}
                  {!day.closed && (
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
