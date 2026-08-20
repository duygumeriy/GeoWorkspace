namespace StajProject.Application.Options;

/// <summary>
/// İlk yönetici hesabının seed bilgisi.
/// <para>
/// <see cref="Password"/> bir secret'tır: kaynak kodda da appsettings
/// dosyalarında da <b>tutulmaz</b>. Yalnızca User Secrets
/// (<c>dotnet user-secrets set "AdminSeed:Password" ...</c>) veya
/// <c>AdminSeed__Password</c> ortam değişkeni üzerinden gelir.
/// </para>
/// <para>
/// Değer yalnızca hesap henüz yoksa kullanılır; mevcut bir hesabın şifre
/// hash'i bununla asla ezilmez. Şifre eksikse varsayılan bir şifre üretilmez,
/// hesap oluşturulmaz (bkz. IdentityDataSeeder).
/// </para>
/// </summary>
public class AdminSeedOptions
{
    public string Username { get; set; } = string.Empty;

    public string Password { get; set; } = string.Empty;

    /// <summary>Boş bırakılırsa <c>{username}@stajproject.local</c> kullanılır.</summary>
    public string? Email { get; set; }

    /// <summary>
    /// Startup'ta sistemde hiç kullanılabilir yönetici kalmadıysa bootstrap
    /// hesabının Administrator rolüne yükseltilip yükseltilmeyeceği. Varsayılan
    /// <c>true</c>:
    /// aksi hâlde yönetim uçlarına hiç erişilemeyen bir çıkmaz oluşabilir.
    /// </summary>
    /// <remarks>
    /// Bu kurtarma yolu <b>yalnızca</b> kullanılabilir yönetici sayısı sıfırken
    /// çalışır; "bootstrap hesabı yönetici değil" durumunda çalışmaz.
    /// Dolayısıyla bir yöneticinin bilinçli rol değişikliğini geri almaz.
    /// Kurtarma her zaman yüksek seviyede loglanır. Sıkı yönetilen ortamlarda
    /// kapatılıp kurtarma manuel bir operasyon hâline getirilebilir.
    /// </remarks>
    public bool EnableZeroAdminRecovery { get; set; } = true;
}
