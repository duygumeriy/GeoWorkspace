using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;

namespace StajProject.Api.Controllers;

/// <summary>
/// Kimlik ve hesap uçları. Controller kasıtlı olarak incedir: doğrulama,
/// token üretimi ve e-posta gönderimi servis katmanındadır.
/// </summary>
[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private readonly IAuthService _authService;
    private readonly IAccountService _accountService;
    private readonly ITwoFactorService _twoFactorService;
    private readonly ICurrentUserService _currentUser;

    public AuthController(
        IAuthService authService,
        IAccountService accountService,
        ITwoFactorService twoFactorService,
        ICurrentUserService currentUser)
    {
        _authService = authService;
        _accountService = accountService;
        _twoFactorService = twoFactorService;
        _currentUser = currentUser;
    }

    /* --- Oturum -------------------------------------------------------------- */

    [HttpPost("login")]
    public async Task<ActionResult<LoginResponse>> Login([FromBody] LoginRequest request, CancellationToken cancellationToken)
    {
        var result = await _authService.LoginAsync(request, cancellationToken);

        if (!result.IsSuccess)
        {
            return Unauthorized(new
            {
                message = result.ErrorMessage,
                requiresEmailConfirmation = result.RequiresEmailConfirmation
            });
        }

        return Ok(result.Response);
    }

    /* --- Login'in ikinci adımı ------------------------------------------------
       Bu uçlar [Authorize] DEĞİLDİR ve olamaz: çağıran henüz oturum açmamıştır.
       Yetkilendirme, gövdedeki challenge biletiyle yapılır — bilet hangi
       kullanıcıya ait olduğunu kendisi taşır, istemci bir kullanıcı kimliği
       gönderemez. */

    [HttpPost("login/2fa")]
    public async Task<ActionResult<LoginResponse>> LoginTwoFactor(
        [FromBody] TwoFactorLoginRequest request,
        CancellationToken cancellationToken) =>
        TwoFactorResponse(await _twoFactorService.CompleteLoginAsync(request, cancellationToken));

    [HttpPost("login/2fa/recovery")]
    public async Task<ActionResult<LoginResponse>> LoginTwoFactorRecovery(
        [FromBody] TwoFactorRecoveryLoginRequest request,
        CancellationToken cancellationToken) =>
        TwoFactorResponse(await _twoFactorService.CompleteLoginWithRecoveryCodeAsync(request, cancellationToken));

    /* --- Zorunlu (bootstrap) 2FA kurulumu -------------------------------------
       Yalnızca Setup amaçlı bilet kabul edilir. Bu bilet ne drawing ne admin
       ucunda işe yarar; kriptografik zarfın purpose'u farklı olduğu için
       doğrulama ucunda bile çözülemez. */

    [HttpPost("login/2fa/setup")]
    public async Task<ActionResult<AuthenticatorSetupResponse>> StartMandatorySetup(
        [FromBody] TwoFactorSetupChallengeRequest request,
        CancellationToken cancellationToken) =>
        TwoFactorResponse(await _twoFactorService.StartBootstrapSetupAsync(request, cancellationToken));

    [HttpPost("login/2fa/setup/verify")]
    public async Task<ActionResult<TwoFactorSetupCompletedResponse>> CompleteMandatorySetup(
        [FromBody] TwoFactorLoginRequest request,
        CancellationToken cancellationToken) =>
        TwoFactorResponse(await _twoFactorService.CompleteBootstrapSetupAsync(request, cancellationToken));

    /* --- Oturum açmış kullanıcının 2FA ayarları ------------------------------- */

    [Authorize]
    [HttpGet("2fa")]
    public Task<ActionResult<TwoFactorStatusResponse>> TwoFactorStatus(CancellationToken cancellationToken) =>
        WithUserId(userId => _twoFactorService.GetStatusAsync(userId, cancellationToken));

    [Authorize]
    [HttpPost("2fa/setup")]
    public Task<ActionResult<AuthenticatorSetupResponse>> StartSetup(
        [FromBody] TwoFactorSetupRequest request,
        CancellationToken cancellationToken) =>
        WithUserId(userId => _twoFactorService.StartSetupAsync(userId, request, cancellationToken));

    [Authorize]
    [HttpPost("2fa/enable")]
    public Task<ActionResult<RecoveryCodesResponse>> Enable(
        [FromBody] TwoFactorEnableRequest request,
        CancellationToken cancellationToken) =>
        WithUserId(userId => _twoFactorService.EnableAsync(userId, request, cancellationToken));

    [Authorize]
    [HttpPost("2fa/disable")]
    public Task<ActionResult<AccountResult>> Disable(
        [FromBody] TwoFactorDisableRequest request,
        CancellationToken cancellationToken) =>
        WithUserId(userId => _twoFactorService.DisableAsync(userId, request, cancellationToken));

    [Authorize]
    [HttpPost("2fa/recovery-codes/regenerate")]
    public Task<ActionResult<RecoveryCodesResponse>> RegenerateRecoveryCodes(
        [FromBody] RegenerateRecoveryCodesRequest request,
        CancellationToken cancellationToken) =>
        WithUserId(userId => _twoFactorService.RegenerateRecoveryCodesAsync(userId, request, cancellationToken));

    [Authorize]
    [HttpGet("me")]
    public async Task<ActionResult<CurrentUserResponse>> Me(CancellationToken cancellationToken)
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
    }

    /* --- Kayıt ve e-posta doğrulama ------------------------------------------ */

    [HttpPost("register")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest request, CancellationToken cancellationToken) =>
        Respond(await _accountService.RegisterAsync(request, cancellationToken));

    [HttpPost("confirm-email")]
    public async Task<IActionResult> ConfirmEmail([FromBody] ConfirmEmailRequest request, CancellationToken cancellationToken) =>
        Respond(await _accountService.ConfirmEmailAsync(request, cancellationToken));

    [HttpPost("resend-confirmation")]
    public async Task<IActionResult> ResendConfirmation([FromBody] ResendConfirmationRequest request, CancellationToken cancellationToken) =>
        Respond(await _accountService.ResendConfirmationAsync(request, cancellationToken));

    /* --- Şifre --------------------------------------------------------------- */

    [HttpPost("forgot-password")]
    public async Task<IActionResult> ForgotPassword([FromBody] ForgotPasswordRequest request, CancellationToken cancellationToken) =>
        Respond(await _accountService.ForgotPasswordAsync(request, cancellationToken));

    [HttpPost("reset-password")]
    public async Task<IActionResult> ResetPassword([FromBody] ResetPasswordRequest request, CancellationToken cancellationToken) =>
        Respond(await _accountService.ResetPasswordAsync(request, cancellationToken));

    [Authorize]
    [HttpPost("change-password")]
    public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordRequest request, CancellationToken cancellationToken)
    {
        // Hangi hesabın şifresinin değişeceği request'ten DEĞİL, doğrulanmış
        // JWT'den belirlenir.
        var userId = _currentUser.UserId;

        if (userId is null)
        {
            return Unauthorized(new { message = "Geçersiz oturum." });
        }

        return Respond(await _accountService.ChangePasswordAsync(userId.Value, request, cancellationToken));
    }

    /// <summary>
    /// Hesap işlemlerinin ortak HTTP karşılığı: başarı 200, doğrulama hatası 400.
    /// Gövde şekli mevcut sözleşmeyle uyumludur (<c>message</c> her zaman var).
    /// </summary>
    private IActionResult Respond(AccountResult result) =>
        result.Succeeded
            ? Ok(new { message = result.Message })
            : BadRequest(new { message = result.Message, errors = result.Errors });

    /* --- 2FA uçlarının ortak HTTP çevirisi ------------------------------------ */

    /// <summary>
    /// Oturum açmış kullanıcının 2FA işlemleri için kimliği token'dan çözer.
    /// Hedef hesap request gövdesinden ASLA okunmaz.
    /// </summary>
    private async Task<ActionResult<T>> WithUserId<T>(Func<int, Task<ServiceResult<T>>> operation)
    {
        var userId = _currentUser.UserId;

        if (userId is null)
        {
            return Unauthorized(new { message = "Geçersiz oturum." });
        }

        return TwoFactorResponse(await operation(userId.Value));
    }

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
