import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { categoryLabel, searchPoiCategories } from '../../map/poiCategorySearch.js'

/**
 * Aranabilir kategori seçici — <b>tek</b> denetim.
 *
 * <b>Neden ayrı bir arama kutusu + `select` DEĞİL.</b> Önceki düzen her ölçüt
 * satırına iki denetim koyuyordu: "Kategori 1 ara" ve "Kategori 1". İkisi de
 * aynı soruyu soruyor gibi görünüyordu ve kullanıcı yazdıktan sonra seçimi
 * AYRICA yapmak zorundaydı; beş ölçütlü bir analizde panelde on denetim
 * oluyordu. Burada arama ile seçim aynı alandır: yazmak listeyi daraltır,
 * seçmek aynı alanı seçili kategorinin adına çevirir.
 *
 * <b>Eşleşme mantığı burada DEĞİLDİR.</b> Katlama, ad + yol araması ve
 * kullanılamaz satırların elenmesi `map/poiCategorySearch.js` içindedir; POI
 * oluşturma formu, düzenleme formu ve yönetim filtresi aynı fonksiyonu
 * çağırır — dört ekranda dört farklı arama davranışı doğamaz.
 *
 * <b>Seçim KİMLİKLEdir, metinle değil.</b> Kullanıcının yazdığı metin yalnızca
 * bir filtredir; dışarı verilen değer daima listeden seçilmiş bir `id`'dir,
 * dolayısıyla serbest metin hiçbir yoldan kategoriye dönüşmez.
 *
 * <b>Erişilebilirlik.</b> WAI-ARIA'nın combobox/listbox kalıbı: alan
 * `role="combobox"` + `aria-expanded` + `aria-controls` taşır, etkin seçenek
 * `aria-activedescendant` ile bildirilir (odak alanda KALIR, listeye
 * geçmez), liste `role="listbox"` ve satırlar `role="option"`tur.
 */
export default function CategoryCombobox({
  id,
  label,
  value = null,
  options = [],
  disabled = false,
  placeholder = 'Kategori ara veya seçin…',
  emptyText = 'Aramanızla eşleşen kategori yok.',
  onChange,
}) {
  const listId = `${id}-listbox`
  const generatedPrefix = useId()

  const [open, setOpen] = useState(false)
  /* `query` yalnızca kullanıcı YAZARKEN anlamlıdır. `typing`, alanın seçili
     kategoriyi mi yoksa sorguyu mu gösterdiğini ayırır: ikisini tek bir
     duruma sıkıştırmak, seçimden sonra alanın boş görünmesine ya da yazmaya
     başlayınca seçili adın silinememesine yol açardı. */
  const [query, setQuery] = useState('')
  const [typing, setTyping] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const containerRef = useRef(null)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  const selected = useMemo(
    () => options.find((category) => category.id === value) ?? null,
    [options, value],
  )

  /* Yazılmıyorsa filtre UYGULANMAZ: alan seçili kategoriyi gösterirken
     listenin o ada göre daralması, kullanıcıyı kendi seçiminin dışına
     çıkamaz hâle getirirdi. */
  const matches = useMemo(
    () => searchPoiCategories(options, typing ? query : ''),
    [options, query, typing],
  )

  const close = useCallback(() => {
    setOpen(false)
    setTyping(false)
    setQuery('')
    setActiveIndex(-1)
  }, [])

  const commit = useCallback(
    (category) => {
      if (!category) return
      onChange?.(category.id)
      close()
    },
    [close, onChange],
  )

  /* --- Escape: YEREL dinleyici, React'in sentetik olayı DEĞİL --------------

     Panelin kendisi bir diyalogdur ve Escape ile kapanır; o dinleyici panel
     düğümüne YEREL olarak bağlıdır (`MapSheet`). React ise sentetik olaylarını
     kök kapsayıcıda toplar — yani panel düğümünün ÜSTÜNDE. Yerel olay
     `input → panel → kök` sırasıyla yükseldiği için panelin dinleyicisi
     React'inkinden ÖNCE çalışır: sentetik bir `onKeyDown` içinden yapılan
     `stopPropagation` çok geç kalır ve listeyi kapatmak için basılan Escape
     PANELİ kapatır — kullanıcının kurduğu bütün analiz formuyla birlikte.
     Ölçüldü: tarayıcı testinde alan Escape'ten sonra DOM'da bulunamıyordu.

     Dinleyici bu yüzden alanın KENDİSİNE bağlanır; olay zincirin en altında
     yakalanır ve panele hiç ulaşmaz. Liste kapalıyken hiçbir şey yapılmaz,
     dolayısıyla ikinci bir Escape beklendiği gibi paneli kapatır. */
  useEffect(() => {
    if (!open) return undefined

    const input = inputRef.current
    if (!input) return undefined

    const onEscape = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      // Seçim DEĞİŞMEZ: kaçış yalnızca yazılanı geri alır.
      close()
    }

    input.addEventListener('keydown', onEscape)
    return () => input.removeEventListener('keydown', onEscape)
  }, [open, close])

  /* Dışarı tıklama kapatır. `mousedown` dinlenir, `click` değil: bir
     seçeneğe tıklandığında `blur` ile `click` yarışır ve `click` kaybederse
     seçim hiç gerçekleşmezdi. */
  useEffect(() => {
    if (!open) return undefined

    const onPointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) close()
    }

    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open, close])

  /* Etkin satır her zaman görünür alanda tutulur: klavyeyle gezinen biri
     listenin dışına kayan bir seçeneği takip edemez. */
  useEffect(() => {
    if (!open || activeIndex < 0) return
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  const openList = () => {
    if (disabled) return
    setOpen(true)

    /* <b>Metin BAŞTAN seçilir.</b> Alan, seçim yapıldıktan sonra kategorinin
       tam yolunu gösterir ("Sağlık Kurumları / Eczane"); üzerine yazmaya
       başlayan biri o metnin SONUNA eklemiş olsaydı sorgu
       "Sağlık Kurumları / Eczanee" olur ve hiçbir şey eşleşmezdi. Tümünü
       seçmek, ilk tuşun metni değiştirmesini sağlar — bir seçicide beklenen
       davranış budur. */
    if (!typing) inputRef.current?.select()

    // Açılışta etkin satır SEÇİLİ olandır; yoksa hiçbiri.
    setActiveIndex(selected ? matches.findIndex((category) => category.id === selected.id) : -1)
  }

  const move = (delta) => {
    if (matches.length === 0) return
    setActiveIndex((current) => {
      const next = current + delta
      if (next < 0) return matches.length - 1
      if (next >= matches.length) return 0
      return next
    })
  }

  const onKeyDown = (event) => {
    if (disabled) return

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        if (!open) openList()
        else move(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        if (!open) openList()
        else move(-1)
        break
      case 'Enter':
        if (open && activeIndex >= 0) {
          // Panelin formunu göndermez: seçim bir gönderim değildir.
          event.preventDefault()
          commit(matches[activeIndex])
        }
        break
      /* Escape BURADA ele ALINMAZ — aşağıdaki yerel (native) dinleyiciye
         aittir. Gerekçe orada. */
      case 'Escape':
        break
      case 'Tab':
        if (open) close()
        break
      default:
        break
    }
  }

  const optionId = (index) => `${generatedPrefix}-option-${index}`

  return (
    <div className="la-combobox" ref={containerRef}>
      {/* Etiket denetimin KARDEŞİdir. İçine konsaydı erişilebilir ad,
          listedeki seçeneklerin metnini de yutardı. */}
      <label htmlFor={id}>{label}</label>

      <div className="la-combobox-control">
        <input
          id={id}
          ref={inputRef}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          disabled={disabled}
          placeholder={placeholder}
          value={typing ? query : categoryLabel(selected)}
          onChange={(event) => {
            setTyping(true)
            setOpen(true)
            setQuery(event.target.value)
            setActiveIndex(-1)
          }}
          onFocus={openList}
          onClick={openList}
          onKeyDown={onKeyDown}
        />

        {/* Seçimi temizlemek, ölçütü "henüz seçilmedi" durumuna döndürür;
            satırı silmekle aynı şey DEĞİLDİR. */}
        {selected && !disabled && (
          <button
            type="button"
            className="la-combobox-clear"
            aria-label={`${label} seçimini temizle`}
            onClick={() => {
              onChange?.(null)
              close()
              inputRef.current?.focus()
            }}
          >
            ×
          </button>
        )}

        <span className="la-combobox-caret" aria-hidden="true">
          ▾
        </span>
      </div>

      {/* Liste KAPALIYKEN de DOM'da durur ve `hidden` alır: `aria-controls`
          var olmayan bir kimliği gösteremez. */}
      <ul
        id={listId}
        ref={listRef}
        role="listbox"
        /* <b>Etiket alanınkinden FARKLI olmalıdır.</b> Aynı adı taşısaydı
           "Kategori 1" adıyla yapılan her erişilebilirlik sorgusu İKİ düğüm
           döndürürdü — hem alan hem liste — ve ekran okuyucu kullanan biri
           hangisinde olduğunu ayırt edemezdi. */
        aria-label={`${label} listesi`}
        className="la-combobox-list"
        hidden={!open}
      >
        {matches.length === 0 && (
          <li className="la-combobox-empty" role="presentation">
            {emptyText}
          </li>
        )}

        {matches.map((category, index) => {
          const isSelected = category.id === value
          const isActive = index === activeIndex

          return (
            <li
              key={category.id}
              id={optionId(index)}
              role="option"
              aria-selected={isSelected}
              data-active={isActive ? 'true' : 'false'}
              className={`la-combobox-option ${isActive ? 'is-active' : ''} ${isSelected ? 'is-selected' : ''}`}
              /* `mousedown` üzerinde seçilir: `click` beklenirse alanın
                 `blur`'ü listeyi önce kapatır ve tıklama boşa düşer. */
              onMouseDown={(event) => {
                event.preventDefault()
                commit(category)
              }}
              onMouseEnter={() => setActiveIndex(index)}
            >
              {/* Yol tam hâliyle gösterilir: aynı adlı kardeşler ancak böyle
                  ayırt edilir (Sağlık Kurumları / Eczane). */}
              {categoryLabel(category)}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
