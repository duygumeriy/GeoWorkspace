import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import Overlay from 'ol/Overlay.js'
import { fromLonLat } from 'ol/proj.js'
import IconButton from '../ui/IconButton.jsx'
import { CloseIcon } from '../ui/icons/index.js'
import { journeyStepDistanceLabel } from '../../map/journeyNavigation.js'
import './JourneyPlanner.css'

/**
 * Kişisel yolculuk işaretçisinin bilgi balonu.
 *
 * <b>Paylaşılan hat aracının balonuyla BİRLEŞTİRİLMEZ.</b> O ürün bir hattın
 * herkese açık çalıştırmasını anlatır (güzergah adı, hat rengi, çok
 * kullanıcılı gözlem); buradaki balon tek bir kullanıcının yolculuğuna aittir
 * ve seyahat profilini, sunucunun ilerlemesini ve adım adım talimatı gösterir.
 * İkisini tek bileşende toplamak, iki ayrı ürünün alanlarını birbirine
 * karıştırmak olurdu. Kurulum deseni ise bilinçle AYNIDIR: overlay yalnızca
 * açıkken yaratılır, içerik React portalıyla taşınır, ikinci bir popup sistemi
 * kurulmaz.
 *
 * <b>Açıkken kendiliğinden tazelenir:</b> konum, yüzde ve talimatlar doğrudan
 * canlı modelden gelir; yeni bir sunucu anlık görüntüsü geldiğinde balon da
 * kullanıcı hiçbir şey yapmadan güncellenir.
 *
 * <b>Kapatmak yalnızca kapatır:</b> durdurmaz, bırakmaz, takibi değiştirmez,
 * SignalR grubundan çıkmaz.
 */
export default function JourneyVehiclePopup({ map, journey, onClose }) {
  const containerRef = useRef(null)
  if (containerRef.current === null && typeof document !== 'undefined') {
    containerRef.current = document.createElement('div')
  }
  const overlayRef = useRef(null)
  const active = Boolean(journey)

  useEffect(() => {
    const container = containerRef.current
    if (!map || !container || !active) return undefined

    const overlay = new Overlay({
      element: container,
      positioning: 'bottom-center',
      offset: [0, -20],
      stopEvent: true,
      autoPan: { animation: { duration: 200 }, margin: 24 },
    })
    overlayRef.current = overlay
    map.addOverlay(overlay)

    return () => {
      overlay.setPosition(undefined)
      map.removeOverlay(overlay)
      if (overlayRef.current === overlay) overlayRef.current = null
    }
  }, [map, active])

  /* Balon HAREKET EDEN feature'ın konumuna bağlıdır: her yeni anlık görüntüde
     çapa da taşınır, ikinci bir konum kaynağı tutulmaz. */
  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay) return
    overlay.setPosition(
      journey && Number.isFinite(journey.longitude) && Number.isFinite(journey.latitude)
        ? fromLonLat([journey.longitude, journey.latitude])
        : undefined,
    )
  }, [map, journey])

  if (!containerRef.current) return null

  const currentDistance = journeyStepDistanceLabel(journey?.currentStep)
  const nextDistance = journeyStepDistanceLabel(journey?.nextStep)

  return createPortal(
    <div className={`journey-vehicle-popup ${journey ? 'is-open' : ''}`.trim()}>
      {journey && (
        <div className="journey-popup-card" role="dialog" aria-label="Yolculuk aracı bilgisi">
          <header>
            <strong>{journey.title}</strong>
            <IconButton label="Yolculuk bilgisini kapat" onClick={onClose}>
              <CloseIcon size={16} />
            </IconButton>
          </header>

          <dl>
            <div><dt>Durum</dt><dd>{journey.statusLabel}</dd></div>
            {/* Yüzde SUNUCUDAN gelir; tarayıcı ilerleme hesaplamaz. Nazik bir
                canlı bölge: her harita tick'inde bağırmaz. */}
            <div>
              <dt>Tamamlanma</dt>
              <dd aria-live="polite">{journey.progressLabel}</dd>
            </div>
          </dl>

          {journey.currentStep && (
            <section className="journey-popup-step is-current">
              <h3>Şu an</h3>
              <p>{journey.currentStep.instruction}</p>
              {journey.currentStep.name && <span>{journey.currentStep.name}</span>}
              {/* Adımın KENDİ uzunluğu; "kalan mesafe" DEĞİLDİR ve öyle
                  etiketlenmez — sunucu kalan mesafeyi adım başına bildirmez. */}
              {currentDistance && <em>Adım uzunluğu: {currentDistance}</em>}
            </section>
          )}

          {journey.nextStep && (
            <section className="journey-popup-step">
              <h3>Sıradaki</h3>
              <p>{journey.nextStep.instruction}</p>
              {journey.nextStep.name && <span>{journey.nextStep.name}</span>}
              {nextDistance && <em>Adım uzunluğu: {nextDistance}</em>}
            </section>
          )}

          {/* Manevrasız güzergah GEÇERLİDİR: kalıcı bir hattın kaydında adım
              verisi bulunmaz ve yalnızca talimat için yeniden yönlendirme
              yapılmaz. */}
          {!journey.hasSteps && (
            <p className="journey-note">Bu güzergâh için adım adım yönlendirme bulunmuyor.</p>
          )}
        </div>
      )}
    </div>,
    containerRef.current,
  )
}
