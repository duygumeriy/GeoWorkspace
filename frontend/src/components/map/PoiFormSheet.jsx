import { useState } from 'react'
import MapSheet from './MapSheet.jsx'
import PoiWorkHoursEditor from './PoiWorkHoursEditor.jsx'
import PoiCategoryPicker from './PoiCategoryPicker.jsx'
import PoiLocationFields from './PoiLocationFields.jsx'
import {
  buildWorkHoursPayload,
  emptyWorkHoursDraft,
  validateWorkHoursDraft,
  workHoursToDraft,
} from '../../poi/workHours.js'
import { isPoiDraftDirty, poiDraftSnapshot } from '../../poi/poiDraft.js'
import { isValidCoordinate } from '../../poi/poiCoordinates.js'
import { formatLonLat } from '../../map/poi.js'
import './PoiSheets.css'

/** Backend sınırı (Poi.MaxNameLength / EF HasMaxLength). */
const MAX_NAME_LENGTH = 200

/**
 * POI öznitelik formu — OLUŞTURMA ve DÜZENLEME için tek bileşen.
 *
 * İki ayrı form yazmak, aynı doğrulamayı (ad zorunluluğu, kategori seçimi,
 * mesai kuralları) ve aynı kategori seçicisini ikinci kez tanımlamak olurdu;
 * ikisi kaçınılmaz olarak birbirinden saparlardı. Fark yalnızca ÜÇ noktadadır
 * ve hepsi `mode` üzerinden okunur: başlık, kaydet etiketi ve konumun nereden
 * geldiği.
 *
 * Haritaya tıklandığı anda HİÇBİR ŞEY kaydedilmez: nokta geçici katmanda
 * bekler ve bu form onun bir kayda dönüşüp dönüşmeyeceğine karar verir —
 * çizimlerdeki öznitelik popup'ıyla birebir aynı sözleşme.
 *
 * <b>Konum düzenlemede ARTIK DÜZENLENEBİLİR.</b> Oluşturmada hâlâ salt
 * okunurdur — orada konumun kaynağı haritaya konan noktadır. Düzenlemede iki
 * yol vardır ve ikisi de AYNI taslak değeri yazar: boylam/enlem kutuları ve
 * "Haritada Taşı" ile sürüklenen taslak işaret. Taslak koordinatın SAHİBİ bu
 * form değil, sayfadır (`MapPage`): aynı değeri hem bu form hem harita
 * düzenler, dolayısıyla iki kopya tutmak ikisinin ayrışmasına açık kapı
 * bırakırdı. Buradaki metin kutuları yalnızca yazılmakta olan METNİ tutar.
 *
 * <b>Doğrulama istemcide yalnızca UX içindir.</b> Ad, kategori, saat ve
 * koordinat kurallarının sahibi sunucudur; buradaki kontroller garanti
 * reddedilecek bir isteği açmamak içindir. Sahiplik denetimi de aynı şekilde
 * sunucudadır — formun açılabilmiş olması, kaydın kaydedilebileceği anlamına
 * gelmez. Coğrafi yetki de öyle: harita üzerinde bir noktayı sürükleyebilmek,
 * oraya taşıyabileceğiniz anlamına gelmez.
 */
export default function PoiFormSheet({
  /** 'create' | 'edit' */
  mode = 'create',
  open,
  /** Oluşturmada yerleştirilen nokta; düzenlemede kaydın kendi konumu. */
  point,
  /** Düzenlemede formun açılacağı KALICI kayıt. */
  poi = null,
  /**
   * Başka bir ekrandan devralınan KAYDEDİLMEMİŞ taslak (yönetim panelinden
   * "Haritada Taşı").
   *
   * Yalnızca başlangıç DEĞERLERİNİ belirler; "neye göre değişti" sorusunun
   * referansı olan anlık görüntü yine KALICI kayıttan alınır. Aksi hâlde
   * "Değişiklikleri Geri Al", kullanıcıyı kaydedilmemiş taslağa geri
   * götürürdü — oysa geri almanın tek anlamı veritabanındaki hâle dönmektir.
   */
  initialDraft = null,
  /** Düzenlemede taslak konum (EPSG:4326) — sahibi sayfadır. */
  coordinate = null,
  /** Taslak konumu değiştirir; haritadaki taslak işaret de bunu izler. */
  onCoordinateChange,
  /** "Haritada Taşı" açık mı. */
  moveActive = false,
  onToggleMove,
  categories,
  categoriesLoading,
  categoriesError,
  onRetryCategories,
  saving,
  error,
  onSave,
  onCancel,
}) {
  const isEdit = mode === 'edit'

  /* Başlangıç değerleri yalnızca MOUNT'ta okunur ve bu bilinçlidir: form
     açıkken kullanıcının yazdığı metin, arkadaki listenin yenilenmesiyle
     ezilmemelidir. Farklı bir kayda geçmek MapPage'de `key` ile yeni bir form
     kurar — çizim popup'ındaki kalıbın aynısı. */
  const [name, setName] = useState(() => initialDraft?.name ?? poi?.name ?? '')
  const [categoryId, setCategoryId] = useState(() => initialDraft?.categoryId ?? poi?.categoryId ?? null)
  const [workHours, setWorkHours] = useState(() => {
    if (initialDraft) return workHoursToDraft(initialDraft.workHours)
    return poi ? workHoursToDraft(poi.workHours) : emptyWorkHoursDraft()
  })
  const [hourErrors, setHourErrors] = useState({})

  /* Açılıştaki DEĞİŞMEZ anlık görüntü. Düzenlemede "neye göre değişti"
     sorusunun tek referansıdır ve başarısız bir kaydetmeden SONRA da aynı
     kalır — aksi hâlde "Değişiklikleri Geri Al" kullanıcıyı reddedilmiş
     taslağa geri götürürdü. Konum da bu görüntüdedir. `poi` prop'u değişse
     bile yeniden okunmaz; farklı bir kayda geçmek MapPage'de `key` ile yeni
     bir form kurar.

     Devralınan bir taslak varken de KALICI kayıttan okunur: geri almanın tek
     anlamı veritabanındaki hâle dönmektir, kaydedilmemiş bir ara duruma
     değil. */
  const [original] = useState(() => (poi ? poiDraftSnapshot(poi) : null))

  /* Düzenlemede taslak konum sayfadadır; prop gelmediyse (oluşturma, ya da
     henüz kurulmamış bir düzenleme) kaydın kendi konumuna düşülür. */
  const draftCoordinate = isEdit
    ? coordinate ?? (poi ? { longitude: poi.longitude, latitude: poi.latitude } : null)
    : null

  const position = draftCoordinate ?? point ?? (poi ? { longitude: poi.longitude, latitude: poi.latitude } : null)

  const trimmed = name.trim()

  /* Geçerlilik: ad zorunlu, kategori yalnızca sunucudan gelen listeden
     seçilebilir, düzenlemede konum da geçerli bir 4326 çifti olmalıdır.
     Serbest metin hiçbir yoldan kategoriye dönüşemez. */
  const isValid =
    trimmed.length > 0
    && Number.isInteger(categoryId)
    && (!isEdit || isValidCoordinate(draftCoordinate))

  /* Kirlilik VEYA'dır: kullanıcının her alanı değiştirmesi beklenmez —
     yalnızca adı, yalnızca kategoriyi, yalnızca tek bir mesai gününü ya da
     yalnızca konumu değiştirmek kaydetmeyi açar. Oluşturmada referans yoktur,
     dolayısıyla yeni kayıt daima gönderilebilir. */
  const isDirty = isPoiDraftDirty(original, {
    name,
    categoryId,
    workHours,
    ...(isEdit ? { longitude: draftCoordinate?.longitude, latitude: draftCoordinate?.latitude } : {}),
  })

  const canSubmit = isValid && isDirty && !saving

  /**
   * "Değişiklikleri Geri Al": taslağı açılıştaki hâline döndürür.
   *
   * Hiçbir istek göndermez, formu KAPATMAZ ve kaydın kimliği gibi sunucuya ait
   * alanlara dokunmaz. Konum da geri gelir — kullanıcı noktayı haritada
   * kilometrelerce öteye sürüklediyse taslak işaret gözle görülür biçimde eski
   * yerine döner. Terk edilen taslaktan doğan doğrulama hataları da temizlenir:
   * kullanıcı geri döndüğü hâlde bir hata mesajıyla karşılaşmamalıdır.
   */
  const revert = () => {
    if (!original) return
    setName(original.name)
    setCategoryId(original.categoryId)
    setWorkHours(original.workHours)
    setHourErrors({})

    if (isEdit && Number.isFinite(original.longitude) && Number.isFinite(original.latitude)) {
      onCoordinateChange?.({ longitude: original.longitude, latitude: original.latitude })
    }
  }

  const submit = (event) => {
    event.preventDefault()
    if (!canSubmit) return

    const errors = validateWorkHoursDraft(workHours)
    setHourErrors(errors)
    if (Object.keys(errors).length) return

    const attributes = {
      name: trimmed,
      categoryId,
      workHours: buildWorkHoursPayload(workHours),
    }

    /* Düzenleme gövdesi artık koordinatı da TAŞIR ve çift olarak taşır:
       yarım bir koordinat sunucuda reddedilir. Değer yuvarlanmaz — yuvarlama
       yalnızca ekranda gösterim içindir. */
    onSave(
      isEdit
        ? { ...attributes, longitude: draftCoordinate.longitude, latitude: draftCoordinate.latitude }
        : { ...attributes, ...position },
    )
  }

  if (!open || !position) return null

  return (
    <MapSheet
      open={open}
      title={isEdit ? 'POI Düzenle' : 'POI Ekle'}
      onClose={onCancel}
      className="poi-sheet"
    >
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

        {/* Aranabilir seçici: oluşturma ve düzenleme AYNI bileşeni ve aynı
            eşleşme mantığını kullanır. */}
        <PoiCategoryPicker
          value={categoryId}
          categories={categories}
          loading={categoriesLoading}
          error={categoriesError}
          disabled={saving}
          onRetry={onRetryCategories}
          onChange={setCategoryId}
          inputId={isEdit ? 'poi-edit-category' : 'poi-create-category'}
        />

        <PoiWorkHoursEditor
          draft={workHours}
          errors={hourErrors}
          disabled={saving}
          onChange={setWorkHours}
        />

        {isEdit ? (
          <PoiLocationFields
            coordinate={draftCoordinate}
            onChange={onCoordinateChange}
            moveActive={moveActive}
            onToggleMove={onToggleMove}
            disabled={saving}
          />
        ) : (
          <div className="poi-field poi-field--readonly">
            <span>Konum</span>
            {/* Haritadaki işaretin ta kendisi; yalnızca gösterim için
                yuvarlanır, gönderilen değer tam hassasiyetini korur. */}
            <output>{formatLonLat(position.longitude, position.latitude)}</output>
            <small>Boylam, Enlem (EPSG:4326)</small>
          </div>
        )}

        {/* Sunucunun mesajı olduğu gibi gösterilir: yetki/sahiplik reddi ve
            coğrafi ret de dâhil, kullanıcıya ne olduğunu söyleyen tek metin
            odur. */}
        {error && <p className="poi-form-error" role="alert">{error}</p>}

        {/* Üçü TEK bir eylem grubudur ve sağa yaslanır: "Değişiklikleri Geri
            Al" bir kenara itilmiş ayrı bir şey değil, İptal'in komşusudur. */}
        <div className="poi-form-actions">
          {/* Yalnızca düzenlemede ve yalnızca geri alınacak bir şey varken. */}
          {isEdit && (
            <button
              type="button"
              className="poi-button secondary compact"
              onClick={revert}
              disabled={saving || !isDirty}
            >
              Değişiklikleri Geri Al
            </button>
          )}
          <button type="button" className="poi-button secondary" onClick={onCancel} disabled={saving}>
            İptal
          </button>
          <button type="submit" className="poi-button" disabled={!canSubmit}>
            {saving ? 'Kaydediliyor…' : isEdit ? 'Güncelle' : 'Kaydet'}
          </button>
        </div>
      </form>
    </MapSheet>
  )
}
