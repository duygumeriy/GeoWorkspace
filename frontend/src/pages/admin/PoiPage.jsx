import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createAdminPoiCategory,
  fetchAdminPoiCategories,
  fetchAdminPois,
  readApiError,
  updateAdminPoiCategory,
} from '../../services/api.js'
import { usePermissions } from '../../auth/permissionStore.js'
import { PERMISSIONS } from '../../auth/permissionCodes.js'
import AdminPageHeader from '../../components/admin/AdminPageHeader.jsx'
import PoiCategoryDialog from '../../components/admin/PoiCategoryDialog.jsx'
import PoiCategoryTree from '../../components/admin/PoiCategoryTree.jsx'
import PoiList from '../../components/admin/PoiList.jsx'
import './PoiPage.css'

const TAB_POIS = 'pois'
const TAB_CATEGORIES = 'categories'

/**
 * POI yönetimi: kayıt envanteri ve kategori taksonomisi.
 *
 * ## İki sekme, iki AYRI yetki
 *
 * Sayfa tek bir yetkiyle korunmaz. `poi.manage` POI listesini,
 * `poi.categories.manage` kategori ağacını açar ve bir kişide yalnızca biri
 * bulunabilir. Sayfayı tek koda bağlamak, yalnızca kategori yetkisi olan bir
 * yöneticiyi taksonomiden tamamen dışlardı; iki ayrı sayfa yapmak ise aynı
 * kabuğu ve aynı gezinme girişini ikiye bölerdi.
 *
 * ## Yetki CANLIDIR
 *
 * Bir yetki ekran açıkken geri alınabilir. Etkin sekme her render'da yeniden
 * doğrulanır ve artık izinli olmayan sekmeden çıkılır; korumalı içerik
 * "önce çiz sonra kaldır" biçiminde bir an bile mount kalmaz.
 *
 * ## Veri sahibi sunucudur
 *
 * Her mutasyondan sonra kategori listesi yeniden OKUNUR. Satırı yerel olarak
 * yamalamak, `path` ve `depth` gibi sunucunun hesapladığı alanların gerçekle
 * ayrışmasına açık kapı bırakırdı — bir yeniden konumlandırma yalnızca
 * dokunduğu satırı değil, tüm alt ağacın yollarını değiştirir.
 */
export default function PoiPage() {
  const { can } = usePermissions()
  const canManagePois = can(PERMISSIONS.POI_MANAGE)
  const canManageCategories = can(PERMISSIONS.POI_CATEGORIES_MANAGE)

  /* Görünür sekmeler tek yerden türetilir: başlık şeridi, varsayılan seçim ve
     "hangi veriyi okuyayım" kararı hep bunu okur. */
  const tabs = useMemo(() => [
    ...(canManagePois ? [{ id: TAB_POIS, label: "POI'ler" }] : []),
    ...(canManageCategories ? [{ id: TAB_CATEGORIES, label: 'Kategoriler' }] : []),
  ], [canManagePois, canManageCategories])

  const [requestedTab, setRequestedTab] = useState(null)

  /* Etkin sekme SAKLANMAZ, türetilir. Yetki geri alındığında saklanan bir
     değerin geçerliliğini ayrıca sınamak gerekirdi; türetilen değer o an
     izinli olmayan sekmede asla duramaz. */
  const activeTab = tabs.some((tab) => tab.id === requestedTab)
    ? requestedTab
    : tabs[0]?.id ?? null

  const [pois, setPois] = useState([])
  const [poisLoading, setPoisLoading] = useState(false)
  const [poisError, setPoisError] = useState('')

  const [categories, setCategories] = useState([])
  const [categoriesLoading, setCategoriesLoading] = useState(false)
  const [categoriesError, setCategoriesError] = useState('')

  const [notice, setNotice] = useState(null)

  // { mode: 'create' } | { mode: 'edit', category } | null — aynı anda bir tane.
  const [dialog, setDialog] = useState(null)
  const [dialogError, setDialogError] = useState('')
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)

  const loadPois = useCallback(async () => {
    setPoisLoading(true); setPoisError('')
    try {
      const res = await fetchAdminPois()
      if (!res.ok) {
        throw new Error(res.status === 403
          ? 'POI kayıtlarını görüntüleme yetkiniz bulunmuyor.'
          : await readApiError(res, 'POI kayıtları yüklenemedi.'))
      }
      setPois(await res.json())
    } catch (err) {
      setPoisError(err.message || 'POI kayıtları yüklenemedi.')
    } finally {
      setPoisLoading(false)
    }
  }, [])

  const loadCategories = useCallback(async () => {
    setCategoriesLoading(true); setCategoriesError('')
    try {
      const res = await fetchAdminPoiCategories()
      if (!res.ok) {
        throw new Error(res.status === 403
          ? 'Kategorileri görüntüleme yetkiniz bulunmuyor.'
          : await readApiError(res, 'Kategoriler yüklenemedi.'))
      }
      setCategories(await res.json())
    } catch (err) {
      setCategoriesError(err.message || 'Kategoriler yüklenemedi.')
    } finally {
      setCategoriesLoading(false)
    }
  }, [])

  /* Okuma YETKİYE bağlıdır, sekme seçimine değil: yetkisi olmayan bir uca
     istek açmak garanti 403 demektir. Yetki sonradan geri alınırsa efekt
     yeniden çalışır ve elde kalan veri temizlenir — korumalı satırlar
     ekranda unutulmaz. */
  useEffect(() => {
    if (!canManagePois) { setPois([]); setPoisError(''); return }
    loadPois()
  }, [canManagePois, loadPois])

  useEffect(() => {
    if (!canManageCategories) { setCategories([]); setCategoriesError(''); return }
    loadCategories()
  }, [canManageCategories, loadCategories])

  /* Kategori yetkisi giderken açık kalmış bir form da kapanır: aksi hâlde
     kaydedilemeyecek bir düzenleme ekranda durmaya devam ederdi. */
  useEffect(() => {
    if (!canManageCategories) { setDialog(null); setDialogError('') }
  }, [canManageCategories])

  /**
   * Tek mutasyon yolu: çift göndermeyi engelle, hatayı çevir, sunucudan
   * yeniden oku.
   */
  const mutate = async (run, describe) => {
    if (inFlight.current) return false
    inFlight.current = true
    setBusy(true); setDialogError('')
    try {
      const res = await run()
      if (!res.ok) {
        throw new Error(res.status === 403
          ? 'Bu işlem için yetkiniz bulunmuyor.'
          : await readApiError(res, 'İşlem tamamlanamadı.'))
      }
      await loadCategories()
      setNotice({ type: 'success', message: describe() })
      return true
    } catch (err) {
      /* Sunucunun mesajı (döngü reddi, geçersiz üst kategori, ad çakışması)
         diyalogda GÖSTERİLİR ve genel bir metinle değiştirilmez; girilen
         değerler de yerinde kalır ki kullanıcı düzeltebilsin. */
      setDialogError(err.message || 'İşlem tamamlanamadı.')
      return false
    } finally {
      inFlight.current = false; setBusy(false)
    }
  }

  const submitCategory = async (payload) => {
    const ok = dialog.mode === 'edit'
      ? await mutate(
        () => updateAdminPoiCategory(dialog.category.id, payload),
        () => `'${payload.name}' kategorisi güncellendi.`,
      )
      : await mutate(
        () => createAdminPoiCategory(payload),
        () => 'Kategori başarıyla oluşturuldu.',
      )

    // Diyalog yalnızca başarıda veya açık bir iptalde kapanır — kullanıcının
    // okuyup düzeltmesi gereken bir hatada asla.
    if (ok) setDialog(null)
  }

  const openCreate = () => { setDialogError(''); setDialog({ mode: 'create' }) }
  const openEdit = (category) => { setDialogError(''); setDialog({ mode: 'edit', category }) }

  return (
    <div className="admin-poi-page">
      <AdminPageHeader
        title="POI Yönetimi"
        description="POI kayıtlarını ve kategori hiyerarşisini yönetin."
      />

      {/* Tek sekme kalıyorsa şerit çizilmez: seçenek sunmayan bir sekme
          çubuğu, olmayan bir tercihi varmış gibi gösterirdi. */}
      {tabs.length > 1 && (
        <div className="admin-poi-tabs" role="tablist" aria-label="POI yönetimi bölümleri">
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`poi-tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              aria-controls={`poi-panel-${tab.id}`}
              /* Sekme çubuğunda klavye sırası TEK bir duraktır ve seçim ok
                 tuşlarıyla değişir — WAI-ARIA sekme deseni budur. */
              tabIndex={activeTab === tab.id ? 0 : -1}
              className={`admin-poi-tab ${activeTab === tab.id ? 'is-active' : ''}`}
              onClick={() => setRequestedTab(tab.id)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
                event.preventDefault()
                const step = event.key === 'ArrowRight' ? 1 : -1
                const next = tabs[(index + step + tabs.length) % tabs.length]
                setRequestedTab(next.id)
                document.getElementById(`poi-tab-${next.id}`)?.focus()
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {notice && (
        <div className={`admin-notice is-${notice.type}`} role="status">
          {notice.message}
          <button type="button" onClick={() => setNotice(null)} aria-label="Bildirimi kapat">×</button>
        </div>
      )}

      {activeTab === TAB_POIS && canManagePois && (
        <section
          role={tabs.length > 1 ? 'tabpanel' : undefined}
          id="poi-panel-pois"
          aria-labelledby={tabs.length > 1 ? 'poi-tab-pois' : undefined}
        >
          {poisError && (
            <div className="admin-error" role="alert">
              <span>{poisError}</span>
              <button type="button" onClick={loadPois}>Tekrar dene</button>
            </div>
          )}
          <PoiList pois={pois} loading={poisLoading} />
        </section>
      )}

      {activeTab === TAB_CATEGORIES && canManageCategories && (
        <section
          role={tabs.length > 1 ? 'tabpanel' : undefined}
          id="poi-panel-categories"
          aria-labelledby={tabs.length > 1 ? 'poi-tab-categories' : undefined}
        >
          <div className="admin-poi-toolbar">
            <button type="button" className="admin-button" onClick={openCreate}>
              + Yeni Kategori
            </button>
          </div>

          {categoriesError && (
            <div className="admin-error" role="alert">
              <span>{categoriesError}</span>
              <button type="button" onClick={loadCategories}>Tekrar dene</button>
            </div>
          )}

          <PoiCategoryTree
            categories={categories}
            loading={categoriesLoading}
            canEdit={canManageCategories}
            onEdit={openEdit}
          />
        </section>
      )}

      {dialog && canManageCategories && (
        <PoiCategoryDialog
          /* `key` diyaloğu hedefine bağlar: başka bir kategoriye geçildiğinde
             bileşen yeniden kurulur ve önceki düzenlemenin değerleri sonraki
             forma sızmaz. */
          key={dialog.mode === 'edit' ? `edit-${dialog.category.id}` : 'create'}
          mode={dialog.mode}
          category={dialog.mode === 'edit' ? dialog.category : null}
          categories={categories}
          busy={busy}
          error={dialogError}
          onCancel={() => { setDialog(null); setDialogError('') }}
          onSubmit={submitCategory}
        />
      )}
    </div>
  )
}
