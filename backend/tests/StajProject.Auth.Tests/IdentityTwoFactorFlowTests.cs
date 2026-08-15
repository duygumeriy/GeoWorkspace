using System.IdentityModel.Tokens.Jwt;
using System.Reflection;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Authentication;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

public class IdentityTwoFactorFlowTests
{
    private const string InitialPassword = "Correct1Password";
    private const string NewPassword = "Changed2Password";

    [Fact]
    public async Task Optional_user_flow_requires_totp_after_enable_and_recovery_code_is_single_use()
    {
        await using var scope = CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();
        var auth = scope.ServiceProvider.GetRequiredService<IAuthService>();
        var twoFactor = scope.ServiceProvider.GetRequiredService<ITwoFactorService>();
        var user = await CreateUserAsync(users, roles, "optional-user", ApplicationRoles.User);

        var passwordOnly = await auth.LoginAsync(Login(user.UserName!, InitialPassword));
        Assert.NotNull(passwordOnly.Response!.Token);
        Assert.Equal(AuthenticationMethods.Password, ReadAuthenticationMethod(passwordOnly.Response.Token!));

        var setup = await twoFactor.StartSetupAsync(user.Id, new TwoFactorSetupRequest { CurrentPassword = InitialPassword });
        Assert.True(setup.IsSuccess);
        Assert.False((await users.FindByIdAsync(user.Id.ToString()))!.TwoFactorEnabled);

        user = (await users.FindByIdAsync(user.Id.ToString()))!;
        var currentCode = await GenerateFrameworkAuthenticatorCodeAsync(users, user);
        var enabled = await twoFactor.EnableAsync(user.Id, new TwoFactorEnableRequest { Code = currentCode });
        Assert.True(enabled.IsSuccess, enabled.Error);
        Assert.Equal(10, enabled.Value!.RecoveryCodes.Count);
        Assert.True((await users.FindByIdAsync(user.Id.ToString()))!.TwoFactorEnabled);

        Assert.True((await users.AccessFailedAsync(user)).Succeeded);
        Assert.True((await users.AccessFailedAsync(user)).Succeeded);
        Assert.True((await users.AccessFailedAsync(user)).Succeeded);
        var passwordStep = await auth.LoginAsync(Login(user.UserName!, InitialPassword));
        Assert.True(passwordStep.Response!.RequiresTwoFactor);
        Assert.Null(passwordStep.Response.Token);
        Assert.Equal(3, (await users.FindByIdAsync(user.Id.ToString()))!.AccessFailedCount);

        var wrong = await twoFactor.CompleteLoginAsync(new TwoFactorLoginRequest
        {
            ChallengeToken = passwordStep.Response.ChallengeToken!,
            Code = "not-a-code"
        });
        Assert.False(wrong.IsSuccess);
        Assert.Equal(4, (await users.FindByIdAsync(user.Id.ToString()))!.AccessFailedCount);

        var refreshedCode = await GenerateFrameworkAuthenticatorCodeAsync(users, user);
        var completed = await twoFactor.CompleteLoginAsync(new TwoFactorLoginRequest
        {
            ChallengeToken = passwordStep.Response.ChallengeToken!,
            Code = refreshedCode
        });
        Assert.True(completed.IsSuccess);
        Assert.Equal(AuthenticationMethods.MultiFactor, ReadAuthenticationMethod(completed.Value!.Token!));
        Assert.Equal(0, (await users.FindByIdAsync(user.Id.ToString()))!.AccessFailedCount);

        var recoveryCode = enabled.Value.RecoveryCodes[0];
        var recoveryChallenge = (await auth.LoginAsync(Login(user.UserName!, InitialPassword))).Response!.ChallengeToken!;
        var recovered = await twoFactor.CompleteLoginWithRecoveryCodeAsync(new TwoFactorRecoveryLoginRequest
        {
            ChallengeToken = recoveryChallenge,
            RecoveryCode = recoveryCode
        });
        Assert.True(recovered.IsSuccess);
        Assert.Equal(AuthenticationMethods.MultiFactor, ReadAuthenticationMethod(recovered.Value!.Token!));

        var secondChallenge = (await auth.LoginAsync(Login(user.UserName!, InitialPassword))).Response!.ChallengeToken!;
        var replay = await twoFactor.CompleteLoginWithRecoveryCodeAsync(new TwoFactorRecoveryLoginRequest
        {
            ChallengeToken = secondChallenge,
            RecoveryCode = recoveryCode
        });
        Assert.False(replay.IsSuccess);
    }

    [Fact]
    public async Task Recovery_regeneration_invalidates_old_set_and_secure_disable_restores_password_only_login()
    {
        await using var scope = CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();
        var auth = scope.ServiceProvider.GetRequiredService<IAuthService>();
        var twoFactor = scope.ServiceProvider.GetRequiredService<ITwoFactorService>();
        var user = await CreateUserAsync(users, roles, "recovery-user", ApplicationRoles.User);
        var initialCodes = await EnableAsync(users, twoFactor, user);
        var oldUnusedCode = initialCodes[1];
        var totp = await GenerateFrameworkAuthenticatorCodeAsync(users, user);

        var regenerated = await twoFactor.RegenerateRecoveryCodesAsync(user.Id, new RegenerateRecoveryCodesRequest
        {
            CurrentPassword = InitialPassword,
            Code = totp
        });
        Assert.True(regenerated.IsSuccess);
        Assert.Equal(10, regenerated.Value!.RecoveryCodes.Count);

        var oldChallenge = (await auth.LoginAsync(Login(user.UserName!, InitialPassword))).Response!.ChallengeToken!;
        var oldResult = await twoFactor.CompleteLoginWithRecoveryCodeAsync(new TwoFactorRecoveryLoginRequest
        {
            ChallengeToken = oldChallenge,
            RecoveryCode = oldUnusedCode
        });
        Assert.False(oldResult.IsSuccess);

        var newCode = regenerated.Value.RecoveryCodes[0];
        var newChallenge = (await auth.LoginAsync(Login(user.UserName!, InitialPassword))).Response!.ChallengeToken!;
        var newResult = await twoFactor.CompleteLoginWithRecoveryCodeAsync(new TwoFactorRecoveryLoginRequest
        {
            ChallengeToken = newChallenge,
            RecoveryCode = newCode
        });
        Assert.True(newResult.IsSuccess);

        var replayChallenge = (await auth.LoginAsync(Login(user.UserName!, InitialPassword))).Response!.ChallengeToken!;
        var newReplay = await twoFactor.CompleteLoginWithRecoveryCodeAsync(new TwoFactorRecoveryLoginRequest
        {
            ChallengeToken = replayChallenge,
            RecoveryCode = newCode
        });
        Assert.False(newReplay.IsSuccess);

        var disableTotp = await GenerateFrameworkAuthenticatorCodeAsync(users, user);
        var disabled = await twoFactor.DisableAsync(user.Id, new TwoFactorDisableRequest
        {
            CurrentPassword = InitialPassword,
            Code = disableTotp
        });
        Assert.True(disabled.IsSuccess);
        Assert.False((await users.FindByIdAsync(user.Id.ToString()))!.TwoFactorEnabled);

        var nextLogin = await auth.LoginAsync(Login(user.UserName!, InitialPassword));
        Assert.NotNull(nextLogin.Response!.Token);
        Assert.Equal(AuthenticationMethods.Password, ReadAuthenticationMethod(nextLogin.Response.Token!));
    }

    [Fact]
    public async Task Admin_without_mfa_must_bootstrap_before_receiving_admin_mfa_token_and_cannot_disable()
    {
        await using var scope = CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();
        var auth = scope.ServiceProvider.GetRequiredService<IAuthService>();
        var twoFactor = scope.ServiceProvider.GetRequiredService<ITwoFactorService>();
        var admin = await CreateUserAsync(users, roles, "bootstrap-admin", ApplicationRoles.Admin);

        var passwordStep = await auth.LoginAsync(Login(admin.UserName!, InitialPassword));
        Assert.True(passwordStep.Response!.RequiresTwoFactorSetup);
        Assert.Null(passwordStep.Response.Token);

        var setup = await twoFactor.StartBootstrapSetupAsync(new TwoFactorSetupChallengeRequest
        {
            ChallengeToken = passwordStep.Response.ChallengeToken!
        });
        Assert.True(setup.IsSuccess);
        Assert.False((await users.FindByIdAsync(admin.Id.ToString()))!.TwoFactorEnabled);

        admin = (await users.FindByIdAsync(admin.Id.ToString()))!;
        var currentCode = await GenerateFrameworkAuthenticatorCodeAsync(users, admin);
        var completed = await twoFactor.CompleteBootstrapSetupAsync(new TwoFactorLoginRequest
        {
            ChallengeToken = setup.Value!.ChallengeToken!,
            Code = currentCode
        });
        Assert.True(completed.IsSuccess, completed.Error);
        Assert.Equal(10, completed.Value!.RecoveryCodes.Count);
        Assert.Equal(AuthenticationMethods.MultiFactor, ReadAuthenticationMethod(completed.Value.Token));

        var disableCode = await GenerateFrameworkAuthenticatorCodeAsync(users, admin);
        var disable = await twoFactor.DisableAsync(admin.Id, new TwoFactorDisableRequest
        {
            CurrentPassword = InitialPassword,
            Code = disableCode
        });
        Assert.False(disable.IsSuccess);
        Assert.Equal(ServiceErrorKind.Conflict, disable.ErrorKind);

        var nextLogin = await auth.LoginAsync(Login(admin.UserName!, InitialPassword));
        Assert.True(nextLogin.Response!.RequiresTwoFactor);
        Assert.Null(nextLogin.Response.Token);
    }

    [Fact]
    public async Task Promotion_requires_bootstrap_and_password_reset_preserves_existing_mfa()
    {
        await using var scope = CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();
        var auth = scope.ServiceProvider.GetRequiredService<IAuthService>();
        var twoFactor = scope.ServiceProvider.GetRequiredService<ITwoFactorService>();
        var promoted = await CreateUserAsync(users, roles, "promoted-user", ApplicationRoles.User);

        Assert.True((await users.RemoveFromRoleAsync(promoted, ApplicationRoles.User)).Succeeded);
        if (!await roles.RoleExistsAsync(ApplicationRoles.Admin))
        {
            Assert.True((await roles.CreateAsync(new IdentityRole<int>(ApplicationRoles.Admin))).Succeeded);
        }
        Assert.True((await users.AddToRoleAsync(promoted, ApplicationRoles.Admin)).Succeeded);
        var promotedLogin = await auth.LoginAsync(Login(promoted.UserName!, InitialPassword));
        Assert.True(promotedLogin.Response!.RequiresTwoFactorSetup);
        Assert.Null(promotedLogin.Response.Token);

        var promotedSetup = await twoFactor.StartBootstrapSetupAsync(new TwoFactorSetupChallengeRequest
        {
            ChallengeToken = promotedLogin.Response.ChallengeToken!
        });
        Assert.True(promotedSetup.IsSuccess);
        promoted = (await users.FindByIdAsync(promoted.Id.ToString()))!;
        var promotedCode = await GenerateFrameworkAuthenticatorCodeAsync(users, promoted);
        var promotedCompletion = await twoFactor.CompleteBootstrapSetupAsync(new TwoFactorLoginRequest
        {
            ChallengeToken = promotedSetup.Value!.ChallengeToken!,
            Code = promotedCode
        });
        Assert.True(promotedCompletion.IsSuccess, promotedCompletion.Error);
        var promotedJwt = new JwtSecurityTokenHandler().ReadJwtToken(promotedCompletion.Value!.Token);
        Assert.Contains(promotedJwt.Claims, claim => claim.Type == System.Security.Claims.ClaimTypes.Role && claim.Value == ApplicationRoles.Admin);
        Assert.Equal(AuthenticationMethods.MultiFactor, ReadAuthenticationMethod(promotedCompletion.Value.Token));

        var protectedUser = await CreateUserAsync(users, roles, "reset-user", ApplicationRoles.User);
        await EnableAsync(users, twoFactor, protectedUser);
        var resetToken = await users.GeneratePasswordResetTokenAsync(protectedUser);
        Assert.True((await users.ResetPasswordAsync(protectedUser, resetToken, NewPassword)).Succeeded);
        Assert.True((await users.FindByIdAsync(protectedUser.Id.ToString()))!.TwoFactorEnabled);

        var afterReset = await auth.LoginAsync(Login(protectedUser.UserName!, NewPassword));
        Assert.True(afterReset.Response!.RequiresTwoFactor);
        Assert.Null(afterReset.Response.Token);
        protectedUser = (await users.FindByIdAsync(protectedUser.Id.ToString()))!;
        var afterResetCode = await GenerateFrameworkAuthenticatorCodeAsync(users, protectedUser);
        var afterResetCompletion = await twoFactor.CompleteLoginAsync(new TwoFactorLoginRequest
        {
            ChallengeToken = afterReset.Response.ChallengeToken!,
            Code = afterResetCode
        });
        Assert.True(afterResetCompletion.IsSuccess, afterResetCompletion.Error);
        Assert.Equal(AuthenticationMethods.MultiFactor, ReadAuthenticationMethod(afterResetCompletion.Value!.Token!));
    }

    private static AsyncServiceScope CreateScope()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddDataProtection().UseEphemeralDataProtectionProvider();
        services.AddDbContext<AppDbContext>(options =>
            options.UseInMemoryDatabase($"auth-tests-{Guid.NewGuid():N}"));
        services
            .AddIdentityCore<User>(options =>
            {
                options.Password.RequiredLength = 8;
                options.Password.RequireDigit = true;
                options.Password.RequireLowercase = true;
                options.Password.RequireUppercase = true;
                options.Password.RequireNonAlphanumeric = false;
                options.Lockout.AllowedForNewUsers = true;
                options.Lockout.MaxFailedAccessAttempts = 5;
                options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(5);
            })
            .AddRoles<IdentityRole<int>>()
            .AddEntityFrameworkStores<AppDbContext>()
            .AddDefaultTokenProviders();
        services.AddSingleton(new JwtOptions
        {
            Key = "test-only-key-that-is-long-enough-for-hmac-sha256-signing",
            Issuer = "StajProject.Tests",
            Audience = "StajProject.Tests.Client",
            ExpireMinutes = 10
        });
        services.AddSingleton<ITokenService, JwtTokenService>();
        services.AddSingleton<ITwoFactorChallengeService, TwoFactorChallengeService>();
        services.AddScoped<IAuthService, AuthService>();
        services.AddScoped<ITwoFactorService, TwoFactorService>();

        return services.BuildServiceProvider().CreateAsyncScope();
    }

    private static async Task<User> CreateUserAsync(
        UserManager<User> users,
        RoleManager<IdentityRole<int>> roles,
        string username,
        string role)
    {
        if (!await roles.RoleExistsAsync(role))
        {
            Assert.True((await roles.CreateAsync(new IdentityRole<int>(role))).Succeeded);
        }

        var user = new User
        {
            UserName = username,
            Email = $"{username}@example.invalid",
            EmailConfirmed = true,
            IsActive = true
        };
        Assert.True((await users.CreateAsync(user, InitialPassword)).Succeeded);
        Assert.True((await users.AddToRoleAsync(user, role)).Succeeded);
        return user;
    }

    private static async Task<IReadOnlyList<string>> EnableAsync(
        UserManager<User> users,
        ITwoFactorService twoFactor,
        User user)
    {
        var setup = await twoFactor.StartSetupAsync(user.Id, new TwoFactorSetupRequest { CurrentPassword = InitialPassword });
        Assert.True(setup.IsSuccess);
        user = (await users.FindByIdAsync(user.Id.ToString()))!;
        var currentCode = await GenerateFrameworkAuthenticatorCodeAsync(users, user);
        var enabled = await twoFactor.EnableAsync(user.Id, new TwoFactorEnableRequest { Code = currentCode });
        Assert.True(enabled.IsSuccess, enabled.Error);
        return enabled.Value!.RecoveryCodes;
    }

    private static LoginRequest Login(string username, string password) => new()
    {
        Username = username,
        Password = password
    };

    /// <summary>
    /// ASP.NET Core Identity intentionally exposes authenticator verification
    /// but no public current-code generator (the authenticator app normally
    /// owns that side). The test invokes the framework's own internal Base32
    /// decoder and RFC6238 generator so production and tests use exactly the
    /// same implementation; no custom OTP algorithm exists here.
    /// </summary>
    private static async Task<string> GenerateFrameworkAuthenticatorCodeAsync(
        UserManager<User> users,
        User user)
    {
        var key = await users.GetAuthenticatorKeyAsync(user);
        Assert.False(string.IsNullOrWhiteSpace(key));

        var identityAssembly = typeof(UserManager<>).Assembly;
        var base32 = identityAssembly.GetType("Microsoft.AspNetCore.Identity.Base32", throwOnError: true)!;
        var fromBase32 = base32.GetMethod("FromBase32", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static)!;
        var keyBytes = (byte[])fromBase32.Invoke(null, [key])!;
        var rfc6238 = identityAssembly.GetType(
            "Microsoft.AspNetCore.Identity.Rfc6238AuthenticationService",
            throwOnError: true)!;
        var compute = rfc6238.GetMethod("ComputeTotp", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static)!;
        var unixTimestamp = Convert.ToInt64(
            Math.Round((DateTime.UtcNow - DateTime.UnixEpoch).TotalSeconds));
        var timeStep = Convert.ToInt64(unixTimestamp / 30);
        var code = (int)compute.Invoke(null, [keyBytes, (ulong)timeStep, null])!;

        return code.ToString("D6", System.Globalization.CultureInfo.InvariantCulture);
    }

    private static string ReadAuthenticationMethod(string token) =>
        new JwtSecurityTokenHandler()
            .ReadJwtToken(token)
            .Claims
            .Single(claim => claim.Type == AuthenticationMethods.ClaimType)
            .Value;
}
