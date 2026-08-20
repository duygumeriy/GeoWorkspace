import { useEffect, useRef, useState } from 'react'
import { accountStatusBadge, isPendingApproval, mfaLabel } from './userStatus.js'
import { isAdministrativeRole } from '../../auth/roles.js'
import GeographicAuthorizationEditor from './GeographicAuthorizationEditor.jsx'
import UserPermissionEditor from './UserPermissionEditor.jsx'

const formatDate = (value) => new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))

/**
 * Confirmation step for every destructive or state-changing action.
 *
 * `withReason` turns it into a small form: the rejection note is optional and
 * is an internal record, so it is captured here rather than on the panel where
 * it would look like something the user receives.
 */
function ConfirmDialog({ config, busy, onCancel, onConfirm }) {
  const cancelRef = useRef(null)
  const [reason, setReason] = useState('')
  useEffect(() => { cancelRef.current?.focus() }, [])
  useEffect(() => { const fn = (e) => { if (e.key === 'Escape' && !busy) onCancel() }; document.addEventListener('keydown', fn); return () => document.removeEventListener('keydown', fn) }, [busy, onCancel])
  return <div className="admin-dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel() }}><div className="admin-dialog" role="alertdialog" aria-modal="true" aria-labelledby="admin-confirm-title" aria-describedby="admin-confirm-copy"><h2 id="admin-confirm-title">{config.title}</h2><p id="admin-confirm-copy">{config.copy}</p>
    {config.withReason && <label className="admin-reason">Gerekçe (isteğe bağlı)<textarea value={reason} maxLength={500} rows={3} disabled={busy} onChange={(e) => setReason(e.target.value)} placeholder="Yalnızca yönetici kayıtlarında saklanır; kullanıcıya gönderilmez." /></label>}
    <div className="admin-dialog-actions"><button ref={cancelRef} type="button" className="admin-button secondary" disabled={busy} onClick={onCancel}>İptal</button><button type="button" className={`admin-button ${config.danger ? 'danger' : ''}`} disabled={busy} onClick={() => onConfirm(reason.trim())}>{busy ? 'İşleniyor…' : config.action}</button></div></div></div>
}

/**
 * Approval section, shown only while the account is waiting for a decision.
 *
 * "Onayla ve Aktifleştir" stays disabled until every precondition the backend
 * enforces is visibly met, so the button never offers an action that would
 * come back as an error.
 */
function ApprovalSection({ user, roles, selectedRole, onSelectRole, mutating, canUpdate, onApprove, onReject }) {
  const chosen = roles.find((r) => r.name === selectedRole)
  const blocked = !user.emailConfirmed
  return <section className="admin-management admin-approval">
    <h3>Hesap Onayı</h3>
    <p className="admin-approval-lead">Bu kullanıcı e-posta adresini doğruladı ve yönetici kararı bekliyor. Onaylandığında seçilen rolle uygulamaya giriş yapabilecek.</p>
    {/* Onay ve red AYNI ucu (users.update) kullanır; yetkisi olmayana karar
        kontrolleri hiç sunulmaz, ekran yalnızca durumu anlatır. */}
    {!canUpdate
      ? <p className="admin-policy-note">Bu başvuruyu karara bağlamak için kullanıcı düzenleme yetkiniz yok.</p>
      : <>
          {blocked && <p className="admin-policy-note" role="alert">Kullanıcı e-posta adresini henüz doğrulamadı; doğrulanmadan onaylanamaz.</p>}
          <label>Rol<select value={selectedRole} disabled={mutating || blocked} onChange={(e) => onSelectRole(e.target.value)}><option value="">Rol seçin…</option>{roles.map((role) => <option key={role.name} value={role.name}>{role.name}</option>)}</select></label>
          {chosen && <div className="admin-role-preview"><strong>Rol ile gelecek erişim</strong><p>{chosen.description}</p>{chosen.requiresTwoFactor && <p className="admin-role-note">Bu rolde iki faktörlü doğrulama zorunludur; kullanıcı ilk girişinde kurulum yapacaktır.</p>}</div>}
          <div className="admin-approval-actions">
            <button type="button" className="admin-button danger" disabled={mutating} onClick={onReject}>Reddet</button>
            <button type="button" className="admin-button" disabled={mutating || blocked || !selectedRole} onClick={onApprove}>Onayla ve Aktifleştir</button>
          </div>
        </>}
  </section>
}

export default function UserDetailPanel({ user, currentUserId, loading, mutating, roles, permissions, geography, canUpdate = true, canViewPermissions = true, onClose, onChangeRole, onChangeStatus, onApprove, onReject }) {
  const [confirm, setConfirm] = useState(null)
  const [geographyOpen, setGeographyOpen] = useState(false)
  const [selectedRole, setSelectedRole] = useState('')
  const [tab, setTab] = useState('general')
  /* Kaydedilmemiş yetki değişikliği varken paneli kapatmak veya rolü
     değiştirmek, kullanıcının işaretlediklerini sessizce çöpe atardı. Rol
     değişikliği ayrıca KALITIMI değiştirir: kaydedilmemiş seçim, artık geçerli
     olmayan bir kaynak tablosunun üzerine yazılırdı. */
  const permissionsDirty = permissions?.dirty === true
  const guard = (run) => permissionsDirty
    ? setConfirm({ kind: 'discard', run, title: 'Kaydedilmemiş yetki değişiklikleri var', copy: 'Bu kullanıcı için işaretlediğiniz doğrudan yetkiler henüz kaydedilmedi. Devam ederseniz değişiklikler kaybolur.', action: 'Değişiklikleri Yoksay', danger: true })
    : run()
  const requestClose = () => guard(onClose)
  /* Coğrafi yetki penceresi AÇIKKEN Escape onundur: burada da kapatmak,
     tek tuşla iki katmanı birden kapatır ve haritadaki kaydedilmemiş alanın
     onayını atlardı. */
  useEffect(() => { const fn = (e) => { if (e.key === 'Escape' && !confirm && !geographyOpen) requestClose() }; document.addEventListener('keydown', fn); return () => document.removeEventListener('keydown', fn) })
  // A fresh account starts with no pre-selected role on purpose: choosing one
  // is the administrator's decision, not a default they have to notice.
  useEffect(() => { setSelectedRole(''); setTab('general'); setGeographyOpen(false) }, [user?.id])
  /* Yetki sekmesinin arkasındaki GET users.view + permissions.view ister.
     İkincisi olmadan sekme yalnızca bir 403 gösterirdi. */
  useEffect(() => { if (!canViewPermissions && tab === 'permissions') setTab('general') }, [canViewPermissions, tab])
  /* Onay metni rolün ADINDAN değil, sunucunun o rol için verdiği açıklamadan
     kurulur. "Admin ise şu, değilse User" dallanması dinamik rollerde yanlış
     cümleler üretiyordu: GIS Editor yapılan biri için "yönetici yetkilerini
     kaybedecek" denmesi gibi. */
  const requestRole = (role) => guard(() => {
    const target = roles.find((r) => r.name === role)
    const parts = [target?.description ?? `Kullanıcının rolü ${role} olarak değiştirilecek.`]
    if (target?.requiresTwoFactor && !user.twoFactorEnabled) {
      parts.push('Bu rolde iki faktörlü doğrulama zorunludur; kullanıcı sonraki girişinde kurulum yapacaktır.')
    }
    if (user.id === currentUserId) {
      parts.push('Kendi hesabınızı değiştiriyorsunuz; mevcut oturum kısa süre eski yetkileri taşıyabilir.')
    }
    setConfirm({ kind: 'role', value: role, title: `${user.username} kullanıcısının rolü ${role} olsun mu?`, copy: parts.join(' '), action: 'Rolü Değiştir' })
  })
  const requestStatus = (active) => setConfirm({ kind: 'status', value: active, title: `${user.username} hesabı ${active ? 'aktifleştirilsin' : 'pasifleştirilsin'} mi?`, copy: active ? 'Rol, e-posta doğrulaması, 2FA ve çizim sahipliği değişmeden hesap yeniden giriş yapabilir.' : `Kullanıcı yeni oturum açamayacaktır. Mevcut çizimleri silinmeyecek ve haritada kalacaktır.${user.id === currentUserId ? ' Kendi hesabınızı pasifleştiriyorsunuz.' : ''}`, action: active ? 'Hesabı Aktifleştir' : 'Hesabı Pasifleştir', danger: !active })
  const requestApproval = () => setConfirm({ kind: 'approve', value: selectedRole, title: `${user.username} onaylansın mı?`, copy: `Hesap ${selectedRole} rolüyle aktifleştirilecek ve kullanıcıya giriş yapabileceğini bildiren bir e-posta gönderilecek.`, action: 'Onayla ve Aktifleştir' })
  const requestRejection = () => setConfirm({ kind: 'reject', title: `${user.username} başvurusu reddedilsin mi?`, copy: 'Kullanıcı uygulamaya erişemeyecek ve rol atanmayacak. Başvurusunun onaylanmadığı kendisine e-postayla bildirilecek.', action: 'Başvuruyu Reddet', danger: true, withReason: true })
  const submit = async (reason) => { const next = confirm; setConfirm(null); if (next.kind === 'discard') { permissions?.onReset(); next.run(); return } if (next.kind === 'role') await onChangeRole(next.value); else if (next.kind === 'status') await onChangeStatus(next.value); else if (next.kind === 'approve') await onApprove(next.value); else await onReject(reason) }
  const status = user ? accountStatusBadge(user) : null
  const pending = isPendingApproval(user)
  return <><div className="admin-panel-scrim" onMouseDown={requestClose} aria-hidden="true" /><aside className="admin-detail-panel" role="dialog" aria-modal="true" aria-labelledby="admin-detail-title"><button type="button" className="admin-panel-close" onClick={requestClose} aria-label="Detayı kapat">×</button>{loading || !user ? <div className="admin-detail-loading">Kullanıcı detayı yükleniyor…</div> : <><header><span className="admin-avatar" aria-hidden="true">{user.username.slice(0, 1).toUpperCase()}</span><div><h2 id="admin-detail-title">{user.username}</h2><span className={`admin-badge ${status.tone}`}>{status.label}</span>{user.id === currentUserId && <span className="admin-badge info">Siz</span>}</div></header>{/* İki sekme: detay zaten yoğun, yetki tablosu 27 satır. Altına eklemek
        panelin en çok kullanılan üst kısmını erişilemez kılardı. */}
    <div className="admin-detail-tabs" role="tablist" aria-label="Kullanıcı detayı">
      <button type="button" role="tab" id="admin-tab-general" aria-selected={tab === 'general'} aria-controls="admin-tabpanel-general" className={`admin-detail-tab ${tab === 'general' ? 'is-active' : ''}`} onClick={() => setTab('general')}>Genel</button>
      {canViewPermissions && <button type="button" role="tab" id="admin-tab-permissions" aria-selected={tab === 'permissions'} aria-controls="admin-tabpanel-permissions" className={`admin-detail-tab ${tab === 'permissions' ? 'is-active' : ''}`} onClick={() => setTab('permissions')}>Yetkiler{permissionsDirty && <span className="admin-tab-dot" aria-label="kaydedilmemiş değişiklik"> •</span>}</button>}
    </div>
    {tab === 'permissions' && canViewPermissions
      ? <div id="admin-tabpanel-permissions" role="tabpanel" aria-labelledby="admin-tab-permissions"><UserPermissionEditor {...permissions} /></div>
      : <div id="admin-tabpanel-general" role="tabpanel" aria-labelledby="admin-tab-general"><dl className="admin-detail-grid"><div><dt>Kullanıcı adı</dt><dd>{user.username}</dd></div><div><dt>E-posta</dt><dd>{user.email || '—'}</dd></div><div><dt>E-posta durumu</dt><dd>{user.emailConfirmed ? 'Doğrulandı' : 'Doğrulanmadı'}</dd></div><div><dt>Hesap durumu</dt><dd>{status.label}</dd></div><div><dt>Rol</dt><dd>{user.role || 'Atanmamış'}</dd></div><div><dt>İki Faktörlü Doğrulama</dt><dd>{mfaLabel(user)}</dd></div>{user.approvedAt && <div><dt>Onay</dt><dd>{formatDate(user.approvedAt)}{user.approvedByUsername ? ` — ${user.approvedByUsername}` : ''}</dd></div>}{user.rejectedAt && <div><dt>Red</dt><dd>{formatDate(user.rejectedAt)}{user.rejectedByUsername ? ` — ${user.rejectedByUsername}` : ''}{user.rejectionReason ? ` · ${user.rejectionReason}` : ''}</dd></div>}<div><dt>Son güncelleme</dt><dd>{formatDate(user.modifiedDate)}</dd></div></dl>
    {pending
      ? <ApprovalSection user={user} roles={roles} selectedRole={selectedRole} onSelectRole={setSelectedRole} mutating={mutating} canUpdate={canUpdate} onApprove={requestApproval} onReject={requestRejection} />
      : <section className="admin-management"><h3>Yetki ve hesap durumu</h3>
          {/* Role and activation are only offered once the account has been
              decided on. While it is pending or rejected the backend refuses
              both, and the approval section above is the way in. */}
          {user.accountStatus === 'Rejected'
            ? <p className="admin-policy-note">Bu başvuru reddedildi. Kullanıcıya erişim vermek için yeni bir başvuru gerekir.</p>
            : user.accountStatus === 'PendingEmailVerification'
              ? <p className="admin-policy-note">Kullanıcı e-posta adresini doğrulamadı. Doğruladığında onay için burada listelenecek.</p>
              /* Rol ve hesap durumu AYNI ucu (users.update) kullanır. Yetkisi
                 olmayan kişi hesabı görüntüler; değiştirilemeyen iki açılır
                 liste bırakmak, yapılamayacak bir işi vaat etmek olurdu. */
              : !canUpdate
                ? <p className="admin-policy-note">Rol ve hesap durumu yalnızca görüntülenir; değiştirmek için kullanıcı düzenleme yetkisi gerekir.</p>
              : <><label>Rol<select value={user.role || ''} disabled={mutating} onChange={(e) => requestRole(e.target.value)}>
                  {/* Seçenekler sunucudan gelen ATANABİLİR rollerdir; sabit
                      Admin/User listesi, Phase 4 backend'inin yeni atamalarda
                      reddettiği iki rolden başka bir şey sunmuyordu. */}
                  {!user.role && <option value="">Rol seçin…</option>}
                  {/* Kullanıcının MEVCUT rolü atanabilir listede olmayabilir
                      (legacy Admin/User gibi). Seçenek olarak eklenmezse
                      açılır liste kullanıcının gerçek rolünü göstermez; devre
                      dışı bırakılır çünkü geri dönülebilir bir seçim değildir. */}
                  {user.role && !roles.some((r) => r.name === user.role) && <option value={user.role} disabled>{user.role}</option>}
                  {roles.map((role) => <option key={role.name} value={role.name}>{role.name}</option>)}
                </select></label><label>Hesap Durumu<select value={user.isActive ? 'active' : 'inactive'} disabled={mutating} onChange={(e) => requestStatus(e.target.value === 'active')}><option value="active">Aktif</option><option value="inactive">Pasif</option></select></label>{isAdministrativeRole(user.role) && <p className="admin-policy-note">Sistemde en az bir kullanılabilir yönetici bulunmalıdır. Son kullanılabilir yöneticinin rolü düşürülemez veya hesabı pasifleştirilemez.</p>}</>}
          {user.accountStatus === 'PendingEmailVerification' && canUpdate && <button type="button" className="admin-button danger" disabled={mutating} onClick={requestRejection}>Başvuruyu Reddet</button>}
        </section>}
    {/* Coğrafi yetki: ayrı bir bölüm, çünkü hesap durumu ve rolden bağımsız
        bir eksendir. Düğme yalnızca coğrafi görüntüleme yetkisi olana çizilir —
        devre dışı bir düğme bırakmak, ödevin "yetkisi yoksa hiç gösterme"
        kuralını karşılamazdı. */}
    {geography?.canView && <section className="admin-management"><h3>Coğrafi Yetki</h3>
      <p className="admin-readonly-note">Kullanıcının çizim yapabileceği coğrafi sınırı haritada tanımlayın. Alan tanımlanmadığında kullanıcı, rollerinden gelen alana veya hiç alan yoksa sınırsız çizime tabidir.</p>
      <div className="geo-entry-actions"><button type="button" className="admin-button secondary" onClick={() => setGeographyOpen(true)}>Coğrafi Yetki</button></div>
    </section>}
    <p className="admin-readonly-note">E-posta doğrulaması ve 2FA durumu yalnızca görüntülenir. Parola ve güvenlik anahtarlarına erişilemez.</p></div>}</>}</aside>{geographyOpen && user && <GeographicAuthorizationEditor targetType="user" targetId={user.id} targetName={user.username} canView={geography?.canView === true} canManage={geography?.canManage === true} onClose={() => setGeographyOpen(false)} />}{confirm && <ConfirmDialog config={confirm} busy={mutating} onCancel={() => setConfirm(null)} onConfirm={submit} />}</>
}
