using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using StajProject.Application.Activity;
using StajProject.Application.Interfaces;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Infrastructure.Services;

/// <summary>
/// Aktivite kayıtlarını <c>activity_logs</c> tablosuna yazar.
/// </summary>
/// <remarks>
/// <para>
/// <b>Aktör oturumdan okunur.</b> Kimlik ne çağıranın verdiği bir parametreden
/// ne de istek gövdesinden gelir; <see cref="ICurrentUserService"/> üzerinden
/// doğrulanmış token'dan alınır. Kullanıcı adı da o anki hâliyle KOPYALANIR:
/// kullanıcı sonradan silinir ya da yeniden adlandırılırsa kayıt hâlâ "kim
/// yaptı" sorusunu yanıtlayabilmelidir.
/// </para>
/// <para>
/// <b>Hata yutulur.</b> Denetim kaydı yazılamadı diye, az önce başarıyla
/// tamamlanmış bir işlem kullanıcıya hata olarak dönmez. Sorun sunucu
/// günlüğüne yazılır.
/// </para>
/// </remarks>
public class ActivityLogWriter : IActivityLogWriter
{
    private readonly AppDbContext _dbContext;
    private readonly ICurrentUserService _currentUser;
    private readonly ILogger<ActivityLogWriter> _logger;

    public ActivityLogWriter(
        AppDbContext dbContext,
        ICurrentUserService currentUser,
        ILogger<ActivityLogWriter> logger)
    {
        _dbContext = dbContext;
        _currentUser = currentUser;
        _logger = logger;
    }

    public Task WriteAsync(ActivityLogEntry entry, CancellationToken cancellationToken = default) =>
        PersistAsync(entry, _currentUser.UserId, _currentUser.UserName, cancellationToken);

    /// <summary>
    /// Aktörü AÇIKÇA verilen olay. Kimlik yine istemciden değil, sunucunun
    /// kendi çalışma zamanı durumundan gelir; ad bilinmiyorsa kayıt anında
    /// çözülür ki satır "kim yaptı" sorusunu yanıtlayabilsin.
    /// </summary>
    public async Task WriteAsync(
        ActivityLogEntry entry,
        ActivityActor actor,
        CancellationToken cancellationToken = default)
    {
        var userName = actor.UserName;

        if (string.IsNullOrWhiteSpace(userName))
        {
            try
            {
                userName = await _dbContext.Users
                    .Where(user => user.Id == actor.UserId)
                    .Select(user => user.UserName)
                    .FirstOrDefaultAsync(cancellationToken);
            }
            catch (Exception exception)
            {
                /* Ad çözülemedi: kaydı BIRAKMAK yerine adsız yazılır. Kimlik
                   zaten satırdadır; eksik bir ad, hiç olmayan bir kayıttan
                   iyidir. */
                _logger.LogWarning(exception, "Aktivite aktörünün adı çözülemedi: {UserId}", actor.UserId);
            }
        }

        await PersistAsync(entry, actor.UserId, userName, cancellationToken);
    }

    private async Task PersistAsync(
        ActivityLogEntry entry,
        int? actorUserId,
        string? actorUserName,
        CancellationToken cancellationToken)
    {
        try
        {
            _dbContext.ActivityLogs.Add(new ActivityLog
            {
                ActorUserId = actorUserId,
                ActorUsername = Truncate(actorUserName, ActivityLog.MaxUsernameLength),
                Action = Truncate(entry.Action, ActivityLog.MaxActionLength)!,
                ResourceType = Truncate(entry.ResourceType, ActivityLog.MaxResourceTypeLength),
                ResourceId = Truncate(entry.ResourceId, ActivityLog.MaxResourceIdLength),
                HttpMethod = Truncate(entry.HttpMethod, ActivityLog.MaxHttpMethodLength)!,
                Path = Truncate(entry.Path, ActivityLog.MaxPathLength)!,
                StatusCode = entry.StatusCode,
                OccurredAt = DateTime.UtcNow,
                Details = Truncate(entry.Details, ActivityLog.MaxDetailsLength),
                ClientIp = Truncate(entry.ClientIp, ActivityLog.MaxClientIpLength)
            });

            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (Exception exception)
        {
            /* Bilinçli olarak yutulur. Bu çağrı, kaydettiği işlem BİTTİKTEN
               sonra çalışır; buradan fırlayan bir hata, kullanıcıya başarılı
               bir işlemi başarısız göstermekten başka bir şey yapmazdı. */
            _logger.LogWarning(exception, "Aktivite kaydı yazılamadı: {Action}", entry.Action);
        }
    }

    /* Sınır aşımı bir istisna değil, kırpmadır: uzun bir yol ya da uzun bir
       kullanıcı adı yüzünden denetim kaydının hiç yazılmaması, kaydın kendisini
       kaybetmek olurdu. */
    private static string? Truncate(string? value, int maxLength) =>
        value is null || value.Length <= maxLength ? value : value[..maxLength];
}
