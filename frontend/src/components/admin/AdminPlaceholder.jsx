import AdminPageHeader from './AdminPageHeader.jsx'

/**
 * Henüz yapılmamış yönetim ekranları için dürüst bir boş durum.
 *
 * Bilinçli olarak hiçbir API çağrısı yapmaz ve sahte kart/metrik göstermez:
 * var olmayan veriyi varmış gibi göstermek, ekranı "çalışıyor" sanmaya yol
 * açar. Arayüz gelene kadar sayfanın söylediği tek şey, ne zaman geleceğidir.
 */
export default function AdminPlaceholder({ title, description, note, Icon }) {
  return (
    <>
      <AdminPageHeader title={title} description={description} />
      <section className="admin-placeholder">
        {Icon && (
          <span className="admin-placeholder-icon" aria-hidden="true">
            <Icon size={24} />
          </span>
        )}
        {/* Sayfa başlığı hemen yukarıda duruyor; kartta aynı kelimeyi tekrar
            etmek yerine kart, ekranın DURUMUNU söyler. */}
        <strong>Bu ekran hazırlanıyor</strong>
        <p>{note}</p>
      </section>
    </>
  )
}
