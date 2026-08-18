/**
 * Yönetim sayfalarının ortak başlığı.
 *
 * Kabuk gezinmeyi taşır, bu bileşen ise "hangi sayfadayım" sorusunu yanıtlar.
 * Üç sayfada üç ayrı başlık işaretlemesi, zamanla üç farklı boşluk ve üç farklı
 * yazı boyu demek olurdu.
 */
export default function AdminPageHeader({ title, description }) {
  return (
    <header className="admin-page-header">
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </header>
  )
}
