namespace StajProject.Domain.Common;

/// <summary>
/// Uygulamanın tanıdığı application role'leri. Rol adları buradan okunur;
/// koda dağılmış "Admin"/"User" string'leri kullanılmaz.
/// </summary>
/// <remarks>
/// <b>Tek primary role kuralı:</b> her kullanıcının aynı anda tam olarak bir
/// application role'ü olur. Bir kullanıcı hem <see cref="Admin"/> hem
/// <see cref="User"/> olamaz — Admin zaten authenticated olduğu için ortak
/// endpoint'leri kullanabilir, ayrıca User rolüne ihtiyacı yoktur.
/// </remarks>
public static class ApplicationRoles
{
    public const string Admin = "Admin";

    public const string User = "User";

    /// <summary>Seed edilecek ve atanmasına izin verilen roller.</summary>
    public static readonly IReadOnlyList<string> All = [Admin, User];

    /// <summary>
    /// Serbest metinden geçerli bir role adı çözer. Büyük/küçük harf ve
    /// baştaki/sondaki boşluk tolere edilir; tanınmayan değer reddedilir
    /// (arbitrary role oluşturulmasını engeller).
    /// </summary>
    public static bool TryParse(string? value, out string role)
    {
        var trimmed = value?.Trim();

        role = All.FirstOrDefault(r => string.Equals(r, trimmed, StringComparison.OrdinalIgnoreCase))
            ?? string.Empty;

        return role.Length > 0;
    }
}
