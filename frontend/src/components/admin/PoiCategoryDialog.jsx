import { useEffect, useState } from 'react'
import { optionLabel, parentOptions } from './poiCategories.js'
import {
  COLOR_OPTIONS,
  DEFAULT_COLOR,
  ICON_OPTIONS,
  normalizeColorHex,
} from './poiCategoryMetadata.js'

/** Backend sınırı (PoiCategory.MaxNameLength / EF HasMaxLength). */
const MAX_NAME_LENGTH = 150

/**
 * Kategori oluşturma / düzenleme.
 *
 * Rol ekranındaki <c>RoleFormDialog</c> ile aynı iskelet: tek bir modal, iki
 * kip. İki ayrı diyalog, doğrulamanın ve klavye davranışının ilk değişiklikte
 * ayrışması demek olurdu.
 *
 * Çağıran diyaloğu `key` ile ayırt eder, dolayısıyla düzenlenen kategori
 * değiştiğinde bileşen yeniden kurulur; prop'a eşitleyen bir efekt YOKTUR ve
 * bir önceki düzenlemenin değerleri sonraki forma sızamaz.
 *
 * <b>İstemci doğrulaması yalnızca boş adı durdurur.</b> Üst kategori
 * geçerliliği, döngü koruması ve uzunluk sınırı SUNUCUNUN kararıdır; burada
 * yeniden yazmak ikinci bir kural kitabı yaratırdı. Sunucunun mesajı olduğu
 * gibi gösterilir — kullanıcıya ne yapması gerektiğini söyleyen tek metin odur.
 */
export default function PoiCategoryDialog({ mode, category, categories, busy, error, onCancel, onSubmit }) {
  const editing = mode === 'edit'

  const [name, setName] = useState(category?.name ?? '')
  const [parentId, setParentId] = useState(category?.parentId ?? '')
  const [isActive, setIsActive] = useState(category?.isActive ?? true)

  /* Sunum metadatası. Düzenlemede mevcut değerlerle başlar; göç öncesinden
     kalan metadatasız bir kayıtta boş/varsayılan gelir ve kaydedebilmek için
     doldurulması GEREKİR — sunucu ikisini de zorunlu tutar. Bu bilinçlidir:
     yönetim ekranından geçen her kayıt metadatasını kazanır. */
  const [iconKey, setIconKey] = useState(category?.iconKey ?? '')
  const [colorHex, setColorHex] = useState(
    normalizeColorHex(category?.colorHex) ?? DEFAULT_COLOR,
  )

  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape' && !busy) onCancel() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [busy, onCancel])

  /* Seçilebilir üstler: pasif ve silinmiş satırlar elenir (sunucu da onları
     reddeder), düzenleme kipinde ayrıca kategorinin kendisi ve — yol verisi
     elverdiğince — alt ağacı çıkarılır. Eleme bir garanti değil kolaylıktır;
     döngü kararının sahibi sunucudur. */
  const options = parentOptions(categories, editing ? category : null)

  const trimmed = name.trim()
  const canonicalColor = normalizeColorHex(colorHex)

  /* Gönderilebilirlik: ad, simge ve geçerli bir renk. Bunlar sunucunun da
     ZORUNLU tuttuğu üç alandır; düğmeyi erkenden kapatmak, garanti bir 400'ü
     kullanıcıya yaşatmamak içindir — kural yine sunucunundur. */
  const canSubmit = trimmed.length > 0 && iconKey !== '' && canonicalColor !== null && !busy

  const submit = (event) => {
    event.preventDefault()
    if (!canSubmit) return

    onSubmit({
      name: trimmed,
      parentId: parentId === '' ? null : Number(parentId),
      /* `<input type="color">` küçük harfli üretir; kanonik biçime çevrilerek
         gönderilir ki aynı renk iki farklı metin olarak saklanmasın. */
      iconKey,
      colorHex: canonicalColor,
      ...(editing ? { isActive } : {}),
    })
  }

  return (
    <div
      className="admin-dialog-backdrop"
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel() }}
    >
      <form
        className="admin-dialog admin-poi-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="poi-category-dialog-title"
        onSubmit={submit}
      >
        <h2 id="poi-category-dialog-title">
          {editing ? `${category.name} kategorisini düzenle` : 'Yeni kategori oluştur'}
        </h2>
        <p>
          {editing
            ? 'Kategorinin adını, üst kategorisini, simgesini, rengini ve kullanım durumunu değiştirebilirsiniz.'
            : 'Kategori bir üst kategoriye bağlanabilir veya ana kategori olarak kalabilir. Simge ve renk zorunludur.'}
        </p>

        <label className="admin-poi-field">
          Kategori adı
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            maxLength={MAX_NAME_LENGTH}
            autoFocus
            placeholder="Örn. Yeme-İçme"
          />
        </label>

        <label className="admin-poi-field">
          Üst kategori
          <select value={parentId} onChange={(e) => setParentId(e.target.value)} disabled={busy}>
            <option value="">Ana kategori (üst kategori yok)</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>{optionLabel(option)}</option>
            ))}
          </select>
        </label>

        <label className="admin-poi-field">
          İkon
          <select value={iconKey} onChange={(e) => setIconKey(e.target.value)} disabled={busy}>
            <option value="">Simge seçin…</option>
            {ICON_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label} — {option.key}
              </option>
            ))}
          </select>
        </label>

        <div className="admin-poi-field admin-poi-color-field">
          <span className="admin-poi-field-label">Renk</span>
          <div className="admin-poi-color-row">
            <input
              type="color"
              aria-label="Kategori rengi"
              value={canonicalColor ?? DEFAULT_COLOR}
              onChange={(e) => setColorHex(e.target.value)}
              disabled={busy}
            />
            {/* Palet bir KISIT değil bir kolaylıktır: yönetici renk seçicisiyle
                palet dışına da çıkabilir; sunucu yalnızca #RRGGBB biçimine
                bakar. */}
            <select
              aria-label="Renk paleti"
              value={COLOR_OPTIONS.some((option) => option.value === canonicalColor) ? canonicalColor : ''}
              onChange={(e) => { if (e.target.value) setColorHex(e.target.value) }}
              disabled={busy}
            >
              <option value="">Palet dışı</option>
              {COLOR_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} — {option.value}
                </option>
              ))}
            </select>
            <code className="admin-poi-color-value">{canonicalColor ?? '—'}</code>
          </div>
        </div>

        {/* Teknik kimlik SALT OKUNURDUR. Gösterilir çünkü ileride GeoServer
            stil kuralı bu değere göre eşleşecektir; düzenlenemez çünkü adın
            değişmesi teknik kimliği taşımaz — bir yeniden adlandırma o stil
            kuralını sahipsiz bırakırdı. */}
        {editing && category?.slug && (
          <p className="admin-poi-slug-note">
            Teknik kimlik (slug): <code>{category.slug}</code>
            <small>Ad değiştirilse bile bu değer sabit kalır.</small>
          </p>
        )}

        {/* Durum yalnızca düzenlemede vardır: yeni kategori her zaman aktif
            başlar ve `isDeleted` hiçbir kipte düzenlenebilir DEĞİLDİR. */}
        {editing && (
          <label className="admin-poi-field">
            Durum
            <select value={isActive ? 'active' : 'inactive'} onChange={(e) => setIsActive(e.target.value === 'active')} disabled={busy}>
              <option value="active">Aktif</option>
              <option value="inactive">Pasif</option>
            </select>
          </label>
        )}

        {error && <p className="admin-dialog-error" role="alert">{error}</p>}

        <div className="admin-dialog-actions">
          <button type="button" className="admin-button secondary" disabled={busy} onClick={onCancel}>İptal</button>
          <button type="submit" className="admin-button" disabled={!canSubmit}>
            {busy ? 'Kaydediliyor…' : editing ? 'Kaydet' : 'Kategori Oluştur'}
          </button>
        </div>
      </form>
    </div>
  )
}
