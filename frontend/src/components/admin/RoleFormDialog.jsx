import { useEffect, useState } from 'react'

/**
 * Create / rename dialog.
 *
 * One component for both because the shape is identical — a single name field.
 * Only the wording and the starting value differ, and two near-identical
 * dialogs would drift in validation the first time one of them changed.
 *
 * Client-side validation stops the empty case only. Duplicates, reserved names
 * and length limits stay the SERVER'S call: re-implementing them here would
 * create a second rulebook, and the browser cannot see the other roles' names
 * authoritatively anyway.
 */
export default function RoleFormDialog({ mode, role, busy, error, onCancel, onSubmit }) {
  /* Başlangıç değeri yeterlidir; alanı prop'a eşitleyen bir efekt YOK. Çağıran
     diyaloğu `key` ile ayırt ediyor, dolayısıyla başka bir rol için açıldığında
     bileşen yeniden kurulur ve önceki adı taşımaz. Efektle senkronlamak,
     kullanıcı yazarken araya giren bir render'ın yazılanı geri almasına açık
     kapı bırakırdı. */
  const [name, setName] = useState(role?.name ?? '')

  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape' && !busy) onCancel() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [busy, onCancel])

  const trimmed = name.trim()
  const renaming = mode === 'rename'
  // Rename with an unchanged name is a no-op request; do not offer it.
  const canSubmit = trimmed.length > 0 && !busy && (!renaming || trimmed !== role?.name)

  const submit = (event) => {
    event.preventDefault()
    if (canSubmit) onSubmit(trimmed)
  }

  return (
    <div
      className="admin-dialog-backdrop"
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel() }}
    >
      <form className="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="role-dialog-title" onSubmit={submit}>
        <h2 id="role-dialog-title">{renaming ? `${role.name} rolünü yeniden adlandır` : 'Yeni rol oluştur'}</h2>
        <p>
          {renaming
            ? 'Rolün kimliği, yetkileri ve kullanıcı üyelikleri korunur; yalnızca adı değişir.'
            : 'Yeni rol yetkisiz başlar. Yetkileri daha sonra yönetilecektir.'}
        </p>

        <label className="admin-role-field">
          Rol adı
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            autoFocus
            placeholder="Örn. Saha Ekibi"
          />
        </label>

        {/* Sunucunun kendi mesajı gösterilir ("… adında bir rol zaten var"),
            genel bir "hata oluştu" ile değiştirilmez: kullanıcıya ne yapması
            gerektiğini söyleyen tek metin odur. */}
        {error && <p className="admin-dialog-error" role="alert">{error}</p>}

        <div className="admin-dialog-actions">
          <button type="button" className="admin-button secondary" disabled={busy} onClick={onCancel}>İptal</button>
          <button type="submit" className="admin-button" disabled={!canSubmit}>
            {busy ? 'Kaydediliyor…' : renaming ? 'Kaydet' : 'Rol Oluştur'}
          </button>
        </div>
      </form>
    </div>
  )
}
