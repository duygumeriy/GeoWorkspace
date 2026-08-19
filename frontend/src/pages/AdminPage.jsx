import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext.jsx'
import { usePermissions } from '../auth/permissionStore.js'
import { PERMISSIONS } from '../auth/permissionCodes.js'
import { approveUser, fetchAdminUser, fetchAdminUserPermissions, fetchAdminUsers, fetchAssignableRoles, readApiError, rejectUser, updateAdminUserPermissions, updateUserRole, updateUserStatus } from '../services/api.js'
import AdminPageHeader from '../components/admin/AdminPageHeader.jsx'
import UserDetailPanel from '../components/admin/UserDetailPanel.jsx'
import UserManagementList from '../components/admin/UserManagementList.jsx'
import { roleFilterOptions } from '../components/admin/userRoles.js'
import { directActiveCodes, sameSet } from '../components/admin/userPermissions.js'
import { STATUS_FILTERS } from '../components/admin/userStatus.js'
import './AdminPage.css'

const conflictMessage = 'Sistemde en az bir aktif Admin bulunmalıdır. Son aktif yönetici User yapılamaz veya pasifleştirilemez.'

export default function AdminPage() {
  const { userId } = useAuth()
  /* Ekrandaki her eylem, ARKASINDAKİ ucun aradığı yetkiyi ister. Rol değişimi,
     hesap durumu, onay ve red hepsi aynı uçtan (users.update) geçer — backend
     users.create / users.deactivate / users.delete için bir uç TANIMLAMAZ, bu
     yüzden burada onlara karşılık gelen bir düğme de uydurulmaz. */
  const { can, refreshPermissions } = usePermissions()
  const canUpdateUser = can(PERMISSIONS.USERS_UPDATE)
  const canViewPermissions = can(PERMISSIONS.PERMISSIONS_VIEW)
  /* Doğrudan yetki KAYDETME ucu users.update + permissions.assign ister. */
  const canAssignDirect = canUpdateUser && can(PERMISSIONS.PERMISSIONS_ASSIGN)
  /* Atanabilir rol listesi roles.view ile korunur; yetkisi olmayana rol
     açılır listesi sunmak, doldurulamayacak bir alan göstermek olurdu. */
  const canViewRoles = can(PERMISSIONS.ROLES_VIEW)
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

  /* --- Kullanıcıya özel yetkiler --------------------------------------------
     Ayrı durum tutulur çünkü ayrı bir kaynaktır: detay çağrısı hesabı anlatır,
     bu çağrı yetki tablosunu. Tek isteğe birleştirmek, yetkilere hiç bakmayan
     yönetici için her detay açılışını pahalılaştırırdı.

     `baseline` sunucunun onayladığı son durumdur; `selected` üzerinde çalışılan
     kümedir. Kirlilik SIRAYA değil ÜYELİĞE bakar. */
  const [permissionData, setPermissionData] = useState(null)
  const [permissionBaseline, setPermissionBaseline] = useState(() => new Set())
  const [permissionSelected, setPermissionSelected] = useState(() => new Set())
  const [permissionLoading, setPermissionLoading] = useState(false)
  const [permissionError, setPermissionError] = useState('')
  const [permissionSaving, setPermissionSaving] = useState(false)
  const [permissionSaveError, setPermissionSaveError] = useState('')

  const adoptPermissions = useCallback((payload) => {
    setPermissionData(payload)
    const direct = directActiveCodes(payload.permissions)
    setPermissionBaseline(direct)
    setPermissionSelected(new Set(direct))
    setPermissionSaveError('')
  }, [])

  const loadPermissions = useCallback(async (id) => {
    /* GET .../permissions users.view + permissions.view ister. İkincisi yoksa
       istek 403 döner; hiç açmamak, sekmeyi bir hata mesajıyla doldurmaktan
       dürüsttür — sekme zaten gösterilmiyor. */
    if (!canViewPermissions) return
    setPermissionLoading(true); setPermissionError('')
    try {
      const res = await fetchAdminUserPermissions(id)
      if (!res.ok) throw new Error(res.status === 403 ? 'Yetkileri görüntülemek için gerekli yetkiye sahip değilsiniz.' : await readApiError(res, 'Kullanıcı yetkileri yüklenemedi.'))
      adoptPermissions(await res.json())
    } catch (err) { setPermissionError(err.message || 'Kullanıcı yetkileri yüklenemedi.') }
    finally { setPermissionLoading(false) }
  }, [adoptPermissions, canViewPermissions])

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
  useEffect(() => {
    if (!canViewRoles) return
    fetchAssignableRoles().then(async (res) => { if (res.ok) setRoles(await res.json()) }).catch(() => {})
  }, [canViewRoles])

  const openDetail = useCallback(async (id) => {
    setSelectedId(id); setDetail(null); setDetailLoading(true); setError('')
    /* Yetki tablosu detayla BİRLİKTE yüklenir: sekmeye tıklandığında beklemek,
       en çok bakılan bilginin arkasına gereksiz bir gecikme koyardı. */
    setPermissionData(null); setPermissionBaseline(new Set()); setPermissionSelected(new Set())
    loadPermissions(id)
    try {
      const res = await fetchAdminUser(id)
      if (!res.ok) throw new Error(res.status === 403 ? 'Bu işlem için yetkiniz bulunmuyor.' : await readApiError(res, 'Kullanıcı detayı yüklenemedi.'))
      setDetail(await res.json())
    } catch (err) { setError(err.message || 'Kullanıcı detayı yüklenemedi.'); setSelectedId(null) }
    finally { setDetailLoading(false) }
  }, [loadPermissions])

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('tr-TR')
    return users.filter((u) => (!term || u.username.toLocaleLowerCase('tr-TR').includes(term) || (u.email || '').toLocaleLowerCase('tr-TR').includes(term)) && (roleFilter === 'All' || u.role === roleFilter) && (statusFilter === 'All' || u.accountStatus === statusFilter))
  }, [users, search, roleFilter, statusFilter])

  const pendingCount = useMemo(() => users.filter((u) => u.accountStatus === 'PendingApproval').length, [users])

  /* Roller artık dinamik: sabit bir Admin/User listesi, Viewer veya özel bir
     role sahip kullanıcıyı filtrelenemez yapardı. Seçenekler ekrandaki veriden
     türer, bu yüzden yeni bir rol tanımlandığında burada kod değişmez. */
  const roleOptions = useMemo(() => roleFilterOptions(users), [users])

  /* Seçili rol listeden düşebilir (o rolü taşıyan son kullanıcı başka bir role
     alındığında). Filtre o değerde kalırsa açılır liste eşleşmeyen bir değer
     gösterir ve liste görünür bir sebep olmadan boşalır. */
  useEffect(() => {
    if (roleFilter !== 'All' && !roleOptions.includes(roleFilter)) setRoleFilter('All')
  }, [roleOptions, roleFilter])

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
      /* Rol veya hesap durumu değişti: KALITIM ve ETKİNLİK artık farklı olabilir.
         Bayat bir "GIS Editor rolünden" etiketi bırakmak, yöneticiye artık
         doğru olmayan bir kaynak göstermek olurdu. */
      loadPermissions(updated.id)
      /* Rol değişimi AKTÖRÜN kendi hesabını da hedefliyor olabilir ve rol,
         etkin yetkilerin kaynağıdır. Hedefin kim olduğuna bakıp koşullu
         tazelemek aynı soruyu tarayıcıda ikinci kez cevaplamak olurdu. */
      refreshPermissions()
      /* The account really did change even when the notification e-mail could
         not be delivered, so that case is a warning on a completed action —
         never an error that would invite the admin to retry. */
      setNotice(updated.notificationWarning
        ? { type: 'warning', message: `${describe(updated)} ${updated.notificationWarning}` }
        : { type: 'success', message: describe(updated) })
    } catch (err) { setNotice({ type: 'error', message: err.message || 'İşlem tamamlanamadı.' }) }
    finally { mutationInFlight.current = false; setMutating(false) }
  }

  /* Mesaj, atanan rolün ADINI söyler. Eskiden "Admin ise şunu, değilse User"
     diye iki dallıydı; dinamik rollerde bu, GIS Editor yapılan bir kullanıcı
     için "Rol User olarak değiştirildi" gibi yanlış bir cümle üretiyordu.
     Zorunlu 2FA uyarısı da rol ADINDAN değil, sunucunun o rol için bildirdiği
     `requiresTwoFactor` alanından gelir — zaten yüklü olan veriden, ek istek
     yok. */
  const changeRole = (role) => mutate((id) => updateUserRole(id, role), (u) => {
    const needsTwoFactorSetup = roles.find((r) => r.name === role)?.requiresTwoFactor && !u.twoFactorEnabled
    return `Kullanıcının rolü ${role} olarak güncellendi.${needsTwoFactorSetup ? ' Kullanıcı bir sonraki girişinde zorunlu 2FA kurulumuna yönlendirilecektir.' : ''}`
  })
  const changeStatus = (active) => mutate((id) => updateUserStatus(id, active), () => active ? 'Hesap aktifleştirildi.' : 'Hesap pasifleştirildi. Kullanıcının çizimleri korunmuştur.')
  const approve = (role) => mutate((id) => approveUser(id, role), (u) => `${u.username} onaylandı ve ${role} rolüyle aktifleştirildi. Giriş yapabileceği kendisine e-postayla bildirildi.`)
  const reject = (reason) => mutate((id) => rejectUser(id, reason), (u) => `${u.username} başvurusu reddedildi. Hesap uygulamaya erişemeyecek.`)

  const togglePermission = (code) => {
    setPermissionSelected((current) => {
      const next = new Set(current)
      if (next.has(code)) next.delete(code); else next.add(code)
      return next
    })
    setPermissionSaveError('')
  }

  /* Geri alma SUNUCUYA GİTMEZ: son onaylanmış durum zaten elimizde. İstek
     atmak, aynı veriyi ikinci kez indirmek ve ağ hatasıyla "geri al"ı
     başarısız kılabilmek olurdu. */
  const resetPermissions = () => {
    setPermissionSelected(new Set(permissionBaseline))
    setPermissionSaveError('')
  }

  const savePermissions = async () => {
    if (permissionSaving || !selectedId) return
    setPermissionSaving(true); setPermissionSaveError('')
    try {
      const res = await updateAdminUserPermissions(selectedId, [...permissionSelected])
      if (!res.ok) {
        throw new Error(res.status === 403
          ? 'Bu kullanıcıya seçilen yetkiyi atamak için gerekli yetkiye sahip değilsiniz.'
          : await readApiError(res, 'Yetkiler kaydedilemedi.'))
      }
      /* Sunucunun döndürdüğü durum YENİ temeldir. İsteği kendi seçimimizle
         "başarılı saymak", sunucunun koruduğu pasif kayıtları ve tazelenmiş
         kaynak etiketlerini kaçırırdı. */
      adoptPermissions(await res.json())
      // Hedef, aktörün kendisi olabilir: doğrudan yetkiler de etkin kümeye girer.
      refreshPermissions()
      setNotice({ type: 'success', message: 'Kullanıcıya özel yetkiler güncellendi.' })
    } catch (err) {
      /* Başarısız kaydetmede seçim KORUNUR: yönetici 27 satırı yeniden
         işaretlemek zorunda kalmadan düzeltip tekrar deneyebilsin. */
      setPermissionSaveError(err.message || 'Yetkiler kaydedilemedi.')
    } finally { setPermissionSaving(false) }
  }

  const permissionSection = {
    data: permissionData,
    selected: permissionSelected,
    baseline: permissionBaseline,
    loading: permissionLoading,
    error: permissionError,
    saving: permissionSaving,
    saveError: permissionSaveError,
    dirty: !sameSet(permissionBaseline, permissionSelected),
    canEdit: canAssignDirect,
    onToggle: togglePermission,
    onReset: resetPermissions,
    onSave: savePermissions,
    onRetry: () => loadPermissions(selectedId),
  }

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
      <label>Rol<select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}><option value="All">Tümü</option>{roleOptions.map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
      <label>Durum<select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>{STATUS_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</select></label>
    </section>
    {error && <div className="admin-error" role="alert"><span>{error}</span><button type="button" onClick={loadUsers}>Tekrar dene</button></div>}
    <UserManagementList users={filteredUsers} currentUserId={userId} loading={loading} selectedId={selectedId} onSelect={openDetail} emptyMessage={emptyMessage} />
    {(selectedId || detailLoading) && <UserDetailPanel user={detail} currentUserId={userId} loading={detailLoading} mutating={mutating} roles={roles} permissions={permissionSection} canUpdate={canUpdateUser} canViewPermissions={canViewPermissions} onClose={() => { setSelectedId(null); setDetail(null) }} onChangeRole={changeRole} onChangeStatus={changeStatus} onApprove={approve} onReject={reject} />}
  </div>
}
