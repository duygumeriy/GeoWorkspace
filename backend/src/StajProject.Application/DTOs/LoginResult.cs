namespace StajProject.Application.DTOs;

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
    private LoginResult(LoginResponse? response, string? errorMessage, bool requiresEmailConfirmation)
    {
        Response = response;
        ErrorMessage = errorMessage;
        RequiresEmailConfirmation = requiresEmailConfirmation;
    }

    public LoginResponse? Response { get; }

    public string? ErrorMessage { get; }

    /// <summary>
    /// Şifre doğru ama e-posta doğrulanmamış. Frontend bu durumda
    /// "doğrulama e-postasını yeniden gönder" seçeneği sunar.
    /// </summary>
    /// <remarks>
    /// Bu bayrak yalnızca <b>şifre doğrulandıktan sonra</b> set edilir;
    /// şifreyi bilmeyen biri bir hesabın doğrulanmamış olduğunu öğrenemez.
    /// </remarks>
    public bool RequiresEmailConfirmation { get; }

    public bool IsSuccess => Response is not null;

    public static LoginResult Success(LoginResponse response) => new(response, null, false);

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

    public static LoginResult Failure(string errorMessage) => new(null, errorMessage, false);

    public static LoginResult EmailNotConfirmed(string errorMessage) => new(null, errorMessage, true);
}
