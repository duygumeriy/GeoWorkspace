using Microsoft.AspNetCore.Identity;

namespace StajProject.Domain.Entities;

/// <summary>
/// Bir role verilmiş yetki. Kullanıcıların yetkilerinin ana kaynağıdır:
/// yetki kişiye tek tek değil, rolün temsil ettiği görev profiline verilir.
/// </summary>
/// <remarks>
/// <para>
/// Birincil anahtar <c>(RoleId, PermissionId)</c> bileşiğidir; aynı yetkinin
/// aynı role iki kez verilmesi veritabanı seviyesinde imkânsızdır. Bu, seed'in
/// tekrar tekrar çalıştırılmasını güvenli kılar.
/// </para>
/// <para>
/// Bu fazda <b>kapsam (scope) yoktur</b>: satır "bu rol bu yetkiye sahiptir"
/// der, "hangi kayıtlar üzerinde" demez. OWN / OWN_AND_ASSIGNED / ALL ayrımı
/// bilinçli olarak sonraki bir faza bırakılmıştır.
/// </para>
/// </remarks>
public class RolePermission
{
    /// <summary>Identity rol anahtarı (<c>IdentityRole&lt;int&gt;.Id</c>).</summary>
    public int RoleId { get; set; }

    public IdentityRole<int>? Role { get; set; }

    public int PermissionId { get; set; }

    public Permission? Permission { get; set; }
}
