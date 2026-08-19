using System.IdentityModel.Tokens.Jwt;
using System.Reflection;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using StajProject.Api.Authorization;
using StajProject.Api.Controllers;
using StajProject.Application.Common;
using StajProject.Domain.Common;
using StajProject.Infrastructure.Authentication;

namespace StajProject.Auth.Tests;

public class JwtAndAdminPolicyTests
{
    private static readonly JwtOptions JwtOptions = new()
    {
        Key = "test-only-key-that-is-long-enough-for-hmac-sha256-signing",
        Issuer = "StajProject.Tests",
        Audience = "StajProject.Tests.Client",
        ExpireMinutes = 10
    };

    [Theory]
    [InlineData(AuthenticationLevel.Password, AuthenticationMethods.Password)]
    [InlineData(AuthenticationLevel.MultiFactor, AuthenticationMethods.MultiFactor)]
    public void Jwt_records_the_server_selected_authentication_method(
        AuthenticationLevel level,
        string expectedMethod)
    {
        var service = new JwtTokenService(JwtOptions);
        var (token, _) = service.GenerateToken(7, "tester", [ApplicationRoles.Admin], level);
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token);

        Assert.Contains(jwt.Claims, claim => claim.Type == AuthenticationMethods.ClaimType && claim.Value == expectedMethod);
        Assert.Contains(jwt.Claims, claim => claim.Type == ClaimTypes.Role && claim.Value == ApplicationRoles.Admin);
    }

    [Fact]
    public void Opaque_challenge_cannot_be_validated_as_an_access_jwt()
    {
        var challenges = new TwoFactorChallengeService(new Microsoft.AspNetCore.DataProtection.EphemeralDataProtectionProvider());
        var challenge = challenges.Create(7, "stamp", StajProject.Application.Interfaces.TwoFactorChallengePurpose.Verify);
        var handler = new JwtSecurityTokenHandler();

        Assert.False(handler.CanReadToken(challenge));
        Assert.ThrowsAny<Exception>(() => handler.ValidateToken(challenge, ValidationParameters(), out _));
    }

    [Theory]
    [InlineData(ApplicationRoles.Admin, AuthenticationMethods.MultiFactor, true)]
    [InlineData(ApplicationRoles.Admin, AuthenticationMethods.Password, false)]
    [InlineData(ApplicationRoles.User, AuthenticationMethods.MultiFactor, false)]
    public async Task Admin_policy_requires_both_admin_role_and_mfa(
        string role,
        string authenticationMethod,
        bool expected)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddAuthorization(options =>
            options.AddPolicy(AuthorizationPolicies.AdminMfaRequired, policy =>
            {
                policy.RequireAuthenticatedUser();
                policy.RequireRole(ApplicationRoles.Admin);
                policy.RequireAssertion(context => AuthenticationMethods.IsMultiFactor(context.User));
            }));
        await using var provider = services.BuildServiceProvider();
        var authorization = provider.GetRequiredService<IAuthorizationService>();
        var identity = new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, "7"), new Claim(ClaimTypes.Role, role), new Claim(AuthenticationMethods.ClaimType, authenticationMethod)],
            "test");

        var result = await authorization.AuthorizeAsync(
            new ClaimsPrincipal(identity),
            resource: null,
            AuthorizationPolicies.AdminMfaRequired);

        Assert.Equal(expected, result.Succeeded);
    }

    /// <summary>
    /// Onay/red uçları anonim veya sıradan bir kullanıcıya açılamaz.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Reflection kasıtlıdır: bir action'ın yanlışlıkla korumasız bırakılması
    /// yalnızca çalışma zamanında fark edilecek bir hatadır.
    /// </para>
    /// <para>
    /// <b>Koruma modeli değişti.</b> Controller artık
    /// <see cref="AuthorizationPolicies.AdminMfaRequired"/> yerine
    /// <see cref="AuthorizationPolicies.MfaRequired"/> kullanır ve her action
    /// kendi yetkisini ayrıca ister. MFA şartı DÜŞMEDİ — aynı <c>amr</c>
    /// kanıtına bakılır; kaldırılan tek şey legacy <c>Admin</c> rol adı
    /// bağıdır. Aksi hâlde 29 yetkinin tamamına sahip bir
    /// <c>Administrator</c> kullanıcısı sırf adı yüzünden engellenirdi.
    /// </para>
    /// </remarks>
    [Theory]
    [InlineData(nameof(AdminUsersController.Approve), PermissionCodes.UsersUpdate)]
    [InlineData(nameof(AdminUsersController.Reject), PermissionCodes.UsersUpdate)]
    [InlineData(nameof(AdminUsersController.GetAssignableRoles), PermissionCodes.RolesView)]
    [InlineData(nameof(AdminUsersController.GetUsers), PermissionCodes.UsersView)]
    [InlineData(nameof(AdminUsersController.GetUser), PermissionCodes.UsersView)]
    [InlineData(nameof(AdminUsersController.ChangeRole), PermissionCodes.UsersUpdate)]
    [InlineData(nameof(AdminUsersController.ChangeStatus), PermissionCodes.UsersUpdate)]
    public void Approval_endpoints_stay_behind_mfa_and_require_a_permission(
        string actionName,
        string expectedPermission)
    {
        var controller = typeof(AdminUsersController);

        var policy = controller
            .GetCustomAttributes<AuthorizeAttribute>(inherit: true)
            .Select(attribute => attribute.Policy)
            .SingleOrDefault();

        Assert.Equal(AuthorizationPolicies.MfaRequired, policy);

        var action = controller.GetMethod(actionName);

        Assert.NotNull(action);
        Assert.Empty(action!.GetCustomAttributes<AllowAnonymousAttribute>(inherit: true));

        var permissions = action
            .GetCustomAttributes<RequirePermissionAttribute>(inherit: true)
            .Select(attribute => attribute.PermissionCode)
            .ToArray();

        Assert.Equal([expectedPermission], permissions);
    }

    /// <summary>
    /// Rol adı bağı gerçekten koptu mu: MfaRequired, legacy <c>Admin</c> rolü
    /// olmayan ama MFA'sını tamamlamış bir kullanıcıyı da geçirmelidir.
    /// </summary>
    [Theory]
    [InlineData(GisRoles.Administrator, AuthenticationMethods.MultiFactor, true)]
    [InlineData(ApplicationRoles.Admin, AuthenticationMethods.MultiFactor, true)]
    [InlineData(GisRoles.Viewer, AuthenticationMethods.MultiFactor, true)]
    [InlineData(ApplicationRoles.Admin, AuthenticationMethods.Password, false)]
    [InlineData(GisRoles.Administrator, AuthenticationMethods.Password, false)]
    public async Task Mfa_policy_checks_the_second_factor_and_not_the_role_name(
        string role,
        string authenticationMethod,
        bool expected)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddAuthorization(options =>
            options.AddPolicy(AuthorizationPolicies.MfaRequired, policy =>
            {
                policy.RequireAuthenticatedUser();
                policy.RequireAssertion(context => AuthenticationMethods.IsMultiFactor(context.User));
            }));
        await using var provider = services.BuildServiceProvider();
        var authorization = provider.GetRequiredService<IAuthorizationService>();
        var identity = new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, "7"), new Claim(ClaimTypes.Role, role), new Claim(AuthenticationMethods.ClaimType, authenticationMethod)],
            "test");

        var result = await authorization.AuthorizeAsync(
            new ClaimsPrincipal(identity),
            resource: null,
            AuthorizationPolicies.MfaRequired);

        /* Policy YETKİ kontrol etmez; yalnızca ikinci faktörü doğrular. Viewer
           da geçer — onu yönetim uçlarından uzak tutan şey RequirePermission'dır.
           İki boyut bilinçli olarak ayrıdır. */
        Assert.Equal(expected, result.Succeeded);
    }

    private static TokenValidationParameters ValidationParameters() => new()
    {
        ValidateIssuer = true,
        ValidIssuer = JwtOptions.Issuer,
        ValidateAudience = true,
        ValidAudience = JwtOptions.Audience,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(JwtOptions.Key)),
        ClockSkew = TimeSpan.Zero
    };
}
