import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext.jsx'
import { approveUser, fetchAdminUser, fetchAdminUsers, fetchAssignableRoles, readApiError, rejectUser, updateUserRole, updateUserStatus } from '../services/api.js'
import AdminPageHeader from '../components/admin/AdminPageHeader.jsx'
import UserDetailPanel from '../components/admin/UserDetailPanel.jsx'
import UserManagementList from '../components/admin/UserManagementList.jsx'
import { STATUS_FILTERS } from '../components/admin/userStatus.js'
import './AdminPage.css'

const conflictMessage = 'Sistemde en az bir aktif Admin bulunmalıdır. Son aktif yönetici User yapılamaz veya pasifleştirilemez.'

export default function AdminPage() {
  const { userId } = useAuth()
  const [users, setUsers] = useState([])
  const [roles, setRoles] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [mutating, setMutating] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(null)
  const mutationInFlight = useRef(false)

  const loadUsers = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetchAdminUsers()
      if (!res.ok) throw new Error(res.status === 403 ? 'Bu işlem için yetkiniz bulunmuyor. Yönetici oturumunuzda MFA doğrulaması gerekli olabilir.' : await readApiError(res, 'Kullanıcılar yüklenemedi.'))
      setUsers(await res.json())
    } catch (err) { setError(err.message || 'Kullanıcılar yüklenemedi.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { loadUsers() }, [loadUsers])

  /* Assignable roles come from the server so the approval dropdown and the
     backend's validation share one source. A failure here is not fatal for the
     rest of the screen, so it does not take over the page-level error slot. */
  useEffect(() => { fetchAssignableRoles().then(async (res) => { if (res.ok) setRoles(await res.json()) }).catch(() => {}) }, [])

  const openDetail = useCallback(async (id) => {
    setSelectedId(id); setDetail(null); setDetailLoading(true); setError('')
    try {
      const res = await fetchAdminUser(id)
      if (!res.ok) throw new Error(res.status === 403 ? 'Bu işlem için yetkiniz bulunmuyor.' : await readApiError(res, 'Kullanıcı detayı yüklenemedi.'))
      setDetail(await res.json())
    } catch (err) { setError(err.message || 'Kullanıcı detayı yüklenemedi.'); setSelectedId(null) }
    finally { setDetailLoading(false) }
  }, [])

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('tr-TR')
    return users.filter((u) => (!term || u.username.toLocaleLowerCase('tr-TR').includes(term) || (u.email || '').toLocaleLowerCase('tr-TR').includes(term)) && (roleFilter === 'All' || u.role === roleFilter) && (statusFilter === 'All' || u.accountStatus === statusFilter))
  }, [users, search, roleFilter, statusFilter])

  const pendingCount = useMemo(() => users.filter((u) => u.accountStatus === 'PendingApproval').length, [users])

  /**
   * One mutation path for every admin action. `run` performs the request and
   * `describe` turns the updated user into the success message, so adding an
   * action does not mean re-implementing the in-flight guard, the error mapping
   * or the list/detail refresh.
   */
  const mutate = async (run, describe) => {
    if (!detail || mutationInFlight.current) return
    mutationInFlight.current = true
    setMutating(true)
    try {
      const res = await run(detail.id)
      if (!res.ok) throw new Error(res.status === 409 ? await readApiError(res, conflictMessage) : res.status === 403 ? 'Bu işlem için yetkiniz bulunmuyor.' : await readApiError(res, 'İşlem tamamlanamadı.'))
      const updated = await res.json()
      setDetail(updated); setUsers((all) => all.map((u) => u.id === updated.id ? { ...u, ...updated } : u))
      /* The account really did change even when the notification e-mail could
         not be delivered, so that case is a warning on a completed action —
         never an error that would invite the admin to retry. */
      setNotice(updated.notificationWarning
        ? { type: 'warning', message: `${describe(updated)} ${updated.notificationWarning}` }
        : { type: 'success', message: describe(updated) })
    } catch (err) { setNotice({ type: 'error', message: err.message || 'İşlem tamamlanamadı.' }) }
    finally { mutationInFlight.current = false; setMutating(false) }
  }

  const changeRole = (role) => mutate((id) => updateUserRole(id, role), () => role === 'Admin' ? `Rol Admin olarak değiştirildi.${detail.twoFactorEnabled ? '' : ' Kullanıcı bir sonraki girişinde zorunlu 2FA kurulumuna yönlendirilecektir.'}` : 'Rol User olarak değiştirildi. Mevcut 2FA ayarı korunmuştur.')
  const changeStatus = (active) => mutate((id) => updateUserStatus(id, active), () => active ? 'Hesap aktifleştirildi.' : 'Hesap pasifleştirildi. Kullanıcının çizimleri korunmuştur.')
  const approve = (role) => mutate((id) => approveUser(id, role), (u) => `${u.username} onaylandı ve ${role} rolüyle aktifleştirildi. Giriş yapabileceği kendisine e-postayla bildirildi.`)
  const reject = (reason) => mutate((id) => rejectUser(id, reason), (u) => `${u.username} başvurusu reddedildi. Hesap uygulamaya erişemeyecek.`)

  const emptyMessage = search.trim() ? 'Aramanızla eşleşen kullanıcı bulunamadı.' : roleFilter !== 'All' || statusFilter !== 'All' ? 'Seçili filtrelerle eşleşen kullanıcı bulunamadı.' : 'Henüz kullanıcı bulunmuyor.'
  /* Kabuk artık <main>, kendi başlığını ve haritaya dönüş bağlantısını taşıyor.
     Burada ikinci bir <main> ya da ikinci bir "← Haritaya dön" bırakmak, sayfada
     iç içe iki kabuk ve iki gezinme yolu demek olurdu. Ekranın İŞLEVSEL içeriği
     (filtreler, liste, detay çekmecesi, tüm API çağrıları) olduğu gibi durur. */
  return <div className="admin-users-page">
    <AdminPageHeader title="Kullanıcılar" description="Sistemdeki kullanıcıları görüntüleyin ve yönetin." />
    {pendingCount > 0 && <button type="button" className="admin-pending-banner" onClick={() => setStatusFilter('PendingApproval')}><strong>{pendingCount} hesap onay bekliyor.</strong><span>Onay bekleyenleri göster →</span></button>}
    {notice && <div className={`admin-notice is-${notice.type}`} role="status">{notice.message}<button type="button" onClick={() => setNotice(null)} aria-label="Bildirimi kapat">×</button></div>}
    <section className="admin-toolbar" aria-label="Kullanıcı filtreleri">
      <label className="admin-search"><span className="sr-only">Kullanıcı ara</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Kullanıcı veya e-posta ara..." /></label>
      <label>Rol<select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}><option value="All">Tümü</option><option value="Admin">Admin</option><option value="User">User</option></select></label>
      <label>Durum<select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>{STATUS_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</select></label>
    </section>
    {error && <div className="admin-error" role="alert"><span>{error}</span><button type="button" onClick={loadUsers}>Tekrar dene</button></div>}
    <UserManagementList users={filteredUsers} currentUserId={userId} loading={loading} selectedId={selectedId} onSelect={openDetail} emptyMessage={emptyMessage} />
    {(selectedId || detailLoading) && <UserDetailPanel user={detail} currentUserId={userId} loading={detailLoading} mutating={mutating} roles={roles} onClose={() => { setSelectedId(null); setDetail(null) }} onChangeRole={changeRole} onChangeStatus={changeStatus} onApprove={approve} onReject={reject} />}
  </div>
}
