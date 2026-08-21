using System.Reflection;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NSubstitute;
using StajProject.Api.Controllers;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

public class AccountInvitationTests
{
    private const string StrongPassword = "Invited1Password";

    [Fact]
    public async Task Dedicated_token_is_generated_only_for_the_invitation_purpose_and_user()
    {
        await using var scope = CreateScope();
        var users = Users(scope);
        var invited = await CreateInvitedAsync(scope, "purpose", GisRoles.Viewer);
        var other = await CreateInvitedAsync(scope, "purpose-other", GisRoles.Viewer);
        var invitation = await Account(scope).GenerateAccountInvitationAsync(invited.Id);

        Assert.True(invitation.IsSuccess);
        Assert.Equal(invited.Id, invitation.Value!.UserId);

        var raw = Decode(invitation.Value.Token);
        Assert.True(await users.VerifyUserTokenAsync(
            invited,
            TokenOptions.DefaultProvider,
            AccountService.AccountInvitationPurpose,
            raw));
        Assert.False(await users.VerifyUserTokenAsync(
            invited,
            TokenOptions.DefaultProvider,
            "ResetPassword",
            raw));
        Assert.False(await users.VerifyUserTokenAsync(
            other,
            TokenOptions.DefaultProvider,
            AccountService.AccountInvitationPurpose,
            raw));
    }

    [Fact]
    public async Task Valid_activation_sets_own_password_activates_directly_and_preserves_role()
    {
        await using var scope = CreateScope();
        var users = Users(scope);
        var user = await CreateInvitedAsync(scope, "valid", GisRoles.Viewer);
        var account = Account(scope);
        var invitation = (await account.GenerateAccountInvitationAsync(user.Id)).Value!;

        var result = await account.ActivateAccountAsync(Request(invitation));
        var persisted = (await users.FindByIdAsync(user.Id.ToString()))!;

        Assert.True(result.Succeeded);
        Assert.Equal(AccountStatus.Active, persisted.AccountStatus);
        Assert.NotEqual(AccountStatus.PendingApproval, persisted.AccountStatus);
        Assert.True(persisted.EmailConfirmed);
        Assert.True(persisted.IsActive);
        Assert.NotNull(persisted.PasswordHash);
        Assert.True(await users.CheckPasswordAsync(persisted, StrongPassword));
        Assert.Equal([GisRoles.Viewer], await users.GetRolesAsync(persisted));
        Assert.False(persisted.TwoFactorEnabled);

        var reused = await account.ActivateAccountAsync(Request(invitation));
        AssertGenericInvitationFailure(reused);
    }

    [Fact]
    public async Task Activation_uses_the_current_role_and_administrator_mfa_remains_for_login()
    {
        await using var scope = CreateScope();
        var users = Users(scope);
        var user = await CreateInvitedAsync(scope, "role-change", GisRoles.Viewer);
        var account = Account(scope);
        var invitation = (await account.GenerateAccountInvitationAsync(user.Id)).Value!;

        Assert.True((await users.RemoveFromRoleAsync(user, GisRoles.Viewer)).Succeeded);
        await EnsureRoleAsync(scope, GisRoles.Administrator);
        Assert.True((await users.AddToRoleAsync(user, GisRoles.Administrator)).Succeeded);

        var result = await account.ActivateAccountAsync(Request(invitation));
        var persisted = (await users.FindByIdAsync(user.Id.ToString()))!;

        Assert.True(result.Succeeded);
        Assert.Equal([GisRoles.Administrator], await users.GetRolesAsync(persisted));
        Assert.False(persisted.TwoFactorEnabled);
        Assert.Equal(AccountStatus.Active, persisted.AccountStatus);
    }

    [Fact]
    public async Task Tampered_and_malformed_tokens_return_the_same_generic_failure_without_changes()
    {
        await using var scope = CreateScope();
        var users = Users(scope);
        var user = await CreateInvitedAsync(scope, "bad-token", GisRoles.Viewer);
        var account = Account(scope);
        var invitation = (await account.GenerateAccountInvitationAsync(user.Id)).Value!;

        var tampered = await account.ActivateAccountAsync(Request(invitation, invitation.Token + "A"));
        var malformed = await account.ActivateAccountAsync(Request(invitation, "%%%not-base64url%%%"));

        AssertGenericInvitationFailure(tampered);
        AssertGenericInvitationFailure(malformed);
        Assert.Equal(tampered.Message, malformed.Message);
        Assert.Equal(tampered.Errors, malformed.Errors);

        var persisted = (await users.FindByIdAsync(user.Id.ToString()))!;
        AssertPendingPasswordless(persisted);
    }

    [Fact]
    public async Task Token_for_another_user_is_rejected_without_changes()
    {
        await using var scope = CreateScope();
        var users = Users(scope);
        var source = await CreateInvitedAsync(scope, "source", GisRoles.Viewer);
        var target = await CreateInvitedAsync(scope, "target", GisRoles.Viewer);
        var account = Account(scope);
        var invitation = (await account.GenerateAccountInvitationAsync(source.Id)).Value!;

        var result = await account.ActivateAccountAsync(new ActivateAccountRequest
        {
            UserId = target.Id,
            Token = invitation.Token,
            Password = StrongPassword,
            ConfirmPassword = StrongPassword
        });

        AssertGenericInvitationFailure(result);
        AssertPendingPasswordless((await users.FindByIdAsync(target.Id.ToString()))!);
    }

    [Fact]
    public async Task Weak_password_is_rejected_by_identity_and_invitation_state_is_preserved()
    {
        await using var scope = CreateScope();
        var users = Users(scope);
        var user = await CreateInvitedAsync(scope, "weak", GisRoles.Viewer);
        var account = Account(scope);
        var invitation = (await account.GenerateAccountInvitationAsync(user.Id)).Value!;

        var result = await account.ActivateAccountAsync(new ActivateAccountRequest
        {
            UserId = user.Id,
            Token = invitation.Token,
            Password = "weak",
            ConfirmPassword = "weak"
        });

        Assert.False(result.Succeeded);
        Assert.Contains(result.Errors, error => error.Contains("8", StringComparison.Ordinal));
        AssertPendingPasswordless((await users.FindByIdAsync(user.Id.ToString()))!);
    }

    [Fact]
    public async Task Wrong_account_states_cannot_generate_or_accept_an_invitation()
    {
        await using var scope = CreateScope();
        var users = Users(scope);
        var account = Account(scope);

        foreach (var mutation in new[] { "deleted", "active", "confirmed", "password", "wrong-status" })
        {
            var user = await CreateInvitedAsync(scope, $"state-{mutation}", GisRoles.Viewer);
            var invitation = (await account.GenerateAccountInvitationAsync(user.Id)).Value!;

            switch (mutation)
            {
                case "deleted": user.IsDeleted = true; break;
                case "active": user.IsActive = true; break;
                case "confirmed": user.EmailConfirmed = true; break;
                case "password":
                    Assert.True((await users.AddPasswordAsync(user, StrongPassword)).Succeeded);
                    break;
                default: user.AccountStatus = AccountStatus.PendingApproval; break;
            }

            if (mutation != "password")
            {
                Assert.True((await users.UpdateAsync(user)).Succeeded);
            }

            Assert.False((await account.GenerateAccountInvitationAsync(user.Id)).IsSuccess);
            AssertGenericInvitationFailure(await account.ActivateAccountAsync(Request(invitation)));
        }
    }

    [Fact]
    public async Task Missing_or_legacy_role_prevents_generation_and_activation()
    {
        await using var scope = CreateScope();
        var users = Users(scope);
        var account = Account(scope);
        var noRole = await CreateInvitedAsync(scope, "no-role", GisRoles.Viewer);
        var noRoleInvitation = (await account.GenerateAccountInvitationAsync(noRole.Id)).Value!;
        Assert.True((await users.RemoveFromRoleAsync(noRole, GisRoles.Viewer)).Succeeded);

        Assert.False((await account.GenerateAccountInvitationAsync(noRole.Id)).IsSuccess);
        AssertGenericInvitationFailure(await account.ActivateAccountAsync(Request(noRoleInvitation)));

        var legacy = await CreateInvitedAsync(scope, "legacy", ApplicationRoles.Admin);
        Assert.False((await account.GenerateAccountInvitationAsync(legacy.Id)).IsSuccess);
    }

    [Fact]
    public async Task Public_endpoint_is_anonymous_thin_and_returns_no_sensitive_authority_fields()
    {
        var method = typeof(AuthController).GetMethod(nameof(AuthController.ActivateAccount));
        Assert.NotNull(method);
        Assert.NotNull(method!.GetCustomAttribute<AllowAnonymousAttribute>());
        var route = method.GetCustomAttribute<HttpPostAttribute>();
        Assert.Equal("activate-account", route!.Template);

        var account = Substitute.For<IAccountService>();
        account.ActivateAccountAsync(Arg.Any<ActivateAccountRequest>(), Arg.Any<CancellationToken>())
            .Returns(
                AccountResult.Success("Hesabınız etkinleştirildi."),
                AccountResult.Failure(
                    "Davet bağlantısı geçersiz veya süresi dolmuş.",
                    "Bağlantı geçersiz."),
                AccountResult.Failure(
                    "Hesap etkinleştirilemedi.",
                    "Şifre en az 8 karakter olmalıdır."));
        var controller = new AuthController(
            Substitute.For<IAuthService>(),
            account,
            Substitute.For<ITwoFactorService>(),
            Substitute.For<ICurrentUserService>(),
            Substitute.For<IEffectivePermissionService>(),
            Substitute.For<IGeographicAuthorizationService>(),
            Substitute.For<ILogger<AuthController>>());

        var response = await controller.ActivateAccount(new ActivateAccountRequest(), default);
        var ok = Assert.IsType<OkObjectResult>(response);
        var invalid = Assert.IsType<BadRequestObjectResult>(
            await controller.ActivateAccount(new ActivateAccountRequest(), default));
        var weak = Assert.IsType<BadRequestObjectResult>(
            await controller.ActivateAccount(new ActivateAccountRequest(), default));
        var body = JsonSerializer.Serialize(new[] { ok.Value, invalid.Value, weak.Value });
        Assert.DoesNotContain("Token", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("PasswordHash", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("SecurityStamp", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Role", body, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Davet", JsonSerializer.Serialize(invalid.Value), StringComparison.Ordinal);
        Assert.Contains("8", JsonSerializer.Serialize(weak.Value), StringComparison.Ordinal);
        await account.Received(3).ActivateAccountAsync(Arg.Any<ActivateAccountRequest>(), default);
    }

    private static AccountService Account(AsyncServiceScope scope) => new(
        scope.ServiceProvider.GetRequiredService<AppDbContext>(),
        Users(scope),
        Substitute.For<IEmailSender>(),
        new ClientAppOptions { BaseUrl = "https://client.example.invalid" },
        Substitute.For<ILogger<AccountService>>());

    private static UserManager<User> Users(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<UserManager<User>>();

    private static async Task<User> CreateInvitedAsync(
        AsyncServiceScope scope,
        string username,
        string role)
    {
        var users = Users(scope);
        await EnsureRoleAsync(scope, role);

        var user = new User
        {
            UserName = username,
            Email = $"{username}@example.invalid",
            EmailConfirmed = false,
            IsActive = false,
            IsDeleted = false,
            AccountStatus = AccountStatus.InvitationPending
        };
        Assert.True((await users.CreateAsync(user)).Succeeded);
        Assert.True((await users.AddToRoleAsync(user, role)).Succeeded);
        return user;
    }

    private static async Task EnsureRoleAsync(AsyncServiceScope scope, string role)
    {
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();
        if (!await roles.RoleExistsAsync(role))
        {
            Assert.True((await roles.CreateAsync(new IdentityRole<int>(role))).Succeeded);
        }
    }

    private static ActivateAccountRequest Request(AccountInvitationToken invitation, string? token = null) => new()
    {
        UserId = invitation.UserId,
        Token = token ?? invitation.Token,
        Password = StrongPassword,
        ConfirmPassword = StrongPassword
    };

    private static void AssertPendingPasswordless(User user)
    {
        Assert.Equal(AccountStatus.InvitationPending, user.AccountStatus);
        Assert.False(user.EmailConfirmed);
        Assert.False(user.IsActive);
        Assert.Null(user.PasswordHash);
    }

    private static void AssertGenericInvitationFailure(AccountResult result)
    {
        Assert.False(result.Succeeded);
        Assert.Equal("Davet bağlantısı geçersiz veya süresi dolmuş.", result.Message);
        Assert.Single(result.Errors);
    }

    private static string Decode(string token) =>
        Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(token));

    private static AsyncServiceScope CreateScope()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IDataProtectionProvider>(new EphemeralDataProtectionProvider());
        services.AddDbContext<AppDbContext>(options =>
            options
                .UseInMemoryDatabase($"account-invitation-{Guid.NewGuid():N}")
                .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning)));
        services
            .AddIdentityCore<User>(options =>
            {
                options.Password.RequiredLength = 8;
                options.Password.RequireDigit = true;
                options.Password.RequireLowercase = true;
                options.Password.RequireUppercase = true;
                options.Password.RequireNonAlphanumeric = false;
            })
            .AddRoles<IdentityRole<int>>()
            .AddEntityFrameworkStores<AppDbContext>()
            .AddDefaultTokenProviders();

        return services.BuildServiceProvider().CreateAsyncScope();
    }
}
