import { useMemo, useState } from 'react'
import MapSheet from './MapSheet.jsx'
import CategoryCombobox from './CategoryCombobox.jsx'
import { PROVINCES } from '../../map/turkeyGeography.js'
import { categoryLabel, isSelectableCategory } from '../../map/poiCategorySearch.js'
import {
  LOCATION_ANALYSIS_STOPS,
  MAX_CRITERIA,
  MIN_CRITERIA,
  REQUIRED_WEIGHT_TOTAL,
  selectableCategories,
  weightTotal,
} from '../../map/locationAnalysis.js'
import './LocationAnalysisPanel.css'

/**
 * Sonuç satırının etiketi: seçicide görünen etiketin AYNISI.
 *
 * Sunucu ölçütün slug'ını ve adını döndürür; ad YALINDIR ("Eczane"), oysa
 * seçici tam yolu gösterir ("Sağlık Kurumları / Eczane"). Aynı kategoriyi iki
 * ayrı biçimde adlandırmak, seçilen ölçütün değiştiği izlenimini veriyordu.
 * Yol bulunamazsa sunucunun adına düşülür — etiket her hâlde bir şey der.
 */
function criterionLabel(item, categories) {
  const match = (categories ?? []).find((category) => category.slug === item.categorySlug)
  return categoryLabel(match) || item.categoryName || item.categorySlug
}

/**
 * "Konum Analizi" paneli: hedef alan + ağırlıklı kategori ölçütleri.
 *
 * <b>Kurallar burada YAZILI DEĞİLDİR.</b> Seçilebilir kategoriler, geçerlilik
 * ve toplam hesabı `map/locationAnalysis.js` içindedir ve orada birim testlerle
 * sabitlenir; bu bileşen yalnızca sonucu gösterir. Aynı ayrım POI kategori
 * seçicisinde de var (`poiCategorySearch.js`).
 *
 * <b>Taslak ile GÖNDERİLMİŞ analiz ayrıdır.</b> Formdaki bir ağırlığı
 * değiştirmek haritayı yeniden boyamaz; harita yalnızca "ANALİZİ BAŞLAT"
 * anındaki anlık görüntüyü çizer. Aksi hâlde kullanıcı, henüz istemediği bir
 * ağırlık bileşiminin sonucuna bakıyor olurdu.
 */
export default function LocationAnalysisPanel({
  open,
  onClose,
  /* Alan */
  areaMode,
  onAreaModeChange,
  provinceCode,
  onProvinceChange,
  areaLabel,
  isDrawing,
  /* Coğrafi yetki: liste zaten süzülmüş gelir, panel yalnızca ANLATIR. */
  provinces: allowedProvinces,
  regions,
  regionKey,
  onRegionChange,
  scopeRestricted,
  /* Ölçütler */
  categories,
  categoriesLoading,
  categoriesError,
  onRetryCategories,
  criteria,
  onCriterionChange,
  onAddCriterion,
  onRemoveCriterion,
  /* Eylem */
  validation,
  onAnalyze,
  onClear,
  /* Sonuç */
  status,
  summary,
  error,
  imageLoading,
  imageError,
  onRetryImage,
  opacity,
  onOpacityChange,
  hasActiveAnalysis,
  heatmapCriterion,
  onHeatmapCriterionChange,
  /* Analiz POI örtüsü */
  poiOverlayVisible,
  onPoiOverlayVisibleChange,
  poiOverlayLoading,
  poiOverlayError,
  poiOverlayCount,
  poiOverlayTruncated,
}) {
  const [provinceSearch, setProvinceSearch] = useState('')

  const usableCategories = useMemo(
    () => (categories ?? []).filter(isSelectableCategory),
    [categories],
  )

  /* Liste MapPage'den süzülmüş gelir: kullanıcının yetkisi dışındaki bir il
     hiç görünmez. Sunucu kararı yine kendi verir; buradaki iş, seçilemeyecek
     bir ili gösterip sonra 403'le karşılamamaktır. */
  const source = allowedProvinces ?? PROVINCES

  const provinces = useMemo(() => {
    const needle = provinceSearch.trim().toLocaleLowerCase('tr')
    if (!needle) return source
    return source.filter((province) => province.name.toLocaleLowerCase('tr').includes(needle))
  }, [provinceSearch, source])

  const total = weightTotal(criteria)
  const totalState = total === REQUIRED_WEIGHT_TOTAL ? 'valid' : total > REQUIRED_WEIGHT_TOTAL ? 'over' : 'under'

  return (
    <MapSheet
      open={open}
      title="Konum Analizi"
      labelledById="location-analysis-title"
      onClose={onClose}
      className="location-analysis-panel"
    >
      <p className="la-intro">
        Bir hedef alan seçin, 2–5 kategori kriteri ekleyin ve ağırlıklarını 100 üzerinden dağıtın.
      </p>

      {/* --- A. HEDEF ALAN ------------------------------------------------- */}
      <section className="la-section" aria-labelledby="la-area-heading">
        <h3 id="la-area-heading">1. Hedef Alan</h3>

        <div className="la-mode-switch" role="group" aria-label="Alan seçim yöntemi">
          <button
            type="button"
            className={`la-mode ${areaMode === 'province' ? 'is-active' : ''}`}
            aria-pressed={areaMode === 'province'}
            onClick={() => onAreaModeChange('province')}
          >
            İl Seç
          </button>
          <button
            type="button"
            className={`la-mode ${areaMode === 'draw' ? 'is-active' : ''}`}
            aria-pressed={areaMode === 'draw'}
            onClick={() => onAreaModeChange('draw')}
          >
            Haritada Çiz
          </button>
        </div>

        {areaMode === 'province' && (
          <div className="la-province">
            {/* Denetim etiketin İÇİNDE DEĞİL, KARDEŞİDİR. Bir <select> etiketin
                içine konduğunda erişilebilir ad, seçeneklerin metnini de yutar
                ("İl Seçiniz… Adana …") ve hem ekran okuyucuda hem testte
                yanlış okunur. */}
            <div className="la-field">
              <label htmlFor="la-province-search">İl ara</label>
              <input
                id="la-province-search"
                type="search"
                value={provinceSearch}
                placeholder="Örn. Ankara"
                autoComplete="off"
                onChange={(event) => setProvinceSearch(event.target.value)}
              />
            </div>

            {/* <b>Bölge, ilin ÜSTÜdür.</b> Veri kümesindeki hiyerarşi
                Bölge(7) → İl(81) şeklindedir; ilin ALTINDA bir birim (ilçe)
                YOKTUR. Bölge seçmek il listesini daraltır ve tek başına da
                geçerli bir hedef alandır. */}
            <div className="la-field">
              <label htmlFor="la-region">Bölge</label>
              <select
                id="la-region"
                value={regionKey ?? ''}
                onChange={(event) => onRegionChange(event.target.value)}
              >
                <option value="">Tüm bölgeler</option>
                {(regions ?? []).map((region) => (
                  <option key={region.key} value={region.key}>
                    {region.name}
                  </option>
                ))}
              </select>
              {regionKey && (
                <p className="la-hint">
                  Bölge sınırı il sınırlarının birleşiminden üretilen bir yaklaşıklıktır.
                  Daha dar bir hedef için aşağıdan il seçebilirsiniz.
                </p>
              )}
            </div>

            <div className="la-field">
              <label htmlFor="la-province">İl</label>
              <select
                id="la-province"
                value={provinceCode}
                onChange={(event) => onProvinceChange(event.target.value)}
              >
                <option value="">Seçiniz…</option>
                {provinces.map((province) => (
                  <option key={province.code} value={province.code}>
                    {province.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {scopeRestricted && (
          <p className="la-hint" role="status">
            {source.length > 0
              ? `Coğrafi yetkiniz sınırlı: yalnızca ${source.length} il listeleniyor. Daha dar bir alan için haritada çizebilirsiniz.`
              : 'Coğrafi yetkiniz tek bir ilin tamamını kapsamıyor. Hedef alanı haritada, yetki alanınızın içinde çizin.'}
          </p>
        )}

        {areaMode === 'draw' && (
          <p className="la-hint" aria-live="polite">
            {isDrawing
              ? 'Haritada alanı çizin · Çift tıklayarak bitirin · ESC ile iptal edin.'
              : 'Çizim aracı kapalı. "Haritada Çiz" düğmesine yeniden basarak açabilirsiniz.'}
          </p>
        )}

        <p className="la-area-state" aria-live="polite">
          {areaLabel ? (
            <>
              Seçili alan: <strong>{areaLabel}</strong>
            </>
          ) : (
            'Henüz bir alan seçilmedi.'
          )}
        </p>
      </section>

      {/* --- B. KRİTERLER --------------------------------------------------- */}
      <section className="la-section" aria-labelledby="la-criteria-heading">
        <h3 id="la-criteria-heading">2. Kriterler</h3>

        {categoriesLoading && <p className="la-hint">Kategoriler yükleniyor…</p>}

        {categoriesError && (
          <div className="la-error" role="alert">
            <span>{categoriesError}</span>
            <button type="button" onClick={onRetryCategories}>
              Yeniden dene
            </button>
          </div>
        )}

        <ul className="la-criteria">
          {criteria.map((criterion, index) => {
            /* Seçilebilirlik ÖNCE, arama SONRA. Sıra önemlidir: arama yalnızca
               bir görünüm filtresidir ve zaten seçilmiş/çakışan bir kategoriyi
               yazarak geri getirememelidir. Çakışma kuralı (aynı kategori iki
               kez, ata + torun birlikte) `selectableCategories` içindedir ve
               sunucu da aynı isteği reddeder. */
            const options = selectableCategories(usableCategories, criteria, index)

            const comboboxId = `la-category-${index}`
            const weightId = `la-weight-${index}`

            return (
              <li key={index} className="la-criterion">
                <div className="la-field la-field-grow">
                  {/* Arama ve seçim TEK denetimdir. Ayrı bir arama kutusu +
                      daralan bir `<select>` düzeni, her ölçüt satırında aynı
                      soruyu iki kez soruyordu; beş ölçütte on denetim ediyordu. */}
                  <CategoryCombobox
                    id={comboboxId}
                    label={`Kategori ${index + 1}`}
                    value={criterion.categoryId ?? null}
                    options={options}
                    disabled={categoriesLoading || Boolean(categoriesError)}
                    placeholder={categoriesLoading ? 'Kategoriler yükleniyor…' : 'Kategori ara veya seçin…'}
                    onChange={(categoryId) => onCriterionChange(index, { categoryId })}
                  />
                </div>

                <div className="la-field la-field-weight">
                  {/* Etiket satır numarasını TAŞIR: aynı metni beş kez
                      tekrarlamak, ekran okuyucu kullanan birine hangi kritere
                      ait olduğunu söylemezdi. Kategori seçici de aynı biçimde
                      numaralanır. */}
                  <label htmlFor={weightId}>Ağırlık {index + 1}</label>
                  <input
                    id={weightId}
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max={REQUIRED_WEIGHT_TOTAL}
                    step="1"
                    value={criterion.weight === 0 ? '' : criterion.weight}
                    onChange={(event) => {
                      const raw = event.target.value
                      onCriterionChange(index, { weight: raw === '' ? 0 : Number(raw) })
                    }}
                  />
                </div>

                <button
                  type="button"
                  className="la-remove"
                  aria-label={`${index + 1}. kriteri kaldır`}
                  disabled={criteria.length <= MIN_CRITERIA}
                  onClick={() => onRemoveCriterion(index)}
                >
                  ×
                </button>
              </li>
            )
          })}
        </ul>

        <button
          type="button"
          className="la-add"
          disabled={criteria.length >= MAX_CRITERIA}
          onClick={onAddCriterion}
        >
          + Kriter ekle
        </button>

        {criteria.length >= MAX_CRITERIA && (
          <p className="la-hint">En fazla {MAX_CRITERIA} kriter eklenebilir.</p>
        )}
      </section>

      {/* --- C. TOPLAM ------------------------------------------------------ */}
      <section className={`la-total la-total--${totalState}`} aria-live="polite">
        <strong>Toplam Ağırlık</strong>
        <output>
          {total} / {REQUIRED_WEIGHT_TOTAL}
        </output>
        {/* Durum yalnızca RENKLE anlatılmaz: metin her zaman okunur. */}
        <span className="la-total-note">
          {totalState === 'valid'
            ? 'Toplam geçerli.'
            : totalState === 'over'
              ? `Toplam ${REQUIRED_WEIGHT_TOTAL} değerini aşıyor.`
              : `${REQUIRED_WEIGHT_TOTAL - total} puan daha dağıtmalısınız.`}
        </span>
      </section>

      {/* --- D. EYLEM ------------------------------------------------------- */}
      <div className="la-actions">
        <button
          type="button"
          className="la-analyze"
          disabled={!validation.valid || status === 'loading'}
          onClick={onAnalyze}
        >
          {status === 'loading' ? 'Analiz ediliyor…' : 'ANALİZİ BAŞLAT'}
        </button>
        <button type="button" className="la-clear" onClick={onClear}>
          Temizle
        </button>
      </div>

      {!validation.valid && (
        <p className="la-reason" aria-live="polite">
          {validation.reason}
        </p>
      )}

      {/* --- E. SONUÇ / DURUM ----------------------------------------------- */}
      <section className="la-status" aria-live="polite">
        {status === 'error' && error && (
          <div className="la-error" role="alert">
            <span>{error}</span>
          </div>
        )}

        {status === 'empty' && (
          <p className="la-empty">Seçilen alan ve kriterlere uygun POI bulunamadı.</p>
        )}

        {status === 'done' && summary && (
          <div className="la-summary">
            <p>
              Eşleşen POI: <strong>{summary.totalMatchingPoiCount}</strong>
            </p>
            <ul>
              {summary.criteria.map((item) => (
                <li key={item.categorySlug}>
                  {/* Etiket SEÇİCİDEKİYLE aynı biçimdir: ikisi de tam yoldur.
                      Sunucu ölçütün kimliğini zaten doğru döndürüyor
                      (`categorySlug` seçilen ölçüttür), ama sonuç satırı
                      kategorinin YALIN adını yazıyordu. "Sağlık Kurumları /
                      Eczane" seçip sonuçta yalnızca "Eczane" görmek,
                      kullanıcının seçmediği bir şeyi seçmiş gibi okunuyordu. */}
                  <span>{criterionLabel(item, usableCategories)}</span>
                  <span>ağırlık {item.weight}</span>
                  <span>{item.matchingPoiCount} POI</span>
                </li>
              ))}
            </ul>
            {summary.criteria.some((item) => item.coveredCategoryCount > 1) && (
              /* Üst kategori seçildiğinde sayaç alt ağacın TAMAMIdır; bunu
                 söylememek, eksik bir sayım izlenimi verirdi. */
              <p className="la-summary-note">Sayılar kapsanan alt kategorileri de içerir.</p>
            )}
          </div>
        )}

        {hasActiveAnalysis && imageLoading && <p className="la-hint">Görünüm güncelleniyor…</p>}

        {hasActiveAnalysis && imageError && (
          <div className="la-error" role="alert">
            <span>{imageError}</span>
            <button type="button" onClick={onRetryImage}>
              Yeniden dene
            </button>
          </div>
        )}
      </section>

      {/* --- Saydamlık + efsane --------------------------------------------- */}
      {hasActiveAnalysis && (
        <>
          {/* Örtü ancak GÖNDERİLMİŞ bir analiz varken anlamlıdır: gösterecek
              bir ölçüt kümesi ve alan olmadan "analiz POI'leri" diye bir küme
              yoktur. */}
          <label className="la-poi-toggle">
            <input
              type="checkbox"
              checked={Boolean(poiOverlayVisible)}
              onChange={(event) => onPoiOverlayVisibleChange(event.target.checked)}
            />
            <span>
              <strong>Analiz POI'lerini Göster</strong>
              <small>Analize giren POI'ler kategori simgeleriyle çizilir; birine tıklayarak inceleyebilirsiniz.</small>
            </span>
          </label>

          {poiOverlayVisible && poiOverlayLoading && (
            <p className="la-hint">Analiz POI'leri yükleniyor…</p>
          )}

          {poiOverlayVisible && !poiOverlayLoading && poiOverlayCount > 0 && (
            <p className="la-hint" aria-live="polite">
              Haritada <strong>{poiOverlayCount}</strong> POI gösteriliyor.
            </p>
          )}

          {/* Kesme SESSİZ OLMAZ: eksik bir sonucu tam sanmak, analizin
              cevabını yanlış okumaktır. */}
          {poiOverlayVisible && poiOverlayTruncated && (
            <p className="la-hint" aria-live="polite">
              Sonuç çok büyük olduğu için yalnızca ilk {poiOverlayCount} POI çizildi.
              Daha dar bir alan seçerek tamamını görebilirsiniz.
            </p>
          )}

          {poiOverlayVisible && poiOverlayError && (
            <div className="la-error" role="alert">
              <span>{poiOverlayError}</span>
            </div>
          )}

          {/* --- Görünüm: birleşik mi, tek ölçüt mü --------------------------

              <b>Neden gerekli.</b> Ağırlıklı birleşik yüzey TEK bir skaler
              alandır; bir bölgenin neden sıcak olduğunu — hangi kategoriden
              ötürü — söyleyemez, çünkü toplama sırasında kategori kimliği
              yapısal olarak kaybolur. Tek ölçütlü görünüm o soruyu doğrudan
              yanıtlar: kullanıcı kategorileri ayrı ayrı görüp
              karşılaştırabilir. Gönderilmiş analiz DEĞİŞMEZ. */}
          <div className="la-field">
            <label htmlFor="la-heatmap-view">Isı haritası görünümü</label>
            <select
              id="la-heatmap-view"
              value={heatmapCriterion ?? ''}
              onChange={(event) => onHeatmapCriterionChange(event.target.value)}
            >
              <option value="">Birleşik (ağırlıklı)</option>
              {(summary?.criteria ?? []).map((item) => (
                <option key={item.categorySlug} value={item.categorySlug}>
                  Yalnızca {criterionLabel(item, usableCategories)}
                </option>
              ))}
            </select>
            {heatmapCriterion && (
              <p className="la-hint">
                Bu görünümde ağırlık etkisizdir; yalnızca seçilen kategorinin
                POI yoğunluğu çizilir.
              </p>
            )}
          </div>

          <label className="la-opacity">
            <span>
              <strong>Saydamlık</strong>
              <output>{Math.round(opacity * 100)}%</output>
            </span>
            <input
              type="range"
              min="20"
              max="100"
              step="5"
              value={Math.round(opacity * 100)}
              aria-label="Isı haritası saydamlığı"
              onChange={(event) => onOpacityChange(Number(event.target.value) / 100)}
            />
          </label>

          <section className="la-legend" aria-label="Konum analizi yoğunluk açıklaması">
            <strong>Göreli yoğunluk (0–1)</strong>
            <span className="la-legend-context">
              {heatmapCriterion
                ? 'Seçilen kategorinin, analiz alanındaki en yoğun bandına göre'
                : 'Ağırlıklı yoğunluk: her kriter önce analiz alanındaki kendi en yoğun bandına göre 0–1’e çekilir, ağırlıklar sonra uygulanır'}
            </span>
            <div className="la-legend-gradient" aria-hidden="true" />
            <div className="la-legend-labels">
              {LOCATION_ANALYSIS_STOPS.map((stop) => (
                <span key={stop.value}>{stop.label}</span>
              ))}
            </div>
            {/* İki ayrı görsel dil, iki ayrı soru. Rampanın rengi hiçbir
                zaman bir KATEGORİYİ temsil etmez; kategori kimliğini yalnızca
                işaretler taşır. Bunu söylememek, kullanıcının kırmızıyı
                "alışveriş", maviyi "demiryolu" sanmasına açık kapı bırakırdı. */}
            <span className="la-legend-caption">
              Renkler <strong>yoğunluğu</strong> gösterir, kategoriyi değil; kategoriyi harita
              üzerindeki <strong>işaretler</strong> anlatır. Ölçek görelidir: iki farklı analizin
              kırmızısı karşılaştırılamaz ve kırmızı bir yer önerisi değildir.
            </span>
          </section>
        </>
      )}
    </MapSheet>
  )
}
