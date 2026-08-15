namespace StajProject.Application.Common;

/// <summary>
/// Authorization policy adları. Controller'lar <c>[Authorize(Policy = ...)]</c>
/// içinde bu sabitleri kullanır; policy tanımları Program.cs'te tek yerdedir.
/// </summary>
/// <remarks>
/// Yetki kararlarının ana mekanizması policy'lerdir. Servislerin içine
/// dağılmış <c>if (IsAdmin)</c> kontrolleri değil — <c>ICurrentUserService</c>
/// üzerindeki rol bilgisi yalnızca iş kuralı gerçekten kimliğe bağlıysa
/// (ör. "admin kendi hesabını pasifleştiriyor mu?") kullanılır.
/// </remarks>
public static class AuthorizationPolicies
{
    /// <summary>Kimliği doğrulanmış herhangi bir kullanıcı.</summary>
    public const string AuthenticatedUser = nameof(AuthenticatedUser);

    /// <summary>Yalnızca Admin rolüne sahip kullanıcılar.</summary>
    public const string AdminOnly = nameof(AdminOnly);

    /// <summary>
    /// Admin rolü <b>ve</b> tamamlanmış ikinci faktör (<c>amr=mfa</c>).
    /// </summary>
    /// <remarks>
    /// AUTH-5'te Admin için 2FA zorunlu olduğundan bir Admin JWT'si zaten
    /// yalnızca ikinci faktör tamamlandıktan sonra üretilir; bu policy o kuralı
    /// <b>authorization tarafında da</b> uygular (defense in depth). Token
    /// üretim tarafında ileride bir hata olsa bile güçlü admin uçları
    /// password-only bir token kabul etmez.
    /// </remarks>
    public const string AdminMfaRequired = nameof(AdminMfaRequired);
}
