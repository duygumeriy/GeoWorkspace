import { useEffect, useState } from 'react'
import { optionLabel, parentOptions } from './poiCategories.js'

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
  const canSubmit = trimmed.length > 0 && !busy

  const submit = (event) => {
    event.preventDefault()
    if (!canSubmit) return

    onSubmit({
      name: trimmed,
      parentId: parentId === '' ? null : Number(parentId),
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
            ? 'Kategorinin adını, bağlı olduğu üst kategoriyi ve kullanım durumunu değiştirebilirsiniz.'
            : 'Kategori bir üst kategoriye bağlanabilir veya ana kategori olarak kalabilir.'}
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
