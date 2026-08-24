import { useEffect, useRef, useState } from 'react'
import {
  coordinatesEqual,
  formatCoordinateInput,
  parseCoordinateInput,
  validateCoordinatePair,
} from '../../poi/poiCoordinates.js'
/* Sınıflar bu bileşenindir; stil, kullanan her ekranla birlikte gelsin diye
   burada içe aktarılır (yönetim paneli POI formunu içe aktarmaz). */
import './PoiSheets.css'

/**
 * Düzenlenebilir konum bölümü: boylam/enlem kutuları ve "Haritada Taşı".
 *
 * <b>Taslak koordinatın sahibi bu bileşen DEĞİLDİR.</b> Sayısal değer yukarıda
 * (sayfada) yaşar, çünkü aynı değeri haritadaki sürükleme de yazar; iki kopya
 * tutmak, kutularla haritadaki işaretin bir noktada ayrışması demek olurdu.
 * Burada tutulan tek şey YAZILMAKTA OLAN METİNDİR: "32." ya da "-" gibi henüz
 * sayı olmayan bir ara girdi, kullanıcının parmağının altından çekilmemelidir.
 *
 * <b>Metin ile sayı arasındaki yön tek bir kuralla ayrılır.</b> Kullanıcı
 * geçerli bir sayı yazdığında değer yukarı gider; yukarıdaki değer BAŞKA bir
 * kaynaktan (harita sürüklemesi, "Değişiklikleri Geri Al") değiştiğinde metin
 * yenilenir. Kendi yolladığımız değerin yankısı metni EZMEZ — ezseydi "32.50"
 * yazmak imkânsız olurdu, çünkü değer 32.5'e sadeleşip kutuya geri yazılırdı.
 *
 * <b>Sürükleme yalnızca TASLAĞI taşır.</b> Kalıcı POI kaydı ve haritadaki
 * kalıcı işaret, başarılı bir güncellemeye kadar yerinde durur; aksi hâlde
 * reddedilen bir istekten sonra harita, veritabanında olmayan bir konumu
 * anlatırdı. Sürükleyebilmek taşıyabilmek de değildir: coğrafi yetkiyi sunucu
 * uygular.
 */
export default function PoiLocationFields({
  coordinate,
  onChange,
  moveActive = false,
  /** Harita ekranı: işareti YERİNDE sürüklenebilir yapar. */
  onToggleMove,
  /** Harita OLMAYAN ekran (yönetim): haritayı açar ve düzenlemeyi orada sürdürür. */
  onOpenOnMap,
  /** Taslak geçersizken haritaya devretmenin anlamı yoktur. */
  canOpenOnMap = true,
  disabled = false,
}) {
  const [longitudeText, setLongitudeText] = useState(() => formatCoordinateInput(coordinate?.longitude))
  const [latitudeText, setLatitudeText] = useState(() => formatCoordinateInput(coordinate?.latitude))

  /** Yukarı en son GÖNDERDİĞİMİZ değer; yankıyı dış değişiklikten ayırır. */
  const pushedRef = useRef(coordinate ?? null)

  useEffect(() => {
    if (coordinatesEqual(coordinate ?? null, pushedRef.current)) return

    // Dış kaynak: harita sürüklemesi ya da "Değişiklikleri Geri Al".
    pushedRef.current = coordinate ?? null
    setLongitudeText(formatCoordinateInput(coordinate?.longitude))
    setLatitudeText(formatCoordinateInput(coordinate?.latitude))
  }, [coordinate])

  const push = (next) => {
    pushedRef.current = next
    onChange?.(next)
  }

  const handleLongitude = (text) => {
    setLongitudeText(text)
    const longitude = parseCoordinateInput(text)
    /* Ayrıştırılamayan metin YUKARI GİTMEZ ve 0'a da düşürülmez: yarım yazılmış
       bir sayı yüzünden taslak işaretin Gine Körfezi'ne atlaması, kullanıcının
       hiç istemediği bir taşıma olurdu. Kutu kendi hatasını gösterir ve
       "Güncelle" kapalı kalır. */
    if (longitude === null) return
    push({ longitude, latitude: coordinate?.latitude })
  }

  const handleLatitude = (text) => {
    setLatitudeText(text)
    const latitude = parseCoordinateInput(text)
    if (latitude === null) return
    push({ longitude: coordinate?.longitude, latitude })
  }

  /* Hata, YAZILAN metinden türetilir: kutuda "abc" varken yukarıdaki son
     geçerli değeri doğrulamak, ekranda görünen şeyle çelişen bir "geçerli"
     durumu üretirdi. */
  const typed = {
    longitude: parseCoordinateInput(longitudeText),
    latitude: parseCoordinateInput(latitudeText),
  }
  const { errors } = validateCoordinatePair(typed)

  return (
    <fieldset className="poi-location" disabled={disabled}>
      <legend>Konum</legend>

      <div className="poi-location-fields">
        <label className="poi-field">
          <span>Boylam</span>
          <input
            type="text"
            inputMode="decimal"
            value={longitudeText}
            onChange={(event) => handleLongitude(event.target.value)}
            aria-invalid={errors.longitude ? 'true' : undefined}
          />
        </label>

        <label className="poi-field">
          <span>Enlem</span>
          <input
            type="text"
            inputMode="decimal"
            value={latitudeText}
            onChange={(event) => handleLatitude(event.target.value)}
            aria-invalid={errors.latitude ? 'true' : undefined}
          />
        </label>
      </div>

      {(errors.longitude || errors.latitude) && (
        <p className="poi-location-error" role="alert">
          {errors.longitude ?? errors.latitude}
        </p>
      )}

      {/* Aynı etiket, ekrana göre İKİ farklı eylem — ve ikisi de aynı taslağı
          düzenler. Harita üzerinde işaret yerinde sürüklenir; haritanın
          olmadığı bir ekranda (yönetim paneli) tek anlamlı karşılık haritayı
          AÇIP düzenlemeyi orada sürdürmektir. İkinci bir OpenLayers haritasını
          diyaloğun içine gömmek, aynı düzenleme mimarisinin ikinci bir kopyası
          olurdu. Hiçbiri sunulmuyorsa düğme de çizilmez: hiçbir şey yapmayan
          bir düğme, olmayan bir yetenek vaat eder. */}
      {(onToggleMove || onOpenOnMap) && (
        <div className="poi-location-actions">
          {onToggleMove ? (
            /* Basılı durum `aria-pressed` ile taşınır: düğme bir eylemi değil,
               açık/kapalı bir kipi anlatır. */
            <button
              type="button"
              className={`poi-button secondary compact ${moveActive ? 'is-active' : ''}`}
              aria-pressed={moveActive}
              onClick={() => onToggleMove(!moveActive)}
            >
              {moveActive ? 'Taşımayı Bitir' : 'Haritada Taşı'}
            </button>
          ) : (
            <button
              type="button"
              className="poi-button secondary compact"
              disabled={!canOpenOnMap}
              onClick={() => onOpenOnMap()}
            >
              Haritada Taşı
            </button>
          )}

          <small className="poi-location-hint">
            {onToggleMove
              ? (moveActive
                  ? 'Haritadaki kesikli işareti sürükleyerek yeni konumu seçin. Değişiklik kaydedilene kadar geçicidir.'
                  : 'Boylam, Enlem (EPSG:4326)')
              : 'Harita açılır ve bu kayıt düzenlenmeye devam eder; kaydedilmemiş değişiklikleriniz korunur.'}
          </small>
        </div>
      )}
    </fieldset>
  )
}
