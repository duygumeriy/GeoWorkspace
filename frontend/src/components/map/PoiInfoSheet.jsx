import MapSheet from './MapSheet.jsx'
import { formatLonLat } from '../../map/poi.js'
import { weekSchedule } from '../../poi/workHours.js'
import './PoiSheets.css'

/**
 * Tıklanan POI'nin bilgi paneli.
 *
 * Oluşturma formuyla AYNI sheet ilkelini kullanır: masaüstünde sağda sabit bir
 * kart, telefonda alttan açılan bir sayfa — tek DOM, tek kapatma/odak mantığı.
 *
 * <b>Oluşturan bilgisi YOKTUR</b> ve olamaz: harita sözleşmesi
 * (<c>GET /api/poi</c>) kullanıcı adını, kimliğini ve denetim alanlarını hiç
 * taşımaz. Sıradan bir harita kullanıcısının bir noktayı görebilmesi, onu kimin
 * eklediğini öğrenebilmesi anlamına gelmez.
 *
 * Mesai saatleri yönetim ekranıyla AYNI yorumdan çizilir
 * (<c>poi/workHours.js</c>): "Kapalı" ile "Belirtilmemiş" ayrımı iki ekranda da
 * korunur ve ham JSON hiçbir yerde gösterilmez.
 */
export default function PoiInfoSheet({ open, poi, onClose }) {
  if (!open || !poi) return null

  return (
    <MapSheet open={open} title="POI Bilgisi" onClose={onClose} className="poi-sheet">
      <dl className="poi-info">
        <div>
          <dt>İsim</dt>
          <dd>{poi.name || '—'}</dd>
        </div>
        <div>
          <dt>Kategori</dt>
          {/* Yol varsa yol: "Yeme-İçme / Kafe", yalnızca "Kafe"den daha çok
              şey söyler. */}
          <dd>{poi.categoryPath || poi.categoryName || '—'}</dd>
        </div>
        <div>
          <dt>Konum</dt>
          <dd>{formatLonLat(poi.longitude, poi.latitude)}</dd>
        </div>
      </dl>

      <section className="poi-info-hours" aria-labelledby="poi-info-hours-title">
        <h3 id="poi-info-hours-title">Mesai Saatleri</h3>
        <dl>
          {weekSchedule(poi.workHours).map((day) => (
            <div key={day.key}>
              <dt>{day.label}</dt>
              <dd>{day.text}</dd>
            </div>
          ))}
        </dl>
      </section>
    </MapSheet>
  )
}
