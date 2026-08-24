import { useEffect, useState } from 'react'
import PoiCategoryPicker from '../map/PoiCategoryPicker.jsx'
import PoiWorkHoursEditor from '../map/PoiWorkHoursEditor.jsx'
import PoiLocationFields from '../map/PoiLocationFields.jsx'
import {
  buildWorkHoursPayload,
  validateWorkHoursDraft,
  workHoursToDraft,
} from '../../poi/workHours.js'
import { isPoiDraftDirty, poiDraftSnapshot } from '../../poi/poiDraft.js'
import { isValidCoordinate } from '../../poi/poiCoordinates.js'

/** Backend sınırı (Poi.MaxNameLength / EF HasMaxLength). */
const MAX_NAME_LENGTH = 200

/**
 * Yönetim panelinden POI düzenleme.
 *
 * <b>Yeni bir doğrulama ya da yeni bir uç DEĞİLDİR.</b> Alanlar, kategori
 * seçicisi ve mesai düzenleyicisi haritadaki formla AYNI bileşenlerdir
 * (`PoiCategoryPicker`, `PoiWorkHoursEditor`, `workHours.js`) ve gönderilen
 * gövde aynı `PUT /api/poi/{id}` sözleşmesidir. Yönetim tarafına ayrı bir
 * "her şeyi yapabilen" uç açmak, iş kuralının iki yerde yaşaması demek olurdu;
 * yetki farkı zaten sunucudadır — `poi.manage` taşıyan çağıran aynı ucun
 * sahiplik denetiminden geçer.
 *
 * Kabuk, kategori diyaloğunun iskeletidir (`admin-dialog-backdrop` +
 * `admin-dialog`), böylece yönetim panelindeki iki modal aynı klavye ve odak
 * davranışını paylaşır.
 *
 * <b>Konum burada da düzenlenebilir</b> ve haritadakiyle AYNI alanları,
 * aynı doğrulamayı ve aynı gövdeyi kullanır (`PoiLocationFields`). Fark tek
 * bir şeydir: bu ekranda harita yoktur, dolayısıyla "Haritada Taşı" noktayı
 * yerinde sürüklemek yerine HARİTAYI AÇAR ve düzenleme orada kaldığı yerden
 * sürer — kaydedilmemiş taslak da birlikte gider. Diyaloğun içine ikinci bir
 * OpenLayers haritası gömmek, aynı düzenleme mimarisinin ikinci bir kopyası
 * olurdu. Coğrafi yetkiyi burada da sunucu uygular.
 *
 * <b>Devretme HİÇBİR ŞEY KAYDETMEZ.</b> Kalıcı kayıt, kullanıcı haritada
 * "Güncelle"ye basana kadar olduğu gibi durur; ekranlar arasında taşınan şey
 * yalnızca taslaktır.
 */
export default function PoiEditDialog({
  poi,
  categories,
  categoriesLoading = false,
  categoriesError = '',
  onRetryCategories,
  busy,
  error,
  onCancel,
  onSubmit,
  /** "Haritada Taşı": kaydedilmemiş taslakla birlikte haritaya devreder. */
  onMoveOnMap,
}) {
  const [name, setName] = useState(poi?.name ?? '')
  const [categoryId, setCategoryId] = useState(poi?.categoryId ?? null)
  const [workHours, setWorkHours] = useState(() => workHoursToDraft(poi?.workHours))
  const [hourErrors, setHourErrors] = useState({})
  const [coordinate, setCoordinate] = useState(() => ({
    longitude: poi?.longitude,
    latitude: poi?.latitude,
  }))

  /* Haritadaki formla AYNI kural: açılıştaki değişmez anlık görüntü, kirlilik
     ve geri alma tek bir yerde tanımlıdır (`poi/poiDraft.js`). İki ekran için
     iki ayrı kopya, ilk değişiklikte birbirinden sapardı. Başarısız bir
     kaydetmeden sonra da aynı kalır. */
  const [original] = useState(() => poiDraftSnapshot(poi))

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [busy, onCancel])

  const trimmed = name.trim()
  const isValid = trimmed.length > 0 && Number.isInteger(categoryId) && isValidCoordinate(coordinate)
  // VEYA: tek bir alanın (konum dâhil) değişmesi kaydetmeyi açar.
  const isDirty = isPoiDraftDirty(original, { name, categoryId, workHours, ...coordinate })
  const canSubmit = isValid && isDirty && !busy

  /** Taslağı açılıştaki hâline döndürür; istek göndermez, diyaloğu kapatmaz. */
  const revert = () => {
    setName(original.name)
    setCategoryId(original.categoryId)
    setWorkHours(original.workHours)
    setHourErrors({})
    setCoordinate({ longitude: original.longitude, latitude: original.latitude })
  }

  /** Formun o anki hâli — hem kaydetme hem haritaya devretme aynı gövdeyi kullanır. */
  const draft = () => ({
    name: trimmed,
    categoryId,
    workHours: buildWorkHoursPayload(workHours),
    longitude: coordinate.longitude,
    latitude: coordinate.latitude,
  })

  const submit = (event) => {
    event.preventDefault()
    if (!canSubmit) return

    const errors = validateWorkHoursDraft(workHours)
    setHourErrors(errors)
    if (Object.keys(errors).length) return

    onSubmit(draft())
  }

  return (
    <div
      className="admin-dialog-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel()
      }}
    >
      <form
        className="admin-dialog admin-poi-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="poi-edit-dialog-title"
        onSubmit={submit}
      >
        {/* Üç bölge: başlık ve eylemler SABİT kalır, yalnızca gövde kayar.
            Form artık kategori seçicisi, yedi mesai günü ve konum alanlarını
            taşıyor; tek parça bir diyalog viewport'u aşıyor ve alttaki
            düğmelere ulaşılamıyordu. */}
        <div className="admin-dialog-header">
          <h2 id="poi-edit-dialog-title">{poi?.name} kaydını düzenle</h2>
          <p>
            Adı, kategorisi, mesai saatleri ve konumu güncellenebilir. Kaydı oluşturan kullanıcı
            değişmez.
          </p>
        </div>

        <div className="admin-dialog-body">
        <label className="admin-poi-field">
          POI adı
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            maxLength={MAX_NAME_LENGTH}
            autoFocus
          />
        </label>

        {/* Haritadaki formla aynı aranabilir seçici ve aynı eşleşme mantığı. */}
        <PoiCategoryPicker
          value={categoryId}
          categories={categories}
          loading={categoriesLoading}
          error={categoriesError}
          disabled={busy}
          onRetry={onRetryCategories}
          onChange={setCategoryId}
          inputId="admin-poi-category"
        />

        <PoiWorkHoursEditor
          draft={workHours}
          errors={hourErrors}
          disabled={busy}
          onChange={setWorkHours}
        />

        {/* Haritadakiyle aynı alanlar; sürükleme yalnızca haritada anlamlıdır
            ve bu ekranda harita yoktur. */}
        {/* Aynı bileşen, farklı eylem: burada "Haritada Taşı" haritayı açar.
            Geçersiz bir taslakla devretmek, haritada da kaydedilemeyecek bir
            forma geçmek olurdu; ölçüt gönderim geçerliliğinin ta kendisidir. */}
        <PoiLocationFields
          coordinate={coordinate}
          onChange={setCoordinate}
          disabled={busy}
          onOpenOnMap={onMoveOnMap ? () => onMoveOnMap(draft()) : undefined}
          canOpenOnMap={isValid && !busy}
        />

        {error && <p className="admin-dialog-error" role="alert">{error}</p>}
        </div>

        <div className="admin-dialog-actions">
          <button
            type="button"
            className="admin-button secondary compact"
            disabled={busy || !isDirty}
            onClick={revert}
          >
            Değişiklikleri Geri Al
          </button>
          <button type="button" className="admin-button secondary" disabled={busy} onClick={onCancel}>
            İptal
          </button>
          <button type="submit" className="admin-button" disabled={!canSubmit}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      </form>
    </div>
  )
}
