import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createAdminRole,
  deleteAdminRole,
  fetchAdminRoles,
  readApiError,
  renameAdminRole,
} from '../../services/api.js'
import { useRolePermissions } from '../../hooks/useRolePermissions.js'
import AdminPageHeader from '../../components/admin/AdminPageHeader.jsx'
import RoleDetailPanel from '../../components/admin/RoleDetailPanel.jsx'
import RoleFormDialog from '../../components/admin/RoleFormDialog.jsx'
import RoleList from '../../components/admin/RoleList.jsx'
import './RolesPage.css'

/**
 * Role management.
 *
 * The source is `GET /api/admin/roles` — the GLOBAL inventory. Deliberately not
 * `/api/admin/users/roles`, which answers "what may I assign" and is narrower:
 * an administrator must be able to manage a role they cannot personally grant,
 * and filtering this screen by assignment authority would hide real roles.
 *
 * Every mutation re-reads the list rather than patching state locally. Counts
 * and capability flags are the server's to compute, and a delete or rename can
 * change more than the row it touched. The one exception is a permission save:
 * that response already CARRIES the updated role, so the row is refreshed from
 * it instead of paying for a second round trip.
 */
export default function RolesPage() {
  const [roles, setRoles] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(null)

  // 'create' | 'rename' | 'delete' | null — only one at a time.
  const [dialog, setDialog] = useState(null)
  const [dialogError, setDialogError] = useState('')
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)

  /* Kaydedilmemiş yetki değişikliği varken engellenen geçiş. Doğrudan
     uygulanmaz; onay verilirse burada saklanan hareket yapılır. */
  const [pending, setPending] = useState(null)

  const loadRoles = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetchAdminRoles()
      if (!res.ok) {
        throw new Error(res.status === 403
          ? 'Rolleri görüntüleme yetkiniz bulunmuyor. Yönetici oturumunuzda MFA doğrulaması gerekli olabilir.'
          : await readApiError(res, 'Roller yüklenemedi.'))
      }
      setRoles(await res.json())
    } catch (err) {
      setError(err.message || 'Roller yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadRoles() }, [loadRoles])

  /* Seçili rol daima LİSTEDEN okunur, ayrı bir kopyadan değil: yeniden
     adlandırmadan sonra açık kalan detayın eski adı göstermesi ancak ikinci bir
     kopya tutulursa mümkün olurdu. Rol silindiyse burada kendiliğinden yok
     olur. */
  const selected = useMemo(
    () => roles.find((role) => role.id === selectedId) ?? null,
    [roles, selectedId],
  )

  useEffect(() => {
    if (selectedId !== null && !loading && !selected) setSelectedId(null)
  }, [selectedId, selected, loading])

  /* Yetki matrisi YALNIZCA seçili rol için okunur. Kanca `selectedId`'yi izler;
     liste yüklenirken hiçbir yetki isteği açılmaz. */
  const permissions = useRolePermissions(selectedId)
  const { dirty } = permissions

  /**
   * Kaydedilmemiş değişiklik varken geçişi onaya bağlar.
   *
   * Korunan hareketler: detayın KAPATILMASI (kapat düğmesi, perde, Escape) ve
   * başka bir role geçiş.
   *
   * Rota için ayrı bir engelleyici YAZILMAZ ve buna gerek de yoktur: detay
   * modal bir çekmecedir, perdesi kenar çubuğu dâhil sayfanın tamamını kapatır.
   * Kaydedilmemiş bir seçim varken /admin/roles'tan çıkmanın tek yolu önce
   * detayı kapatmaktır ve o yol zaten buradan geçer. Uygulama `BrowserRouter`
   * kullandığı için `useBlocker` da yoktur; router'ın içine girmek, var olmayan
   * bir kaçış yolunu kapatmak için ödenecek bir bedel olurdu.
   */
  function applyTransition(action) {
    if (action.type === 'select') setSelectedId(action.id)
    else if (action.type === 'close') setSelectedId(null)
  }

  function guard(action) {
    if (dirty) { setPending(action); return }
    applyTransition(action)
  }

  /**
   * Yetki kaydı. Diğer mutasyonlardan ayrıdır çünkü listeyi yeniden OKUMAZ:
   * yanıt rolün güncel hâlini (yetki sayımı dâhil) zaten taşır, dolayısıyla
   * satır ondan tazelenir. Başarısızlıkta hiçbir sayım değişmez — olmamış bir
   * kaydetmeyi olmuş gibi göstermek, yetki ekranını güvenilmez kılardı.
   */
  const savePermissions = async () => {
    const saved = await permissions.save()
    if (!saved) return
    setRoles((current) => current.map((row) => (row.id === saved.id ? saved : row)))
    setNotice({ type: 'success', message: `'${saved.name}' rolünün yetkileri güncellendi.` })
  }

  /**
   * One path for every mutation: guard against double submits, map the failure,
   * then re-read from the server. `describe` turns the outcome into the notice.
   */
  const mutate = async (run, describe, { onDialogError } = {}) => {
    if (inFlight.current) return false
    inFlight.current = true
    setBusy(true); setDialogError('')
    try {
      const res = await run()
      if (!res.ok) {
        const message = res.status === 403
          ? 'Bu işlem için yetkiniz bulunmuyor.'
          : await readApiError(res, 'İşlem tamamlanamadı.')
        throw new Error(message)
      }
      /* Liste sunucudan yeniden okunur. Satırı yerel olarak düzeltmek,
         sayımların ve yetenek bayraklarının gerçekle ayrışmasına açık kapı
         bırakırdı. */
      await loadRoles()
      setNotice({ type: 'success', message: describe() })
      return true
    } catch (err) {
      const message = err.message || 'İşlem tamamlanamadı.'
      if (onDialogError) onDialogError(message)
      else setNotice({ type: 'error', message })
      return false
    } finally {
      inFlight.current = false; setBusy(false)
    }
  }

  const submitCreate = async (name) => {
    const ok = await mutate(
      () => createAdminRole(name),
      () => `'${name}' rolü oluşturuldu. Yetkileri henüz tanımlı değil.`,
      { onDialogError: setDialogError },
    )
    // Dialog only closes on success or an explicit cancel — never on an error
    // that the person still needs to read and correct.
    if (ok) setDialog(null)
  }

  const submitRename = async (name) => {
    const previous = selected.name
    const ok = await mutate(
      () => renameAdminRole(selected.id, name),
      () => `'${previous}' rolünün adı '${name}' olarak güncellendi.`,
      { onDialogError: setDialogError },
    )
    if (ok) setDialog(null)
  }

  const submitDelete = async () => {
    const target = selected
    const ok = await mutate(
      () => deleteAdminRole(target.id),
      () => `'${target.name}' rolü silindi.`,
    )
    /* Başarısız silmede rol listede KALIR ve detay açık kalır: iyimser bir
       kaldırma, sunucunun reddettiği bir silmeyi olmuş gibi gösterirdi. */
    setDialog(null)
    if (ok) setSelectedId(null)
  }

  return (
    <div className="admin-roles-page">
      <AdminPageHeader
        title="Roller"
        description="Kullanıcı rollerini görüntüleyin ve özel roller oluşturup yönetin."
      />

      <div className="admin-roles-toolbar">
        {/* Yalnızca backend'in gerçekten desteklediği eylem sunulur. */}
        <button type="button" className="admin-button" onClick={() => { setDialogError(''); setDialog('create') }}>
          + Yeni Rol
        </button>
      </div>

      {notice && (
        <div className={`admin-notice is-${notice.type}`} role="status">
          {notice.message}
          <button type="button" onClick={() => setNotice(null)} aria-label="Bildirimi kapat">×</button>
        </div>
      )}

      {error && (
        <div className="admin-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={loadRoles}>Tekrar dene</button>
        </div>
      )}

      <RoleList
        roles={roles}
        loading={loading}
        selectedId={selectedId}
        onSelect={(id) => guard({ type: 'select', id })}
      />

      {selected && (
        <RoleDetailPanel
          role={selected}
          busy={busy || permissions.saving}
          permissions={{
            permissions: permissions.permissions,
            selected: permissions.selected,
            loading: permissions.loading,
            error: permissions.error,
            saving: permissions.saving,
            saveError: permissions.saveError,
            dirty: permissions.dirty,
            onToggle: permissions.toggle,
            onSetCategory: permissions.setCategorySelection,
            onReset: permissions.reset,
            onSave: savePermissions,
            onRetry: permissions.reload,
          }}
          onClose={() => guard({ type: 'close' })}
          onRename={() => { setDialogError(''); setDialog('rename') }}
          onDelete={() => setDialog('delete')}
        />
      )}

      {pending && (
        <div className="admin-dialog-backdrop" role="presentation">
          <div className="admin-dialog" role="alertdialog" aria-modal="true" aria-labelledby="perm-discard-title">
            <h2 id="perm-discard-title">Kaydedilmemiş yetki değişiklikleri var.</h2>
            <p>Değişiklikleri kaybetmek istediğinize emin misiniz?</p>
            <div className="admin-dialog-actions">
              {/* Vazgeçmek düzenleyiciyi OLDUĞU GİBİ bırakır: seçim de kirli
                  durum da korunur, hiçbir istek açılmaz. */}
              <button type="button" className="admin-button secondary" onClick={() => setPending(null)}>
                Düzenlemeye Dön
              </button>
              <button
                type="button"
                className="admin-button danger"
                onClick={() => { const action = pending; setPending(null); applyTransition(action) }}
              >
                Değişiklikleri Yoksay
              </button>
            </div>
          </div>
        </div>
      )}

      {(dialog === 'create' || dialog === 'rename') && (
        <RoleFormDialog
          /* Oluşturma ve her rolün yeniden adlandırması ayrı birer örnektir:
             alan başlangıç değerini kurulumda alır, prop senkronu gerekmez. */
          key={dialog === 'rename' ? `rename-${selected?.id}` : 'create'}
          mode={dialog}
          role={dialog === 'rename' ? selected : null}
          busy={busy}
          error={dialogError}
          onCancel={() => { setDialog(null); setDialogError('') }}
          onSubmit={dialog === 'rename' ? submitRename : submitCreate}
        />
      )}

      {dialog === 'delete' && selected && (
        <div className="admin-dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setDialog(null) }}>
          <div className="admin-dialog" role="alertdialog" aria-modal="true" aria-labelledby="role-delete-title" aria-describedby="role-delete-copy">
            <h2 id="role-delete-title">'{selected.name}' rolünü silmek istediğinize emin misiniz?</h2>
            <p id="role-delete-copy">
              Bu işlem geri alınamaz. Rolü taşıyan kullanıcı varsa sunucu silmeyi reddeder; kullanıcılar
              kendiliğinden başka bir role TAŞINMAZ.
            </p>
            <div className="admin-dialog-actions">
              <button type="button" className="admin-button secondary" disabled={busy} onClick={() => setDialog(null)}>İptal</button>
              <button type="button" className="admin-button danger" disabled={busy} onClick={submitDelete}>
                {busy ? 'Siliniyor…' : 'Rolü Sil'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
