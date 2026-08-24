import { useEffect, useMemo, useRef, useState } from 'react'
import { categoryLabel, searchPoiCategories } from '../../map/poiCategorySearch.js'

/**
 * Aranabilir kategori seçici.
 *
 * Düz bir `<select>` yerine bir arama alanı + filtrelenmiş liste kullanılır:
 * taksonomi hiyerarşiktir ve derinleştikçe açılır liste, kullanıcının aradığı
 * yaprağı onlarca satır arasında elle bulmasını gerektirir. Burada "kafe"
 * yazmak yaprağa, "Yeme" yazmak bütün dala gider.
 *
 * <b>Eşleşme mantığı burada DEĞİLDİR.</b> Katlama, ad+yol eşleşmesi ve
 * kullanılamaz satırların elenmesi `map/poiCategorySearch.js` içindedir;
 * oluşturma formu, düzenleme formu ve yönetim ekranındaki filtre aynı
 * fonksiyonu çağırır — üç ekranda üç farklı arama davranışı doğamaz.
 *
 * <b>Seçim kimlikledir, metinle değil.</b> Kullanıcının yazdığı metin yalnızca
 * filtredir; gönderilen değer daima listeden seçilmiş bir `id`'dir, dolayısıyla
 * serbest metin hiçbir yoldan kategoriye dönüşmez.
 */
export default function PoiCategoryPicker({
  value,
  categories = [],
  loading = false,
  error = '',
  disabled = false,
  onRetry,
  onChange,
  inputId = 'poi-category-search',
}) {
  const [query, setQuery] = useState('')
  const listRef = useRef(null)

  const matches = useMemo(() => searchPoiCategories(categories, query), [categories, query])
  const selected = useMemo(
    () => categories.find((category) => category.id === value) ?? null,
    [categories, value],
  )

  /* Seçim değiştiğinde seçili satır görünür alana getirilir: uzun bir listede
     düzenleme formu açıldığında kaydın kategorisi ekran dışında kalabilir. */
  useEffect(() => {
    if (!listRef.current || value == null) return
    const row = listRef.current.querySelector('[data-selected="true"]')
    row?.scrollIntoView({ block: 'nearest' })
  }, [value, matches])

  const noneUsable = !loading && !error && searchPoiCategories(categories, '').length === 0

  return (
    <div className="poi-category-picker">
      <label className="poi-field" htmlFor={inputId}>
        <span>Kategori</span>
        <input
          id={inputId}
          type="search"
          role="searchbox"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={disabled || loading || noneUsable}
          placeholder={loading ? 'Kategoriler yükleniyor…' : 'Kategori ara (ör. kafe)'}
          autoComplete="off"
        />
      </label>

      {/* Seçili kategori HER ZAMAN görünür durur: filtre onu eleyecek bir
          arama yazıldığında bile kullanıcı neyin seçili olduğunu bilmelidir. */}
      {selected && (
        <p className="poi-category-selected" aria-live="polite">
          Seçili: <strong>{categoryLabel(selected)}</strong>
        </p>
      )}

      {error && (
        <p className="poi-form-error" role="alert">
          {error}
          {onRetry && (
            <button type="button" className="poi-link-button" onClick={onRetry}>
              Tekrar dene
            </button>
          )}
        </p>
      )}

      {noneUsable && (
        <p className="poi-form-note" role="status">
          POI eklemek için önce bir kategori tanımlanmalıdır.
        </p>
      )}

      {!loading && !error && !noneUsable && (
        <ul className="poi-category-list" ref={listRef} role="listbox" aria-label="Kategoriler">
          {matches.length === 0 && (
            <li className="poi-category-empty" role="presentation">
              Aramanızla eşleşen kategori yok.
            </li>
          )}

          {matches.map((category) => {
            const isSelected = category.id === value
            return (
              <li key={category.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  data-selected={isSelected ? 'true' : 'false'}
                  className={`poi-category-option ${isSelected ? 'is-selected' : ''}`}
                  disabled={disabled}
                  onClick={() => onChange?.(category.id)}
                >
                  {/* Yol tam hâliyle gösterilir: aynı adlı kardeşler ancak
                      böyle ayırt edilir. */}
                  {categoryLabel(category)}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
