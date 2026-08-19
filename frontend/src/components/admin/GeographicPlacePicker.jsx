import { useMemo, useState } from 'react'
import {
  PROVINCES,
  REGIONS,
  REGION_APPROXIMATION_NOTE,
  provinceAreas,
  regionAreas,
} from '../../map/turkeyGeography.js'

/**
 * Hazır coğrafi kapsam seçimi: il ya da coğrafi bölge.
 *
 * <b>Sınırlar UYDURULMAMIŞTIR.</b> Veri kümesi kamu malı Natural Earth idari
 * sınırlarıdır ve uygulamayla birlikte paketlenir; çalışma zamanında hiçbir
 * üçüncü taraf servise istek yapılmaz. Kaynak, lisans, indirilme tarihi ve
 * uygulanan sadeleştirme `docs/geographic-data-sources.md` dosyasındadır.
 *
 * <b>Bölgeler YAKLAŞIKTIR ve bu gizlenmez.</b> Resmî coğrafi bölge sınırları il
 * sınırlarını birebir takip etmez; buradaki bölgeler illerin birleşimidir ve
 * ekranda böyle etiketlenir. Yaklaşık bir sınırı resmî gibi sunmak,
 * yöneticinin yanlış sandığı bir kapsamla yetki vermesi olurdu.
 *
 * <b>Parçalar ATILMAZ.</b> Adaları olan bir il ya da boğazla ayrılan bir bölge
 * birden çok alan üretir; saklama modeli satır başına tek poligon olduğu için
 * her parça kendi alanı olur. Yalnızca en büyük parçayı almak, o ilin
 * adalarını sessizce kapsam dışında bırakmak olurdu.
 *
 * @param {object} props
 * @param {(areas: {name:string,wkt:string,sourceType:string,sourceKey:string}[]) => void} props.onPick
 * @param {boolean} props.disabled
 */
export default function GeographicPlacePicker({ onPick, disabled = false }) {
  const [kind, setKind] = useState('province')
  const [search, setSearch] = useState('')
  const [provinceCode, setProvinceCode] = useState('')
  const [regionKey, setRegionKey] = useState('')

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('tr')
    if (!needle) return PROVINCES
    return PROVINCES.filter((province) => province.name.toLocaleLowerCase('tr').includes(needle))
  }, [search])

  const selectProvince = (code) => {
    setProvinceCode(code)
    setRegionKey('')
    // Seçim ANINDA önizlemeye döner: kaydetmeden önce sınırı haritada görmek,
    // yanlış ili seçtiğini fark etmenin tek yoludur.
    onPick(code ? provinceAreas(code) : [])
  }

  const selectRegion = (key) => {
    setRegionKey(key)
    setProvinceCode('')
    onPick(key ? regionAreas(key) : [])
  }

  const switchKind = (next) => {
    setKind(next)
    setProvinceCode('')
    setRegionKey('')
    // Sekme değişince önizleme de temizlenir; bir sekmede seçilip diğerinde
    // görünmeye devam eden bir kapsam, neyin kaydedileceğini belirsizleştirirdi.
    onPick([])
  }

  const previewCount = provinceCode
    ? provinceAreas(provinceCode).length
    : regionKey
      ? regionAreas(regionKey).length
      : 0

  return (
    <div className="geo-place-picker">
      <div className="geo-place-kinds" role="group" aria-label="Hazır kapsam türü">
        <button
          type="button"
          className={`admin-button secondary ${kind === 'province' ? 'is-active' : ''}`}
          aria-pressed={kind === 'province'}
          disabled={disabled}
          onClick={() => switchKind('province')}
        >
          İl
        </button>
        <button
          type="button"
          className={`admin-button secondary ${kind === 'region' ? 'is-active' : ''}`}
          aria-pressed={kind === 'region'}
          disabled={disabled}
          onClick={() => switchKind('region')}
        >
          Coğrafi Bölge
        </button>
      </div>

      {kind === 'province' ? (
        <>
          <label className="geo-field">
            <span>İl ara</span>
            <input
              type="search"
              value={search}
              disabled={disabled}
              placeholder="Ankara, Kayseri…"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>

          <label className="geo-field">
            <span>İl seç</span>
            <select
              value={provinceCode}
              disabled={disabled}
              onChange={(event) => selectProvince(event.target.value)}
            >
              <option value="">İl seçin…</option>
              {filtered.map((province) => (
                <option key={province.code} value={province.code}>
                  {province.name}
                </option>
              ))}
            </select>
          </label>

          {filtered.length === 0 && (
            <p className="geo-place-empty" role="status">Aramanıza uyan il bulunamadı.</p>
          )}
        </>
      ) : (
        <>
          <label className="geo-field">
            <span>Bölge seç</span>
            <select
              value={regionKey}
              disabled={disabled}
              onChange={(event) => selectRegion(event.target.value)}
            >
              <option value="">Bölge seçin…</option>
              {REGIONS.map((region) => (
                <option key={region.key} value={region.key}>
                  {region.name}
                </option>
              ))}
            </select>
          </label>

          {/* Yaklaşıklık, seçim yapılmadan ÖNCE söylenir. */}
          <p className="geo-place-approximation" role="note">{REGION_APPROXIMATION_NOTE}</p>
        </>
      )}

      {previewCount > 1 && (
        <p className="geo-place-parts" role="status">
          Bu seçim {previewCount} ayrı parçadan oluşuyor (adalar veya kopuk bölümler).
          Kaydedildiğinde {previewCount} ayrı alan olarak eklenir; hiçbir parça atılmaz.
        </p>
      )}
    </div>
  )
}
