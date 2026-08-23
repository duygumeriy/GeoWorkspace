import { useState } from 'react'
import MapSheet from './MapSheet.jsx'
import PoiWorkHoursEditor from './PoiWorkHoursEditor.jsx'
import {
  buildWorkHoursPayload,
  emptyWorkHoursDraft,
  validateWorkHoursDraft,
} from '../../poi/workHours.js'
import { formatLonLat } from '../../map/poi.js'
import './PoiSheets.css'

/** Backend sınırı (Poi.MaxNameLength / EF HasMaxLength). */
const MAX_NAME_LENGTH = 200

/**
 * Yerleştirilen noktanın öznitelik formu.
 *
 * Haritaya tıklandığı anda HİÇBİR ŞEY kaydedilmez: nokta geçici katmanda
 * bekler ve bu form onun bir kayda dönüşüp dönüşmeyeceğine karar verir —
 * çizimlerdeki öznitelik popup'ıyla birebir aynı sözleşme.
 *
 * Konum SALT OKUNURDUR. Elle düzenlenebilseydi, haritada görünen işaret ile
 * gönderilen koordinat ayrışabilirdi; konumu değiştirmenin yolu noktayı
 * yeniden yerleştirmektir.
 *
 * <b>Doğrulama istemcide yalnızca UX içindir.</b> Ad, kategori ve saat
 * kurallarının sahibi sunucudur; buradaki kontroller garanti reddedilecek bir
 * isteği açmamak içindir.
 */
export default function PoiFormSheet({
  open,
  point,
  categories,
  categoriesLoading,
  categoriesError,
  onRetryCategories,
  saving,
  error,
  onSave,
  onCancel,
}) {
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [workHours, setWorkHours] = useState(emptyWorkHoursDraft)
  const [hourErrors, setHourErrors] = useState({})

  if (!open || !point) return null

  const trimmed = name.trim()
  const noCategories = !categoriesLoading && !categoriesError && categories.length === 0
  /* CategoryId yalnızca sunucudan gelen listeden seçilebilir; boş bırakılırsa
     kaydetme kapalıdır. `categoryId=0` gibi bir değer hiçbir yoldan
     gönderilemez. */
  const canSubmit = trimmed.length > 0 && categoryId !== '' && !saving && !noCategories

  const submit = (event) => {
    event.preventDefault()
    if (!canSubmit) return

    const errors = validateWorkHoursDraft(workHours)
    setHourErrors(errors)
    if (Object.keys(errors).length) return

    onSave({
      name: trimmed,
      categoryId: Number(categoryId),
      workHours: buildWorkHoursPayload(workHours),
      longitude: point.longitude,
      latitude: point.latitude,
    })
  }

  return (
    <MapSheet open={open} title="POI Ekle" onClose={onCancel} className="poi-sheet">
      <form className="poi-form" onSubmit={submit}>
        <label className="poi-field">
          <span>POI Adı</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_NAME_LENGTH}
            disabled={saving}
            autoFocus
            placeholder="Örn. Ankara Kalesi Kafe"
          />
        </label>

        <label className="poi-field">
          <span>Kategori</span>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            disabled={saving || categoriesLoading || noCategories}
          >
            <option value="">{categoriesLoading ? 'Kategoriler yükleniyor…' : 'Kategori seçin'}</option>
            {/* Etiket YOLU gösterir ki aynı adlı kardeşler ayırt edilebilsin. */}
            {categories.map((category) => (
              <option key={category.id} value={category.id}>{category.path || category.name}</option>
            ))}
          </select>
        </label>

        {categoriesError && (
          <p className="poi-form-error" role="alert">
            {categoriesError}
            <button type="button" className="poi-link-button" onClick={onRetryCategories}>Tekrar dene</button>
          </p>
        )}

        {/* Sessizce boş bir kategoriyle göndermek yerine ne yapılması
            gerektiği söylenir. */}
        {noCategories && (
          <p className="poi-form-note" role="status">
            POI eklemek için önce bir kategori tanımlanmalıdır.
          </p>
        )}

        <PoiWorkHoursEditor
          draft={workHours}
          errors={hourErrors}
          disabled={saving}
          onChange={setWorkHours}
        />

        <div className="poi-field poi-field--readonly">
          <span>Konum</span>
          {/* Haritadaki işaretin ta kendisi; yalnızca gösterim için yuvarlanır,
              gönderilen değer tam hassasiyetini korur. */}
          <output>{formatLonLat(point.longitude, point.latitude)}</output>
          <small>Boylam, Enlem (EPSG:4326)</small>
        </div>

        {/* Sunucunun mesajı olduğu gibi gösterilir: coğrafi yetki reddi de
            dâhil, kullanıcıya ne olduğunu söyleyen tek metin odur. */}
        {error && <p className="poi-form-error" role="alert">{error}</p>}

        <div className="poi-form-actions">
          <button type="button" className="poi-button secondary" onClick={onCancel} disabled={saving}>
            İptal
          </button>
          <button type="submit" className="poi-button" disabled={!canSubmit}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      </form>
    </MapSheet>
  )
}
