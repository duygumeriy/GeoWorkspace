import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { BusFront, Loader2, Route, Search, Shapes, X } from 'lucide-react'
import useGlobalMapSearch from '../../hooks/useGlobalMapSearch.js'
import PoiCategoryBadge from './PoiCategoryBadge.jsx'
import './PoiSearchBar.css'

/**
 * Harita üzerindeki çok türde global arama kutusu.
 *
 * <b>Görünürlük YETKİDEN türer.</b> Çağıran en az bir arama türünü görmeye
 * yetkili değilse bileşen hiç çizilmez; POI türü ayrıca `poi.view`, çizim türü
 * `drawings.view`, durak ve güzergah türleri `transport.view` gerektirir.
 *
 * <b>Klavyeyle kullanılabilir.</b> Combobox/listbox semantiği eksiksizdir:
 * ArrowDown/ArrowUp gezinir, Enter seçer, Escape kapatır ve
 * `aria-activedescendant` ekran okuyucuya hangi satırın etkin olduğunu söyler.
 * Yalnızca fareyle çalışan bir açılır liste, klavye kullanan birine aramayı
 * tamamen kapatırdı.
 *
 * <b>Kalıcı bir işaret KATMANI oluşturmaz.</b> POI'lerin haritadaki gösterimi
 * Faz 4'teki WMS rasterine aittir; burada yapılan tek şey kameranın
 * odaklanmasıdır. İkinci bir işaret katmanı aynı POI'yi iki kez çizerdi.
 *
 * <b>Artık kalıcı olarak da DURMAZ.</b> Bileşen yalnızca kullanıcı harita
 * denetimlerindeki arama düğmesine bastığında monte edilir. Kapanış bir
 * "gizleme" değil, gerçek bir SÖKÜLMEDİR ve bu bilinçlidir: uçan istek
 * `usePoiSearch`'ün kendi temizliğinde iptal olur, açılır liste yok olur,
 * klavye imleci sıfırlanır ve sorgu `useState('')` ile temiz doğar. Ayrı bir
 * "kapanışta şunları da temizle" yordamı yazmak, aynı işi ikinci kez ve
 * ayrışabilir biçimde yapmak olurdu.
 *
 * <b>Temizle ve KAPAT ayrı eylemlerdir.</b> Tek bir düğmenin bağlama göre bazen
 * metni silmesi bazen kutuyu kapatması, kullanıcının hangisini alacağını
 * bilememesi demektir. Temizle yalnızca metin varken ve kutunun İÇİNDE durur;
 * kapat her zaman en sağda, bir ayraçtan sonra.
 *
 * @param {{ enabled: boolean, onSelect: (result: object) => void,
 *           onClose?: () => void }} props
 */
export default function PoiSearchBar({
  enabled,
  availableTypes = [{ id: 'poi', label: 'POI' }],
  drawings = [],
  stops = [],
  routes = [],
  onSelect,
  onClose,
}) {
  const [type, setType] = useState(() => availableTypes[0]?.id ?? '')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const inputRef = useRef(null)
  const containerRef = useRef(null)

  const listboxId = useId()
  const optionId = useCallback((index) => `${listboxId}-option-${index}`, [listboxId])

  const { results, loading, error, searched, reset } = useGlobalMapSearch({
    enabled,
    type,
    query,
    drawings,
    stops,
    routes,
  })
  const selectedType = availableTypes.find((item) => item.id === type) ?? availableTypes[0]

  /* Açılır açılmaz yazılabilir. Kutuyu açmak için düğmeye basan biri, yazmak
     için ikinci kez tıklamak zorunda kalmamalıdır. Bileşen zaten yalnızca
     açıkken monte olduğu için "monte olunca odaklan" doğru ve tek kuraldır —
     zamanlayıcı hilesi gerekmez. */
  useEffect(() => {
    if (enabled) inputRef.current?.focus()
  }, [enabled])

  /* Sonuçlar değiştiğinde etkin satır başa döner: eski indeks yeni listede
     bambaşka bir kaydı işaret ederdi. */
  useEffect(() => {
    setActiveIndex(results.length > 0 ? 0 : -1)
  }, [results])

  const hasPanel = open && query.trim().length > 0
  const showEmpty = hasPanel && searched && !loading && !error && results.length === 0

  const close = useCallback(() => {
    setOpen(false)
    setActiveIndex(-1)
  }, [])

  useEffect(() => {
    if (availableTypes.some((item) => item.id === type)) return
    setType(availableTypes[0]?.id ?? '')
    setQuery('')
    reset()
    close()
  }, [availableTypes, type, reset, close])

  const clear = useCallback(() => {
    setQuery('')
    reset()
    close()
    inputRef.current?.focus()
  }, [close, reset])

  const choose = useCallback(
    (result) => {
      if (!result) return
      close()
      onSelect?.(result)
    },
    [close, onSelect],
  )

  /* Dışarı tıklama listeyi kapatır ama SORGUYU KORUR: kullanıcı haritaya bakıp
     geri dönebilmeli, yazdığını yeniden yazmak zorunda kalmamalıdır. */
  useEffect(() => {
    if (!hasPanel) return undefined

    const onPointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) close()
    }

    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [hasPanel, close])

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation()

      /* İKİ AŞAMALI ve bu, birleşik kutuların (combobox) standart davranışıdır:
         önce açılır liste kapanır ve odak kutuda kalır, ikinci Escape ise
         aramanın tamamını kapatır. Tek Escape her şeyi kapatsaydı, listeden
         vazgeçmek isteyen kullanıcı yazdığını da kaybederdi. */
      if (hasPanel) {
        close()
        return
      }

      onClose?.()
      return
    }

    if (!results.length) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((current) => (current + 1) % results.length)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((current) => (current <= 0 ? results.length - 1 : current - 1))
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      choose(results[activeIndex] ?? results[0])
    }
  }

  const rows = useMemo(
    () =>
      results.map((result, index) => {
        return (
          <li
            key={`${result.searchType}:${result.key ?? result.id}`}
            id={optionId(index)}
            role="option"
            aria-selected={index === activeIndex}
            className={`poi-search-option ${index === activeIndex ? 'is-active' : ''}`}
            /* Fare imleci klavye seçimiyle AYNI durumu sürer; iki ayrı
               "etkin satır" kavramı kullanıcıyı şaşırtırdı. */
            onMouseEnter={() => setActiveIndex(index)}
            /* mousedown: input'un blur olup listeyi kapatmasından ÖNCE seçer. */
            onMouseDown={(event) => {
              event.preventDefault()
              choose(result)
            }}
          >
            {/* Rozetin görünümü DEĞİŞMEDİ; yalnızca çizen kod ortaklaştı —
                yönetim ağacı ve "POI'lerim" artık aynı bileşeni kullanıyor. */}
            {result.searchType === 'poi' ? (
              <PoiCategoryBadge iconKey={result.iconKey} colorHex={result.colorHex} className="poi-search-option-icon" />
            ) : (
              <span className={`poi-search-option-icon global-search-icon is-${result.searchType}`} aria-hidden="true">
                {result.searchType === 'drawing' ? <Shapes size={17} /> : result.searchType === 'stop' ? <BusFront size={17} /> : <Route size={17} />}
              </span>
            )}
            <span className="poi-search-option-text">
              <strong>{result.name}</strong>
              <small>{
                result.searchType === 'poi' ? result.categoryName
                  : result.searchType === 'drawing' ? ({ point: 'Nokta', line: 'Çizgi', polygon: 'Poligon' }[result.type] ?? 'Çizim')
                    : result.searchType === 'stop' ? result.routeName
                      : `${result.stopCount ?? stops.filter((stop) => stop.routeId === result.id).length} durak`
              }</small>
            </span>
          </li>
        )
      }),
    [results, activeIndex, optionId, choose, stops],
  )

  // İzinli arama türü yoksa kutu HİÇ çizilmez ve hiçbir istek açılmaz.
  if (!enabled) return null

  return (
    <div className="poi-search" ref={containerRef}>
      <div className="poi-search-field global-search-field">
        <Search className="poi-search-leading" size={16} strokeWidth={2} aria-hidden="true" />

        <select
          className="global-search-type"
          aria-label="Arama türü"
          value={type}
          onChange={(event) => {
            setType(event.target.value)
            setQuery('')
            reset()
            close()
            inputRef.current?.focus()
          }}
        >
          {availableTypes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>

        <input
          ref={inputRef}
          type="text"
          className="poi-search-input"
          value={query}
          placeholder={`${selectedType?.label ?? ''} ara…`}
          aria-label={`${selectedType?.label ?? ''} ara`}
          autoComplete="off"
          role="combobox"
          aria-expanded={hasPanel}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 && results.length ? optionId(activeIndex) : undefined}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />

        {loading && (
          <Loader2 className="poi-search-spinner" size={16} strokeWidth={2} aria-hidden="true" />
        )}

        {query.length > 0 && (
          <button type="button" className="poi-search-clear" onClick={clear} aria-label="Aramayı temizle">
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        )}

        {/* Kapat AYRI bir eylemdir: her zaman görünür, en sağda ve bir
            ayraçtan sonra durur. Temizle ise yalnızca silinecek bir metin
            varken belirir ve kutunun içinde kalır — ikisi ne yerini ne de
            görünürlük koşulunu paylaşır. */}
        {typeof onClose === 'function' && (
          <>
            <span className="poi-search-divider" aria-hidden="true" />
            <button
              type="button"
              className="poi-search-close"
              onClick={onClose}
              aria-label="Aramayı kapat"
              title="Aramayı kapat"
            >
              <X size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          </>
        )}
      </div>

      {hasPanel && (
        <div className="poi-search-panel">
          <ul id={listboxId} role="listbox" aria-label={`${selectedType?.label ?? ''} arama sonuçları`} className="poi-search-list">
            {rows}
          </ul>

          {showEmpty && <p className="poi-search-note">{selectedType?.label ?? 'Kayıt'} bulunamadı.</p>}
          {/* Hata haritayı düşürmez; küçük ve yıkıcı olmayan bir not. */}
          {error && <p className="poi-search-note poi-search-note-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  )
}
