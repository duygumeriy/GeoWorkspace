/**
 * Başarsoft KURUMSAL İŞARETİ — tek kaynak.
 *
 * <b>Logo YENİDEN ÇİZİLMEZ.</b> Aşağıdaki poligonlar
 * <code>src/assets/brand/basarsoft-symbol.svg</code> dosyasındaki
 * <code>points</code> değerlerinin BİREBİR kendisidir; bir test iki tarafı
 * karşılaştırır, böylece dosya değişip modül değişmediğinde (ya da tersi)
 * sessizce "yaklaşık bir logo" oluşamaz.
 *
 * <b>Neden JS modülü de var.</b> İşaret iki ayrı dünyada çizilir: React
 * (kenar çubuğu marka simgesi) ve OpenLayers (paylaşılan hat aracı).
 * OpenLayers bir React bileşeni çizemez ve derleyici olmayan birim testleri
 * <code>.svg</code> içe aktaramaz; bu yüzden geometri, her iki tarafın da
 * okuyabildiği düz veri olarak burada durur. CSS tarafı (üstbilgi marka
 * artı sözcük işareti) doğrudan <code>.svg</code> dosyalarını kullanır.
 *
 * <b>Ağ yoktur, CDN yoktur, yeni ikon paketi yoktur.</b>
 */

/** Asset dosyasının kanonik çizim kutusu. */
export const BASARSOFT_MARK_VIEW_BOX = Object.freeze({ width: 167, height: 166 })

/** Asset dosyasındaki poligonlar — sıra ve değerler dosyayla aynıdır. */
export const BASARSOFT_MARK_POLYGONS = Object.freeze([
  Object.freeze({ points: '0,56 51,5 167,0 106,61', fill: '#4091D3' }),
  Object.freeze({ points: '106,61 167,0 162,116 111,166', fill: '#1B2B51' }),
])

/**
 * İşaretin <code>&lt;polygon&gt;</code> işaretlemesi.
 *
 * Kılıf (viewBox, ölçü, süsleme) çağırana aittir: aynı geometri hem düz bir
 * marka simgesi hem de haritadaki araç olarak kullanılır.
 */
export function basarsoftMarkPolygonMarkup() {
  return BASARSOFT_MARK_POLYGONS
    .map(({ points, fill }) => `<polygon points="${points}" fill="${fill}"/>`)
    .join('')
}
