import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Overlay from 'ol/Overlay'
import { fromLonLat } from 'ol/proj.js'
import IconButton from '../ui/IconButton.jsx'
import { CloseIcon } from '../ui/icons/index.js'
import './AnalysisPoiPopup.css'

/** Koordinat gösterimi: metrede ~1 m'lik ayrım için beş ondalık yeter. */
const COORDINATE_DIGITS = 5

/** CSS'teki `max-width` ile aynı: kartın merkezden sağa taşan yarısı. */
const POPUP_HALF_WIDTH = 140

/**
 * Tıklanan analiz POI'sinin kartı — <b>haritaya çakılı</b>.
 *
 * Bir `ol/Overlay` kullanılır, ekrana sabitlenmiş bir kutu DEĞİL: kart kaydın
 * koordinatına bağlıdır ve kaydırma/yakınlaştırmada onunla birlikte hareket
 * eder. Ekrana sabit bir kutu, "bu bilgi HANGİ noktaya ait" sorusunu
 * kullanıcıya bırakırdı.
 *
 * ## DOM sahipliği — bu bileşenin ASIL kuralı
 *
 * <b>Overlay'in kök düğümü JSX'te render EDİLMEZ.</b> OpenLayers, kendisine
 * verilen elemanı kendi overlay konteynerine TAŞIR. O eleman aynı zamanda bir
 * JSX ağacının çocuğu olsaydı, React onu hâlâ kendi ebeveyninin altında
 * sanmaya devam ederdi; bir kardeş düğüm eklendiğinde React
 * `parent.insertBefore(yeniDüğüm, buDüğüm)` çağırır ve düğüm artık o
 * ebeveynin çocuğu olmadığı için `NotFoundError` fırlar. Ölçüldü: kart
 * açıkken ısı haritası paneli (JSX'te bu bileşenden ÖNCE gelen kardeş)
 * mount edildiğinde tam olarak bu hata çıkıyor ve <b>uygulama beyaz ekrana
 * düşüyordu</b>.
 *
 * Sınır bu yüzden nettir:
 *
 * - <b>OpenLayers</b> konteyneri KONUMLANDIRIR. Konteyner burada
 *   `document.createElement` ile üretilir; React ağacına hiç girmez,
 *   dolayısıyla React onun yerleşimi hakkında hiçbir varsayım taşımaz.
 * - <b>React</b> konteynerin İÇİNİ render eder (`createPortal`). Portal, ayrı
 *   bir `createRoot` yerine seçildi: tek bir React ağacı kalır, tema/bağlam
 *   çalışmaya devam eder ve StrictMode'un çift montajında ikinci bir kök
 *   oluşma riski yoktur.
 */
export default function AnalysisPoiPopup({ map, poi, error, onClose }) {
  /* Konteyner BİR KEZ üretilir ve StrictMode'un mount → cleanup → mount
     döngüsünde aynı kalır: her montajda yenisini üretmek, portal hedefini
     değiştirip içeriği gereksizce yeniden kurardı. */
  const containerRef = useRef(null)
  if (containerRef.current === null && typeof document !== 'undefined') {
    containerRef.current = document.createElement('div')
  }

  const overlayRef = useRef(null)
  const [growLeft, setGrowLeft] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!map || !container) return undefined

    const overlay = new Overlay({
      element: container,
      positioning: 'bottom-center',
      /* Kart, işaret ettiği noktanın ÜSTÜNDE durur; nokta kartın altından
         görünmeye devam eder. */
      offset: [0, -14],
      /* `stopEvent` AÇIK: kartın içindeki kapatma düğmesi bir harita
         tıklaması olarak da sayılsaydı, kartı kapatan tık aynı anda yeni bir
         isabet testi başlatırdı. */
      stopEvent: true,
      /* Kenara yakın bir noktaya tıklandığında harita kartı görünür kılacak
         kadar kayar. */
      autoPan: { animation: { duration: 200 }, margin: 24 },
    })

    overlayRef.current = overlay
    map.addOverlay(overlay)

    return () => {
      /* Sıra ÖNEMLİ: önce konum düşürülür, sonra overlay haritadan alınır.
         OpenLayers konteyneri kendi ağacından çıkarır; konteynerin kendisi
         bize aittir ve bir sonraki montajda yeniden kullanılır. */
      overlay.setPosition(undefined)
      map.removeOverlay(overlay)
      if (overlayRef.current === overlay) overlayRef.current = null
    }
  }, [map])

  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay) return

    if (!poi) {
      overlay.setPosition(undefined)
      return
    }

    /* Konum EPSG:3857'ye çevrilir: kayıt derecelerde saklanır, harita Web
       Mercator'dadır. Ham dereceyi vermek kartı Gine Körfezi'ne koyardı. */
    const coordinate = fromLonLat([poi.longitude, poi.latitude])

    /* --- Kart docklenmiş panelden KAÇAR --------------------------------------

       <b>Kart panelin üstüne ÇIKAMAZ ve bu yapısaldır.</b> `.map-container`
       bir açılış animasyonu için `transform` taşır; `transform` bir YIĞINLAMA
       BAĞLAMI kurar, dolayısıyla haritanın içindeki hiçbir `z-index` — kaç
       olursa olsun — panelin (z-index 40) üstüne çıkamaz.

       Çözüm DOM'u taşımak DEĞİLDİR (bkz. yukarıdaki sahiplik kuralı): kart
       panelin üzerine doğru BÜYÜMEZ, sağa dayalı bir noktada sola açılır.
       Karar yalnızca Overlay'in kendi `positioning` değeriyle ve React'in
       sahip olduğu bir sınıfla uygulanır. Panelin genişliği SABİT YAZILMAZ,
       ölçülür — kırılım noktalarında değişir ve telefonda panel alta yapışır. */
    const sheet = document.querySelector('.map-sheet')?.getBoundingClientRect()
    const viewport = map?.getTargetElement()?.getBoundingClientRect()
    const pixel = map?.getPixelFromCoordinate(coordinate)

    let towardsLeft = false

    if (sheet && viewport && pixel) {
      /* Yan dock mu, alt sayfa mı: telefonda panel altta ve tam genişliktir,
         yatay kaçış oraya çare değildir (kart zaten yukarı doğru açılır). */
      const isSideDock = sheet.height < viewport.height * 0.95
      towardsLeft = isSideDock && viewport.left + pixel[0] + POPUP_HALF_WIDTH > sheet.left
    }

    overlay.setPositioning(towardsLeft ? 'bottom-right' : 'bottom-center')
    overlay.setPosition(coordinate)
    setGrowLeft(towardsLeft)
  }, [map, poi])

  const container = containerRef.current
  if (!container) return null

  /* Portal: React yalnızca konteynerin ÇOCUKLARINI yönetir. Konteynerin
     kendisi bu ağacın parçası değildir, dolayısıyla OpenLayers onu
     taşıdığında React'in hiçbir varsayımı bozulmaz. */
  return createPortal(
    <div
      className={`analysis-poi-popup ${poi ? 'is-open' : ''}`}
      data-grow={growLeft ? 'left' : 'center'}
    >
      {poi && (
        <div className="app-card" role="dialog" aria-label="Analiz POI bilgisi">
          <header>
            {/* Ad NULL OLABİLİR ve bu veri kaybı değildir: açık veri
                kümelerinde adsız ama geçerli kayıtlar sıradandır. "null",
                "undefined" ya da "-" göstermek yerine ne olduğu söylenir —
                kategori satırı zaten hemen altındadır. */}
            <strong>{poi.name?.trim() || 'İsimsiz POI'}</strong>
            <IconButton label="POI bilgisini kapat" onClick={onClose}>
              <CloseIcon size={16} />
            </IconButton>
          </header>

          <dl>
            <div>
              <dt>Kategori</dt>
              {/* Tam yol: panelin ölçüt seçicisi ve özet satırları da tam yol
                  gösterir. Aynı kategoriyi iki farklı biçimde adlandırmak,
                  kullanıcıya başka bir şeye baktığını düşündürürdü. */}
              <dd>{poi.categoryPath || poi.categoryName || poi.categorySlug}</dd>
            </div>
            <div>
              <dt>Konum</dt>
              <dd>
                {poi.latitude.toFixed(COORDINATE_DIGITS)}, {poi.longitude.toFixed(COORDINATE_DIGITS)}
              </dd>
            </div>
            {poi.source && (
              <div>
                <dt>Kaynak</dt>
                <dd>{poi.source}</dd>
              </div>
            )}
          </dl>

          {error && <p className="app-error">{error}</p>}
        </div>
      )}
    </div>,
    container,
  )
}
