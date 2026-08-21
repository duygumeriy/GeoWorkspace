using System.Text;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NSubstitute;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

public class AccountFlowRegressionTests
{
    [Fact]
    public async Task Register_confirmation_forgot_reset_and_change_password_flows_remain_operational()
    {
        await using var scope = CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();
        Assert.True((await roles.CreateAsync(new IdentityRole<int>(ApplicationRoles.User))).Succeeded);
        var email = Substitute.For<IEmailSender>();
        var account = new AccountService(
            scope.ServiceProvider.GetRequiredService<AppDbContext>(),
            users,
            email,
            new ClientAppOptions { BaseUrl = "https://client.example.invalid" },
            Substitute.For<ILogger<AccountService>>());

        var registered = await account.RegisterAsync(new RegisterRequest
        {
            Username = "account-regression",
            Email = "account-regression@example.invalid",
            Password = "Initial1Password",
            ConfirmPassword = "Initial1Password"
        });
        Assert.True(registered.Succeeded);
        await email.Received(1).SendAsync(Arg.Any<EmailMessage>(), Arg.Any<CancellationToken>());
        var user = (await users.FindByNameAsync("account-regression"))!;
        Assert.False(user.EmailConfirmed);
        /* Kayıt artık rol ATAMAZ ve hesabı aktifleştirmez: erişim yönetici
           onayında verilir (bkz. AccountApprovalTests). */
        Assert.Empty(await users.GetRolesAsync(user));
        Assert.Equal(AccountStatus.PendingEmailVerification, user.AccountStatus);

        var confirmationToken = await users.GenerateEmailConfirmationTokenAsync(user);
        var confirmed = await account.ConfirmEmailAsync(new ConfirmEmailRequest
        {
            UserId = user.Id,
            Token = Encode(confirmationToken)
        });
        Assert.True(confirmed.Succeeded);
        var afterConfirmation = (await users.FindByIdAsync(user.Id.ToString()))!;
        Assert.True(afterConfirmation.EmailConfirmed);
        Assert.Equal(AccountStatus.PendingApproval, afterConfirmation.AccountStatus);

        var forgot = await account.ForgotPasswordAsync(new ForgotPasswordRequest { Email = user.Email! });
        Assert.True(forgot.Succeeded);
        await email.Received(2).SendAsync(Arg.Any<EmailMessage>(), Arg.Any<CancellationToken>());

        var resetToken = await users.GeneratePasswordResetTokenAsync(user);
        var reset = await account.ResetPasswordAsync(new ResetPasswordRequest
        {
            Email = user.Email!,
            Token = Encode(resetToken),
            NewPassword = "Reset2Password",
            ConfirmPassword = "Reset2Password"
        });
        Assert.True(reset.Succeeded);
        Assert.True(await users.CheckPasswordAsync(user, "Reset2Password"));

        var changed = await account.ChangePasswordAsync(user.Id, new ChangePasswordRequest
        {
            CurrentPassword = "Reset2Password",
            NewPassword = "Changed3Password",
            ConfirmPassword = "Changed3Password"
        });
        Assert.True(changed.Succeeded);
        Assert.True(await users.CheckPasswordAsync(user, "Changed3Password"));
    }

    private static AsyncServiceScope CreateScope()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IDataProtectionProvider>(new EphemeralDataProtectionProvider());
        services.AddDbContext<AppDbContext>(options =>
            options.UseInMemoryDatabase($"account-regression-{Guid.NewGuid():N}"));
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

    private static string Encode(string token) =>
        WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(token));
}
