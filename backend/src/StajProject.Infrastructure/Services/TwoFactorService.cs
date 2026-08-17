using System.Text;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Logging;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;

namespace StajProject.Infrastructure.Services;

/// <summary>
/// <see cref="ITwoFactorService"/> implementasyonu.
/// </summary>
/// <remarks>
/// <para>
/// <b>Hiçbir kriptografi bu sınıfta yazılmaz.</b> TOTP secret üretimi
/// (<see cref="UserManager{TUser}.ResetAuthenticatorKeyAsync"/>), kod
/// doğrulaması (<see cref="UserManager{TUser}.VerifyTwoFactorTokenAsync"/>,
/// <see cref="TokenOptions.DefaultAuthenticatorProvider"/>) ve kurtarma
/// kodları (<c>GenerateNewTwoFactorRecoveryCodes</c> /
/// <c>RedeemTwoFactorRecoveryCode</c>) tamamen ASP.NET Core Identity'nindir.
/// Burada yalnızca <i>hangi koşulda hangi framework çağrısının yapılacağı</i>
/// kararı vardır.
/// </para>
/// <para>
/// <b>Sır sızdırmama:</b> authenticator anahtarı ve kurtarma kodları yalnızca
/// üretildikleri isteğin dönüş değerinde bulunur. Bu sınıftaki hiçbir log
/// satırı kod, anahtar veya şifre içermez — yalnızca UserId ve olay adı.
/// </para>
/// </remarks>
public class TwoFactorService : ITwoFactorService
{
    /// <summary>
    /// Authenticator uygulamasında hesabın altında görünecek uygulama adı.
    /// </summary>
    private const string AuthenticatorIssuer = "StajProject";

    /// <summary>
    /// Kurtarma kodu adedi. Identity'nin ürettiği set tamamen değiştirilir.
    /// </summary>
    private const int RecoveryCodeCount = 10;

    private const string InvalidCodeMessage = "Doğrulama kodu geçersiz. Lütfen tekrar deneyin.";
    private const string InvalidChallengeMessage =
        "Doğrulama oturumu geçersiz veya süresi doldu. Lütfen tekrar giriş yapın.";
    private const string LockedOutMessage =
        "Çok fazla hatalı deneme yapıldı. Hesap geçici olarak kilitlendi, lütfen bir süre sonra tekrar deneyin.";
    private const string InvalidPasswordMessage = "Mevcut şifre hatalı.";
    private const string NotEnabledMessage = "Bu hesapta iki faktörlü doğrulama etkin değil.";

    private readonly UserManager<User> _userManager;
    private readonly ITokenService _tokenService;
    private readonly ITwoFactorChallengeService _challenges;
    private readonly ILogger<TwoFactorService> _logger;

    public TwoFactorService(
        UserManager<User> userManager,
        ITokenService tokenService,
        ITwoFactorChallengeService challenges,
        ILogger<TwoFactorService> logger)
    {
        _userManager = userManager;
        _tokenService = tokenService;
        _challenges = challenges;
        _logger = logger;
    }

    /* --- Oturum açmış kullanıcı ---------------------------------------------- */

    public async Task<ServiceResult<TwoFactorStatusResponse>> GetStatusAsync(
        int userId,
        CancellationToken cancellationToken = default)
    {
        var user = await FindUsableUserAsync(userId);

        if (user is null)
        {
            return ServiceResult<TwoFactorStatusResponse>.NotFound("Hesap bulunamadı.");
        }

        return ServiceResult<TwoFactorStatusResponse>.Success(new TwoFactorStatusResponse
        {
            Enabled = user.TwoFactorEnabled,
            Required = await IsMfaMandatoryAsync(user),
            RecoveryCodesLeft = user.TwoFactorEnabled
                ? await _userManager.CountRecoveryCodesAsync(user)
                : 0
        });
    }

    public async Task<ServiceResult<AuthenticatorSetupResponse>> StartSetupAsync(
        int userId,
        TwoFactorSetupRequest request,
        CancellationToken cancellationToken = default)
    {
        var user = await FindUsableUserAsync(userId);

        if (user is null)
        {
            return ServiceResult<AuthenticatorSetupResponse>.NotFound("Hesap bulunamadı.");
        }

        /* Re-authentication: geçerli bir JWT tek başına yeni bir TOTP secret
           üretmeye yetmez. Aksi hâlde ele geçirilmiş/açık bırakılmış bir
           oturum, kullanıcının hesabına saldırganın authenticator'ını
           bağlayabilirdi. */
        if (!await _userManager.CheckPasswordAsync(user, request.CurrentPassword))
        {
            return ServiceResult<AuthenticatorSetupResponse>.Failure(InvalidPasswordMessage);
        }

        if (user.TwoFactorEnabled)
        {
            return ServiceResult<AuthenticatorSetupResponse>.Conflict(
                "İki faktörlü doğrulama zaten etkin. Yeniden kurmak için önce devre dışı bırakın.");
        }

        return await PrepareAuthenticatorAsync(user);
    }

    public async Task<ServiceResult<RecoveryCodesResponse>> EnableAsync(
        int userId,
        TwoFactorEnableRequest request,
        CancellationToken cancellationToken = default)
    {
        var user = await FindUsableUserAsync(userId);

        if (user is null)
        {
            return ServiceResult<RecoveryCodesResponse>.NotFound("Hesap bulunamadı.");
        }

        if (user.TwoFactorEnabled)
        {
            return ServiceResult<RecoveryCodesResponse>.Conflict("İki faktörlü doğrulama zaten etkin.");
        }

        var verification = await VerifyAuthenticatorCodeAsync(user, request.Code);

        if (verification is not null)
        {
            return ServiceResult<RecoveryCodesResponse>.Failure(verification);
        }

        return await EnableAndIssueRecoveryCodesAsync(user);
    }

    public async Task<ServiceResult<AccountResult>> DisableAsync(
        int userId,
        TwoFactorDisableRequest request,
        CancellationToken cancellationToken = default)
    {
        var user = await FindUsableUserAsync(userId);

        if (user is null)
        {
            return ServiceResult<AccountResult>.NotFound("Hesap bulunamadı.");
        }

        /* Admin için 2FA bir tercih değil, kuralın kendisidir. Kullanıcı bunu
           kendi kararıyla kaldıramaz: önce BAŞKA bir Admin tarafından User
           rolüne alınması gerekir. Böylece "Admin ⇒ 2FA zorunlu" önermesi
           sistemde hiçbir zaman bozulmaz. */
        if (await IsMfaMandatoryAsync(user))
        {
            _logger.LogWarning(
                "Admin hesabında 2FA devre dışı bırakma girişimi reddedildi. UserId={UserId}", user.Id);

            return ServiceResult<AccountResult>.Conflict(
                "Yönetici hesaplarında iki faktörlü doğrulama zorunludur ve kapatılamaz. " +
                "Kapatılması gerekiyorsa hesabın önce başka bir yönetici tarafından standart kullanıcıya " +
                "dönüştürülmesi gerekir.");
        }

        if (!user.TwoFactorEnabled)
        {
            return ServiceResult<AccountResult>.Failure(NotEnabledMessage);
        }

        if (!await _userManager.CheckPasswordAsync(user, request.CurrentPassword))
        {
            return ServiceResult<AccountResult>.Failure(InvalidPasswordMessage);
        }

        /* Şifre TEK BAŞINA yetmez: korumanın kaldırılması da korumanın kendisi
           kadar hassastır, bu yüzden ikinci faktör burada da istenir.
           Telefonuna erişemeyen kullanıcı kurtarma kodunu kullanabilir. */
        var secondFactor = await VerifySecondFactorAsync(user, request.Code, request.RecoveryCode);

        if (secondFactor is not null)
        {
            return ServiceResult<AccountResult>.Failure(secondFactor);
        }

        var disable = await _userManager.SetTwoFactorEnabledAsync(user, false);

        if (!disable.Succeeded)
        {
            return ServiceResult<AccountResult>.Failure("İki faktörlü doğrulama kapatılamadı.");
        }

        /* Anahtar ve kurtarma kodları geride bırakılmaz: kullanılmayan bir sır
           saklamanın faydası yok, zararı var. Yeniden etkinleştirme her zaman
           sıfırdan kurulum yapar. */
        await _userManager.ResetAuthenticatorKeyAsync(user);
        await _userManager.GenerateNewTwoFactorRecoveryCodesAsync(user, 0);

        _logger.LogInformation("İki faktörlü doğrulama devre dışı bırakıldı. UserId={UserId}", user.Id);

        return ServiceResult<AccountResult>.Success(
            AccountResult.Success("İki faktörlü doğrulama devre dışı bırakıldı."));
    }

    public async Task<ServiceResult<RecoveryCodesResponse>> RegenerateRecoveryCodesAsync(
        int userId,
        RegenerateRecoveryCodesRequest request,
        CancellationToken cancellationToken = default)
    {
        var user = await FindUsableUserAsync(userId);

        if (user is null)
        {
            return ServiceResult<RecoveryCodesResponse>.NotFound("Hesap bulunamadı.");
        }

        if (!user.TwoFactorEnabled)
        {
            return ServiceResult<RecoveryCodesResponse>.Failure(NotEnabledMessage);
        }

        if (!await _userManager.CheckPasswordAsync(user, request.CurrentPassword))
        {
            return ServiceResult<RecoveryCodesResponse>.Failure(InvalidPasswordMessage);
        }

        /* Burada kurtarma kodu kabul EDİLMEZ, yalnız authenticator kodu:
           kurtarma kodları bu işlemle geçersizleşeceği için, kurtarma koduyla
           yeni set üretmek saldırgana tek bir sızmış kodu kalıcı erişime
           çevirme imkânı verirdi. */
        var verification = await VerifyAuthenticatorCodeAsync(user, request.Code);

        if (verification is not null)
        {
            return ServiceResult<RecoveryCodesResponse>.Failure(verification);
        }

        var codes = await _userManager.GenerateNewTwoFactorRecoveryCodesAsync(user, RecoveryCodeCount);

        _logger.LogInformation("Kurtarma kodları yenilendi. UserId={UserId}", user.Id);

        return ServiceResult<RecoveryCodesResponse>.Success(new RecoveryCodesResponse
        {
            RecoveryCodes = codes?.ToArray() ?? [],
            Message = "Yeni kurtarma kodlarınız oluşturuldu. Önceki kodlar artık geçersizdir."
        });
    }

    /* --- Login'in ikinci adımı ------------------------------------------------ */

    public async Task<ServiceResult<LoginResponse>> CompleteLoginAsync(
        TwoFactorLoginRequest request,
        CancellationToken cancellationToken = default)
    {
        var user = await ResolveChallengeAsync(request.ChallengeToken, TwoFactorChallengePurpose.Verify);

        if (user is null)
        {
            return ServiceResult<LoginResponse>.Failure(InvalidChallengeMessage);
        }

        if (!user.TwoFactorEnabled)
        {
            // Bilet üretildikten sonra 2FA kapatılmışsa akış baştan başlamalı.
            return ServiceResult<LoginResponse>.Failure(InvalidChallengeMessage);
        }

        var verification = await VerifyAuthenticatorCodeAsync(user, request.Code);

        if (verification is not null)
        {
            return ServiceResult<LoginResponse>.Failure(verification);
        }

        _logger.LogInformation("İkinci faktör doğrulandı (authenticator). UserId={UserId}", user.Id);

        return await IssueMultiFactorTokenAsync(user);
    }

    public async Task<ServiceResult<LoginResponse>> CompleteLoginWithRecoveryCodeAsync(
        TwoFactorRecoveryLoginRequest request,
        CancellationToken cancellationToken = default)
    {
        var user = await ResolveChallengeAsync(request.ChallengeToken, TwoFactorChallengePurpose.Verify);

        if (user is null || !user.TwoFactorEnabled)
        {
            return ServiceResult<LoginResponse>.Failure(InvalidChallengeMessage);
        }

        if (await _userManager.IsLockedOutAsync(user))
        {
            return ServiceResult<LoginResponse>.Failure(LockedOutMessage);
        }

        // Identity kodu harcar (tek kullanımlık) ve eşleşmezse hiçbir şey tüketmez.
        var redeemed = await _userManager.RedeemTwoFactorRecoveryCodeAsync(user, NormalizeRecoveryCode(request.RecoveryCode));

        if (!redeemed.Succeeded)
        {
            await _userManager.AccessFailedAsync(user);
            return ServiceResult<LoginResponse>.Failure("Kurtarma kodu geçersiz veya daha önce kullanılmış.");
        }

        await _userManager.ResetAccessFailedCountAsync(user);

        var remaining = await _userManager.CountRecoveryCodesAsync(user);

        // Kodun KENDİSİ değil, yalnızca kaç tane kaldığı loglanır.
        _logger.LogInformation(
            "İkinci faktör kurtarma koduyla doğrulandı. UserId={UserId} KalanKod={Remaining}",
            user.Id,
            remaining);

        return await IssueMultiFactorTokenAsync(user);
    }

    /* --- Zorunlu (bootstrap) kurulum ------------------------------------------ */

    public async Task<ServiceResult<AuthenticatorSetupResponse>> StartBootstrapSetupAsync(
        TwoFactorSetupChallengeRequest request,
        CancellationToken cancellationToken = default)
    {
        var user = await ResolveChallengeAsync(request.ChallengeToken, TwoFactorChallengePurpose.Setup);

        if (user is null)
        {
            return ServiceResult<AuthenticatorSetupResponse>.Failure(InvalidChallengeMessage);
        }

        if (user.TwoFactorEnabled)
        {
            // Kurulum bileti kurulmuş bir hesabı yeniden kurmak için kullanılamaz.
            return ServiceResult<AuthenticatorSetupResponse>.Failure(InvalidChallengeMessage);
        }

        var setupResult = await PrepareAuthenticatorAsync(user);

        if (!setupResult.IsSuccess)
        {
            return setupResult;
        }

        var setup = setupResult.Value!;

        /* Yeni anahtar security stamp'i yeniler; kullanıcının elindeki bilet
           eski stamp'e bağlı olduğu için doğrulama adımında reddedilirdi.
           Bileti burada yenileyip döndürerek akış kesintisiz kalır ve stamp
           bağını gevşetmek gerekmez. */
        setup.ChallengeToken = _challenges.Create(
            user.Id,
            await _userManager.GetSecurityStampAsync(user),
            TwoFactorChallengePurpose.Setup);

        return ServiceResult<AuthenticatorSetupResponse>.Success(setup);
    }

    public async Task<ServiceResult<TwoFactorSetupCompletedResponse>> CompleteBootstrapSetupAsync(
        TwoFactorLoginRequest request,
        CancellationToken cancellationToken = default)
    {
        var user = await ResolveChallengeAsync(request.ChallengeToken, TwoFactorChallengePurpose.Setup);

        if (user is null || user.TwoFactorEnabled)
        {
            return ServiceResult<TwoFactorSetupCompletedResponse>.Failure(InvalidChallengeMessage);
        }

        var verification = await VerifyAuthenticatorCodeAsync(user, request.Code);

        if (verification is not null)
        {
            return ServiceResult<TwoFactorSetupCompletedResponse>.Failure(verification);
        }

        var codesResult = await EnableAndIssueRecoveryCodesAsync(user);

        if (!codesResult.IsSuccess)
        {
            return ServiceResult<TwoFactorSetupCompletedResponse>.Failure(codesResult.Error!);
        }

        var token = await IssueMultiFactorTokenAsync(user);

        if (!token.IsSuccess)
        {
            return ServiceResult<TwoFactorSetupCompletedResponse>.Failure(token.Error!);
        }

        return ServiceResult<TwoFactorSetupCompletedResponse>.Success(new TwoFactorSetupCompletedResponse
        {
            Token = token.Value!.Token!,
            ExpiresAt = token.Value.ExpiresAt!.Value,
            RecoveryCodes = codesResult.Value!.RecoveryCodes
        });
    }

    /* --- Ortak yardımcılar ---------------------------------------------------- */

    /// <summary>
    /// Bileti çözer ve arkasındaki kullanıcıyı getirir. Bilet geçersizse,
    /// kullanıcı silinmiş/pasifse veya security stamp bilet üretildiğinden
    /// beri değiştiyse <c>null</c> döner.
    /// </summary>
    private async Task<User?> ResolveChallengeAsync(string? challengeToken, TwoFactorChallengePurpose purpose)
    {
        var challenge = _challenges.Validate(challengeToken, purpose);

        if (challenge is null)
        {
            return null;
        }

        var user = await FindUsableUserAsync(challenge.UserId);

        if (user is null)
        {
            return null;
        }

        /* Stamp kontrolü: bilet üretildikten sonra şifre değiştiyse (ya da
           hesapla ilgili başka bir güvenlik olayı yaşandıysa) bekleyen tüm
           biletler geçersizdir. Sabit zamanlı karşılaştırma gerekmez; stamp
           gizli bir doğrulayıcı değil, bir sürüm numarasıdır. */
        var currentStamp = await _userManager.GetSecurityStampAsync(user);

        return string.Equals(currentStamp, challenge.SecurityStamp, StringComparison.Ordinal)
            ? user
            : null;
    }

    private async Task<User?> FindUsableUserAsync(int userId)
    {
        var user = await _userManager.FindByIdAsync(userId.ToString());

        return user is null || user.IsDeleted || !user.IsActive ? null : user;
    }

    private async Task<bool> IsMfaMandatoryAsync(User user) =>
        await _userManager.IsInRoleAsync(user, ApplicationRoles.Admin);

    /// <summary>
    /// Yeni bir authenticator anahtarı üretir ve QR verisini hazırlar.
    /// 2FA burada <b>etkinleşmez</b> — yalnızca kod doğrulandığında etkinleşir.
    /// </summary>
    private async Task<ServiceResult<AuthenticatorSetupResponse>> PrepareAuthenticatorAsync(User user)
    {
        /* Kurulum her başlatıldığında anahtar sıfırlanır. Eski (ör. daha önce
           devre dışı bırakılmış bir kurulumdan kalan) anahtarı yeniden
           kullanmak, o anahtarı bir kez görmüş birine kalıcı erişim
           bırakabilirdi. */
        var reset = await _userManager.ResetAuthenticatorKeyAsync(user);

        if (!reset.Succeeded)
        {
            _logger.LogError(
                "Authenticator anahtarı oluşturulamadı. UserId={UserId} Errors={Errors}",
                user.Id,
                string.Join(',', reset.Errors.Select(error => error.Code)));

            return ServiceResult<AuthenticatorSetupResponse>.Failure(
                "Authenticator kurulumu hazırlanamadı. Lütfen tekrar deneyin.");
        }

        var key = await _userManager.GetAuthenticatorKeyAsync(user);

        if (string.IsNullOrWhiteSpace(key))
        {
            _logger.LogError("Identity boş authenticator anahtarı döndürdü. UserId={UserId}", user.Id);

            return ServiceResult<AuthenticatorSetupResponse>.Failure(
                "Authenticator kurulumu hazırlanamadı. Lütfen tekrar deneyin.");
        }

        return ServiceResult<AuthenticatorSetupResponse>.Success(new AuthenticatorSetupResponse
        {
            SharedKey = FormatKey(key),
            AuthenticatorUri = BuildAuthenticatorUri(user.UserName ?? user.Email ?? user.Id.ToString(), key)
        });
    }

    /// <summary>
    /// 2FA'yı etkinleştirir ve kurtarma kodlarını üretir. Yalnızca kod
    /// doğrulandıktan sonra çağrılır.
    /// </summary>
    private async Task<ServiceResult<RecoveryCodesResponse>> EnableAndIssueRecoveryCodesAsync(User user)
    {
        var enable = await _userManager.SetTwoFactorEnabledAsync(user, true);

        if (!enable.Succeeded)
        {
            _logger.LogError(
                "İki faktörlü doğrulama etkinleştirilemedi. UserId={UserId} Errors={Errors}",
                user.Id,
                string.Join(',', enable.Errors.Select(error => error.Code)));

            return ServiceResult<RecoveryCodesResponse>.Failure(
                "İki faktörlü doğrulama etkinleştirilemedi. Lütfen tekrar deneyin.");
        }

        var codes = await _userManager.GenerateNewTwoFactorRecoveryCodesAsync(user, RecoveryCodeCount);

        var recoveryCodes = codes?.ToArray() ?? [];

        if (recoveryCodes.Length != RecoveryCodeCount)
        {
            // 2FA etkinleşti fakat kullanıcıya güvenli çıkış yolu verecek tam
            // recovery set'i üretilemedi. MFA token vermeden ve başarı
            // bildirmeden önce korumayı geri alarak durumu tutarlı bırak.
            var rollback = await _userManager.SetTwoFactorEnabledAsync(user, false);

            _logger.LogError(
                "Kurtarma kodları üretilemedi; 2FA geri alındı. UserId={UserId} RollbackSucceeded={RollbackSucceeded}",
                user.Id,
                rollback.Succeeded);

            return ServiceResult<RecoveryCodesResponse>.Failure(
                "Kurtarma kodları oluşturulamadığı için iki faktörlü doğrulama etkinleştirilmedi. Lütfen tekrar deneyin.");
        }

        _logger.LogInformation("İki faktörlü doğrulama etkinleştirildi. UserId={UserId}", user.Id);

        return ServiceResult<RecoveryCodesResponse>.Success(new RecoveryCodesResponse
        {
            RecoveryCodes = recoveryCodes,
            Message = "İki faktörlü doğrulama etkinleştirildi. Kurtarma kodlarınızı güvenli bir yerde saklayın."
        });
    }

    /// <summary>
    /// Authenticator kodunu doğrular. Başarılıysa <c>null</c>, aksi hâlde
    /// kullanıcıya gösterilecek hata mesajı döner.
    /// </summary>
    /// <remarks>
    /// TOTP doğrulaması, mevcut lockout altyapısına bağlanır: her hatalı kod
    /// <c>AccessFailedCount</c>'u artırır ve eşik aşılınca hesap Identity'nin
    /// kendi kurallarıyla kilitlenir. Bu, 6 haneli bir kodun sınırsız
    /// denenmesini engelleyen minimum korumadır; genel/dağıtık rate limiting
    /// AUTH-7 kapsamındadır.
    /// </remarks>
    private async Task<string?> VerifyAuthenticatorCodeAsync(User user, string? code)
    {
        if (await _userManager.IsLockedOutAsync(user))
        {
            return LockedOutMessage;
        }

        var normalized = NormalizeAuthenticatorCode(code);

        // Format tutmuyorsa framework'e hiç gitmeye gerek yok; yine de
        // başarısız deneme olarak sayılır ki filtre bir bypass'a dönüşmesin.
        var verified = normalized is not null
            && await _userManager.VerifyTwoFactorTokenAsync(
                user,
                _userManager.Options.Tokens.AuthenticatorTokenProvider,
                normalized);

        if (!verified)
        {
            await _userManager.AccessFailedAsync(user);

            // Kodun kendisi ASLA loglanmaz.
            _logger.LogWarning("Geçersiz iki faktör kodu denendi. UserId={UserId}", user.Id);

            return await _userManager.IsLockedOutAsync(user) ? LockedOutMessage : InvalidCodeMessage;
        }

        await _userManager.ResetAccessFailedCountAsync(user);

        return null;
    }

    /// <summary>
    /// Authenticator kodu veya kurtarma kodu — hangisi gönderildiyse onu
    /// doğrular. Başarılıysa <c>null</c> döner.
    /// </summary>
    private async Task<string?> VerifySecondFactorAsync(User user, string? code, string? recoveryCode)
    {
        if (!string.IsNullOrWhiteSpace(code))
        {
            return await VerifyAuthenticatorCodeAsync(user, code);
        }

        if (string.IsNullOrWhiteSpace(recoveryCode))
        {
            return "Doğrulama kodu veya kurtarma kodu girmelisiniz.";
        }

        if (await _userManager.IsLockedOutAsync(user))
        {
            return LockedOutMessage;
        }

        var redeemed = await _userManager.RedeemTwoFactorRecoveryCodeAsync(user, NormalizeRecoveryCode(recoveryCode));

        if (!redeemed.Succeeded)
        {
            await _userManager.AccessFailedAsync(user);
            return "Kurtarma kodu geçersiz veya daha önce kullanılmış.";
        }

        await _userManager.ResetAccessFailedCountAsync(user);

        return null;
    }

    /// <summary>
    /// İkinci faktör tamamlandıktan sonra normal access token'ı üretir.
    /// <see cref="AuthenticationLevel.MultiFactor"/> yalnızca buradan geçer.
    /// </summary>
    private async Task<ServiceResult<LoginResponse>> IssueMultiFactorTokenAsync(User user)
    {
        if (!user.EmailConfirmed)
        {
            return ServiceResult<LoginResponse>.Failure("E-posta adresinizi doğrulamanız gerekiyor.");
        }

        /* Onay kapısı burada bir kez daha uygulanır. AuthService onaylanmamış
           bir hesaba zaten challenge bileti vermez, dolayısıyla buraya normalde
           gelinmez; ama access token üreten HER yol kendi kontrolünü yapmalıdır
           — aksi hâlde tek bir regresyon ikinci faktörü onay kapısının etrafından
           dolaşan bir yola çevirirdi. */
        if (user.AccountStatus != AccountStatus.Active || !user.IsActive)
        {
            return ServiceResult<LoginResponse>.Failure(
                "Hesabınız şu anda giriş yapmaya uygun değil. Lütfen yöneticinizle iletişime geçin.");
        }

        // Roller daima veritabanından okunur; biletin içinde rol taşınmaz.
        var roles = await _userManager.GetRolesAsync(user);

        var (token, expiresAt) = _tokenService.GenerateToken(
            user.Id,
            user.UserName!,
            roles,
            AuthenticationLevel.MultiFactor);

        return ServiceResult<LoginResponse>.Success(new LoginResponse
        {
            Token = token,
            ExpiresAt = expiresAt
        });
    }

    /// <summary>
    /// Kullanıcı kodu boşluk/tire ile yapıştırabilir. Yalnızca 6 haneli sayısal
    /// biçim kabul edilir; başka her şey <c>null</c> döner.
    /// </summary>
    private static string? NormalizeAuthenticatorCode(string? code)
    {
        if (string.IsNullOrWhiteSpace(code))
        {
            return null;
        }

        var digits = new string(code.Where(char.IsAsciiDigit).ToArray());

        var stripped = code.Where(c => !char.IsWhiteSpace(c) && c != '-').ToArray();

        // "12 34-56" gibi girdiler kabul; "12a456" gibi karışık girdiler değil.
        return digits.Length == 6 && stripped.Length == digits.Length ? digits : null;
    }

    /// <summary>
    /// Kurtarma kodunun görünür biçimi kopyalanırken boşluk kapabilir.
    /// Kodun kendi karakterlerine (tire dahil) dokunulmaz.
    /// </summary>
    private static string NormalizeRecoveryCode(string? recoveryCode) =>
        new((recoveryCode ?? string.Empty).Where(c => !char.IsWhiteSpace(c)).ToArray());

    /// <summary>
    /// Manuel giriş için anahtarı dörtlü gruplara böler (QR okunamadığında
    /// kullanıcı bunu authenticator'a elle yazar).
    /// </summary>
    private static string FormatKey(string unformattedKey)
    {
        var result = new StringBuilder();

        for (var i = 0; i < unformattedKey.Length; i += 4)
        {
            result
                .Append(unformattedKey.AsSpan(i, Math.Min(4, unformattedKey.Length - i)))
                .Append(' ');
        }

        return result.ToString().Trim();
    }

    /// <summary>
    /// Google/Microsoft Authenticator ve diğer standart uygulamaların okuduğu
    /// <c>otpauth</c> URI'si. Biçim key-uri-format spesifikasyonundandır;
    /// parametreler Identity'nin varsayılan authenticator provider ayarlarıyla
    /// (SHA1, 6 hane, 30 sn) uyumludur.
    /// </summary>
    private static string BuildAuthenticatorUri(string account, string unformattedKey) =>
        string.Format(
            System.Globalization.CultureInfo.InvariantCulture,
            "otpauth://totp/{0}:{1}?secret={2}&issuer={0}&digits=6&period=30&algorithm=SHA1",
            UrlEncoder.Default.Encode(AuthenticatorIssuer),
            UrlEncoder.Default.Encode(account),
            unformattedKey);
}
