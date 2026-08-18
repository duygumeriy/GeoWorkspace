import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchAdminPermissions, readApiError } from '../../services/api.js'
import AdminPageHeader from '../../components/admin/AdminPageHeader.jsx'
import PermissionCatalogList from '../../components/admin/PermissionCatalogList.jsx'
import {
  STATUS_FILTERS,
  categoryOptions,
  countStatuses,
  filterPermissions,
  hasActiveFilters,
} from '../../components/admin/permissionCatalog.js'
import './PermissionsPage.css'

/**
 * Yetki kataloğu — salt okunur.
 *
 * Tek kaynak `GET /api/admin/permissions`'tır ve sayfa açılışta YALNIZCA onu
 * çağırır. Rol bazlı `.../roles/{id}/permissions` buraya karışmaz: o uç "bu
 * rolde ne işaretli" sorusunu yanıtlar, bu ekranın sorusu ise "sistemde hangi
 * yetkiler VAR". Rol başına istek açmak 30 rollük bir kurulumda açılışta 30
 * istek demek olurdu.
 *
 * Arama ve süzgeçler TAMAMEN istemci tarafındadır. Katalog birkaç düzine
 * satırdır ve zaten tamamı indirilmiştir; her tuş vuruşunda sunucuya gitmek,
 * elde olan veriyi ikinci kez indirmek olurdu.
 *
 * <b>Katalogda CRUD YOKTUR</b> ve bu bir eksik değildir: bir yetki, kodda
 * karşılığı olan bir yeteneği temsil eder. Sunucunun da create/update/delete
 * ucu yoktur; burada bir "yeni yetki" düğmesi çizmek, hiçbir şeyin
 * denetlemediği satırlar vaat etmek olurdu.
 */
export default function PermissionsPage() {
  const [permissions, setPermissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')
  const [status, setStatus] = useState('All')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetchAdminPermissions()
      if (!res.ok) {
        /* 403 bir oturum sorunu DEĞİLDİR: token geçerli, izin yok. authFetch
           yalnızca 401'de çıkış yaptırır; burada kişiyi giriş ekranına atmak,
           çalışan bir oturumu yetki eksikliği yüzünden sonlandırmak olurdu. */
        throw new Error(res.status === 403
          ? 'Yetki kataloğunu görüntülemek için gerekli izne sahip değilsiniz. Yönetici oturumunuzda MFA doğrulaması gerekli olabilir.'
          : await readApiError(res, 'Yetkiler yüklenemedi.'))
      }
      setPermissions(await res.json())
    } catch (err) {
      setPermissions([])
      setError(err.message || 'Yetkiler yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const categories = useMemo(() => categoryOptions(permissions), [permissions])
  const counts = useMemo(() => countStatuses(permissions), [permissions])
  const visible = useMemo(
    () => filterPermissions(permissions, { search, category, status }),
    [permissions, search, category, status],
  )

  /* Seçili kategori katalogdan düşebilir (tekrar denemeden sonra gelen yanıt
     daha dar olabilir). Süzgeç o değerde kalırsa açılır liste eşleşmeyen bir
     değer gösterir ve tablo görünür bir sebep olmadan boşalırdı. */
  useEffect(() => {
    if (category !== 'All' && !categories.some((option) => option.value === category)) {
      setCategory('All')
    }
  }, [categories, category])

  const filtered = hasActiveFilters({ search, category, status })
  const clearFilters = () => { setSearch(''); setCategory('All'); setStatus('All') }

  /* İki boş durum aynı şey DEĞİLDİR ve aynı cümleyi kurmazlar: biri "katalog
     boş", diğeri "süzgeçler eşleşmedi". İkincisinde çıkış yolu da sunulur. */
  const empty = filtered ? (
    <div className="admin-empty">
      <strong>Eşleşen yetki yok</strong>
      {/* Temizleme düğmesi hemen yukarıdaki özet satırındadır ve burada TEKRAR
          EDİLMEZ: aynı işi yapan iki düğme, ekran okuyucuda da klavyede de iki
          ayrı durak demek olurdu. */}
      <span>Bu filtrelerle eşleşen yetki bulunamadı. Aramayı ve süzgeçleri yukarıdan temizleyebilirsiniz.</span>
    </div>
  ) : (
    <div className="admin-empty">
      <strong>Yetki bulunamadı</strong>
      <span>Sistemde tanımlı yetki yok.</span>
    </div>
  )

  return (
    <div className="admin-permissions-page">
      <AdminPageHeader
        title="Yetkiler"
        /* Metin ne yapılabileceğini SÖYLER: bu ekran inceleme ekranıdır.
           "Yönetin" demek, olmayan bir düzenleme vaadi olurdu. */
        description="Sistemde tanımlı yetkileri görüntüleyin ve erişim kapsamlarını inceleyin."
      />

      <section className="admin-toolbar admin-catalog-toolbar" aria-label="Yetki filtreleri">
        <label className="admin-search">
          <span className="sr-only">Yetki ara</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Yetki adı, kodu veya açıklama ara..."
          />
        </label>
        <label>
          Kategori
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="All">Tüm kategoriler</option>
            {/* Seçenekler yüklenen veriden gelir; sabit bir kategori listesi
                yeni bir kategori eklendiği gün sessizce eksik kalırdı. */}
            {categories.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          Durum
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            {STATUS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </section>

      {!loading && !error && counts.total > 0 && (
        <p className="admin-catalog-summary" role="status">
          {filtered ? (
            <span><strong>{visible.length}</strong> / {counts.total} yetki gösteriliyor</span>
          ) : (
            /* Sayımlar daima yanıttan türer; hiçbir toplam sabitlenmez. */
            <span>
              <strong>{counts.total}</strong> yetki · {counts.active} aktif
              {counts.inactive > 0 && ` · ${counts.inactive} pasif`}
            </span>
          )}
          {filtered && (
            <button type="button" className="admin-catalog-clear" onClick={clearFilters}>
              Filtreleri Temizle
            </button>
          )}
        </p>
      )}

      {error && (
        <div className="admin-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={load}>Tekrar dene</button>
        </div>
      )}

      {!error && <PermissionCatalogList permissions={visible} loading={loading} empty={empty} />}
    </div>
  )
}
