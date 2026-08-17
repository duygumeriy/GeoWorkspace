namespace StajProject.Application.DTOs;

/// <summary>
/// Login'in engellenme sebebi. Yalnızca <b>şifre doğrulandıktan sonra</b>
/// bilgilendirici bir değere ayarlanır; şifreyi bilmeyen birine hesabın durumu
/// hakkında hiçbir şey söylenmez.
/// </summary>
public enum LoginBlockReason
{
    /// <summary>İstek engellenmedi.</summary>
    None = 0,

    /// <summary>Kullanıcı yok, silinmiş veya şifre hatalı — ayrımı yapılmaz.</summary>
    InvalidCredentials,

    /// <summary>Identity lockout'u devrede.</summary>
    LockedOut,

    /// <summary>E-posta adresi henüz doğrulanmamış.</summary>
    EmailNotConfirmed,

    /// <summary>E-posta doğrulanmış ancak hesap yönetici onayı bekliyor.</summary>
    PendingApproval,

    /// <summary>Hesap yönetici tarafından devre dışı bırakılmış.</summary>
    Suspended,

    /// <summary>Hesap başvurusu reddedilmiş.</summary>
    Rejected
}

/// <summary>
/// Login denemesinin sonucu. Başarısızlık her zaman 401'e karşılık gelir;
/// bu tip yalnızca hangi mesajın döneceğini taşır.
/// </summary>
/// <remarks>
/// "Başarı" burada <b>oturum açıldı</b> demek değildir; "istek geçerli bir
/// sonraki adıma ulaştı" demektir. İkinci faktör bekleyen bir kullanıcı da
/// <see cref="IsSuccess"/> döner ama <see cref="LoginResponse.Token"/> null'dır
/// — access token yalnızca ikinci faktör tamamlandığında doldurulur.
/// </remarks>
public sealed class LoginResult
{
    private LoginResult(LoginResponse? response, string? errorMessage, LoginBlockReason blockReason)
    {
        Response = response;
        ErrorMessage = errorMessage;
        BlockReason = blockReason;
    }

    public LoginResponse? Response { get; }

    public string? ErrorMessage { get; }

    /// <summary>
    /// İsteğin neden ilerlemediği. Hesap durumuna bağlı sebepler yalnızca
    /// şifre doğrulandıktan sonra üretilir.
    /// </summary>
    public LoginBlockReason BlockReason { get; }

    /// <summary>
    /// Şifre doğru ama e-posta doğrulanmamış. Frontend bu durumda
    /// "doğrulama e-postasını yeniden gönder" seçeneği sunar.
    /// </summary>
    /// <remarks>
    /// Mevcut HTTP sözleşmesi korunsun diye ayrı bir alan olarak kalır;
    /// değeri <see cref="BlockReason"/>'dan türetilir.
    /// </remarks>
    public bool RequiresEmailConfirmation => BlockReason == LoginBlockReason.EmailNotConfirmed;

    public bool IsSuccess => Response is not null;

    public static LoginResult Success(LoginResponse response) => new(response, null, LoginBlockReason.None);

    /// <summary>
    /// Şifre doğrulandı fakat kullanıcının 2FA'sı etkin: access token
    /// ÜRETİLMEZ, yalnızca ikinci adım bileti döner.
    /// </summary>
    public static LoginResult TwoFactorRequired(string challengeToken) =>
        Success(new LoginResponse
        {
            RequiresTwoFactor = true,
            ChallengeToken = challengeToken
        });

    /// <summary>
    /// Şifre doğrulandı fakat hesap, 2FA'sı zorunlu olup henüz kurulum
    /// yapmamış bir Admin. Yine access token ÜRETİLMEZ; dönen bilet yalnızca
    /// authenticator kurulumunu yapmaya yarar.
    /// </summary>
    public static LoginResult TwoFactorSetupRequired(string challengeToken) =>
        Success(new LoginResponse
        {
            RequiresTwoFactorSetup = true,
            ChallengeToken = challengeToken
        });

    public static LoginResult Failure(string errorMessage) =>
        new(null, errorMessage, LoginBlockReason.InvalidCredentials);

    public static LoginResult LockedOut(string errorMessage) =>
        new(null, errorMessage, LoginBlockReason.LockedOut);

    public static LoginResult EmailNotConfirmed(string errorMessage) =>
        new(null, errorMessage, LoginBlockReason.EmailNotConfirmed);

    /// <summary>
    /// Hesap durumu nedeniyle engellendi (onay bekliyor / askıya alınmış /
    /// reddedilmiş). Bu yollardan hiçbirinde access token üretilmez.
    /// </summary>
    public static LoginResult Blocked(LoginBlockReason reason, string errorMessage) =>
        new(null, errorMessage, reason);
}
