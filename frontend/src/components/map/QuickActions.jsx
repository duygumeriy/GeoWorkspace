import { Route as RouteIcon, Search } from 'lucide-react'
import { HomeIcon, CrosshairIcon, FocusIcon } from '../ui/icons/index.js'
import { JOURNEY_CENTER_TITLE } from '../../map/journeyWorkspace.js'
import './QuickActions.css'

/**
 * Camera shortcuts, stacked at the top-left corner of the map viewport.
 *
 * `children` extends the same stack with controls that are more than a plain
 * button — the basemap picker owns a popover, so it renders itself here rather
 * than being flattened into the `actions` list. Sharing the stack is what keeps
 * every map control one column at one size.
 *
 * <b>Arama düğmesi bir KAMERA kısayolu değildir</b>, ama aynı yığına aittir:
 * kullanıcı için hepsi "haritanın kenarındaki denetimler"dir ve ikinci bir
 * yüzen düğme, aynı işi yapan iki ayrı görsel dil demek olurdu. Bu yüzden
 * `children`'dan SONRA, yani yığının en altında çizilir ve `.quick-action`
 * sınıfını olduğu gibi kullanır — genişlik, yükseklik, kenarlık, gölge, hover
 * ve odak halkası diğerleriyle birebir aynıdır.
 *
 * Düğme yalnızca bir ANAHTARDIR: arama kutusunun kendisi onaylanmış üst-orta
 * konumunda açılır, buranın yanında değil.
 */
export default function QuickActions({
  onGoTurkey,
  onGoMyLocation,
  onFocusAll,
  /**
   * `{ permitted, open, onToggle, buttonRef }` — yoksa düğme hiç çizilmez.
   * `permitted`, çağıranın arayabildiği POI/çizim/ulaşım türlerinden en az
   * birinin bulunmasından gelir; burada rol adına bakan bir kural yoktur.
   */
  search = null,
  /**
   * `{ permitted, open, onToggle, status }` — yoksa düğme hiç çizilmez.
   *
   * Arama düğmesiyle AYNI gerekçe: yolculuk paneli de bir panel açar ve
   * kısayolu bu yığına aittir. Panelin kendi köşesinde duran ayrı bir yeniden
   * açma düğmesi, analiz panelinin tam üstüne oturuyordu.
   *
   * `status` sunucudan türetilmiş bir DURUM ÖZETİDİR (`journeyStatusIndicator`)
   * ve yalnızca okunur: burada hiçbir ölçüm hesaplanmaz, hiçbir animasyon
   * döngüsü kurulmaz.
   */
  journey = null,
  children,
}) {
  const actions = [
    { id: 'turkey', label: "Türkiye'ye Dön", Icon: HomeIcon, onClick: onGoTurkey },
    { id: 'location', label: 'Konumuma Git', Icon: CrosshairIcon, onClick: onGoMyLocation },
    { id: 'focus', label: 'Tüm Çizimlere Odaklan', Icon: FocusIcon, onClick: onFocusAll },
  ]

  return (
    <div className="quick-actions" role="group" aria-label="Harita kısayolları">
      {actions.map(({ id, label, Icon, onClick }) => (
        <button key={id} type="button" className="quick-action" aria-label={label} title={label} onClick={onClick}>
          <Icon size={18} />
        </button>
      ))}
      {children}

      {journey?.permitted && (
        <button
          type="button"
          className={`quick-action journey-trigger ${journey.open ? 'is-open' : ''}`.trim()}
          /* Panel kapalıyken bile yolculuğun SÜRDÜĞÜ söylenir: nokta görsel
             ipucudur, cümle ise erişilebilir addadır.

             Ad ÜRÜNÜN adıdır, bir özelliğinki değil: kısayol artık yalnızca
             planlayıcıyı değil, kaydedilenleri, geçmişi ve paylaşımlı ulaşımı
             da açıyor. Kenar çubuğundaki satırla AYNI metin kullanılır —
             kullanıcı iki farklı yerden aynı ürüne gittiğini bilmelidir. */
          aria-label={journey.status
            ? `${JOURNEY_CENTER_TITLE} · ${journey.status.label}`
            : JOURNEY_CENTER_TITLE}
          title={journey.status ? journey.status.label : JOURNEY_CENTER_TITLE}
          aria-pressed={Boolean(journey.open)}
          onClick={journey.onToggle}
        >
          <RouteIcon size={18} strokeWidth={2} />
          {journey.status && (
            <span className={`journey-trigger-dot is-${journey.status.tone}`} aria-hidden="true" />
          )}
        </button>
      )}

      {search?.permitted && (
        <button
          type="button"
          /* Açık durumun görünümü YENİDEN İCAT EDİLMEZ: temel harita
             seçicisinin `is-open` durumu zaten bu yığının "etkin" dilidir. */
          className={`quick-action poi-search-trigger ${search.open ? 'is-open' : ''}`}
          ref={search.buttonRef}
          aria-label="Haritada Ara"
          title="Haritada Ara"
          aria-pressed={Boolean(search.open)}
          onClick={search.onToggle}
        >
          <Search size={18} strokeWidth={2} />
        </button>
      )}
    </div>
  )
}
