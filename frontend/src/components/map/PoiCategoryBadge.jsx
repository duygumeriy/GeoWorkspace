import { accentColor, iconForKey } from './poiIconRegistry.js'

/**
 * Bir kategorinin görsel kimliği: kendi renginde, kendi Lucide simgesi.
 *
 * <b>TEK bir görsel dil.</b> Harita rozeti, arama sonuçları, yönetim panelindeki
 * kategori ağacı ve "POI'lerim" listesi aynı kategoriyi aynı simgeyle
 * göstermelidir. Her ekran kendi göstergesini uydurduğunda — biri renkli kare,
 * biri genel bir raptiye, biri gerçek simge — kullanıcı aynı kaydı üç farklı
 * şey sanır.
 *
 * <b>İkinci bir simge tablosu YOKTUR.</b> Anahtar çözümü tek kaynaktan yapılır
 * (<c>poiIconRegistry</c>); bu bileşen o eşlemenin görsel sarmalayıcısından
 * ibarettir. Kategori adı, slug'ı ve rengi buraya kopyalanmaz — hepsi
 * çağırandan, yani sunucudan gelir.
 *
 * <b>Hiçbir koşulda çizilmeden dönmez.</b> Tanınmayan anahtar <c>MapPin</c>'e,
 * bozuk renk nötr griye düşer; göç öncesinden kalan metadatasız bir kategori de
 * listede görünmelidir.
 *
 * Biçimlendirme <c>className</c> ile ÇAĞIRANA bırakılır: aynı bileşen 30
 * piksellik arama satırında da, 28 piksellik yönetim satırında da kullanılır ve
 * boyutu kendi bağlamının CSS'i söyler.
 *
 * @param {{ iconKey?: string|null, colorHex?: string|null, size?: number,
 *           className?: string }} props
 */
export default function PoiCategoryBadge({
  iconKey,
  colorHex,
  size = 16,
  className = 'poi-category-badge',
}) {
  const Icon = iconForKey(iconKey)
  const color = accentColor(colorHex)

  return (
    <span className={className} style={{ '--poi-accent': color }} aria-hidden="true">
      <Icon size={size} strokeWidth={2} />
    </span>
  )
}
