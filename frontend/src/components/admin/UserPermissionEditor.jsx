import { useId, useMemo } from 'react'
import LockIcon from '../ui/icons/LockIcon.jsx'
import { groupByCategory, isToggleable, preservedInactiveDirect, sourceNotes } from './userPermissions.js'
import './permissionMatrix.css'

/**
 * Bir kullanıcının yetki tablosu: kaynak gösterimi ve — sunucu izin veriyorsa —
 * doğrudan yetkilerin düzenlenmesi.
 *
 * <b>Üç kavram ayrı tutulur.</b> Rolden KALITILAN, kullanıcıya DOĞRUDAN verilen
 * ve gerçekten ETKİN olan yetkiler farklı şeylerdir. Onay kutusu yalnızca
 * doğrudan atamaları temsil eder; rolden gelen bir satır işaretli ama KİLİTLİ
 * görünür, çünkü onu ikinci kez atamak hiçbir erişim eklemez — ama rol
 * değiştiğinde arkada kalıp yöneticinin beklemediği bir yetkiyi sürdürürdü.
 *
 * <b>Yetkilendirme kararı burada verilmez.</b> Neyin atanabileceğini,
 * kaldırılabileceğini ve ekranın hiç düzenlenebilir olup olmadığını sunucu
 * söyler. "Kullanıcı Administrator ise" gibi bir dallanma ikinci bir kural
 * kitabı kurar ve backend'in verisi değiştiği gün sessizce onunla çelişirdi.
 * Devre dışı bir onay kutusu zaten yalnızca nezakettir: sunucu, tarayıcının ne
 * çizdiğine bakmadan reddeder.
 */
export default function UserPermissionEditor({
  data,
  selected,
  baseline,
  loading,
  error,
  saving,
  saveError,
  dirty,
  onToggle,
  onReset,
  onSave,
  onRetry,
}) {
  const headingId = useId()

  const groups = useMemo(() => groupByCategory(data?.permissions ?? []), [data])
  const preserved = useMemo(() => preservedInactiveDirect(data?.permissions ?? []), [data])

  if (loading) {
    /* Yalnızca BU sekme bekler; detayın geri kalanı kullanılabilir kalır. */
    return (
      <section className="admin-management" aria-labelledby={headingId}>
        <h3 id={headingId}>Yetkiler</h3>
        <p className="admin-readonly-note" role="status">Kullanıcı yetkileri yükleniyor…</p>
      </section>
    )
  }

  if (error) {
    return (
      <section className="admin-management" aria-labelledby={headingId}>
        <h3 id={headingId}>Yetkiler</h3>
        {/* Hata bölümde KALIR: panel kendiliğinden kapanmaz, çünkü kapanan bir
            panel ne olduğunu anlatma şansını da götürür. */}
        <div className="admin-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={onRetry}>Tekrar dene</button>
        </div>
      </section>
    )
  }

  if (!data) return null

  const editable = data.canManageDirectPermissions === true
  const effectiveCount = data.permissions.filter((p) => p.effective).length

  return (
    <section className="admin-management admin-permissions" aria-labelledby={headingId}>
      <h3 id={headingId}>Yetkiler</h3>

      <p className="admin-permission-summary">
        <strong>{effectiveCount}</strong> etkin yetki · <strong>{selected.size}</strong> kullanıcıya özel
        {dirty && <span className="admin-permission-dirty"> · Kaydedilmemiş değişiklik var</span>}
      </p>

      <p className="admin-readonly-note">
        {data.roles.length > 0
          ? `Rolünden gelen yetkiler ${data.roles.join(' + ')} üzerinden verilir ve buradan değiştirilemez; rol yetkileri Roller ekranında düzenlenir.`
          : 'Bu kullanıcının rolü yok; yalnızca kendisine özel verilen yetkiler geçerlidir.'}
      </p>

      {!editable && (
        <p className="admin-policy-note">
          Yetkileri görüntüleyebilirsiniz, ancak değiştirmek için kullanıcı düzenleme ve yetki
          atama yetkileri gerekir.
        </p>
      )}

      {/* Atamalar duruyor ama hiçbiri işlemiyor — sebebini söylemeden bırakmak,
          yöneticiyi olmayan bir hatayı aramaya iterdi. */}
      {!data.targetAccountEligible && (
        <p className="admin-policy-note">
          Hesap aktif olmadığı için hiçbir yetki şu anda etkin değil. Atamalar korunur ve hesap
          yeniden aktifleştirildiğinde geçerli olur.
        </p>
      )}

      {preserved.length > 0 && (
        <p className="admin-readonly-note">
          Bu kullanıcıda kullanımdan kaldırılmış {preserved.length} kişiye özel yetki kaydı var.
          Salt okunur gösterilir, etkin erişim vermez ve kaydetme sırasında SİLİNMEZ.
        </p>
      )}

      {/* Kaydet/geri al bölümün BAŞINDA durur: 27 satırın altına inmek zorunda
          kalmadan, sekme açıldığı anda görünür ve erişilebilir olsun diye. */}
      {editable && (
        <div className="admin-role-actions">
          <button type="button" className="admin-button" disabled={!dirty || saving} onClick={onSave}>
            {saving ? 'Kaydediliyor…' : 'Doğrudan Yetkileri Kaydet'}
          </button>
          {dirty && (
            <button type="button" className="admin-button secondary" disabled={saving} onClick={onReset}>
              Değişiklikleri Geri Al
            </button>
          )}
        </div>
      )}

      {saveError && (
        <div className="admin-error" role="alert">
          <span>{saveError}</span>
        </div>
      )}

      {groups.map((group) => (
        <div className="admin-permission-group" key={group.category} role="group" aria-label={group.label}>
          <div className="admin-permission-group-head">
            <h4>{group.label}</h4>
          </div>

          <ul className="admin-permission-list">
            {group.items.map((item) => {
              const inherited = item.inheritedFromRoles.length > 0
              const toggleable = isToggleable(item, baseline, editable)

              /* Onay kutusu YALNIZCA doğrudan atamayı temsil eder — "bu yetki
                 kullanıcıda var mı"yı değil. Rolden gelen satırı da işaretli
                 çizmek daha sezgisel görünürdü, ama çakışan bir satırda (hem
                 rolden gelen hem kişiye özel) kutu asla sönmez ve kişiye özel
                 kaydı kaldırmak imkânsız hâle gelirdi.

                 Kullanıcının yetkiye SAHİP olduğu bilgisi kaybolmaz: "Etkin"
                 rozeti ve "… rolünden" cümlesi bunu zaten söyler. */
              const checked = item.isActive ? selected.has(item.code) : item.directAssigned
              const notes = sourceNotes({
                ...item,
                directAssigned: item.isActive ? selected.has(item.code) : item.directAssigned,
              })

              /* Rolden gelen ve kişiye özel kaydı OLMAYAN satırda düzenlenecek
                 hiçbir şey yoktur. Burada boş bir onay kutusu çizmek, yetki
                 gerçekten işlerken "kapalı" izlenimi verirdi — kutu doğrudan
                 atamayı anlatır, kullanıcı ise onu "bu yetki var mı" diye
                 okur. Form kontrolü yerine kilit konur: kaydı olmayan bir
                 satır için kapatılabilir bir kutu zaten yanlış bir vaattir.

                 Çakışan satır (hem rolden gelen hem kişiye özel) bu muameleyi
                 ALMAZ: orada kaldırılacak gerçek bir kayıt vardır. */
              const lockedByRole = inherited && !item.directAssigned

              const body = (
                <span className="admin-permission-text">
                  <strong>
                    {item.name}
                    {!item.isActive && <span className="admin-badge">Pasif</span>}
                    {item.effective && <span className="admin-badge success">Etkin</span>}
                  </strong>
                  {item.description && <span>{item.description}</span>}

                  {/* Kaynak METİNLE anlatılır; bir simgenin ya da devre dışı bir
                      kutunun rengi tek başına hiçbir şey açıklamaz. */}
                  {notes.length > 0 && <span className="admin-permission-source">{notes.join(' · ')}</span>}
                  {notes.length === 0 && item.isActive && <span className="admin-permission-source">Atanmamış</span>}

                  {/* Kilidin SEBEBİ yazılır: "neden tıklayamıyorum" sorusu
                      ekranda cevaplanmalı, deneme yanılmayla değil. */}
                  {lockedByRole && (
                    <span className="admin-permission-lock">
                      Bu yetki rol tarafından sağlanıyor; doğrudan atama yapılamaz.
                    </span>
                  )}
                  {editable && item.isActive && !toggleable && !inherited && !baseline.has(item.code) && (
                    <span className="admin-permission-lock">Bu yetkiyi doğrudan atama yetkiniz yok.</span>
                  )}

                  {/* Teknik kod yöneticiye faydalıdır ama satırın konusu
                      değildir: küçük, sönük ve en altta. */}
                  <code>{item.code}</code>
                </span>
              )

              return (
                <li key={item.code}>
                  {lockedByRole ? (
                    /* <label> DEĞİL: sarmalayacak bir form kontrolü yok, ve
                       tıklanabilir görünen bir etiket hiçbir şey yapmazdı. */
                    <div className="admin-permission-row is-locked is-inherited">
                      <span className="admin-permission-mark">
                        <LockIcon size={16} />
                        {/* Simge tek başına bırakılmaz: ekran okuyucu da kilidi
                            duymalı. */}
                        <span className="sr-only">Rolden geliyor, salt okunur.</span>
                      </span>
                      {body}
                    </div>
                  ) : (
                    <label className={`admin-permission-row ${toggleable ? '' : 'is-locked'}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!toggleable}
                        onChange={() => onToggle(item.code)}
                      />
                      {body}
                    </label>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </section>
  )
}
