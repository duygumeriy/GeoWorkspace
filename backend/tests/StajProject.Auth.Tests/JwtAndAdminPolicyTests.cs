using System.IdentityModel.Tokens.Jwt;
using System.Reflection;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
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
    /// Koruma controller seviyesindedir ve yukarıdaki theory policy'nin
    /// kendisini doğrular. Burada eksik olan halka test edilir: yeni action'lar
    /// gerçekten o korumanın ALTINDA mı, yoksa <c>[AllowAnonymous]</c> ile
    /// dışına mı çıkmışlar. Reflection kasıtlıdır — bir action'ın yanlışlıkla
    /// korumasız bırakılması, yalnızca çalışma zamanında fark edilecek bir
    /// hatadır.
    /// </remarks>
    [Theory]
    [InlineData(nameof(AdminUsersController.Approve))]
    [InlineData(nameof(AdminUsersController.Reject))]
    [InlineData(nameof(AdminUsersController.GetAssignableRoles))]
    public void Approval_endpoints_stay_behind_the_admin_mfa_policy(string actionName)
    {
        var controller = typeof(AdminUsersController);

        var policy = controller
            .GetCustomAttributes<AuthorizeAttribute>(inherit: true)
            .Select(attribute => attribute.Policy)
            .SingleOrDefault();

        Assert.Equal(AuthorizationPolicies.AdminMfaRequired, policy);

        var action = controller.GetMethod(actionName);

        Assert.NotNull(action);
        Assert.Empty(action!.GetCustomAttributes<AllowAnonymousAttribute>(inherit: true));
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
