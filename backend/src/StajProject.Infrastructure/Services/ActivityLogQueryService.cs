using Microsoft.EntityFrameworkCore;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Infrastructure.Services;

/// <summary>
/// Aktivite geçmişini okur: en yeniden eskiye, sayfalanmış.
/// </summary>
/// <remarks>
/// <para>
/// <b>Sayfalama zorunludur ve sınırlıdır.</b> İstemci sayfa boyutunu seçebilir
/// ama <see cref="MaxPageSize"/>'ı geçemez: tek bir istekle tüm tabloyu
/// çekebilmek, kayıt sayısı büyüdüğünde sunucuyu ve tarayıcıyı birlikte
/// durdururdu.
/// </para>
/// <para>
/// <b>Filtreler indeksli kolonlar üzerindedir</b> (zaman, aktör, işlem kodu).
/// Yol ve ayrıntı içinde serbest metin araması bilinçli olarak sunulmaz.
/// </para>
/// </remarks>
public class ActivityLogQueryService : IActivityLogQueryService
{
    public const int DefaultPageSize = 25;
    public const int MaxPageSize = 100;

    private readonly AppDbContext _dbContext;

    public ActivityLogQueryService(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task<ActivityLogPage> GetAsync(
        ActivityLogQuery query,
        CancellationToken cancellationToken = default)
    {
        var page = Math.Max(1, query.Page ?? 1);
        var pageSize = Math.Clamp(query.PageSize ?? DefaultPageSize, 1, MaxPageSize);

        var filtered = Filter(_dbContext.ActivityLogs.AsNoTracking(), query);

        /* Toplam SAYIM ayrı bir sorgudur ve gereklidir: arayüz "kaç sayfa var"
           sorusunu ancak böyle yanıtlayabilir. Sayfayı doldurup "belki devamı
           vardır" demek, son sayfada boş bir "sonraki" düğmesi bırakırdı. */
        var totalCount = await filtered.CountAsync(cancellationToken);

        var rows = await filtered
            /* Sıra EN YENİDEN başlar. İkincil anahtar olarak Id kullanılır:
               aynı milisaniyede yazılmış iki kayıt arasında kararsız bir sıra,
               sayfalar arasında satır tekrarına ya da kaybına yol açardı. */
            .OrderByDescending(log => log.OccurredAt)
            .ThenByDescending(log => log.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        return new ActivityLogPage
        {
            Items = [.. rows.Select(Describe)],
            Page = page,
            PageSize = pageSize,
            TotalCount = totalCount,
            TotalPages = totalCount == 0 ? 0 : (int)Math.Ceiling(totalCount / (double)pageSize)
        };
    }

    private static IQueryable<ActivityLog> Filter(IQueryable<ActivityLog> source, ActivityLogQuery query)
    {
        if (query.ActorUserId is { } actorUserId)
        {
            source = source.Where(log => log.ActorUserId == actorUserId);
        }

        if (!string.IsNullOrWhiteSpace(query.Action))
        {
            var action = query.Action.Trim();
            source = source.Where(log => log.Action == action);
        }

        if (query.From is { } from)
        {
            source = source.Where(log => log.OccurredAt >= from);
        }

        if (query.To is { } to)
        {
            source = source.Where(log => log.OccurredAt <= to);
        }

        if (query.Succeeded is { } succeeded)
        {
            // "Başarılı" = 2xx. Tek tanım burada durur; arayüz durum kodunu
            // yeniden yorumlamaz.
            source = succeeded
                ? source.Where(log => log.StatusCode >= 200 && log.StatusCode < 300)
                : source.Where(log => log.StatusCode < 200 || log.StatusCode >= 300);
        }

        return source;
    }

    private static ActivityLogListItem Describe(ActivityLog log) => new()
    {
        Id = log.Id,
        OccurredAt = log.OccurredAt,
        ActorUserId = log.ActorUserId,
        ActorUsername = log.ActorUsername,
        Action = log.Action,
        // Türkçe ad kodla BİRLİKTE taşınır; tanınmayan kod için kodun kendisi.
        ActionName = ActivityActionCatalog.NameOf(log.Action),
        ResourceType = log.ResourceType,
        ResourceId = log.ResourceId,
        HttpMethod = log.HttpMethod,
        Path = log.Path,
        StatusCode = log.StatusCode,
        IsSuccess = log.StatusCode is >= 200 and < 300,
        Details = log.Details,
        ClientIp = log.ClientIp
    };
}
