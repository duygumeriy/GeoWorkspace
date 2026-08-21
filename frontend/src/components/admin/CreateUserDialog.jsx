import { useEffect, useRef, useState } from 'react'

export default function CreateUserDialog({ roles, busy, error, onCancel, onSubmit }) {
  const usernameRef = useRef(null)
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')

  useEffect(() => { usernameRef.current?.focus() }, [])
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape' && !busy) onCancel() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [busy, onCancel])

  const canSubmit = username.trim() && email.trim() && role && !busy
  const submit = (event) => {
    event.preventDefault()
    if (canSubmit) onSubmit({ username: username.trim(), email: email.trim(), role })
  }

  return <div className="admin-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel() }}>
    <form className="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="create-user-title" onSubmit={submit}>
      <h2 id="create-user-title">Kullanıcı Ekle</h2>
      <p>Kullanıcı parolasını davet bağlantısından kendisi belirleyecektir.</p>
      <div className="admin-create-user-fields">
        <label>Kullanıcı adı<input ref={usernameRef} value={username} required disabled={busy} autoComplete="off" onChange={(event) => setUsername(event.target.value)} /></label>
        <label>E-posta<input type="email" value={email} required disabled={busy} autoComplete="email" onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Rol<select value={role} required disabled={busy} onChange={(event) => setRole(event.target.value)}><option value="">Rol seçin…</option>{roles.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
      </div>
      {error && <p className="admin-dialog-error" role="alert">{error}</p>}
      <div className="admin-dialog-actions"><button type="button" className="admin-button secondary" disabled={busy} onClick={onCancel}>İptal</button><button type="submit" className="admin-button" disabled={!canSubmit}>{busy ? 'Oluşturuluyor…' : 'Kullanıcı Oluştur'}</button></div>
    </form>
  </div>
}
