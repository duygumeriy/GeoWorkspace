using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using StajProject.Api.Common;
using StajProject.Api.Controllers;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;

namespace StajProject.Auth.Tests;

/// <summary>
/// Controller'ların hata sınırını kilitler: servis katmanından gelen
/// <b>beklenmeyen</b> bir exception her uçta aynı 500 gövdesine çevrilir ve
/// istemciye teknik detay sızmaz.
/// </summary>
/// <remarks>
/// <para>
/// Testler ikinci bir şeyi daha kilitler: iş kuralı sonuçları (yanlış şifre,
/// bulunamayan kayıt, geçersiz geometry) exception <i>değildir</i> ve hata
/// sınırı onları 500'e çevirmez — mevcut 401/404/400 karşılıkları korunur.
/// Standardizasyonun asıl riski buydu.
/// </para>
/// <para>
/// Controller'lar doğrudan kurulur; veritabanına, HTTP sunucusuna veya harici
/// bir servise ihtiyaç yoktur.
/// </para>
/// </remarks>
public class ControllerExceptionBoundaryTests
{
    private const string TraceId = "trace-boundary-1";

    /// <summary>
    /// Gerçek bir arızanın taşıyabileceği türden hassas metin. Yanıt gövdesinde
    /// bunun herhangi bir parçası görünmemelidir.
    /// </summary>
    private const string LeakyMessage =
        "Npgsql: Host=10.0.0.5;Password=super-secret;Database=staj — relation \"users\" does not exist";

    /* --- AuthController ------------------------------------------------------ */

    [Fact]
    public async Task Auth_login_maps_unexpected_service_failure_to_standard_500()
    {
        var authService = Substitute.For<IAuthService>();
        authService
            .LoginAsync(Arg.Any<LoginRequest>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new InvalidOperationException(LeakyMessage));

        var controller = AuthControllerWith(authService);

        var response = await controller.Login(new LoginRequest { Username = "u", Password = "p" }, default);

        AssertStandardServerError(response.Result);
    }

    /// <summary>
    /// Regresyon: hatalı kimlik bilgisi hâlâ 401'dir. Hata sınırı login'in
    /// mevcut sözleşmesini (mesaj + <c>requiresEmailConfirmation</c>) bozmaz.
    /// </summary>
    [Fact]
    public async Task Auth_login_keeps_401_for_invalid_credentials()
    {
        var authService = Substitute.For<IAuthService>();
        authService
            .LoginAsync(Arg.Any<LoginRequest>(), Arg.Any<CancellationToken>())
            .Returns(LoginResult.Failure("Kullanıcı adı veya şifre hatalı."));

        var controller = AuthControllerWith(authService);

        var response = await controller.Login(new LoginRequest { Username = "u", Password = "p" }, default);

        var unauthorized = Assert.IsType<UnauthorizedObjectResult>(response.Result);
        Assert.Equal(StatusCodes.Status401Unauthorized, unauthorized.StatusCode);
        Assert.Contains("şifre hatalı", Serialize(unauthorized.Value));
    }

    /// <summary>
    /// <c>IActionResult</c> döndüren hesap uçları da (GuardAction) aynı sınırdadır.
    /// </summary>
    [Fact]
    public async Task Auth_account_endpoint_maps_unexpected_service_failure_to_standard_500()
    {
        var accountService = Substitute.For<IAccountService>();
        accountService
            .RegisterAsync(Arg.Any<RegisterRequest>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new InvalidOperationException(LeakyMessage));

        var controller = AuthControllerWith(accountService: accountService);

        AssertStandardServerError(await controller.Register(new RegisterRequest(), default));
    }

    /* --- AdminUsersController ------------------------------------------------ */

    [Fact]
    public async Task Admin_users_maps_unexpected_service_failure_to_standard_500()
    {
        var userManagement = Substitute.For<IUserManagementService>();
        userManagement
            .GetUsersAsync(Arg.Any<CancellationToken>())
            .ThrowsAsync(new InvalidOperationException(LeakyMessage));

        var controller = AdminControllerWith(userManagement);

        AssertStandardServerError((await controller.GetUsers(default)).Result);
    }

    /// <summary>Regresyon: bulunamayan kullanıcı 500 değil 404'tür.</summary>
    [Fact]
    public async Task Admin_users_keeps_404_for_missing_user()
    {
        var userManagement = Substitute.For<IUserManagementService>();
        userManagement
            .GetUserAsync(42, Arg.Any<CancellationToken>())
            .Returns(ServiceResult<AdminUserDetail>.NotFound("Kullanıcı bulunamadı."));

        var controller = AdminControllerWith(userManagement);

        var response = await controller.GetUser(42, default);

        Assert.IsType<NotFoundObjectResult>(response.Result);
    }

    /* --- AnalysisController -------------------------------------------------- */

    [Fact]
    public async Task Analysis_maps_unexpected_service_failure_to_standard_500()
    {
        var analysis = Substitute.For<ISpatialAnalysisService>();
        analysis
            .CountIntersectionsAsync(Arg.Any<IntersectionAnalysisRequest>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new InvalidOperationException(LeakyMessage));

        var controller = WithHttpContext(new AnalysisController(analysis, NullLogger<AnalysisController>.Instance));

        var response = await controller.CountIntersections(new IntersectionAnalysisRequest(), default);

        AssertStandardServerError(response.Result);
    }

    /// <summary>Regresyon: geçersiz geometry hâlâ 400'dür.</summary>
    [Fact]
    public async Task Analysis_keeps_400_for_invalid_request()
    {
        var analysis = Substitute.For<ISpatialAnalysisService>();
        analysis
            .CountIntersectionsAsync(Arg.Any<IntersectionAnalysisRequest>(), Arg.Any<CancellationToken>())
            .Returns(ServiceResult<IntersectionAnalysisResponse>.Failure("Geçersiz poligon."));

        var controller = WithHttpContext(new AnalysisController(analysis, NullLogger<AnalysisController>.Instance));

        var response = await controller.CountIntersections(new IntersectionAnalysisRequest(), default);

        Assert.IsType<BadRequestObjectResult>(response.Result);
    }

    /* --- DrawingsController --------------------------------------------------
       Referans desen: çizim uçları zaten korunuyordu. Buradaki test diğer
       controller'ların onunla AYNI 500 gövdesini ürettiğini kilitler. */

    [Fact]
    public async Task Drawings_maps_unexpected_service_failure_to_standard_500()
    {
        var drawingService = Substitute.For<IDrawingService>();
        drawingService
            .GetPointsAsync(Arg.Any<CancellationToken>())
            .ThrowsAsync(new InvalidOperationException(LeakyMessage));

        var controller = WithHttpContext(
            new DrawingsController(drawingService, NullLogger<DrawingsController>.Instance));

        AssertStandardServerError((await controller.GetPoints(default)).Result);
    }

    /* --- Yardımcılar --------------------------------------------------------- */

    private static AuthController AuthControllerWith(
        IAuthService? authService = null,
        IAccountService? accountService = null) =>
        WithHttpContext(new AuthController(
            authService ?? Substitute.For<IAuthService>(),
            accountService ?? Substitute.For<IAccountService>(),
            Substitute.For<ITwoFactorService>(),
            Substitute.For<ICurrentUserService>(),
            NullLogger<AuthController>.Instance));

    private static AdminUsersController AdminControllerWith(IUserManagementService userManagement) =>
        WithHttpContext(new AdminUsersController(
            userManagement,
            Substitute.For<ICurrentUserService>(),
            NullLogger<AdminUsersController>.Instance));

    private static TController WithHttpContext<TController>(TController controller)
        where TController : ControllerBase
    {
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { TraceIdentifier = TraceId }
        };

        return controller;
    }

    /// <summary>
    /// Tek tip 500: sabit mesaj + izlenebilir traceId, teknik detay yok.
    /// </summary>
    private static void AssertStandardServerError(IActionResult? result)
    {
        var objectResult = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status500InternalServerError, objectResult.StatusCode);

        var error = Assert.IsType<ApiError>(objectResult.Value);
        Assert.Equal(StatusCodes.Status500InternalServerError, error.StatusCode);
        Assert.Equal("Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.", error.Message);
        Assert.Equal(TraceId, error.TraceId);
        Assert.Empty(error.Errors);

        // Gövdenin tamamı serileştirilip taranır: exception mesajı, bağlantı
        // bilgisi veya stack trace hiçbir alandan sızmamalıdır.
        var body = Serialize(error);
        Assert.DoesNotContain("super-secret", body);
        Assert.DoesNotContain("Npgsql", body);
        Assert.DoesNotContain("InvalidOperationException", body);
        Assert.DoesNotContain("StajProject.Api", body);
    }

    /// <summary>
    /// Türkçe karakterlerin <c>ı</c> gibi kaçışlarla gizlenmemesi için
    /// gevşek encoder kullanılır; aksi hâlde metin taraması yanıltıcı olur.
    /// </summary>
    private static string Serialize(object? value) =>
        JsonSerializer.Serialize(value, new JsonSerializerOptions
        {
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
        });
}
