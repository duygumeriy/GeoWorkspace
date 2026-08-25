import PoiCategoryBadge from '../map/PoiCategoryBadge.jsx'
import { categoryStatus, indentOf } from './poiCategories.js'
import { displayColor, iconLabel } from './poiCategoryMetadata.js'

/**
 * Kategori hiyerarşisi.
 *
 * Sunucu satırları YOL SIRASINDA döner ve her satır kendi `path` ve `depth`
 * değerini taşır; ağaç bu yüzden istemcide yeniden kurulmaz. İç içe bir veri
 * yapısı üretmek, sunucunun zaten cevapladığı soruyu ikinci kez cevaplamak ve
 * döngü korumasını tarayıcıya taşımak olurdu — burada yapılan tek şey düz
 * listeyi girintiyle çizmektir.
 *
 * Derinlik SINIRSIZ varsayılır; girinti ise `MAX_INDENT_DEPTH` ile sabitlenir,
 * böylece çok derin bir dal satırı yatay olarak taşırmaz.
 */
export default function PoiCategoryTree({
  categories,
  loading,
  canEdit,
  /** Süzgeçten ÖNCEKİ satır sayısı: iki boş durumu ayırt eden tek bilgi. */
  total = null,
  onResetFilters,
  onEdit,
}) {
  if (loading) {
    return (
      <div className="admin-users-list" aria-label="Kategoriler yükleniyor">
        {[1, 2, 3, 4].map((n) => <div className="admin-skeleton" key={n} />)}
      </div>
    )
  }

  if (!categories.length) {
    const filteredOut = total !== null && total > 0

    return (
      <div className="admin-empty">
        {filteredOut ? (
          <>
            <strong>Filtrelerle eşleşen kategori bulunamadı.</strong>
            <span>Arama ya da süzgeç ölçütlerini genişletmeyi deneyin.</span>
            {onResetFilters && (
              <button type="button" className="admin-button secondary" onClick={onResetFilters}>
                Filtreleri Temizle
              </button>
            )}
          </>
        ) : (
          <>
            <strong>Henüz kategori bulunmuyor.</strong>
            <span>POI eklenebilmesi için önce en az bir kategori tanımlanmalıdır.</span>
          </>
        )}
      </div>
    )
  }

  return (
    <ul className="admin-poi-tree" aria-label="POI kategorileri">
      {categories.map((category) => {
        const status = categoryStatus(category)
        /* Silinmiş satır DÜZENLENEMEZ: backend bu satırlar için NotFound döner,
           dolayısıyla düğmeyi sunmak garanti başarısız bir işlem vaat etmek
           olurdu. Görünür kalır — denetim için envanterin tamamı gösterilir. */
        const editable = canEdit && !category.isDeleted

        return (
          <li
            key={category.id}
            className="admin-poi-tree-item"
            style={{ '--poi-depth': indentOf(category) }}
          >
            <div className="admin-poi-tree-row">
              {/* Kök satırlarda bağlantı işareti çizilmez: bağlanacağı bir üst
                  yok. Görünürlüğü CSS'te satır içi stile bakarak çözmek,
                  seçiciyi React'in özel özellik serileştirmesine bağlardı. */}
              {indentOf(category) > 0 && <span className="admin-poi-tree-rail" aria-hidden="true" />}

              {/* Kategorinin GERÇEK simgesi, rengiyle birlikte.
                  Önceki hâli 12 piksellik renkli bir kareydi: rengi doğru
                  söylüyordu ama hangi kategori olduğunu söylemiyordu — ve
                  yöneticinin listede aradığı tam olarak oydu. Simge, haritanın
                  ve arama sonuçlarının kullandığı AYNI kayıttan çözülür
                  (`poiIconRegistry`), dolayısıyla üç ekran aynı kategoriyi aynı
                  glifle gösterir.

                  Her satır KENDİ `iconKey`'ini kullanır; alt kategori üstünün
                  simgesini devralmaz — "Giyim Mağazaları" gömlek, "Alışveriş"
                  çanta gösterir. Renk `displayColor` ile normalleştirilir ve
                  bozuk/eksik değer nötr griye düşer. */}
              <PoiCategoryBadge
                iconKey={category.iconKey}
                colorHex={displayColor(category)}
                className="admin-poi-tree-swatch"
              />

              <span className="admin-poi-tree-identity">
                <strong>{category.name}</strong>
                {/* Üst bağlam yalnızca kök olmayan satırlarda anlamlıdır. */}
                {category.parentName && (
                  <small>{category.path}</small>
                )}
                {/* Teknik metadata İKİNCİL kalır: yönetici için gerekli
                    (ileride SLD kuralı slug'a bakacak) ama satırın konusu
                    kategorinin kendisidir. */}
                <small className="admin-poi-tree-meta">
                  <code>{category.slug}</code>
                  {category.iconKey && <> · {iconLabel(category.iconKey)}</>}
                </small>
              </span>

              <span className={`admin-badge ${status.tone}`}>{status.label}</span>

              {editable && (
                <button
                  type="button"
                  className="admin-button secondary admin-poi-tree-edit"
                  onClick={() => onEdit(category)}
                  aria-label={`${category.name} kategorisini düzenle`}
                >
                  Düzenle
                </button>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
