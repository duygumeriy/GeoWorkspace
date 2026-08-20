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

    /// <summary>
    /// Tamamlanmış ikinci faktör (<c>amr=mfa</c>) — <b>rol şartı yok</b>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <see cref="AdminMfaRequired"/> ile aynı MFA kanıtını arar, ama bir rol
    /// adı GEREKTİRMEZ. Dinamik yetkilendirmede "ne
    /// yapabilir" sorusunu yetki satırları yanıtlar; MFA ise ondan bağımsız
    /// bir güvenlik boyutudur ("kimliğini ne kadar güçlü kanıtladı").
    /// </para>
    /// <para>
    /// İkisini ayırmak gerekiyordu: yönetim uçları yalnızca
    /// <c>AdminMfaRequired</c> ile korunsaydı, gerekli yetkilere sahip bir
    /// özel rol kullanıcısı sırf rol adı yüzünden engellenirdi. Korunan uçlar bu yüzden
    /// <c>MfaRequired</c> + gerekli yetki biçiminde kurulur.
    /// </para>
    /// <para>
    /// MFA şartı <b>gevşetilmez</b>: kanıt aynı <c>amr</c> claim'idir ve
    /// yalnızca ikinci faktör doğrulandıktan sonra yazılır.
    /// </para>
    /// </remarks>
    public const string MfaRequired = nameof(MfaRequired);
}
