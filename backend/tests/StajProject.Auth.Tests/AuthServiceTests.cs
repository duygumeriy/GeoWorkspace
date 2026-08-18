using Microsoft.AspNetCore.Identity;
using NSubstitute;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

public class AuthServiceTests
{
    [Fact]
    public async Task Mfa_user_gets_challenge_without_access_token_or_lockout_reset()
    {
        var (service, users, tokens, challenges, user) = CreateService(twoFactorEnabled: true, roles: [ApplicationRoles.User]);
        user.AccessFailedCount = 3;

        var result = await service.LoginAsync(new LoginRequest { Username = user.UserName!, Password = "correct" });

        Assert.True(result.IsSuccess);
        Assert.True(result.Response!.RequiresTwoFactor);
        Assert.Null(result.Response.Token);
        await users.DidNotReceive().ResetAccessFailedCountAsync(user);
        tokens.DidNotReceiveWithAnyArgs().GenerateToken(default, default!, default!, default);
        challenges.Received(1).Create(user.Id, user.SecurityStamp!, TwoFactorChallengePurpose.Verify);
    }

    [Fact]
    public async Task Admin_without_mfa_gets_setup_challenge_without_access_token()
    {
        var (service, _, tokens, challenges, user) = CreateService(twoFactorEnabled: false, roles: [ApplicationRoles.Admin]);

        var result = await service.LoginAsync(new LoginRequest { Username = user.UserName!, Password = "correct" });

        Assert.True(result.IsSuccess);
        Assert.True(result.Response!.RequiresTwoFactorSetup);
        Assert.Null(result.Response.Token);
        tokens.DidNotReceiveWithAnyArgs().GenerateToken(default, default!, default!, default);
        challenges.Received(1).Create(user.Id, user.SecurityStamp!, TwoFactorChallengePurpose.Setup);
    }

    [Fact]
    public async Task Password_only_user_resets_failures_and_receives_pwd_token()
    {
        var (service, users, _, _, user) = CreateService(twoFactorEnabled: false, roles: [ApplicationRoles.User]);
        user.AccessFailedCount = 2;

        var result = await service.LoginAsync(new LoginRequest { Username = user.UserName!, Password = "correct" });

        Assert.True(result.IsSuccess);
        Assert.NotNull(result.Response!.Token);
        await users.Received(1).ResetAccessFailedCountAsync(user);
    }

    [Fact]
    public async Task Wrong_password_increments_identity_lockout_count_and_returns_no_token()
    {
        var (service, users, tokens, _, user) = CreateService(twoFactorEnabled: true, roles: [ApplicationRoles.User]);
        users.CheckPasswordAsync(user, Arg.Any<string>()).Returns(false);

        var result = await service.LoginAsync(new LoginRequest { Username = user.UserName!, Password = "wrong" });

        Assert.False(result.IsSuccess);
        await users.Received(1).AccessFailedAsync(user);
        tokens.DidNotReceiveWithAnyArgs().GenerateToken(default, default!, default!, default);
    }

    /* --- Hesap onay kapısı ----------------------------------------------------
       Bu testlerin ortak noktası: şifre DOĞRU. Yani buradaki her engelleme,
       "yanlış şifre" yolundan değil, hesabın durumundan kaynaklanır — ve
       hiçbirinde access token üretilmez. */

    [Fact]
    public async Task Pending_approval_user_is_blocked_without_access_token_or_challenge()
    {
        var (service, _, tokens, challenges, user) = CreateService(
            twoFactorEnabled: false,
            roles: [],
            status: AccountStatus.PendingApproval,
            isActive: false);

        var result = await service.LoginAsync(new LoginRequest { Username = user.UserName!, Password = "correct" });

        Assert.False(result.IsSuccess);
        Assert.Equal(LoginBlockReason.PendingApproval, result.BlockReason);
        Assert.False(result.RequiresEmailConfirmation);
        tokens.DidNotReceiveWithAnyArgs().GenerateToken(default, default!, default!, default);
        challenges.DidNotReceiveWithAnyArgs().Create(default, default!, default);
    }

    [Fact]
    public async Task Suspended_user_is_blocked_even_with_correct_password()
    {
        var (service, _, tokens, _, user) = CreateService(
            twoFactorEnabled: false,
            roles: [ApplicationRoles.User],
            status: AccountStatus.Suspended,
            isActive: false);

        var result = await service.LoginAsync(new LoginRequest { Username = user.UserName!, Password = "correct" });

        Assert.False(result.IsSuccess);
        Assert.Equal(LoginBlockReason.Suspended, result.BlockReason);
        tokens.DidNotReceiveWithAnyArgs().GenerateToken(default, default!, default!, default);
    }

    [Fact]
    public async Task Rejected_user_is_blocked_even_with_correct_password()
    {
        var (service, _, tokens, _, user) = CreateService(
            twoFactorEnabled: false,
            roles: [],
            status: AccountStatus.Rejected,
            isActive: false);

        var result = await service.LoginAsync(new LoginRequest { Username = user.UserName!, Password = "correct" });

        Assert.False(result.IsSuccess);
        Assert.Equal(LoginBlockReason.Rejected, result.BlockReason);
        tokens.DidNotReceiveWithAnyArgs().GenerateToken(default, default!, default!, default);
    }

    [Fact]
    public async Task Unverified_user_is_blocked_before_the_approval_gate_is_consulted()
    {
        // Doğrulama kapısı önce gelir: durumu ne olursa olsun mesaj
        // "e-postanı doğrula" olmalı, "onay bekliyor" değil.
        var (service, _, tokens, _, user) = CreateService(
            twoFactorEnabled: false,
            roles: [],
            status: AccountStatus.PendingEmailVerification,
            isActive: false);
        user.EmailConfirmed = false;

        var result = await service.LoginAsync(new LoginRequest { Username = user.UserName!, Password = "correct" });

        Assert.False(result.IsSuccess);
        Assert.True(result.RequiresEmailConfirmation);
        Assert.Equal(LoginBlockReason.EmailNotConfirmed, result.BlockReason);
        tokens.DidNotReceiveWithAnyArgs().GenerateToken(default, default!, default!, default);
    }

    [Fact]
    public async Task Approved_mfa_user_still_has_to_complete_the_second_factor()
    {
        // Onay, ikinci faktörün YERİNE GEÇMEZ: onaylı bir MFA hesabı hâlâ
        // token değil, challenge alır.
        var (service, _, tokens, challenges, user) = CreateService(
            twoFactorEnabled: true,
            roles: [ApplicationRoles.User]);

        var result = await service.LoginAsync(new LoginRequest { Username = user.UserName!, Password = "correct" });

        Assert.True(result.IsSuccess);
        Assert.True(result.Response!.RequiresTwoFactor);
        Assert.Null(result.Response.Token);
        tokens.DidNotReceiveWithAnyArgs().GenerateToken(default, default!, default!, default);
        challenges.Received(1).Create(user.Id, user.SecurityStamp!, TwoFactorChallengePurpose.Verify);
    }

    private static (AuthService Service, UserManager<User> Users, ITokenService Tokens, ITwoFactorChallengeService Challenges, User User)
        CreateService(
            bool twoFactorEnabled,
            IList<string> roles,
            AccountStatus status = AccountStatus.Active,
            bool isActive = true)
    {
        var user = new User
        {
            Id = 7,
            UserName = "tester",
            Email = "tester@example.invalid",
            EmailConfirmed = true,
            AccountStatus = status,
            IsActive = isActive,
            LockoutEnabled = true,
            TwoFactorEnabled = twoFactorEnabled,
            SecurityStamp = "stamp"
        };
        var users = IdentityTestFactory.CreateUserManager();
        users.FindByNameAsync(user.UserName).Returns(user);
        users.IsLockedOutAsync(user).Returns(false);
        users.CheckPasswordAsync(user, Arg.Any<string>()).Returns(true);
        users.GetRolesAsync(user).Returns(roles);
        users.GetSecurityStampAsync(user).Returns(user.SecurityStamp!);
        users.ResetAccessFailedCountAsync(user).Returns(IdentityResult.Success);
        users.AccessFailedAsync(user).Returns(IdentityResult.Success);

        var tokens = Substitute.For<ITokenService>();
        tokens.GenerateToken(user.Id, user.UserName, Arg.Any<IEnumerable<string>>(), AuthenticationLevel.Password)
            .Returns(("access-token", DateTime.UtcNow.AddMinutes(10)));
        var challenges = Substitute.For<ITwoFactorChallengeService>();
        challenges.Create(user.Id, user.SecurityStamp!, Arg.Any<TwoFactorChallengePurpose>())
            .Returns("opaque-challenge");

        return (new AuthService(tokens, users, challenges), users, tokens, challenges, user);
    }
}
