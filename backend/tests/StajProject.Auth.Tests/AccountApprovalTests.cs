using System.Text;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

/// <summary>
/// Kayıt → doğrulama → yönetici onayı zincirinin uçtan uca davranışı.
/// </summary>
/// <remarks>
/// Gerçek <see cref="UserManager{TUser}"/>, gerçek Identity token provider'ları
/// ve gerçek servisler kullanılır; yalnızca veritabanı (in-memory) ve e-posta
/// gönderimi (substitute) değiştirilir. Böylece testler "hangi metot çağrıldı"
/// yerine <b>hesabın gerçekten hangi duruma geldiğini</b> doğrular.
/// </remarks>
public class AccountApprovalTests
{
    private const int ApproverId = 1;

    /* --- Kayıt ve doğrulama --------------------------------------------------- */

    [Fact]
    public async Task Register_creates_an_inactive_unapproved_user_without_a_role()
    {
        await using var scope = CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();

        var user = await RegisterAsync(scope, "pending-user");

        Assert.False(user.EmailConfirmed);
        Assert.False(user.IsActive);
        Assert.Equal(AccountStatus.PendingEmailVerification, user.AccountStatus);
        // Kayıt hiçbir rol vermez: erişim yöneticinin kararıdır.
        Assert.Empty(await users.GetRolesAsync(user));
    }

    [Fact]
    public async Task Email_confirmation_moves_the_user_to_pending_approval_not_into_the_application()
    {
        await using var scope = CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();

        var user = await RegisterAsync(scope, "confirming-user");
        var result = await ConfirmEmailAsync(scope, user);

        Assert.True(result.Succeeded);
        Assert.Contains("yönetici onayı", result.Message);

        var reloaded = (await users.FindByIdAsync(user.Id.ToString()))!;
        Assert.True(reloaded.EmailConfirmed);
        Assert.Equal(AccountStatus.PendingApproval, reloaded.AccountStatus);
        Assert.False(reloaded.IsActive);
        Assert.Empty(await users.GetRolesAsync(reloaded));
    }

    [Fact]
    public async Task Repeated_confirmation_is_idempotent_and_reports_the_current_state()
    {
        await using var scope = CreateScope();

        var user = await RegisterAsync(scope, "double-clicker");
        await ConfirmEmailAsync(scope, user);

        // Kullanıcı bağlantıya ikinci kez tıkladı: hata değil, aynı bilgi.
        var second = await ConfirmEmailAsync(scope, user);

        Assert.True(second.Succeeded);
        Assert.Contains("yönetici onayı", second.Message);
    }

    /* --- Onayın reddedildiği durumlar ----------------------------------------- */

    [Fact]
    public async Task Unverified_user_cannot_be_approved()
    {
        await using var scope = CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var management = CreateManagement(scope, out _);

        var user = await RegisterAsync(scope, "unverified");

        var result = await management.ApproveAsync(
            user.Id,
            new ApproveUserRequest { Role = GisRoles.GisEditor },
            ApproverId);

        Assert.False(result.IsSuccess);
        var reloaded = (await users.FindByIdAsync(user.Id.ToString()))!;
        Assert.Equal(AccountStatus.PendingEmailVerification, reloaded.AccountStatus);
        Assert.False(reloaded.IsActive);
        Assert.Empty(await users.GetRolesAsync(reloaded));
    }

    /// <summary>
    /// Var olmayan roller ve geçiş dönemi rolleri onayda reddedilir.
    /// </summary>
    /// <remarks>
    /// <c>"GIS Manager"</c> vakası bilinçli olarak KALDIRILDI: hedef GIS
    /// rolleri artık atanabilir ve bunu sağlamak Phase 4'ün amacıdır. Yerine
    /// legacy <c>Admin</c>/<c>User</c> eklendi — bunlar mevcut kullanıcılarda
    /// geçerli kalmaya devam eder ama YENİ onaylarda kullanılamaz.
    /// </remarks>
    [Theory]
    [InlineData("")]
    [InlineData("SuperAdmin")]
    [InlineData(ApplicationRoles.Admin)]
    [InlineData(ApplicationRoles.User)]
    public async Task Approval_rejects_roles_the_server_does_not_recognise(string role)
    {
        await using var scope = CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var management = CreateManagement(scope, out _);

        var user = await RegisterAndConfirmAsync(scope, "invalid-role");

        var result = await management.ApproveAsync(user.Id, new ApproveUserRequest { Role = role }, ApproverId);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
        var reloaded = (await users.FindByIdAsync(user.Id.ToString()))!;
        Assert.Equal(AccountStatus.PendingApproval, reloaded.AccountStatus);
        Assert.False(reloaded.IsActive);
    }

    [Fact]
    public async Task Approving_an_already_active_user_fails_safely_without_touching_the_account()
    {
        await using var scope = CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var management = CreateManagement(scope, out _);

        var user = await RegisterAndConfirmAsync(scope, "double-approved");
        Assert.True((await management.ApproveAsync(user.Id, Approve(GisRoles.GisEditor), ApproverId)).IsSuccess);

        var approvedAt = (await users.FindByIdAsync(user.Id.ToString()))!.ApprovedAt;

        // İkinci onay farklı bir rolle geliyor; sessizce uygulanmamalı.
        var second = await management.ApproveAsync(user.Id, Approve(GisRoles.Administrator), actingUserId: 42);

        Assert.False(second.IsSuccess);
        Assert.Equal(ServiceErrorKind.Conflict, second.ErrorKind);
        var reloaded = (await users.FindByIdAsync(user.Id.ToString()))!;
        Assert.Equal(approvedAt, reloaded.ApprovedAt);
        Assert.Equal(ApproverId, reloaded.ApprovedByUserId);
        Assert.True(await users.IsInRoleAsync(reloaded, GisRoles.GisEditor));
        Assert.False(await users.IsInRoleAsync(reloaded, GisRoles.Administrator));
    }

    [Fact]
    public async Task Rejected_user_cannot_be_approved_by_accident()
    {
        await using var scope = CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var management = CreateManagement(scope, out _);

        var user = await RegisterAndConfirmAsync(scope, "rejected-then-approved");
        Assert.True((await management.RejectAsync(user.Id, new RejectUserRequest(), ApproverId)).IsSuccess);

        var result = await management.ApproveAsync(user.Id, Approve(GisRoles.GisEditor), ApproverId);

        Assert.False(result.IsSuccess);
        var reloaded = (await users.FindByIdAsync(user.Id.ToString()))!;
        Assert.Equal(AccountStatus.Rejected, reloaded.AccountStatus);
        Assert.False(reloaded.IsActive);
        Assert.Empty(await users.GetRolesAsync(reloaded));
    }

    [Fact]
    public async Task Deleted_user_cannot_be_approved()
    {
        await using var scope = CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var management = CreateManagement(scope, out _);

        var user = await RegisterAndConfirmAsync(scope, "soft-deleted");
        user.IsDeleted = true;
        Assert.True((await users.UpdateAsync(user)).Succeeded);

        var result = await management.ApproveAsync(user.Id, Approve(GisRoles.GisEditor), ApproverId);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.NotFound, result.ErrorKind);
    }

    /// <summary>
    /// Rol ataması başarısız olursa hesap aktifleşmez.
    /// </summary>
    /// <remarks>
    /// Doğrulanan şey işlem SIRASIDIR: rol önce atanır, aktifleştirme ve onay
    /// metadata'sı yalnızca atama başarılıysa yazılır. PostgreSQL'de bunun
    /// üstüne bir de transaction gelir; in-memory sağlayıcı transaction
    /// yürütmediği için burada garantinin sıraya dayanan yarısı test edilir —
    /// yani "aktif ama rolsüz" hesap, rollback olmasa bile oluşmaz.
    /// </remarks>
    [Fact]
    public async Task Failed_role_assignment_does_not_leave_a_partially_activated_user()
    {
        await using var scope = CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var email = Substitute.For<IEmailSender>();

        var user = await RegisterAndConfirmAsync(scope, "role-failure");

        var management = new UserManagementService(
            scope.ServiceProvider.GetRequiredService<AppDbContext>(),
            new RoleAssignmentFailsUserManager(scope.ServiceProvider),
            RoleManagement(scope),
            email,
            ClientApp,
            Substitute.For<ILogger<UserManagementService>>());

        var result = await management.ApproveAsync(user.Id, Approve(GisRoles.GisEditor), ApproverId);

        Assert.False(result.IsSuccess);
        var reloaded = (await users.FindByIdAsync(user.Id.ToString()))!;
        Assert.Equal(AccountStatus.PendingApproval, reloaded.AccountStatus);
        Assert.False(reloaded.IsActive);
        Assert.Null(reloaded.ApprovedAt);
        Assert.Null(reloaded.ApprovedByUserId);
        Assert.Empty(await users.GetRolesAsync(reloaded));
        // Onay gerçekleşmediği için "hesabınız onaylandı" e-postası da gitmez.
        await email.DidNotReceive().SendAsync(Arg.Any<EmailMessage>(), Arg.Any<CancellationToken>());
    }

    /// <summary>
    /// Rol atamasının başarısız olduğu senaryoyu üretir.
    /// </summary>
    /// <remarks>
    /// Substitute yerine gerçek <see cref="UserManager{TUser}"/> türetilir:
    /// servisin kullanıcıyı <c>Users</c> üzerinden async sorguyla bulması
    /// gerekir ve bu, ancak EF destekli gerçek bir sorgu sağlayıcısıyla
    /// çalışır. Yalnızca tek bir metot değiştirilir.
    /// </remarks>
    private sealed class RoleAssignmentFailsUserManager(IServiceProvider services) : UserManager<User>(
        services.GetRequiredService<IUserStore<User>>(),
        services.GetRequiredService<IOptions<IdentityOptions>>(),
        services.GetRequiredService<IPasswordHasher<User>>(),
        services.GetServices<IUserValidator<User>>(),
        services.GetServices<IPasswordValidator<User>>(),
        services.GetRequiredService<ILookupNormalizer>(),
        services.GetRequiredService<IdentityErrorDescriber>(),
        services,
        services.GetRequiredService<ILogger<UserManager<User>>>())
    {
        public override Task<IdentityResult> AddToRoleAsync(User user, string role) =>
            Task.FromResult(IdentityResult.Failed(new IdentityError
            {
                Code = "RoleAssignmentFailed",
                Description = "Rol atanamadı."
            }));
    }

    /* --- Başarılı onay --------------------------------------------------------- */

    [Fact]
    public async Task Successful_approval_assigns_the_role_activates_the_account_and_stores_the_approver()
    {
        await using var scope = CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var management = CreateManagement(scope, out _);

        var user = await RegisterAndConfirmAsync(scope, "approved-user");
        var before = DateTime.UtcNow;

        var result = await management.ApproveAsync(user.Id, Approve(GisRoles.GisEditor), ApproverId);

        Assert.True(result.IsSuccess);
        Assert.Equal(AccountStatus.Active, result.Value!.AccountStatus);
        Assert.Equal(GisRoles.GisEditor, result.Value.Role);
        Assert.Null(result.Value.NotificationWarning);

        var reloaded = (await users.FindByIdAsync(user.Id.ToString()))!;
        Assert.Equal(AccountStatus.Active, reloaded.AccountStatus);
        Assert.True(reloaded.IsActive);
        Assert.True(await users.IsInRoleAsync(reloaded, GisRoles.GisEditor));
        Assert.NotNull(reloaded.ApprovedAt);
        Assert.InRange(reloaded.ApprovedAt!.Value, before, DateTime.UtcNow);
        Assert.Equal(ApproverId, reloaded.ApprovedByUserId);
    }

    [Fact]
    public async Task Approval_email_is_sent_after_activation_and_carries_no_secrets()
    {
        await using var scope = CreateScope();
        var management = CreateManagement(scope, out var email);

        var user = await RegisterAndConfirmAsync(scope, "notified-user");
        await management.ApproveAsync(user.Id, Approve(GisRoles.GisEditor), ApproverId);

        var sent = email.ReceivedCalls()
            .Select(call => call.GetArguments()[0])
            .OfType<EmailMessage>()
            .Last();

        Assert.Equal(user.Email, sent.To);
        Assert.Contains("onayland", sent.Subject, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(GisRoles.GisEditor, sent.Body);
        Assert.EndsWith("/login", sent.ActionUrl!);
        // Ne şifre, ne token, ne kurtarma kodu, ne de yönetici kimliği.
        Assert.DoesNotContain("Password", sent.Body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("token", sent.Body, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Approval_email_failure_does_not_roll_back_the_activation()
    {
        await using var scope = CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var management = CreateManagement(scope, out var email);
        email.SendAsync(Arg.Any<EmailMessage>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new InvalidOperationException("SMTP kapalı"));

        var user = await RegisterAndConfirmAsync(scope, "mail-failure");

        var result = await management.ApproveAsync(user.Id, Approve(GisRoles.GisEditor), ApproverId);

        // İşlem başarısız SAYILMAZ: hesap gerçekten aktifleşti.
        Assert.True(result.IsSuccess);
        Assert.NotNull(result.Value!.NotificationWarning);

        var reloaded = (await users.FindByIdAsync(user.Id.ToString()))!;
        Assert.Equal(AccountStatus.Active, reloaded.AccountStatus);
        Assert.True(reloaded.IsActive);
        Assert.True(await users.IsInRoleAsync(reloaded, GisRoles.GisEditor));
        Assert.NotNull(reloaded.ApprovedAt);
    }

    [Fact]
    public async Task Approved_user_can_complete_a_normal_login()
    {
        await using var scope = CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var management = CreateManagement(scope, out _);

        var user = await RegisterAndConfirmAsync(scope, "logging-in");
        await management.ApproveAsync(user.Id, Approve(GisRoles.GisEditor), ApproverId);

        var tokens = Substitute.For<ITokenService>();
        tokens.GenerateToken(Arg.Any<int>(), Arg.Any<string>(), Arg.Any<IEnumerable<string>>(), Arg.Any<AuthenticationLevel>())
            .Returns(("access-token", DateTime.UtcNow.AddMinutes(10)));
        var auth = new AuthService(tokens, users, Substitute.For<ITwoFactorChallengeService>());

        var login = await auth.LoginAsync(new LoginRequest { Username = user.UserName!, Password = Password });

        Assert.True(login.IsSuccess);
        Assert.Equal("access-token", login.Response!.Token);
    }

    /* --- Reddetme -------------------------------------------------------------- */

    [Fact]
    public async Task Rejection_records_the_decision_and_leaves_the_account_without_access()
    {
        await using var scope = CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var management = CreateManagement(scope, out var email);

        var user = await RegisterAndConfirmAsync(scope, "rejected-user");

        var result = await management.RejectAsync(
            user.Id,
            new RejectUserRequest { Reason = "Kurum dışı başvuru" },
            ApproverId);

        Assert.True(result.IsSuccess);
        var reloaded = (await users.FindByIdAsync(user.Id.ToString()))!;
        Assert.Equal(AccountStatus.Rejected, reloaded.AccountStatus);
        Assert.False(reloaded.IsActive);
        Assert.Equal(ApproverId, reloaded.RejectedByUserId);
        Assert.Equal("Kurum dışı başvuru", reloaded.RejectionReason);
        Assert.Empty(await users.GetRolesAsync(reloaded));

        // Yönetici notu kullanıcıya GİTMEZ.
        var sent = email.ReceivedCalls()
            .Select(call => call.GetArguments()[0])
            .OfType<EmailMessage>()
            .Last();
        Assert.DoesNotContain("Kurum dışı başvuru", sent.Body);
    }

    [Fact]
    public async Task Active_account_cannot_be_rejected()
    {
        await using var scope = CreateScope();
        var management = CreateManagement(scope, out _);

        var user = await RegisterAndConfirmAsync(scope, "active-reject");
        await management.ApproveAsync(user.Id, Approve(GisRoles.GisEditor), ApproverId);

        var result = await management.RejectAsync(user.Id, new RejectUserRequest(), ApproverId);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Conflict, result.ErrorKind);
    }

    /* --- Askıya alma ve geri açma --------------------------------------------- */

    [Fact]
    public async Task Deactivating_an_active_account_suspends_it_and_reactivating_restores_it()
    {
        await using var scope = CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var management = CreateManagement(scope, out _);

        var user = await RegisterAndConfirmAsync(scope, "suspend-cycle");
        await management.ApproveAsync(user.Id, Approve(GisRoles.GisEditor), ApproverId);

        Assert.True((await management.ChangeStatusAsync(user.Id, new UpdateUserStatusRequest { IsActive = false }, ApproverId)).IsSuccess);
        var suspended = (await users.FindByIdAsync(user.Id.ToString()))!;
        Assert.Equal(AccountStatus.Suspended, suspended.AccountStatus);
        Assert.False(suspended.IsActive);
        // Rol korunur: askıya alma bir yetki kaldırma işlemi değildir.
        Assert.True(await users.IsInRoleAsync(suspended, GisRoles.GisEditor));

        Assert.True((await management.ChangeStatusAsync(user.Id, new UpdateUserStatusRequest { IsActive = true }, ApproverId)).IsSuccess);
        var restored = (await users.FindByIdAsync(user.Id.ToString()))!;
        Assert.Equal(AccountStatus.Active, restored.AccountStatus);
        Assert.True(restored.IsActive);
    }

    [Fact]
    public async Task Pending_user_cannot_be_activated_through_the_status_toggle()
    {
        await using var scope = CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var management = CreateManagement(scope, out _);

        var user = await RegisterAndConfirmAsync(scope, "toggle-bypass");

        var result = await management.ChangeStatusAsync(
            user.Id,
            new UpdateUserStatusRequest { IsActive = true },
            ApproverId);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Conflict, result.ErrorKind);
        var reloaded = (await users.FindByIdAsync(user.Id.ToString()))!;
        Assert.Equal(AccountStatus.PendingApproval, reloaded.AccountStatus);
        Assert.False(reloaded.IsActive);
        Assert.Empty(await users.GetRolesAsync(reloaded));
    }

    /* --- Kurulum --------------------------------------------------------------- */

    private const string Password = "Approval1Password";

    private static ApproveUserRequest Approve(string role) => new() { Role = role };

    private static async Task<User> RegisterAsync(AsyncServiceScope scope, string username)
    {
        var account = CreateAccountService(scope, out _);

        var result = await account.RegisterAsync(new RegisterRequest
        {
            Username = username,
            Email = $"{username}@example.invalid",
            Password = Password,
            ConfirmPassword = Password
        });

        Assert.True(result.Succeeded, result.Message);

        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        return (await users.FindByNameAsync(username))!;
    }

    private static async Task<AccountResult> ConfirmEmailAsync(AsyncServiceScope scope, User user)
    {
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var account = CreateAccountService(scope, out _);
        var token = await users.GenerateEmailConfirmationTokenAsync(user);

        return await account.ConfirmEmailAsync(new ConfirmEmailRequest
        {
            UserId = user.Id,
            Token = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(token))
        });
    }

    private static async Task<User> RegisterAndConfirmAsync(AsyncServiceScope scope, string username)
    {
        var user = await RegisterAsync(scope, username);
        Assert.True((await ConfirmEmailAsync(scope, user)).Succeeded);

        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        return (await users.FindByIdAsync(user.Id.ToString()))!;
    }

    private static AccountService CreateAccountService(AsyncServiceScope scope, out IEmailSender email)
    {
        email = Substitute.For<IEmailSender>();

        return new AccountService(
            scope.ServiceProvider.GetRequiredService<UserManager<User>>(),
            email,
            ClientApp,
            Substitute.For<ILogger<AccountService>>());
    }

    /// <summary>
    /// Gerçek rol yönetimi servisi. Onay akışının atanabilir rol kuralını
    /// taklit etmek yerine ÜRETİMDEKİ kuralla doğrulanması için kullanılır.
    /// </summary>
    private static RoleManagementService RoleManagement(AsyncServiceScope scope) =>
        new(
            scope.ServiceProvider.GetRequiredService<AppDbContext>(),
            scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>(),
            scope.ServiceProvider.GetRequiredService<IEffectivePermissionService>(),
            Substitute.For<ILogger<RoleManagementService>>());

    private static UserManagementService CreateManagement(AsyncServiceScope scope, out IEmailSender email)
    {
        email = Substitute.For<IEmailSender>();

        return new UserManagementService(
            scope.ServiceProvider.GetRequiredService<AppDbContext>(),
            scope.ServiceProvider.GetRequiredService<UserManager<User>>(),
            RoleManagement(scope),
            email,
            ClientApp,
            Substitute.For<ILogger<UserManagementService>>());
    }

    private static ClientAppOptions ClientApp => new() { BaseUrl = "https://client.example.invalid" };

    private static AsyncServiceScope CreateScope(IReadOnlyList<string>? seedRoles = null)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IDataProtectionProvider>(new EphemeralDataProtectionProvider());
        services.AddDbContext<AppDbContext>(options => options
            .UseInMemoryDatabase($"account-approval-{Guid.NewGuid():N}")
            /* Servis, PostgreSQL'de gerçek bir transaction açar. In-memory
               sağlayıcı transaction yürütmez ve varsayılan olarak bunu hata
               sayar; uyarı susturularak çağrı no-op'a döner. Atomiklik
               garantisi PostgreSQL'in kendisindedir — burada test edilen,
               servisin işlem sırası ve durum geçişleridir. */
            .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning)));

        services
            .AddIdentityCore<User>(options =>
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

        /* Üretimdeki gibi hem legacy hem hedef roller var olur: Phase 4'te onay
           akışı hedef rolleri kullanır, legacy roller yalnızca mevcut
           kullanıcılar için durmaya devam eder. */
        foreach (var role in seedRoles ?? [.. ApplicationRoles.All, .. GisRoles.All])
        {
            roles.CreateAsync(new IdentityRole<int>(role)).GetAwaiter().GetResult();
        }

        return scope;
    }
}
