using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NSubstitute;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

public class AdminUserCreationTests
{
    [Fact]
    public async Task Creates_a_passwordless_inactive_invitation_with_one_canonical_role()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "canonical-creator", GisRoles.Administrator);
        var email = Substitute.For<IEmailSender>();
        var service = Management(scope, email);

        var result = await service.CreateUserAsync(new CreateAdminUserRequest
        {
            Username = "canonical-invite",
            Email = "canonical-invite@example.invalid",
            Role = "viewer"
        }, actor.Id);

        Assert.True(result.IsSuccess);
        Assert.Equal(GisRoles.Viewer, result.Value!.Role);
        Assert.False(result.Value.EmailConfirmed);
        Assert.False(result.Value.IsActive);
        Assert.Equal(AccountStatus.InvitationPending, result.Value.AccountStatus);

        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var created = (await users.FindByNameAsync("canonical-invite"))!;
        Assert.Null(created.PasswordHash);
        Assert.False(created.EmailConfirmed);
        Assert.False(created.IsActive);
        Assert.False(created.IsDeleted);
        Assert.Equal(AccountStatus.InvitationPending, created.AccountStatus);
        Assert.Equal([GisRoles.Viewer], await users.GetRolesAsync(created));

        await email.Received(1).SendAsync(
            Arg.Is<EmailMessage>(message =>
                message.To == created.Email
                && message.Subject == "StajProject hesabınız oluşturuldu"
                && message.ActionUrl != null
                && message.ActionUrl.Contains("/activate-account?", StringComparison.Ordinal)
                && message.ActionUrl.Contains($"userId={created.Id}", StringComparison.Ordinal)
                && message.ActionUrl.Contains("token=", StringComparison.Ordinal)),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Creates_a_passwordless_user_with_an_assignable_custom_role()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "custom-creator", GisRoles.Administrator);
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();
        Assert.True((await roles.CreateAsync(new IdentityRole<int>("Field Reviewer"))).Succeeded);

        var result = await Management(scope).CreateUserAsync(new CreateAdminUserRequest
        {
            Username = "custom-invite",
            Email = "custom-invite@example.invalid",
            Role = "field reviewer"
        }, actor.Id);

        Assert.True(result.IsSuccess);
        Assert.Equal("Field Reviewer", result.Value!.Role);
    }

    [Theory]
    [InlineData("Admin")]
    [InlineData("User")]
    public async Task Retired_roles_cannot_be_selected(string role)
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, $"legacy-{role}", GisRoles.Administrator);

        var result = await Management(scope).CreateUserAsync(new CreateAdminUserRequest
        {
            Username = $"legacy-target-{role}",
            Email = $"legacy-target-{role}@example.invalid",
            Role = role
        }, actor.Id);

        Assert.False(result.IsSuccess);
        Assert.Null(await scope.ServiceProvider.GetRequiredService<UserManager<User>>()
            .FindByNameAsync($"legacy-target-{role}"));
    }

    [Fact]
    public async Task Actor_cannot_create_a_user_in_a_role_it_cannot_grant()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "weak-creator", GisRoles.GisManager);

        var result = await Management(scope).CreateUserAsync(new CreateAdminUserRequest
        {
            Username = "escalation-target",
            Email = "escalation-target@example.invalid",
            Role = GisRoles.Administrator
        }, actor.Id);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
        Assert.Null(await scope.ServiceProvider.GetRequiredService<UserManager<User>>()
            .FindByNameAsync("escalation-target"));
    }

    [Fact]
    public async Task Duplicate_username_returns_a_controlled_conflict()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "duplicate-name-creator", GisRoles.Administrator);
        var email = Substitute.For<IEmailSender>();
        var service = Management(scope, email);
        var request = new CreateAdminUserRequest
        {
            Username = "duplicate-name",
            Email = "duplicate-name-a@example.invalid",
            Role = GisRoles.Viewer
        };
        Assert.True((await service.CreateUserAsync(request, actor.Id)).IsSuccess);

        var duplicate = await service.CreateUserAsync(new CreateAdminUserRequest
        {
            Username = "duplicate-name",
            Email = "duplicate-name-b@example.invalid",
            Role = GisRoles.Viewer
        }, actor.Id);

        Assert.False(duplicate.IsSuccess);
        Assert.Equal(ServiceErrorKind.Conflict, duplicate.ErrorKind);
        await email.Received(1).SendAsync(Arg.Any<EmailMessage>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Invitation_delivery_failure_returns_warning_but_keeps_committed_pending_account()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "smtp-failure-creator", GisRoles.Administrator);
        var email = Substitute.For<IEmailSender>();
        email.SendAsync(Arg.Any<EmailMessage>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromException(new InvalidOperationException("simulated transport failure")));

        var result = await Management(scope, email).CreateUserAsync(new CreateAdminUserRequest
        {
            Username = "smtp-failure-invite",
            Email = "smtp-failure-invite@example.invalid",
            Role = GisRoles.Viewer
        }, actor.Id);

        Assert.True(result.IsSuccess);
        Assert.Equal("Kullanıcı oluşturuldu ancak davet e-postası gönderilemedi.", result.Value!.NotificationWarning);

        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var created = (await users.FindByNameAsync("smtp-failure-invite"))!;
        AssertPendingPasswordless(created);
        Assert.Equal([GisRoles.Viewer], await users.GetRolesAsync(created));
    }

    [Fact]
    public async Task Resend_rotates_stamp_invalidates_old_token_and_sends_a_valid_replacement()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "resend-creator", GisRoles.Administrator);
        var email = Substitute.For<IEmailSender>();
        var service = Management(scope, email);

        var created = await service.CreateUserAsync(new CreateAdminUserRequest
        {
            Username = "resend-target",
            Email = "resend-target@example.invalid",
            Role = GisRoles.Viewer
        }, actor.Id);
        var firstMessage = EmailFrom(email.ReceivedCalls().Single());
        var oldToken = TokenFrom(firstMessage);
        email.ClearReceivedCalls();

        var resent = await service.ResendInvitationAsync(created.Value!.Id);

        Assert.True(resent.IsSuccess);
        Assert.Null(resent.Value!.NotificationWarning);
        var replacement = EmailFrom(email.ReceivedCalls().Single());
        var newToken = TokenFrom(replacement);
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var user = (await users.FindByIdAsync(created.Value.Id.ToString()))!;

        Assert.False(await VerifiesAsync(users, user, oldToken));
        Assert.True(await VerifiesAsync(users, user, newToken));
        AssertPendingPasswordless(user);
    }

    [Fact]
    public async Task Resend_smtp_failure_keeps_account_pending_and_old_token_invalid()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "resend-failure-creator", GisRoles.Administrator);
        var email = Substitute.For<IEmailSender>();
        var service = Management(scope, email);
        var created = await service.CreateUserAsync(new CreateAdminUserRequest
        {
            Username = "resend-failure-target",
            Email = "resend-failure-target@example.invalid",
            Role = GisRoles.Viewer
        }, actor.Id);
        var oldToken = TokenFrom(EmailFrom(email.ReceivedCalls().Single()));
        email.ClearReceivedCalls();
        email.SendAsync(Arg.Any<EmailMessage>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromException(new InvalidOperationException("simulated transport failure")));

        var resent = await service.ResendInvitationAsync(created.Value!.Id);
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var user = (await users.FindByIdAsync(created.Value.Id.ToString()))!;

        Assert.True(resent.IsSuccess);
        Assert.Equal("Yeni davet oluşturuldu ancak davet e-postası gönderilemedi.", resent.Value!.NotificationWarning);
        Assert.False(await VerifiesAsync(users, user, oldToken));
        AssertPendingPasswordless(user);
    }

    [Theory]
    [InlineData(AccountStatus.Active, false, true, false)]
    [InlineData(AccountStatus.PendingApproval, false, false, false)]
    [InlineData(AccountStatus.PendingEmailVerification, false, false, false)]
    [InlineData(AccountStatus.Suspended, false, false, false)]
    [InlineData(AccountStatus.Rejected, false, false, false)]
    [InlineData(AccountStatus.InvitationPending, true, false, false)]
    [InlineData(AccountStatus.InvitationPending, false, true, false)]
    [InlineData(AccountStatus.InvitationPending, false, false, true)]
    public async Task Resend_rejects_invalid_account_state_without_sending(
        AccountStatus status,
        bool deleted,
        bool confirmed,
        bool addPassword)
    {
        await using var scope = await CreateScopeAsync();
        var email = Substitute.For<IEmailSender>();
        var user = await CreateInvitationAsync(scope, $"invalid-{status}-{deleted}-{confirmed}-{addPassword}", GisRoles.Viewer);
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        user.AccountStatus = status;
        user.IsDeleted = deleted;
        user.EmailConfirmed = confirmed;
        user.IsActive = status == AccountStatus.Active;
        Assert.True((await users.UpdateAsync(user)).Succeeded);
        if (addPassword)
        {
            Assert.True((await users.AddPasswordAsync(user, "Added1Password")).Succeeded);
        }

        var result = await Management(scope, email).ResendInvitationAsync(user.Id);

        Assert.False(result.IsSuccess);
        await email.DidNotReceive().SendAsync(Arg.Any<EmailMessage>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Resend_rejects_missing_and_legacy_roles_without_sending()
    {
        await using var scope = await CreateScopeAsync();
        var email = Substitute.For<IEmailSender>();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var noRole = await CreateInvitationAsync(scope, "resend-no-role", GisRoles.Viewer);
        Assert.True((await users.RemoveFromRoleAsync(noRole, GisRoles.Viewer)).Succeeded);
        var legacy = await CreateInvitationAsync(scope, "resend-legacy", ApplicationRoles.Admin);
        var service = Management(scope, email);

        Assert.False((await service.ResendInvitationAsync(noRole.Id)).IsSuccess);
        Assert.False((await service.ResendInvitationAsync(legacy.Id)).IsSuccess);
        await email.DidNotReceive().SendAsync(Arg.Any<EmailMessage>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Duplicate_email_returns_a_controlled_conflict()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "duplicate-email-creator", GisRoles.Administrator);
        var service = Management(scope);
        Assert.True((await service.CreateUserAsync(new CreateAdminUserRequest
        {
            Username = "duplicate-email-a",
            Email = "same-email@example.invalid",
            Role = GisRoles.Viewer
        }, actor.Id)).IsSuccess);

        var duplicate = await service.CreateUserAsync(new CreateAdminUserRequest
        {
            Username = "duplicate-email-b",
            Email = "same-email@example.invalid",
            Role = GisRoles.Viewer
        }, actor.Id);

        Assert.False(duplicate.IsSuccess);
        Assert.Equal(ServiceErrorKind.Conflict, duplicate.ErrorKind);
    }

    [Fact]
    public async Task Failed_role_assignment_never_produces_a_usable_account()
    {
        await using var scope = await CreateScopeAsync();
        var manager = IdentityTestFactory.CreateUserManager();
        User? attempted = null;
        manager.CreateAsync(Arg.Do<User>(user => attempted = user)).Returns(IdentityResult.Success);
        manager.AddToRoleAsync(Arg.Any<User>(), GisRoles.Viewer).Returns(
            IdentityResult.Failed(new IdentityError { Code = "RoleFailure", Description = "role failed" }));

        var roleManagement = Substitute.For<IRoleManagementService>();
        roleManagement.ResolveAssignableRoleAsync(GisRoles.Viewer, 42, Arg.Any<CancellationToken>())
            .Returns(ServiceResult<string>.Success(GisRoles.Viewer));

        var service = new UserManagementService(
            scope.ServiceProvider.GetRequiredService<AppDbContext>(),
            manager,
            roleManagement,
            Substitute.For<IEmailSender>(),
            new ClientAppOptions(),
            Substitute.For<ILogger<UserManagementService>>());

        var result = await service.CreateUserAsync(new CreateAdminUserRequest
        {
            Username = "failed-role",
            Email = "failed-role@example.invalid",
            Role = GisRoles.Viewer
        }, 42);

        Assert.False(result.IsSuccess);
        Assert.NotNull(attempted);
        Assert.False(attempted!.IsActive);
        Assert.False(attempted.EmailConfirmed);
        Assert.Null(attempted.PasswordHash);
        Assert.Equal(AccountStatus.InvitationPending, attempted.AccountStatus);
    }

    [Fact]
    public async Task Self_registration_still_uses_pending_email_verification()
    {
        await using var scope = await CreateScopeAsync();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var account = new AccountService(
            scope.ServiceProvider.GetRequiredService<AppDbContext>(),
            users,
            Substitute.For<IEmailSender>(),
            new ClientAppOptions { BaseUrl = "https://client.example.invalid" },
            Substitute.For<ILogger<AccountService>>());

        var result = await account.RegisterAsync(new RegisterRequest
        {
            Username = "self-register",
            Email = "self-register@example.invalid",
            Password = "Initial1Password",
            ConfirmPassword = "Initial1Password"
        });

        Assert.True(result.Succeeded);
        var user = (await users.FindByNameAsync("self-register"))!;
        Assert.Equal(AccountStatus.PendingEmailVerification, user.AccountStatus);
        Assert.NotNull(user.PasswordHash);
    }

    private static UserManagementService Management(AsyncServiceScope scope, IEmailSender? email = null)
    {
        email ??= Substitute.For<IEmailSender>();
        var account = new AccountService(
            scope.ServiceProvider.GetRequiredService<AppDbContext>(),
            scope.ServiceProvider.GetRequiredService<UserManager<User>>(),
            email,
            new ClientAppOptions { BaseUrl = "https://client.example.invalid" },
            Substitute.For<ILogger<AccountService>>());

        return new UserManagementService(
            scope.ServiceProvider.GetRequiredService<AppDbContext>(),
            scope.ServiceProvider.GetRequiredService<UserManager<User>>(),
            new RoleManagementService(
                scope.ServiceProvider.GetRequiredService<AppDbContext>(),
                scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>(),
                scope.ServiceProvider.GetRequiredService<IEffectivePermissionService>(),
                Substitute.For<ILogger<RoleManagementService>>()),
            email,
            new ClientAppOptions { BaseUrl = "https://client.example.invalid" },
            Substitute.For<ILogger<UserManagementService>>(),
            accountService: account);
    }

    private static async Task<User> CreateInvitationAsync(AsyncServiceScope scope, string username, string role)
    {
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var user = new User
        {
            UserName = username,
            Email = $"{username}@example.invalid",
            AccountStatus = AccountStatus.InvitationPending,
            EmailConfirmed = false,
            IsActive = false
        };
        Assert.True((await users.CreateAsync(user)).Succeeded);
        Assert.True((await users.AddToRoleAsync(user, role)).Succeeded);
        return user;
    }

    private static EmailMessage EmailFrom(NSubstitute.Core.ICall call) =>
        (EmailMessage)call.GetArguments()[0]!;

    private static string TokenFrom(EmailMessage message)
    {
        var query = QueryHelpers.ParseQuery(new Uri(message.ActionUrl!).Query);
        return query["token"].Single()!;
    }

    private static async Task<bool> VerifiesAsync(UserManager<User> users, User user, string encodedToken) =>
        await users.VerifyUserTokenAsync(
            user,
            TokenOptions.DefaultProvider,
            AccountService.AccountInvitationPurpose,
            System.Text.Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(encodedToken)));

    private static void AssertPendingPasswordless(User user)
    {
        Assert.Equal(AccountStatus.InvitationPending, user.AccountStatus);
        Assert.False(user.EmailConfirmed);
        Assert.False(user.IsActive);
        Assert.Null(user.PasswordHash);
    }

    private static async Task<User> CreateActorAsync(AsyncServiceScope scope, string username, string role)
    {
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var actor = new User
        {
            UserName = username,
            Email = $"{username}@example.invalid",
            EmailConfirmed = true,
            IsActive = true,
            AccountStatus = AccountStatus.Active
        };

        Assert.True((await users.CreateAsync(actor, "Str0ng!Password")).Succeeded);
        Assert.True((await users.AddToRoleAsync(actor, role)).Succeeded);
        return actor;
    }

    private static async Task<AsyncServiceScope> CreateScopeAsync()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IDataProtectionProvider>(new EphemeralDataProtectionProvider());
        services.AddDbContext<AppDbContext>(options => options
            .UseInMemoryDatabase($"admin-user-create-{Guid.NewGuid():N}")
            .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning)));
        services.AddIdentityCore<User>(options =>
            {
                options.Password.RequiredLength = 8;
                options.Password.RequireDigit = true;
                options.Password.RequireLowercase = true;
                options.Password.RequireUppercase = true;
                options.Password.RequireNonAlphanumeric = false;
                options.User.RequireUniqueEmail = true;
            })
            .AddRoles<IdentityRole<int>>()
            .AddEntityFrameworkStores<AppDbContext>()
            .AddDefaultTokenProviders();
        services.AddScoped<IEffectivePermissionService, EffectivePermissionService>();

        var scope = services.BuildServiceProvider().CreateAsyncScope();
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();
        foreach (var retired in ApplicationRoles.Retired)
        {
            Assert.True((await roles.CreateAsync(new IdentityRole<int>(retired))).Succeeded);
        }

        await AuthorizationDataSeeder.SeedAsync(
            scope.ServiceProvider.GetRequiredService<AppDbContext>(),
            roles,
            scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("test"));
        return scope;
    }
}
