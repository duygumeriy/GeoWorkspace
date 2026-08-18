using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.Extensions.Options;
using NSubstitute;
using StajProject.Api.Authorization;
using StajProject.Api.Controllers;
using StajProject.Application.Common;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;

namespace StajProject.Auth.Tests;

/// <summary>
/// Yetkilendirme altyapısının parçaları: requirement, policy sağlayıcı ve
/// handler.
/// </summary>
public class PermissionAuthorizationTests
{
    /* --- Requirement ----------------------------------------------------------- */

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void A_requirement_cannot_be_built_without_a_permission_code(string? code)
    {
        // Kodsuz bir yetki gereksinimi anlamsızdır; programlama hatası olarak yakalanır.
        Assert.Throws<ArgumentException>(() => new PermissionRequirement(code!));
    }

    /* --- Policy sağlayıcı ------------------------------------------------------ */

    [Fact]
    public async Task The_provider_builds_a_policy_for_its_own_prefix()
    {
        var provider = CreateProvider();

        var policy = await provider.GetPolicyAsync(PermissionPolicyProvider.PolicyPrefix + PermissionCodes.DrawingsView);

        Assert.NotNull(policy);
        var requirement = policy!.Requirements.OfType<PermissionRequirement>().Single();
        Assert.Equal(PermissionCodes.DrawingsView, requirement.PermissionCode);

        // Kimlik doğrulaması da şarttır; anonim istek 401 alsın diye.
        Assert.Contains(policy.Requirements, r => r is DenyAnonymousAuthorizationRequirement);
    }

    [Fact]
    public async Task The_provider_builds_a_policy_for_an_unknown_permission_code_instead_of_throwing()
    {
        var provider = CreateProvider();

        /* Katalogda olmayan kod için de geçerli bir politika üretilir. Karar
           handler'a bırakılır ve kimsede olmayan yetki kimseyi geçirmez:
           sonuç 403 olur, "policy bulunamadı" diye 500 DEĞİL. */
        var policy = await provider.GetPolicyAsync(PermissionPolicyProvider.PolicyPrefix + "does.not.exist");

        Assert.NotNull(policy);
        Assert.Equal("does.not.exist", policy!.Requirements.OfType<PermissionRequirement>().Single().PermissionCode);
    }

    [Fact]
    public async Task The_provider_denies_everyone_when_the_prefix_carries_no_code()
    {
        var provider = CreateProvider();
        var policy = await provider.GetPolicyAsync(PermissionPolicyProvider.PolicyPrefix);

        Assert.NotNull(policy);

        // Fail-closed: hiçbir principal geçemez.
        var authorized = await new AuthorizationPolicyEvaluatorStub().EvaluateAsync(policy!, Authenticated("7"));
        Assert.False(authorized);
    }

    [Theory]
    [InlineData(AuthorizationPolicies.AdminMfaRequired)]
    [InlineData(AuthorizationPolicies.AdminOnly)]
    [InlineData(AuthorizationPolicies.MfaRequired)]
    [InlineData(AuthorizationPolicies.AuthenticatedUser)]
    public async Task The_provider_falls_back_for_existing_policies(string policyName)
    {
        // Kritik: yeni sağlayıcı mevcut authorization sistemini bozmamalı.
        var provider = CreateProvider(options =>
        {
            options.AddPolicy(AuthorizationPolicies.AuthenticatedUser, p => p.RequireAuthenticatedUser());
            options.AddPolicy(AuthorizationPolicies.AdminOnly, p => p.RequireRole(ApplicationRoles.Admin));
            options.AddPolicy(AuthorizationPolicies.AdminMfaRequired, p =>
            {
                p.RequireRole(ApplicationRoles.Admin);
                p.RequireAssertion(c => AuthenticationMethods.IsMultiFactor(c.User));
            });
            options.AddPolicy(AuthorizationPolicies.MfaRequired, p =>
                p.RequireAssertion(c => AuthenticationMethods.IsMultiFactor(c.User)));
        });

        var policy = await provider.GetPolicyAsync(policyName);

        Assert.NotNull(policy);
        Assert.Empty(policy!.Requirements.OfType<PermissionRequirement>());
    }

    /* --- Handler --------------------------------------------------------------- */

    [Fact]
    public async Task The_handler_succeeds_when_the_service_reports_the_permission()
    {
        var permissions = Substitute.For<IEffectivePermissionService>();
        permissions.HasPermissionAsync(7, PermissionCodes.DrawingsView, Arg.Any<CancellationToken>()).Returns(true);

        var context = await HandleAsync(permissions, Authenticated("7"), PermissionCodes.DrawingsView);

        Assert.True(context.HasSucceeded);
    }

    [Fact]
    public async Task The_handler_fails_when_the_service_reports_no_permission()
    {
        var permissions = Substitute.For<IEffectivePermissionService>();
        permissions.HasPermissionAsync(7, PermissionCodes.UsersDelete, Arg.Any<CancellationToken>()).Returns(false);

        var context = await HandleAsync(permissions, Authenticated("7"), PermissionCodes.UsersDelete);

        Assert.False(context.HasSucceeded);
    }

    [Fact]
    public async Task The_handler_fails_for_an_anonymous_principal()
    {
        var permissions = Substitute.For<IEffectivePermissionService>();

        var context = await HandleAsync(permissions, new ClaimsPrincipal(new ClaimsIdentity()), PermissionCodes.MapView);

        Assert.False(context.HasSucceeded);
        await permissions.DidNotReceiveWithAnyArgs().HasPermissionAsync(default, default, default);
    }

    [Theory]
    [InlineData("not-a-number")]
    [InlineData("")]
    public async Task The_handler_fails_closed_for_an_unusable_user_id(string rawUserId)
    {
        var permissions = Substitute.For<IEffectivePermissionService>();

        // İstisna fırlatmaz — bir yetki reddi asla 500'e dönüşmemeli.
        var context = await HandleAsync(permissions, Authenticated(rawUserId), PermissionCodes.MapView);

        Assert.False(context.HasSucceeded);
        await permissions.DidNotReceiveWithAnyArgs().HasPermissionAsync(default, default, default);
    }

    [Theory]
    [InlineData(ApplicationRoles.Admin)]
    [InlineData(GisRoles.Administrator)]
    public async Task The_handler_has_no_role_name_bypass(string role)
    {
        var permissions = Substitute.For<IEffectivePermissionService>();
        permissions.HasPermissionAsync(Arg.Any<int>(), Arg.Any<string>(), Arg.Any<CancellationToken>()).Returns(false);

        var identity = new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, "7"), new Claim(ClaimTypes.Role, role)], "test", ClaimTypes.Name, ClaimTypes.Role);

        var context = await HandleAsync(permissions, new ClaimsPrincipal(identity), PermissionCodes.UsersDelete);

        /* Rol adı ne olursa olsun karar servisin cevabıdır. Handler'da bir
           "Admin ise geç" kestirmesi olsaydı bu assert geçmezdi. */
        Assert.False(context.HasSucceeded);
    }

    /* --- Uç → yetki eşlemesi --------------------------------------------------- */

    [Theory]
    [InlineData(nameof(DrawingsController.CreatePoint), PermissionCodes.DrawingsPointCreate)]
    [InlineData(nameof(DrawingsController.CreateLine), PermissionCodes.DrawingsLineCreate)]
    [InlineData(nameof(DrawingsController.CreatePolygon), PermissionCodes.DrawingsPolygonCreate)]
    [InlineData(nameof(DrawingsController.GetPoints), PermissionCodes.DrawingsView)]
    [InlineData(nameof(DrawingsController.GetLines), PermissionCodes.DrawingsView)]
    [InlineData(nameof(DrawingsController.GetPolygons), PermissionCodes.DrawingsView)]
    [InlineData(nameof(DrawingsController.GetDeleted), PermissionCodes.DrawingsView)]
    [InlineData(nameof(DrawingsController.UpdatePointStyle), PermissionCodes.DrawingsStyleUpdate)]
    [InlineData(nameof(DrawingsController.UpdateLineStyle), PermissionCodes.DrawingsStyleUpdate)]
    [InlineData(nameof(DrawingsController.UpdatePolygonStyle), PermissionCodes.DrawingsStyleUpdate)]
    [InlineData(nameof(DrawingsController.DeletePoint), PermissionCodes.DrawingsDelete)]
    [InlineData(nameof(DrawingsController.DeleteLine), PermissionCodes.DrawingsDelete)]
    [InlineData(nameof(DrawingsController.DeletePolygon), PermissionCodes.DrawingsDelete)]
    [InlineData(nameof(DrawingsController.BulkDelete), PermissionCodes.DrawingsDelete)]
    [InlineData(nameof(DrawingsController.BulkStyle), PermissionCodes.DrawingsStyleUpdate)]
    [InlineData(nameof(DrawingsController.Restore), PermissionCodes.DrawingsRestore)]
    public void Each_drawing_action_requires_exactly_its_permission(string actionName, string expectedCode)
    {
        Assert.Equal([expectedCode], RequiredPermissions(typeof(DrawingsController), actionName));
    }

    [Theory]
    [InlineData(nameof(DrawingsController.UpdatePoint))]
    [InlineData(nameof(DrawingsController.UpdateLine))]
    [InlineData(nameof(DrawingsController.UpdatePolygon))]
    public void The_combined_update_action_requires_all_three_update_permissions(string actionName)
    {
        /* Tek çağrı metadata + geometry + stil değiştirebildiği için üçü de
           istenir. Tek bir yetkiye indirgemek, yalnızca ad değiştirebilmesi
           gereken birine geometry değiştirme imkânı verirdi. */
        Assert.Equal(
            [
                PermissionCodes.DrawingsGeometryUpdate,
                PermissionCodes.DrawingsMetadataUpdate,
                PermissionCodes.DrawingsStyleUpdate
            ],
            RequiredPermissions(typeof(DrawingsController), actionName).Order(StringComparer.Ordinal));
    }

    [Fact]
    public void Bulk_create_requires_all_three_create_permissions()
    {
        // Gövde üç türü birden taşıyabilir; statik attribute ayırt edemez.
        Assert.Equal(
            [
                PermissionCodes.DrawingsLineCreate,
                PermissionCodes.DrawingsPointCreate,
                PermissionCodes.DrawingsPolygonCreate
            ],
            RequiredPermissions(typeof(DrawingsController), nameof(DrawingsController.BulkCreate)).Order(StringComparer.Ordinal));
    }

    [Fact]
    public void Analysis_requires_the_inventory_analysis_permission()
    {
        Assert.Equal(
            [PermissionCodes.InventoryAnalysis],
            RequiredPermissions(typeof(AnalysisController), nameof(AnalysisController.CountIntersections)));
    }

    [Fact]
    public void Every_drawing_action_is_permission_protected()
    {
        /* Yeni bir uç eklenip yetkisi unutulursa bu test düşer. Eksik
           korumanın yalnızca çalışma zamanında fark edilmesi kabul edilemez. */
        var unprotected = typeof(DrawingsController)
            .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(m => m.GetCustomAttributes<HttpMethodAttribute>(inherit: true).Any())
            .Where(m => !m.GetCustomAttributes<RequirePermissionAttribute>(inherit: true).Any())
            .Select(m => m.Name)
            .ToArray();

        Assert.Empty(unprotected);
    }

    /* --- Yardımcılar ----------------------------------------------------------- */

    private static string[] RequiredPermissions(Type controller, string actionName)
    {
        var action = controller.GetMethod(actionName);
        Assert.NotNull(action);

        return [.. action!.GetCustomAttributes<RequirePermissionAttribute>(inherit: true)
            .Select(attribute => attribute.PermissionCode)];
    }

    private static ClaimsPrincipal Authenticated(string userId) =>
        new(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, userId)], "test"));

    private static async Task<AuthorizationHandlerContext> HandleAsync(
        IEffectivePermissionService permissions,
        ClaimsPrincipal user,
        string permissionCode)
    {
        var requirement = new PermissionRequirement(permissionCode);
        var context = new AuthorizationHandlerContext([requirement], user, resource: null);

        await new PermissionAuthorizationHandler(permissions).HandleAsync(context);

        return context;
    }

    private static PermissionPolicyProvider CreateProvider(Action<AuthorizationOptions>? configure = null)
    {
        var options = new AuthorizationOptions();
        configure?.Invoke(options);
        return new PermissionPolicyProvider(Options.Create(options));
    }

    /// <summary>
    /// Bir politikanın verilen principal'ı geçirip geçirmediğini, HTTP hattı
    /// kurmadan değerlendirir.
    /// </summary>
    private sealed class AuthorizationPolicyEvaluatorStub
    {
        public async Task<bool> EvaluateAsync(AuthorizationPolicy policy, ClaimsPrincipal user)
        {
            var context = new AuthorizationHandlerContext(policy.Requirements, user, resource: null);

            foreach (var requirement in policy.Requirements.OfType<IAuthorizationHandler>())
            {
                await requirement.HandleAsync(context);
            }

            return context.HasSucceeded;
        }
    }
}
