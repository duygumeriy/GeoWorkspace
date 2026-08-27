import { useEffect, useState } from 'react'

const DEFAULT_COLOR = '#2563EB'
const COLOR_PATTERN = /^#[0-9A-F]{6}$/i

function normalizeColor(value) {
  return COLOR_PATTERN.test(value.trim()) ? value.trim().toUpperCase() : null
}

export default function TransportRouteDialog({ route, busy, error, onCancel, onSubmit }) {
  const editing = Boolean(route)
  const [name, setName] = useState(route?.name ?? '')
  const [colorHex, setColorHex] = useState(route?.colorHex ?? DEFAULT_COLOR)
  const canonicalColor = normalizeColor(colorHex)
  const canSubmit = name.trim().length > 0 && canonicalColor !== null && !busy

  useEffect(() => {
    const close = (event) => { if (event.key === 'Escape' && !busy) onCancel() }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [busy, onCancel])

  const submit = (event) => {
    event.preventDefault()
    if (!canSubmit) return
    onSubmit({ name: name.trim(), colorHex: canonicalColor })
  }

  return (
    <div className="admin-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel()
    }}>
      <form
        className="admin-dialog transport-route-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transport-route-dialog-title"
        onSubmit={submit}
      >
        <h2 id="transport-route-dialog-title">{editing ? 'Güzergahı Düzenle' : 'Yeni Güzergah'}</h2>
        <p>Güzergah adı ve haritada kullanılacak kanonik renk değerini belirleyin.</p>

        <label className="transport-route-field">
          Güzergah Adı
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} disabled={busy} autoFocus />
        </label>

        <div className="transport-route-field">
          <span>Renk</span>
          <div className="transport-route-color-inputs">
            <input
              type="color"
              aria-label="Güzergah rengi"
              value={canonicalColor ?? DEFAULT_COLOR}
              onChange={(event) => setColorHex(event.target.value.toUpperCase())}
              disabled={busy}
            />
            <input
              aria-label="Renk hex değeri"
              value={colorHex}
              onChange={(event) => setColorHex(event.target.value)}
              placeholder="#2563EB"
              maxLength={7}
              disabled={busy}
            />
          </div>
          {!canonicalColor && <small className="transport-route-validation">Renk #RRGGBB biçiminde olmalıdır.</small>}
        </div>

        {error && <p className="admin-dialog-error" role="alert">{error}</p>}

        <div className="admin-dialog-actions">
          <button type="button" className="admin-button secondary" onClick={onCancel} disabled={busy}>İptal</button>
          <button type="submit" className="admin-button" disabled={!canSubmit}>
            {busy ? 'Kaydediliyor…' : editing ? 'Değişiklikleri Kaydet' : 'Güzergah Oluştur'}
          </button>
        </div>
      </form>
    </div>
  )
}
