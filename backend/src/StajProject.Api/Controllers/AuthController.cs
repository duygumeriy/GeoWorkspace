using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StajProject.Api.Common;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;

namespace StajProject.Api.Controllers;

/// <summary>
/// Kimlik ve hesap uçları. Controller kasıtlı olarak incedir: doğrulama,
/// token üretimi ve e-posta gönderimi servis katmanındadır.
/// </summary>
/// <remarks>
/// <para>
/// <b>Hata yönetimi.</b> Her uç <see cref="ApiControllerBase"/> üzerinden aynı
/// try-catch sınırındadır. Başarısız login, yanlış TOTP veya geçersiz bilet
/// birer <i>exception değil</i> servis sonucudur; mevcut 400/401/404/409
/// eşlemeleri aynen korunur. Catch yalnızca beklenmeyen hatalar (ör. veritabanı
/// veya SMTP arızası) içindir.
/// </para>
/// <para>
/// <b>Kimlik uçlarında sızıntı yasağı.</b> Beklenmeyen hata gövdesi sabittir:
/// exception mesajı, iç exception, SQL/bağlantı ayrıntısı veya token bilgisi
/// istemciye ASLA yazılmaz. Hata gövdesi hangi hesap için istek geldiğine göre
/// de değişmez — aksi hâlde 500'ler üzerinden kullanıcı numaralandırması
/// (user enumeration) mümkün olurdu.
/// </para>
/// </remarks>
[ApiController]
[Route("api/auth")]
public class AuthController : ApiControllerBase
{
    private readonly IAuthService _authService;
    private readonly IAccountService _accountService;
    private readonly ITwoFactorService _twoFactorService;
    private readonly ICurrentUserService _currentUser;
    private readonly IEffectivePermissionService _permissions;

    public AuthController(
        IAuthService authService,
        IAccountService accountService,
        ITwoFactorService twoFactorService,
        ICurrentUserService currentUser,
        IEffectivePermissionService permissions,
        ILogger<AuthController> logger)
        : base(logger)
    {
        _authService = authService;
        _accountService = accountService;
        _twoFactorService = twoFactorService;
        _currentUser = currentUser;
        _permissions = permissions;
    }

    /* --- Oturum -------------------------------------------------------------- */

    [HttpPost("login")]
    public Task<ActionResult<LoginResponse>> Login([FromBody] LoginRequest request, CancellationToken cancellationToken) =>
        Guard<LoginResponse>(nameof(Login), async () =>
        {
            var result = await _authService.LoginAsync(request, cancellationToken);

            if (!result.IsSuccess)
            {
                /* `reason` ek bir alandır; `message` ve
                   `requiresEmailConfirmation` mevcut sözleşmedeki anlamlarıyla
                   aynen kalır, dolayısıyla eski istemciler etkilenmez.
                   İstemci mesajı sunucudan olduğu gibi gösterir — hesap durumu
                   metinleri tek bir yerde, servis katmanında tanımlıdır. */
                return Unauthorized(new
                {
                    message = result.ErrorMessage,
                    requiresEmailConfirmation = result.RequiresEmailConfirmation,
                    reason = result.BlockReason.ToString()
                });
            }

            return Ok(result.Response);
        });

    /* --- Login'in ikinci adımı ------------------------------------------------
       Bu uçlar [Authorize] DEĞİLDİR ve olamaz: çağıran henüz oturum açmamıştır.
       Yetkilendirme, gövdedeki challenge biletiyle yapılır — bilet hangi
       kullanıcıya ait olduğunu kendisi taşır, istemci bir kullanıcı kimliği
       gönderemez. */

    [HttpPost("login/2fa")]
    public Task<ActionResult<LoginResponse>> LoginTwoFactor(
        [FromBody] TwoFactorLoginRequest request,
        CancellationToken cancellationToken) =>
        GuardTwoFactor(
            nameof(LoginTwoFactor),
            () => _twoFactorService.CompleteLoginAsync(request, cancellationToken));

    [HttpPost("login/2fa/recovery")]
    public Task<ActionResult<LoginResponse>> LoginTwoFactorRecovery(
        [FromBody] TwoFactorRecoveryLoginRequest request,
        CancellationToken cancellationToken) =>
        GuardTwoFactor(
            nameof(LoginTwoFactorRecovery),
            () => _twoFactorService.CompleteLoginWithRecoveryCodeAsync(request, cancellationToken));

    /* --- Zorunlu (bootstrap) 2FA kurulumu -------------------------------------
       Yalnızca Setup amaçlı bilet kabul edilir. Bu bilet ne drawing ne admin
       ucunda işe yarar; kriptografik zarfın purpose'u farklı olduğu için
       doğrulama ucunda bile çözülemez. */

    [HttpPost("login/2fa/setup")]
    public Task<ActionResult<AuthenticatorSetupResponse>> StartMandatorySetup(
        [FromBody] TwoFactorSetupChallengeRequest request,
        CancellationToken cancellationToken) =>
        GuardTwoFactor(
            nameof(StartMandatorySetup),
            () => _twoFactorService.StartBootstrapSetupAsync(request, cancellationToken));

    [HttpPost("login/2fa/setup/verify")]
    public Task<ActionResult<TwoFactorSetupCompletedResponse>> CompleteMandatorySetup(
        [FromBody] TwoFactorLoginRequest request,
        CancellationToken cancellationToken) =>
        GuardTwoFactor(
            nameof(CompleteMandatorySetup),
            () => _twoFactorService.CompleteBootstrapSetupAsync(request, cancellationToken));

    /* --- Oturum açmış kullanıcının 2FA ayarları ------------------------------- */

    [Authorize]
    [HttpGet("2fa")]
    public Task<ActionResult<TwoFactorStatusResponse>> TwoFactorStatus(CancellationToken cancellationToken) =>
        WithUserId(nameof(TwoFactorStatus), userId => _twoFactorService.GetStatusAsync(userId, cancellationToken));

    [Authorize]
    [HttpPost("2fa/setup")]
    public Task<ActionResult<AuthenticatorSetupResponse>> StartSetup(
        [FromBody] TwoFactorSetupRequest request,
        CancellationToken cancellationToken) =>
        WithUserId(nameof(StartSetup), userId => _twoFactorService.StartSetupAsync(userId, request, cancellationToken));

    [Authorize]
    [HttpPost("2fa/enable")]
    public Task<ActionResult<RecoveryCodesResponse>> Enable(
        [FromBody] TwoFactorEnableRequest request,
        CancellationToken cancellationToken) =>
        WithUserId(nameof(Enable), userId => _twoFactorService.EnableAsync(userId, request, cancellationToken));

    [Authorize]
    [HttpPost("2fa/disable")]
    public Task<ActionResult<AccountResult>> Disable(
        [FromBody] TwoFactorDisableRequest request,
        CancellationToken cancellationToken) =>
        WithUserId(nameof(Disable), userId => _twoFactorService.DisableAsync(userId, request, cancellationToken));

    [Authorize]
    [HttpPost("2fa/recovery-codes/regenerate")]
    public Task<ActionResult<RecoveryCodesResponse>> RegenerateRecoveryCodes(
        [FromBody] RegenerateRecoveryCodesRequest request,
        CancellationToken cancellationToken) =>
        WithUserId(
            nameof(RegenerateRecoveryCodes),
            userId => _twoFactorService.RegenerateRecoveryCodesAsync(userId, request, cancellationToken));

    [Authorize]
    [HttpGet("me")]
    public Task<ActionResult<CurrentUserResponse>> Me(CancellationToken cancellationToken) =>
        Guard<CurrentUserResponse>(nameof(Me), async () =>
        {
            // Kimlik istek gövdesinden değil, doğrulanmış token'dan okunur.
            var userId = _currentUser.UserId;

            if (userId is null)
            {
                return Unauthorized(new { message = "Geçersiz oturum." });
            }

            var user = await _authService.GetCurrentUserAsync(userId.Value, cancellationToken);

            if (user is null)
            {
                return Unauthorized(new { message = "Kullanıcı bulunamadı veya pasif." });
            }

            return Ok(user);
        });

    /// <summary>
    /// Çağıranın o anki etkin yetki kodları — arayüzün "neyi gösterebilirim"
    /// sorusunun tek kaynağı.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Neden ayrı bir uç.</b> <c>me</c> hesabın kim olduğunu anlatır ve
    /// nadiren değişir; yetkiler ise canlıdır ve bir yönetici değişikliğinden
    /// sonra tek başına tazelenmeleri gerekir. Aynı gövdeye koymak, her yetki
    /// tazelemesinde profili de yeniden indirmek olurdu.
    /// </para>
    /// <para>
    /// <b>Kimlik istemciden GELMEZ.</b> Hedef daima
    /// <see cref="ICurrentUserService.UserId"/>'dir; query, gövde veya route
    /// üzerinden bir kullanıcı id'si kabul edilmez.
    /// </para>
    /// <para>
    /// <b>MFA şartı YOKTUR</b> ve bu bilinçlidir. Yönetim uçları
    /// <see cref="AuthorizationPolicies.MfaRequired"/> ile korunmaya DEVAM
    /// eder; ama zorunlu 2FA yalnızca <c>Admin</c> rolü içindir, dolayısıyla
    /// sıradan bir GIS kullanıcısı password-only token taşır. Buraya MFA
    /// koymak, o kullanıcıların yetkilerini hiç okuyamaması ve arayüzün
    /// tamamının fail-closed kapanması demek olurdu.
    /// </para>
    /// <para>
    /// <b>Bu uç bir güvenlik sınırı değildir.</b> Yanıtı yalnızca arayüzü
    /// biçimlendirir; her korumalı uç kendi <c>RequirePermission</c> kapısını
    /// aynen uygular ve yetkisiz isteğe 403 döner.
    /// </para>
    /// </remarks>
    [Authorize]
    [HttpGet("me/permissions")]
    public Task<ActionResult<CurrentUserPermissionsResponse>> MyPermissions(CancellationToken cancellationToken) =>
        Guard<CurrentUserPermissionsResponse>(nameof(MyPermissions), async () =>
        {
            var userId = _currentUser.UserId;

            if (userId is null)
            {
                return Unauthorized(new { message = "Geçersiz oturum." });
            }

            /* Servis TEK kez çağrılır ve tüm kümeyi birlikte çözer: yetki
               başına sorgu, 27 kodluk katalogda 27 gidiş-geliş olurdu.
               Uygun olmayan hesap (pasif, askıya alınmış, silinmiş) için boş
               liste döner — istisna değil; yetkilendirmenin güvenli cevabı
               "hiçbiri"dir. */
            var codes = await _permissions.GetEffectivePermissionCodesAsync(userId.Value, cancellationToken);

            return Ok(new CurrentUserPermissionsResponse
            {
                UserId = userId.Value,
                Permissions = codes
            });
        });

    /* --- Kayıt ve e-posta doğrulama ------------------------------------------ */

    [HttpPost("register")]
    public Task<IActionResult> Register([FromBody] RegisterRequest request, CancellationToken cancellationToken) =>
        GuardAccount(nameof(Register), () => _accountService.RegisterAsync(request, cancellationToken));

    [HttpPost("confirm-email")]
    public Task<IActionResult> ConfirmEmail([FromBody] ConfirmEmailRequest request, CancellationToken cancellationToken) =>
        GuardAccount(nameof(ConfirmEmail), () => _accountService.ConfirmEmailAsync(request, cancellationToken));

    [HttpPost("resend-confirmation")]
    public Task<IActionResult> ResendConfirmation([FromBody] ResendConfirmationRequest request, CancellationToken cancellationToken) =>
        GuardAccount(nameof(ResendConfirmation), () => _accountService.ResendConfirmationAsync(request, cancellationToken));

    /* --- Şifre --------------------------------------------------------------- */

    [HttpPost("forgot-password")]
    public Task<IActionResult> ForgotPassword([FromBody] ForgotPasswordRequest request, CancellationToken cancellationToken) =>
        GuardAccount(nameof(ForgotPassword), () => _accountService.ForgotPasswordAsync(request, cancellationToken));

    [HttpPost("reset-password")]
    public Task<IActionResult> ResetPassword([FromBody] ResetPasswordRequest request, CancellationToken cancellationToken) =>
        GuardAccount(nameof(ResetPassword), () => _accountService.ResetPasswordAsync(request, cancellationToken));

    [Authorize]
    [HttpPost("change-password")]
    public Task<IActionResult> ChangePassword([FromBody] ChangePasswordRequest request, CancellationToken cancellationToken) =>
        GuardAction(nameof(ChangePassword), async () =>
        {
            // Hangi hesabın şifresinin değişeceği request'ten DEĞİL, doğrulanmış
            // JWT'den belirlenir.
            var userId = _currentUser.UserId;

            if (userId is null)
            {
                return Unauthorized(new { message = "Geçersiz oturum." });
            }

            return Respond(await _accountService.ChangePasswordAsync(userId.Value, request, cancellationToken));
        });

    /// <summary>
    /// Hesap işlemlerinin ortak HTTP karşılığı: başarı 200, doğrulama hatası 400.
    /// Gövde şekli mevcut sözleşmeyle uyumludur (<c>message</c> her zaman var).
    /// </summary>
    private IActionResult Respond(AccountResult result) =>
        result.Succeeded
            ? Ok(new { message = result.Message })
            : BadRequest(new { message = result.Message, errors = result.Errors });

    /// <summary>Hesap uçlarının hata sınırı + mevcut <see cref="Respond"/> eşlemesi.</summary>
    private Task<IActionResult> GuardAccount(string endpoint, Func<Task<AccountResult>> operation) =>
        GuardAction(endpoint, async () => Respond(await operation()));

    /* --- 2FA uçlarının ortak HTTP çevirisi ------------------------------------ */

    /// <summary>2FA uçlarının hata sınırı + mevcut <see cref="TwoFactorResponse"/> eşlemesi.</summary>
    private Task<ActionResult<T>> GuardTwoFactor<T>(string endpoint, Func<Task<ServiceResult<T>>> operation) =>
        Guard<T>(endpoint, async () => TwoFactorResponse(await operation()));

    /// <summary>
    /// Oturum açmış kullanıcının 2FA işlemleri için kimliği token'dan çözer.
    /// Hedef hesap request gövdesinden ASLA okunmaz.
    /// </summary>
    private Task<ActionResult<T>> WithUserId<T>(string endpoint, Func<int, Task<ServiceResult<T>>> operation) =>
        Guard<T>(endpoint, async () =>
        {
            var userId = _currentUser.UserId;

            if (userId is null)
            {
                return Unauthorized(new { message = "Geçersiz oturum." });
            }

            return TwoFactorResponse(await operation(userId.Value));
        });

    /// <summary>
    /// <see cref="ServiceResult{T}"/>'in HTTP karşılığı.
    /// </summary>
    /// <remarks>
    /// Doğrulama hataları burada <b>401</b> değil 400/409 döner; 401 istemci
    /// tarafında "oturum bitti → otomatik logout" anlamına geldiği için,
    /// yanlış TOTP girmiş bir kullanıcıyı uygulamadan atardı. Geçersiz bilet
    /// de 400'dür: ortada zaten bir oturum yoktur.
    /// </remarks>
    private ActionResult<T> TwoFactorResponse<T>(ServiceResult<T> result)
    {
        if (result.IsSuccess)
        {
            return Ok(result.Value);
        }

        return result.ErrorKind switch
        {
            ServiceErrorKind.NotFound => NotFound(new { message = result.Error }),
            ServiceErrorKind.Conflict => Conflict(new { message = result.Error }),
            ServiceErrorKind.Forbidden => StatusCode(StatusCodes.Status403Forbidden, new { message = result.Error }),
            _ => BadRequest(new { message = result.Error })
        };
    }
}
