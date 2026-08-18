import { categoryLabel } from './rolePermissions.js'

/**
 * Yetki kataloğunun tablosu. SALT OKUNUR.
 *
 * Gerçek bir `<table>`'dır, panelin başka yerlerindeki ızgara-tablo taklidi
 * değil: buradaki satırlar tıklanabilir değil, dolayısıyla `<button>` satırlara
 * ihtiyaç yok ve karşılığında `<th scope>` ile gerçek başlık semantiği geliyor.
 * Ekran okuyucu her hücreyi hangi sütuna ait olduğunu söyleyerek okur.
 *
 * Satırda hiçbir eylem YOKTUR — düzenleme, silme, aktif/pasif anahtarı yok.
 * Yetki tanımları sistem tanımlarıdır; rol bazlı atama /admin/roles'ta yapılır.
 */
export default function PermissionCatalogList({ permissions, loading, empty }) {
  if (loading) {
    return (
      <div className="admin-users-list" aria-label="Yetkiler yükleniyor">
        {[1, 2, 3, 4, 5, 6].map((n) => <div className="admin-skeleton" key={n} />)}
      </div>
    )
  }

  if (!permissions.length) return empty

  /* Rollerin AÇIKÇA yazılmasının sebebi dar ekran düzenidir: telefonda satırlar
     karta dönüşürken CSS `display` değişir ve tarayıcı, örtük tablo
     semantiğini o noktada DÜŞÜRÜR. Açık ARIA rolleri iki düzende de kalıcıdır,
     böylece ekran okuyucu telefonda da "Kod: drawings.view" diye okur. */
  return (
    <div className="admin-users-list admin-catalog">
      <table className="admin-catalog-table" role="table" aria-label="Sistemde tanımlı yetkiler">
        <thead role="rowgroup">
          <tr role="row">
            <th scope="col" role="columnheader">Yetki</th>
            <th scope="col" role="columnheader">Kategori</th>
            <th scope="col" role="columnheader">Kod</th>
            <th scope="col" role="columnheader">Durum</th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {permissions.map((permission) => (
            /* Anahtar `code`'tur, `id` değil: kod kanonik, Id kuruluma
               özgüdür. Id ayrıca ekranda GÖSTERİLMEZ — yöneticiye bir şey
               anlatmayan, kurulumdan kuruluma değişen bir sayıdır. */
            <tr role="row" key={permission.code}>
              <th scope="row" role="rowheader" className="admin-catalog-name">
                <strong>{permission.name}</strong>
                {/* Açıklama nullable'dır. Boşsa satır hiç çizilmez: "-" ya da
                    "undefined" göstermek, olmayan bilgiyi varmış gibi
                    sunmaktır. */}
                {permission.description && <span>{permission.description}</span>}
              </th>
              <td role="cell" data-label="Kategori">{categoryLabel(permission.category)}</td>
              <td role="cell" data-label="Kod">
                <code>{permission.code}</code>
              </td>
              <td role="cell" data-label="Durum">
                {/* Durum yalnızca renkle anlatılmaz: rozetin metni de var.
                    Pasif "bozuk" demek değildir, o yüzden tehlike tonu
                    kullanılmaz — nötr bir rozet ve tek satırlık açıklama. */}
                <span className={`admin-badge ${permission.isActive ? 'success' : 'admin-catalog-inactive'}`}>
                  {permission.isActive ? 'Aktif' : 'Pasif'}
                </span>
                {!permission.isActive && <small>Yeni atamalarda kullanılamaz.</small>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
