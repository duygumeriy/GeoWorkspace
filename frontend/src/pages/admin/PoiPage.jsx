import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createAdminPoiCategory,
  deletePoi,
  fetchAdminPoiCategories,
  fetchAdminPois,
  fetchPoiCategories,
  readApiError,
  restorePoi,
  updateAdminPoiCategory,
  updatePoi,
} from '../../services/api.js'
import { usePermissions } from '../../auth/permissionStore.js'
import { PERMISSIONS } from '../../auth/permissionCodes.js'
import AdminPageHeader from '../../components/admin/AdminPageHeader.jsx'
import PoiCategoryDialog from '../../components/admin/PoiCategoryDialog.jsx'
import PoiCategoryTree from '../../components/admin/PoiCategoryTree.jsx'
import PoiList from '../../components/admin/PoiList.jsx'
import PoiEditDialog from '../../components/admin/PoiEditDialog.jsx'
import AdminPoiFilterBar from '../../components/admin/AdminPoiFilterBar.jsx'
import AdminCategoryFilterBar from '../../components/admin/AdminCategoryFilterBar.jsx'
import {
  EMPTY_ADMIN_CATEGORY_FILTERS,
  EMPTY_ADMIN_POI_FILTERS,
  buildAdminCategoryView,
  buildAdminPoiView,
} from '../../map/adminPoiFilters.js'
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
  const navigate = useNavigate()
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

  /* --- Süzgeçler -------------------------------------------------------------
     Kural bileşenin DIŞINDADIR (`map/adminPoiFilters.js`) ve süzme İSTEMCİDE
     yapılır: yönetim uçları listenin tamamını tek seferde döner (sayfalama
     yoktur), dolayısıyla her tuş vuruşunda sunucuya gitmek hem gereksiz hem de
     yavaş olurdu. Süzgeç bir güvenlik sınırı değildir; kapsamı zaten sunucu
     belirledi. */
  const [poiFilters, setPoiFilters] = useState(EMPTY_ADMIN_POI_FILTERS)
  const [categoryFilters, setCategoryFilters] = useState(EMPTY_ADMIN_CATEGORY_FILTERS)

  const poiView = useMemo(() => buildAdminPoiView(pois, poiFilters), [pois, poiFilters])
  const categoryView = useMemo(
    () => buildAdminCategoryView(categories, categoryFilters),
    [categories, categoryFilters],
  )

  const resetPoiFilters = useCallback(() => setPoiFilters(EMPTY_ADMIN_POI_FILTERS), [])
  const resetCategoryFilters = useCallback(() => setCategoryFilters(EMPTY_ADMIN_CATEGORY_FILTERS), [])

  /* --- POI mutasyonları -----------------------------------------------------
     Kayıt uçları YÖNETİME ÖZEL değildir: `PUT/DELETE /api/poi/{id}` ve
     `POST /api/poi/{id}/restore`, haritanın kullandığı uçların ta kendisidir.
     `poi.manage` taşıyan çağıran aynı uçtan geçer ve sahiplik denetimini
     sunucu yapar — yönetim için iş kuralını atlayan ikinci bir yol açmak,
     kuralın iki yerde yaşaması demek olurdu. */

  /** Düzenlenmekte olan kayıt; aynı anda yalnızca bir tane. */
  const [poiDialog, setPoiDialog] = useState(null)
  const [poiDialogError, setPoiDialogError] = useState('')
  /** İşlem gören kaydın kimliği; yalnızca o satırın düğmeleri bekler. */
  const [poiBusyId, setPoiBusyId] = useState(null)

  /* Düzenleme formunun kategori listesi: harita formuyla AYNI uç (aktif
     kategoriler). Yönetim ağacı (pasif/silinmiş dâhil) burada kullanılmaz —
     bir POI yalnızca kullanılabilir bir kategoriye bağlanabilir. */
  const [poiCategories, setPoiCategories] = useState({ items: [], loading: false, error: '' })

  const loadPoiCategories = useCallback(async () => {
    setPoiCategories((current) => ({ ...current, loading: true, error: '' }))
    try {
      const res = await fetchPoiCategories()
      if (!res.ok) throw new Error(await readApiError(res, 'Kategoriler yüklenemedi.'))
      setPoiCategories({ items: await res.json(), loading: false, error: '' })
    } catch (err) {
      setPoiCategories({ items: [], loading: false, error: err.message || 'Kategoriler yüklenemedi.' })
    }
  }, [])

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

  /* Aynı gerekçe POI düzenleme formu için: `poi.manage` geri alındığında açık
     kalan form kapanır — sunucu zaten reddederdi, ama reddedileceği belli olan
     bir formu ayakta tutmanın anlamı yok. */
  useEffect(() => {
    if (!canManagePois) { setPoiDialog(null); setPoiDialogError('') }
  }, [canManagePois])

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

  /* --- POI eylemleri --------------------------------------------------------
     Üçü de aynı sırayı izler: isteği gönder, hatayı çevir, listeyi SUNUCUDAN
     yeniden oku. Satırı yerel olarak yamamak, sunucunun hesapladığı durum ve
     tarih alanlarının gerçekle ayrışmasına açık kapı bırakırdı. */

  const runPoiMutation = async (poi, request, describe) => {
    if (inFlight.current) return false
    inFlight.current = true
    setPoiBusyId(poi.id)
    setPoiDialogError('')

    try {
      const res = await request()
      if (!res.ok) {
        throw new Error(res.status === 403
          ? 'Bu POI kaydı üzerinde işlem yapma yetkiniz bulunmuyor.'
          : await readApiError(res, 'İşlem tamamlanamadı.'))
      }
      await loadPois()
      setNotice({ type: 'success', message: describe() })
      return true
    } catch (err) {
      const message = err.message || 'İşlem tamamlanamadı.'
      /* Diyalog açıkken hata orada gösterilir (girilen değerler yerinde
         kalsın), satır eyleminde ise sayfa bildirimi olarak. */
      if (poiDialog) setPoiDialogError(message)
      else setNotice({ type: 'error', message })
      return false
    } finally {
      inFlight.current = false
      setPoiBusyId(null)
    }
  }

  /**
   * "Haritada Taşı": düzenlemeyi HARİTADA sürdürür.
   *
   * <b>Hiçbir şey kaydedilmez.</b> Kalıcı kayıt, kullanıcı haritada
   * "Güncelle"ye basana kadar olduğu gibi durur; ekranlar arasında taşınan tek
   * şey KAYDEDİLMEMİŞ taslaktır. Sessiz bir PUT atmak, kullanıcının hiç
   * onaylamadığı bir yazma olurdu.
   *
   * <b>Devredilen şey yalnızca VERİDİR, yetki değil.</b> Gövdede `canUpdate`
   * gibi bir karar taşınmaz ve taşınamaz: harita sayfası kaydı kendi okuduğu
   * listeden çözer, yeteneği sunucunun o kayıt için verdiği bayraktan okur ve
   * PUT yine sunucuda sahiplik, kategori, koordinat ve coğrafi yetki
   * denetiminden geçer. Gezinme durumu istemci girdisidir; burada da öyle
   * muamele görür.
   */
  const moveOnMap = (draft) => {
    const target = poiDialog
    if (!target) return

    navigate('/map', {
      state: {
        poiEditHandoff: {
          poiId: target.id,
          draft,
          // Yalnızca bilgi amaçlı: nereden gelindiği.
          origin: '/admin/poi',
        },
      },
    })
  }

  const openPoiEdit = (poi) => {
    setPoiDialogError('')
    setPoiDialog(poi)
    if (!poiCategories.items.length && !poiCategories.loading) loadPoiCategories()
  }

  const submitPoiEdit = async (payload) => {
    const target = poiDialog
    if (!target) return
    const ok = await runPoiMutation(
      target,
      () => updatePoi(target.id, payload),
      () => `'${payload.name}' kaydı güncellendi.`,
    )
    // Diyalog yalnızca başarıda kapanır; okunması gereken bir hatada asla.
    if (ok) setPoiDialog(null)
  }

  const deletePoiRecord = (poi) =>
    runPoiMutation(
      poi,
      () => deletePoi(poi.id),
      // Soft delete: satır durur, "Silinmiş" olarak listelenmeye devam eder.
      () => `'${poi.name}' kaydı çöp kutusuna taşındı.`,
    )

  const restorePoiRecord = (poi) =>
    runPoiMutation(poi, () => restorePoi(poi.id), () => `'${poi.name}' kaydı geri yüklendi.`)

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
          {!poisLoading && !poisError && pois.length > 0 && (
            <AdminPoiFilterBar
              pois={pois}
              filters={poiFilters}
              onChange={setPoiFilters}
              onReset={resetPoiFilters}
              matchCount={poiView.matchCount}
              total={poiView.total}
            />
          )}

          <PoiList
            pois={poiView.items}
            total={poiView.total}
            onResetFilters={resetPoiFilters}
            loading={poisLoading}
            /* Sekme zaten `poi.manage` ile açılıyor; koşul yine de AÇIKÇA
               yazılır ki eylemlerin hangi yetkiye bağlı olduğu satırda
               görünsün. */
            canManage={canManagePois}
            busyId={poiBusyId}
            onEdit={openPoiEdit}
            onDelete={deletePoiRecord}
            onRestore={restorePoiRecord}
          />
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

          {!categoriesLoading && !categoriesError && categories.length > 0 && (
            <AdminCategoryFilterBar
              filters={categoryFilters}
              onChange={setCategoryFilters}
              onReset={resetCategoryFilters}
              matchCount={categoryView.matchCount}
              total={categoryView.total}
            />
          )}

          <PoiCategoryTree
            categories={categoryView.items}
            total={categoryView.total}
            onResetFilters={resetCategoryFilters}
            loading={categoriesLoading}
            canEdit={canManageCategories}
            onEdit={openEdit}
          />
        </section>
      )}

      {/* Düzenlenen kayıt değiştiğinde `key` formu sıfırdan kurar; bir önceki
          kaydın değerleri sonrakine sızmaz (kategori diyaloğuyla aynı kalıp). */}
      {poiDialog && canManagePois && (
        <PoiEditDialog
          key={poiDialog.id}
          poi={poiDialog}
          categories={poiCategories.items}
          categoriesLoading={poiCategories.loading}
          categoriesError={poiCategories.error}
          onRetryCategories={loadPoiCategories}
          busy={poiBusyId === poiDialog.id}
          error={poiDialogError}
          onCancel={() => { setPoiDialog(null); setPoiDialogError('') }}
          onSubmit={submitPoiEdit}
          onMoveOnMap={moveOnMap}
        />
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
