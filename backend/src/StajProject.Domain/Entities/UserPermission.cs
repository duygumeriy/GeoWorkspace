namespace StajProject.Domain.Entities;

/// <summary>
/// Bir kullanıcıya doğrudan verilmiş EK yetki. Rolünün profiline uymayan tekil
/// bir ihtiyacı, kişiye özel bir rol açmadan karşılamak içindir.
/// </summary>
/// <remarks>
/// <para>
/// <b>Yalnızca ekleme.</b> Bu ilişki bir yetkiyi geri ALMAZ. Deny/override
/// modeli yoktur ve bu fazda bilinçli olarak eklenmemiştir: iki yönlü bir
/// model, "yetkim var mı" sorusunun cevabını sıralamaya bağlı hale getirirdi.
/// Etkin yetki ilerleyen fazda basitçe rol yetkileri ∪ doğrudan yetkiler
/// olarak hesaplanacaktır.
/// </para>
/// <para>
/// Birincil anahtar <c>(UserId, PermissionId)</c> bileşiğidir; aynı yetki bir
/// kullanıcıya iki kez verilemez.
/// </para>
/// </remarks>
public class UserPermission
{
    public int UserId { get; set; }

    public User? User { get; set; }

    public int PermissionId { get; set; }

    public Permission? Permission { get; set; }
}
