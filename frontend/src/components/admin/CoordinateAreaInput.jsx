import { useEffect, useState } from 'react'
import { coordinateTextToWkt, MIN_VERTICES } from './coordinateArea.js'

/**
 * Elle koordinat girerek alan tanımlama.
 *
 * <b>Birim EPSG:4326'dır: önce BOYLAM, sonra ENLEM.</b> Sıra her satırda
 * yazılıdır, çünkü (enlem, boylam) sırası da yaygındır ve karıştırıldığında
 * poligon sessizce Türkiye'nin dışına düşer — hata mesajı vermeden.
 *
 * <b>Halka otomatik kapanır.</b> Kullanıcıdan ilk köşeyi sonda tekrar etmesini
 * beklemek, WKT'nin bir uygulama detayını arayüze sızdırmak olurdu.
 *
 * Girdi geçerli oldukça önizleme haritaya yansır; geçersizken kaydetme
 * kapalıdır ve sebebi yazılıdır.
 */
export default function CoordinateAreaInput({ onChange, disabled = false, initialText = '' }) {
  const [text, setText] = useState(initialText)
  const [error, setError] = useState('')

  useEffect(() => {
    const { wkt, error: parseError } = coordinateTextToWkt(text)
    setError(parseError ?? '')
    // Geçersizken üst bileşene null gider: yarım bir geometri önizlemede
    // görünüp kaydedilebilir sanılmamalıdır.
    onChange(parseError ? null : wkt)
    // `onChange` üst bileşende her render'da yeniden üretilebilir; bağımlılığa
    // eklemek bu etkiyi sonsuz döngüye çevirirdi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  return (
    <div className="geo-coordinate-input">
      <label className="geo-field">
        <span>Köşe koordinatları</span>
        <textarea
          rows={8}
          value={text}
          disabled={disabled}
          spellCheck={false}
          placeholder={'32.85, 39.92\n33.20, 39.50\n32.40, 38.90'}
          aria-describedby="geo-coordinate-help"
          onChange={(event) => setText(event.target.value)}
        />
      </label>

      <p id="geo-coordinate-help" className="geo-coordinate-help">
        Her satıra bir köşe: <strong>boylam, enlem</strong> (EPSG:4326).
        En az {MIN_VERTICES} köşe gerekir; alan otomatik kapatılır.
        Boylam −180…180, enlem −90…90 aralığında olmalıdır.
      </p>

      {error && (
        <p className="geo-editor-error" role="alert">{error}</p>
      )}
    </div>
  )
}
