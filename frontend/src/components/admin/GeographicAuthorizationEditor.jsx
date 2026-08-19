import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  deleteAdminRoleGeographicAuthorization,
  deleteAdminUserGeographicAuthorization,
  fetchAdminRoleGeographicAuthorization,
  fetchAdminUserGeographicAuthorization,
  readApiError,
  updateAdminRoleGeographicAuthorization,
  updateAdminUserGeographicAuthorization,
} from '../../services/api.js'
import GeographicScopeMap from './GeographicScopeMap.jsx'
import { inheritedScopeWkt, normalizeScopeWkt } from './geographicScope.js'
import './GeographicAuthorizationEditor.css'

/* Hedef türüne göre uç seti. Bileşenin geri kalanı "kullanıcı mı rol mü" diye
   dallanmaz: iki ekran arasındaki fark burada biter. */
const ENDPOINTS = {
  user: {
    fetch: fetchAdminUserGeographicAuthorization,
    update: updateAdminUserGeographicAuthorization,
    remove: deleteAdminUserGeographicAuthorization,
  },
  role: {
    fetch: fetchAdminRoleGeographicAuthorization,
    update: updateAdminRoleGeographicAuthorization,
    remove: deleteAdminRoleGeographicAuthorization,
  },
}

/**
 * Kullanıcı ve rol için ORTAK coğrafi yetki düzenleyicisi.
 *
 * İki hedef türü için iki ayrı harita uygulaması yazmak, projeksiyon
 * dönüşümünden kirlilik takibine kadar her kuralın iki yerde tutulması demekti;
 * biri düzeltilirken diğeri geride kalırdı. Fark yalnızca üç uçtur ve
 * miras kavramının kullanıcıya özgü olmasıdır.
 *
 * <b>Bu ekran bir güvenlik sınırı DEĞİLDİR.</b> Düğmeleri gizlemek yetki
 * vermez: uçlar users.update/roles.update + geography.manage arar ve tarayıcı
 * ne gösterirse göstersin 403 döndürür. Buradaki kurallar yalnızca yapılamayacak
 * bir işi teklif etmemek içindir.
 */
export default function GeographicAuthorizationEditor({
  targetType,
  targetId,
  targetName,
  canView = true,
  canManage = false,
  onClose,
}) {
  const [status, setStatus] = useState('loading')
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [workingWkt, setWorkingWkt] = useState(null)
  const [mode, setMode] = useState('idle')
  const [clearToken, setClearToken] = useState(0)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  // 'delete' | 'close' — aynı anda yalnızca biri.
  const [confirm, setConfirm] = useState(null)
  const inFlight = useRef(false)

  const endpoints = ENDPOINTS[targetType]

  const load = useCallback(async () => {
    setStatus('loading'); setLoadError(''); setActionError(''); setNotice('')
    try {
      const res = await endpoints.fetch(targetId)
      if (!res.ok) {
        throw new Error(res.status === 403
          ? 'Bu hedefin coğrafi yetkisini görüntüleme yetkiniz bulunmuyor.'
          : await readApiError(res, 'Coğrafi yetki alanı yüklenemedi.'))
      }
      setData(await res.json())
      setStatus('ready')
    } catch (err) {
      /* Hata "kısıt yok" DEĞİLDİR ve öyle gösterilemez: yüklenemeyen bir alan
         için boş bir Türkiye haritası çizmek, var olan bir sınırı yokmuş gibi
         göstermek olurdu. Düzenleme, veri gelene kadar kapalı kalır. */
      setLoadError(err.message || 'Coğrafi yetki alanı yüklenemedi.')
      setStatus('error')
    }
  }, [endpoints, targetId])

  useEffect(() => { load() }, [load])

  /* Sunucunun onayladığı doğrudan alan, ekrandaki geometriyle AYNI yoldan
     geçirilerek temel alınır; kirlilik karşılaştırması ancak böyle anlamlıdır. */
  const baselineWkt = useMemo(() => normalizeScopeWkt(data?.wkt), [data])
  const inheritedWkt = useMemo(() => inheritedScopeWkt(targetType, data), [targetType, data])

  const dirty = status === 'ready' && workingWkt !== baselineWkt
  const hasDirect = data?.hasDirectAuthorization === true

  /* Yetki CANLI okunur. Yönetme yetkisi düzenleyici açıkken kaldırılırsa
     etkileşim o anda durur: yarım kalan çizim ekranda kalabilir ama artık
     gönderilemez ve yeni bir köşe eklenemez. */
  useEffect(() => { if (!canManage && mode !== 'idle') setMode('idle') }, [canManage, mode])

  const requestClose = useCallback(() => {
    if (busy) return
    if (dirty) { setConfirm('close'); return }
    onClose()
  }, [busy, dirty, onClose])

  /* Escape: kirli değilse kapatır, kirliyse onay ister. Harita kendi klavye
     davranışını çalıştırsa bile bu koruma atlanamaz — dinleyici belgededir. */
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      if (confirm) { setConfirm(null); return }
      requestClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [confirm, requestClose])

  const startDraw = () => { setActionError(''); setNotice(''); setMode('draw') }
  const startModify = () => { setActionError(''); setNotice(''); setMode(mode === 'modify' ? 'idle' : 'modify') }

  /* "Yeniden çiz" YALNIZCA yerel geometriyi boşaltır ve çizim kipine geçer.
     Sunucudaki alanı burada silmek, vazgeçilebilir bir düzenlemeyi kalıcı bir
     kayba çevirirdi; kaldırma ayrı ve onaylı bir eylemdir. */
  const redraw = () => {
    setActionError(''); setNotice('')
    setClearToken((n) => n + 1)
    setMode('draw')
  }

  const run = async (request, describe) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true); setActionError(''); setNotice('')
    try {
      const res = await request()
      if (!res.ok) {
        throw new Error(res.status === 403
          ? 'Bu coğrafi yetkiyi değiştirme yetkiniz bulunmuyor.'
          : await readApiError(res, 'Coğrafi yetki alanı güncellenemedi.'))
      }
      /* Yeni temel SUNUCUNUN döndürdüğü durumdur. Kendi gönderdiğimizi
         "başarılı" saymak, kullanıcı hedefinde silme sonrası devreye giren rol
         alanını ve sunucunun normalleştirdiği geometriyi kaçırırdı. */
      setData(await res.json())
      setMode('idle')
      setNotice(describe)
    } catch (err) {
      /* Başarısız istekte çalışma geometrisi KORUNUR: yönetici alanı yeniden
         çizmek zorunda kalmadan tekrar deneyebilsin. */
      setActionError(err.message || 'İşlem tamamlanamadı.')
    } finally {
      inFlight.current = false; setBusy(false)
    }
  }

  const save = () => {
    // Asgari yerel denetim; geçerlilik kararı sunucunundur.
    if (!workingWkt || !dirty || !canManage) return
    run(() => endpoints.update(targetId, workingWkt), 'Coğrafi yetki alanı güncellendi.')
  }

  const remove = () => {
    setConfirm(null)
    run(
      () => endpoints.remove(targetId),
      targetType === 'user'
        ? 'Kullanıcıya özel coğrafi alan kaldırıldı.'
        : 'Rolün coğrafi alanı kaldırıldı.',
    )
  }

  const subject = targetType === 'user' ? 'kullanıcının' : 'rolün'

  return (
    <div className="geo-editor-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose() }}>
      <section className="geo-editor" role="dialog" aria-modal="true" aria-labelledby="geo-editor-title">
        <header className="geo-editor-head">
          <div>
            <h2 id="geo-editor-title">Coğrafi Yetki — {targetName}</h2>
            <p>Bu alan, {subject} çizim yapabileceği coğrafi sınırı belirler.</p>
          </div>
          <button type="button" className="geo-editor-close" onClick={requestClose} aria-label="Coğrafi yetki penceresini kapat">×</button>
        </header>

        {!canView ? (
          /* Görüntüleme yetkisi düzenleyici AÇIKKEN kaldırıldı. Haritayı ve
             etkileşimi çalışır bırakmak, artık okunmasına izin verilmeyen bir
             veriyi ekranda tutmak olurdu. */
          <div className="geo-editor-state" role="alert">
            <p>Coğrafi yetkileri görüntüleme yetkiniz kaldırıldı.</p>
            <button type="button" className="admin-button secondary" onClick={onClose}>Kapat</button>
          </div>
        ) : status === 'loading' ? (
          <div className="geo-editor-state" role="status">Coğrafi yetki alanı yükleniyor…</div>
        ) : status === 'error' ? (
          <div className="geo-editor-state" role="alert">
            <p>{loadError}</p>
            <button type="button" className="admin-button secondary" onClick={load}>Tekrar dene</button>
          </div>
        ) : (
          <>
            <p className={`geo-editor-status ${hasDirect ? 'is-direct' : inheritedWkt ? 'is-inherited' : 'is-none'}`}>
              {hasDirect
                ? targetType === 'user'
                  ? 'Bu kullanıcı için doğrudan bir coğrafi alan tanımlı. Rol bazlı alanların yerine bu alan geçer.'
                  : 'Bu rol için bir coğrafi alan tanımlı.'
                : inheritedWkt
                  ? 'Bu kullanıcı için doğrudan coğrafi alan tanımlı değil. Etkin alan rol(ler) üzerinden geliyor.'
                  : targetType === 'user'
                    ? 'Bu kullanıcı için coğrafi kısıtlama bulunmuyor. Coğrafi alan tanımlanmadığı için kullanıcı mevcut izinleri kapsamında coğrafi olarak sınırsızdır.'
                    : 'Bu rol için coğrafi yetki tanımlanmamış.'}
            </p>

            <div className="geo-editor-body">
              <GeographicScopeMap
                baselineWkt={baselineWkt}
                inheritedWkt={inheritedWkt}
                mode={mode}
                clearToken={clearToken}
                onWorkingChange={setWorkingWkt}
                onDrawEnd={() => setMode('idle')}
              />

              {/* Efsane renge DEĞİL metne dayanır; renk yalnızca ona eşlik eder. */}
              <ul className="geo-editor-legend">
                <li><span className="geo-swatch is-direct" aria-hidden="true" />{targetType === 'user' ? 'Kullanıcıya özel alan' : 'Rol coğrafi alanı'}</li>
                {inheritedWkt && <li><span className="geo-swatch is-inherited" aria-hidden="true" />Rol üzerinden etkin alan (salt okunur)</li>}
              </ul>
            </div>

            {/* Miras alınan alan varken çizilen poligonun ne yapacağı ÖNCEDEN
                söylenir: Phase 8A'da doğrudan alan rolleri birleştirmez, ezer. */}
            {inheritedWkt && workingWkt && canManage && (
              <p className="geo-editor-warning" role="status">
                Kullanıcıya özel alan kaydedildiğinde rol bazlı coğrafi alanların yerine geçer.
              </p>
            )}

            {notice && <p className="geo-editor-notice" role="status">{notice}</p>}
            {actionError && <p className="geo-editor-error" role="alert">{actionError}</p>}

            {canManage ? (
              <div className="geo-editor-actions">
                <div className="geo-editor-tools">
                  {!workingWkt ? (
                    <button type="button" className="admin-button secondary" disabled={busy} onClick={startDraw}>
                      {mode === 'draw' ? 'Haritada çizin…' : inheritedWkt ? 'Kullanıcıya Özel Alan Çiz' : 'Poligon Çiz'}
                    </button>
                  ) : (
                    <>
                      <button type="button" className={`admin-button secondary ${mode === 'modify' ? 'is-active' : ''}`} disabled={busy} aria-pressed={mode === 'modify'} onClick={startModify}>
                        Alanı Düzenle
                      </button>
                      <button type="button" className="admin-button secondary" disabled={busy} onClick={redraw}>
                        Yeniden Çiz
                      </button>
                    </>
                  )}
                </div>
                <div className="geo-editor-submit">
                  {hasDirect && (
                    <button type="button" className="admin-button danger" disabled={busy} onClick={() => setConfirm('delete')}>
                      Coğrafi Yetkiyi Kaldır
                    </button>
                  )}
                  <button type="button" className="admin-button" disabled={busy || !dirty || !workingWkt} onClick={save}>
                    {busy ? 'Kaydediliyor…' : 'Coğrafi Yetkiyi Kaydet'}
                  </button>
                </div>
              </div>
            ) : (
              /* Devre dışı bir düğme yığını, yapılamayacak bir işi vaat eder.
                 Sebep tek cümleyle yazılır ve kontroller HİÇ çizilmez. */
              <p className="geo-editor-readonly">
                Coğrafi alan yalnızca görüntüleniyor. Değişiklik yapmak için
                {targetType === 'user' ? ' kullanıcı düzenleme' : ' rol düzenleme'} ve coğrafi yetki yönetimi izinleri gerekir.
              </p>
            )}
          </>
        )}
      </section>

      {confirm && (
        <div className="admin-dialog-backdrop" role="presentation">
          <div className="admin-dialog" role="alertdialog" aria-modal="true" aria-labelledby="geo-confirm-title" aria-describedby="geo-confirm-copy">
            <h2 id="geo-confirm-title">
              {confirm === 'delete' ? 'Coğrafi yetki kaldırılsın mı?' : 'Kaydedilmemiş coğrafi alan değişiklikleri var'}
            </h2>
            <p id="geo-confirm-copy">
              {confirm === 'delete'
                ? targetType === 'user'
                  ? 'Kullanıcıya özel alan silinecek. Kullanıcı, rollerinden gelen coğrafi alanlara düşer; rolünde de alan yoksa coğrafi olarak sınırsız olur.'
                  : 'Rolün coğrafi alanı silinecek. Bu rolü taşıyan ve kendi alanı olmayan kullanıcılar bu sınırdan çıkar.'
                : 'Haritada yaptığınız değişiklikler henüz kaydedilmedi. Devam ederseniz kaybolur.'}
            </p>
            <div className="admin-dialog-actions">
              <button type="button" className="admin-button secondary" disabled={busy} onClick={() => setConfirm(null)}>
                {confirm === 'delete' ? 'İptal' : 'Düzenlemeye Dön'}
              </button>
              <button type="button" className="admin-button danger" disabled={busy} onClick={confirm === 'delete' ? remove : onClose}>
                {confirm === 'delete' ? 'Coğrafi Yetkiyi Kaldır' : 'Değişiklikleri Yoksay'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
