namespace StajProject.Application.DTOs;

/// <summary>
/// <c>GET /api/auth/me/permissions</c> gövdesi: çağıranın O ANDAKİ etkin yetki
/// kodları.
/// </summary>
/// <remarks>
/// <para>
/// <b>Yalnızca çağıranın kendisi.</b> Uç bir kullanıcı kimliği KABUL ETMEZ;
/// hedef daima doğrulanmış token'daki kimliktir. Bir id parametresi olsaydı bu
/// uç, <c>users.view</c> istemeden başkasının yetkilerini okuyan bir kaçak yol
/// olurdu.
/// </para>
/// <para>
/// <b>Katalog değil, sahip olunan kodlar.</b> Yanıt yetki kataloğunun tamamını
/// (ad, açıklama, kategori) taşımaz: arayüzün sorduğu soru "bu kodu yapabilir
/// miyim" — kataloğun kendisi <c>permissions.view</c> ile korunan ayrı bir
/// ekranın konusudur.
/// </para>
/// <para>
/// <b>Kodlar kanoniktir</b> (<c>drawings.point.create</c> gibi). Kullanıcıya
/// gösterilen Türkçe adlar burada YOKTUR — onlar yetkilendirme kimliği
/// değildir.
/// </para>
/// </remarks>
public class CurrentUserPermissionsResponse
{
    /// <summary>
    /// Yanıtın kime ait olduğu. İstemci, kullanıcı değiştiğinde elindeki
    /// kümenin bayat olup olmadığını buradan doğrulayabilir.
    /// </summary>
    public int UserId { get; set; }

    /// <summary>
    /// Etkin yetki kodları: rolden gelenler ∪ doğrudan verilenler, her kod en
    /// fazla bir kez. Uygun olmayan hesap için BOŞ döner.
    /// </summary>
    public IReadOnlyCollection<string> Permissions { get; set; } = [];
}
