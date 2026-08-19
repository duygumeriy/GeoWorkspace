import { transformExtent } from 'ol/proj'
import { DATA_PROJECTION, MAP_PROJECTION } from './drawing.js'

/**
 * Türkiye'ye odaklı açılış görünümü — TEK tanım.
 *
 * Hem ana harita hem de yönetim panelindeki coğrafi yetki düzenleyicisi
 * buradan okur. İkisine ayrı sayılar yazmak, "Türkiye'ye zoomlanmış harita"
 * gerekliliğinin iki ekranda iki farklı yere bakması demekti.
 *
 * <b>Burada bir SINIR poligonu yoktur.</b> Gereklilik haritanın Türkiye'ye
 * odaklı açılmasıdır; resmî bir ülke sınırı veri kümesi indirip saklamak, bu
 * iş için gereksiz bir coğrafi veri bağımlılığı olurdu. Kutu yalnızca kamerayı
 * konumlandırır — hiçbir yetki kararında kullanılmaz ve çizilen alanları
 * kırpmaz.
 */

/** Türkiye'nin yaklaşık coğrafi merkezi (Longitude, Latitude). */
export const TURKEY_CENTER_LON_LAT = [35.2433, 38.9637]

/** Ülkenin tamamını rahatça gösteren açılış yakınlaştırması. */
export const TURKEY_ZOOM = 6

/**
 * Ülkeyi çevreleyen kaba kutu: [minLon, minLat, maxLon, maxLat].
 *
 * Batıda Ege adaları, doğuda Ağrı, kuzeyde Karadeniz kıyısı ve güneyde Hatay
 * dâhil olacak kadar geniş tutulur; kamera bunu kenar boşluğuyla sığdırır.
 */
export const TURKEY_EXTENT_LON_LAT = Object.freeze([25.5, 35.6, 45.0, 42.4])

/** Aynı kutu, haritanın çalıştığı projeksiyonda (EPSG:3857). */
export function turkeyExtent() {
  return transformExtent([...TURKEY_EXTENT_LON_LAT], DATA_PROJECTION, MAP_PROJECTION)
}
