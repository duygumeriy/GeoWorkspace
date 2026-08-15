using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using NSubstitute;
using StajProject.Domain.Entities;

namespace StajProject.Auth.Tests;

internal static class IdentityTestFactory
{
    public static UserManager<User> CreateUserManager(IdentityOptions? identityOptions = null)
    {
        var store = Substitute.For<IUserStore<User>>();
        var options = Options.Create(identityOptions ?? new IdentityOptions());
        var passwordHasher = Substitute.For<IPasswordHasher<User>>();
        var userValidators = Array.Empty<IUserValidator<User>>();
        var passwordValidators = Array.Empty<IPasswordValidator<User>>();
        var normalizer = Substitute.For<ILookupNormalizer>();
        var errors = new IdentityErrorDescriber();
        var services = Substitute.For<IServiceProvider>();
        var logger = Substitute.For<ILogger<UserManager<User>>>();

        return Substitute.For<UserManager<User>>(
            store,
            options,
            passwordHasher,
            userValidators,
            passwordValidators,
            normalizer,
            errors,
            services,
            logger);
    }
}
