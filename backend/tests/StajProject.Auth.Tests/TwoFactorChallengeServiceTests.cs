using System.Globalization;
using System.Text;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.WebUtilities;
using StajProject.Application.Interfaces;
using StajProject.Infrastructure.Authentication;

namespace StajProject.Auth.Tests;

public class TwoFactorChallengeServiceTests
{
    private readonly EphemeralDataProtectionProvider _provider = new();

    [Fact]
    public void Valid_challenge_resolves_only_for_its_purpose_and_user()
    {
        var service = new TwoFactorChallengeService(_provider);
        var token = service.Create(42, "stamp-a", TwoFactorChallengePurpose.Verify);

        var challenge = service.Validate(token, TwoFactorChallengePurpose.Verify);

        Assert.NotNull(challenge);
        Assert.Equal(42, challenge.UserId);
        Assert.Equal("stamp-a", challenge.SecurityStamp);
        Assert.Null(service.Validate(token, TwoFactorChallengePurpose.Setup));
    }

    [Fact]
    public void Modified_challenge_is_rejected()
    {
        var service = new TwoFactorChallengeService(_provider);
        var token = service.Create(42, "stamp-a", TwoFactorChallengePurpose.Verify);
        var mutationIndex = token.Length / 2;
        var replacement = token[mutationIndex] == 'A' ? 'B' : 'A';
        var modified = token[..mutationIndex] + replacement + token[(mutationIndex + 1)..];

        Assert.Null(service.Validate(modified, TwoFactorChallengePurpose.Verify));
    }

    [Fact]
    public void Expired_challenge_is_rejected()
    {
        const int userId = 42;
        const string securityStamp = "stamp-a";
        var payload = string.Join('|', "v1", userId.ToString(CultureInfo.InvariantCulture), securityStamp);
        var protector = _provider
            .CreateProtector("StajProject.TwoFactorChallenge", TwoFactorChallengePurpose.Verify.ToString())
            .ToTimeLimitedDataProtector();
        var expiredEnvelope = protector.Protect(payload, DateTimeOffset.UtcNow.AddMinutes(-1));
        var token = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(expiredEnvelope));
        var service = new TwoFactorChallengeService(_provider);

        Assert.Null(service.Validate(token, TwoFactorChallengePurpose.Verify));
    }

    [Fact]
    public void Challenge_lifetime_is_five_minutes()
    {
        var service = new TwoFactorChallengeService(_provider);

        Assert.Equal(TimeSpan.FromMinutes(5), service.Lifetime);
    }
}
