import { Crosshair } from 'lucide-react'
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
 * <b>Eylemler SUNUCUNUN kararını yansıtır.</b> "Düzenle" ve "Sil", kaydın
 * kendi `canUpdate` / `canDelete` bayraklarına bakar; bu bayrakları sunucu
 * hesaplar (poi.manage VEYA sahiplik VE poi.update/poi.delete) ve yanıtta
 * taşır. Böylece arayüz, kaydın SAHİBİNİ öğrenmeden doğru düğmeleri gösterir —
 * harita sözleşmesi kimin ne eklediğini hâlâ taşımaz. Bayraklar bir güvenlik
 * sınırı DEĞİLDİR: her mutasyon ucu aynı kararı bağımsız olarak yeniden verir.
 *
 * <b>"Zoom Yap" bir YETKİYE bağlı değildir.</b> Düzenle/Sil kaydın yetenek
 * bayraklarına bakar çünkü ikisi de kaydı DEĞİŞTİRİR; kamerayı taşımak ise
 * hiçbir şeyi değiştirmez ve hiçbir veriyi açığa çıkarmaz — paneli görebilen
 * zaten kaydın konumunu görüyordur. Bu yüzden yıkıcı olmayan, ikincil bir
 * eylem olarak sunulur ve "Sil"in kırmızısını PAYLAŞMAZ.
 *
 * Mesai saatleri yönetim ekranıyla AYNI yorumdan çizilir
 * (<c>poi/workHours.js</c>): "Kapalı" ile "Belirtilmemiş" ayrımı iki ekranda da
 * korunur ve ham JSON hiçbir yerde gösterilmez.
 */
export default function PoiInfoSheet({ open, poi, onClose, onEdit, onDelete, onZoom, busy = false }) {
  if (!open || !poi) return null

  /* Yetenek bayrağı YOKSA düğme de yoktur: eski bir yanıt (alan taşımayan)
     hiçbir eylem sunmaz — fail-closed. */
  const canEdit = poi.canUpdate === true && typeof onEdit === 'function'
  const canDelete = poi.canDelete === true && typeof onDelete === 'function'

  /* Gezinme, kaydın konumu OKUNABİLİYORSA sunulur: koordinatı olmayan bir
     kayda "git" demek, kamerayı tanımsız bir yere göndermek olurdu. */
  const canZoom =
    typeof onZoom === 'function'
    && Number.isFinite(poi.longitude)
    && Number.isFinite(poi.latitude)

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

      {/* Eylem şeridi, sunulacak en az bir eylem varsa çizilir; hiçbiri yoksa
          boş bir düğme şeridi bırakılmaz. Sıra niyete göredir: önce yıkıcı
          olmayan gezinme, sonra düzenleme, en sonda silme. */}
      {(canZoom || canEdit || canDelete) && (
        <div className="poi-info-actions">
          {canZoom && (
            <button
              type="button"
              className="poi-button secondary poi-button-zoom"
              onClick={onZoom}
            >
              <Crosshair size={16} strokeWidth={2} aria-hidden="true" />
              Zoom Yap
            </button>
          )}
          {canEdit && (
            <button type="button" className="poi-button" onClick={onEdit} disabled={busy}>
              Düzenle
            </button>
          )}
          {canDelete && (
            <button type="button" className="poi-button danger" onClick={onDelete} disabled={busy}>
              {busy ? 'Siliniyor…' : 'Sil'}
            </button>
          )}
        </div>
      )}
    </MapSheet>
  )
}
