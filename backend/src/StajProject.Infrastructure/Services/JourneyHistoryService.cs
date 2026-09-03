using Microsoft.EntityFrameworkCore;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Journeys;
using StajProject.Application.Simulation;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Infrastructure.Services;

/// <summary>
/// Kişisel yolculuk geçmişinin okuma ve yeniden kullanma kuralları.
/// </summary>
/// <remarks>
/// <para>
/// <b>DEĞİŞTİREN hiçbir metot yoktur.</b> Ad değiştirme, favori, güncelleme ve
/// silme bilinçli olarak bulunmaz: geçmiş, olmuş bir şeyin tutanağıdır.
/// Kullanıcının burada yapabileceği tek "yazma" eylemi, aynı yolculuğu YENİDEN
/// yapmaktır — ve o da tutanağı değiştirmez, yenisini doğurur.
/// </para>
/// <para>
/// <b>Gösterim canlı veriye BAĞIMLI DEĞİLDİR.</b> Liste ve ayrıntı yollarında
/// POI, durak ya da hat tablolarına HİÇ gidilmez; her ad kaydın kendi
/// kopyasından okunur. Silinmiş bir POI'yi içeren yolculuk bu yüzden hâlâ
/// açılabilir. Canlı kayıtlara yalnızca YENİDEN KULLANIM yolunda gidilir,
/// çünkü orada soru "o gün ne vardı" değil "bugün ne var"dır.
/// </para>
/// <para>
/// <b>SAHİPLİK HER SORGUDA VARDIR</b> ve sorgunun kendisindedir: önce okuyup
/// sonra sahibini karşılaştırmak, filtreyi eklemeyi unutan bir çağrı yolu
/// bırakırdı. Başkasının kaydı için yapılan istek "bulunamadı" ile biter.
/// </para>
/// <para>
/// <b>Paylaşılan ulaşım simülasyonuna hiç dokunulmaz:</b> burada hiçbir
/// <c>TransportRoute</c> kaydı değişmez ve hiçbir paylaşılan çalıştırma
/// başlatılmaz/durdurulmaz.
/// </para>
/// </remarks>
public sealed class JourneyHistoryService : IJourneyHistoryService
{
    /// <summary>Mevcut aktivite geçmişiyle AYNI sayfa sınırları; ikinci bir dil kurulmaz.</summary>
    public const int DefaultPageSize = 20;

    public const int MaxPageSize = 100;

    private const string UnknownUserMessage = "Yolculuk geçmişi için kimlik doğrulaması gerekiyor.";
    private const string NotFoundMessage = "Yolculuk kaydı bulunamadı.";
    private const string InvalidStatusMessage =
        "Geçersiz durum süzgeci. Yalnızca tamamlanmış ya da iptal edilmiş yolculuklar süzülebilir.";
    private const string RouteMissingMessage =
        "Bu yolculuğun hattı artık mevcut değil. Yolculuk yeniden oluşturulamadı.";
    private const string CorruptRecordMessage = "Bu yolculuk yeniden oluşturulamadı.";

    private readonly AppDbContext _dbContext;
    private readonly ICurrentUserService _currentUser;
    private readonly IJourneySimulationService _simulations;

    public JourneyHistoryService(
        AppDbContext dbContext,
        ICurrentUserService currentUser,
        IJourneySimulationService simulations)
    {
        _dbContext = dbContext;
        _currentUser = currentUser;
        _simulations = simulations;
    }

    /* --- Liste -------------------------------------------------------------------- */

    public async Task<ServiceResult<JourneyHistoryPage>> ListAsync(
        JourneyHistoryQuery query,
        CancellationToken cancellationToken = default)
    {
        if (_currentUser.UserId is not { } userId)
        {
            return ServiceResult<JourneyHistoryPage>.Forbidden(UnknownUserMessage);
        }

        var page = Math.Max(1, query?.Page ?? 1);
        var pageSize = Math.Clamp(query?.PageSize ?? DefaultPageSize, 1, MaxPageSize);

        var filtered = _dbContext.JourneyHistories
            .AsNoTracking()
            .Where(item => item.UserId == userId);

        if (!string.IsNullOrWhiteSpace(query?.Status))
        {
            /* Süzgeç ÇALIŞMA ZAMANININ kendi adlarını kullanır; ikinci bir
               durum dili uydurulmaz. Bilinmeyen bir değer sessizce "hepsi"ne
               düşmez: kullanıcı süzdüğünü sanırken süzülmemiş bir liste
               görürdü. */
            if (!TryParseTerminalStatus(query.Status, out var status))
            {
                return ServiceResult<JourneyHistoryPage>.Failure(InvalidStatusMessage);
            }

            var wanted = status.ToString();
            filtered = filtered.Where(item => item.TerminalStatus == wanted);
        }

        /* Toplam SAYIM ayrı bir sorgudur ve gereklidir: arayüz "devamı var mı"
           sorusunu ancak böyle yanıtlayabilir. */
        var totalCount = await filtered.CountAsync(cancellationToken);

        var rows = await filtered
            /* EN SON BİTEN en üstte. İkincil anahtar kimliktir: aynı anda biten
               iki kayıt arasında kararsız bir sıra, sayfalar arasında satır
               tekrarına ya da kaybına yol açardı. */
            .OrderByDescending(item => item.EndedAt)
            .ThenByDescending(item => item.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(item => new
            {
                item.Id,
                item.SimulationId,
                item.Mode,
                item.Profile,
                item.TerminalStatus,
                item.StartedAt,
                item.EndedAt,
                item.DurationSeconds,
                item.DistanceMeters,
                item.CoveredDistanceMeters,
                item.RouteDisplayName,

                /* Liste satırı için YALNIZCA adlar okunur: geometri, manevra ve
                   kanonik kimlikler bir listede işe yaramaz. */
                Points = item.Points.OrderBy(point => point.Sequence)
                    .Select(point => point.DisplayName)
                    .ToList(),
            })
            .ToListAsync(cancellationToken);

        var items = rows
            .Select(row => new JourneyHistoryListItem
            {
                Id = row.Id,
                SimulationId = row.SimulationId,
                Mode = row.Mode,
                Profile = row.Profile,
                TerminalStatus = row.TerminalStatus,
                StartedAt = row.StartedAt,
                EndedAt = row.EndedAt,
                DurationSeconds = row.DurationSeconds,
                DistanceMeters = row.DistanceMeters,
                CoveredDistanceMeters = row.CoveredDistanceMeters,
                RouteDisplayName = row.RouteDisplayName,
                PointCount = row.Points.Count,
                OriginName = row.Points.Count > 0 ? row.Points[0] : null,
                DestinationName = row.Points.Count > 1 ? row.Points[^1] : null,
            })
            .ToList();

        return ServiceResult<JourneyHistoryPage>.Success(new JourneyHistoryPage
        {
            Items = items,
            Page = page,
            PageSize = pageSize,
            TotalCount = totalCount,
            TotalPages = totalCount == 0 ? 0 : (int)Math.Ceiling(totalCount / (double)pageSize),
        });
    }

    /* --- Ayrıntı ------------------------------------------------------------------ */

    public async Task<ServiceResult<JourneyHistoryDetailResponse>> GetAsync(
        int journeyHistoryId,
        CancellationToken cancellationToken = default)
    {
        if (_currentUser.UserId is not { } userId)
        {
            return ServiceResult<JourneyHistoryDetailResponse>.Forbidden(UnknownUserMessage);
        }

        var history = await FindOwnedAsync(journeyHistoryId, userId, cancellationToken);

        return history is null
            ? ServiceResult<JourneyHistoryDetailResponse>.NotFound(NotFoundMessage)
            : ServiceResult<JourneyHistoryDetailResponse>.Success(ToDetail(history));
    }

    /* --- Yeniden kullanım ---------------------------------------------------------- */

    public async Task<ServiceResult<JourneySimulationResponse>> ReuseAsync(
        int journeyHistoryId,
        CancellationToken cancellationToken = default)
    {
        if (_currentUser.UserId is not { } userId)
        {
            return ServiceResult<JourneySimulationResponse>.Forbidden(UnknownUserMessage);
        }

        var history = await FindOwnedAsync(journeyHistoryId, userId, cancellationToken);

        if (history is null)
        {
            return ServiceResult<JourneySimulationResponse>.NotFound(NotFoundMessage);
        }

        /* Kanonik referanslar ÖNCE çözülür. Başlatma yolu zaten fail-closed'dur
           ama mesajı genel olurdu; buradaki denetim kullanıcıya HANGİ tarihsel
           noktanın artık bulunmadığını söyler. Bağlayıcı doğrulamanın yerine
           GEÇMEZ — başlatma aynı kuralları kendi güven sınırının içinde
           yeniden uygular. */
        var missing = await FindMissingReferenceAsync(history, cancellationToken);

        if (missing is not null)
        {
            /* Kayıt SİLİNMEZ, işaretlenmez ve DEĞİŞMEZ: geçmiş, yeniden
               yapılamadığı için bozulmaz. Bu yolda hiçbir simülasyon
               oluşturulmaz. */
            return ServiceResult<JourneySimulationResponse>.NotFound(missing);
        }

        var intent = ToIntent(history);

        if (intent is null)
        {
            return ServiceResult<JourneySimulationResponse>.Failure(CorruptRecordMessage);
        }

        /* MEVCUT başlatma yolu: referanslar yeniden çözülür, güzergah yeniden
           hesaplanır ve YENİ bir simulationId üretilir. Kayıttaki tarihsel
           kimlik isteğe hiç girmez — girseydi ölü bir çalıştırma diriltilmeye
           çalışılırdı. */
        return await _simulations.StartAsync(intent, cancellationToken);
    }

    /// <summary>
    /// Tarihsel kaydı, mevcut yolculuk NİYETİ sözleşmesine çevirir.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Tarihsel hiçbir ÖLÇÜM taşınmaz.</b> Mesafe, süre, geometri ve eski
    /// çalıştırma kimliği için sözleşmede alan yoktur; taşınan yalnızca kip,
    /// profil ve kanonik kimliklerdir.
    /// </para>
    /// <para>
    /// <b>Kip ayrımı KORUNUR.</b> Tam hat yolculuğu hattın KENDİSİNDEN yeniden
    /// kurulur — kayıttaki iki uç noktası tarihsel gösterim içindir ve geçiş
    /// noktası olarak KULLANILMAZ; hatta o günden beri durak eklenmişse
    /// yeniden yapılan yolculuk onları da içermelidir.
    /// </para>
    /// </remarks>
    private static JourneyPlanRequest? ToIntent(JourneyHistory history)
    {
        if (!JourneyContractNames.TryParseMode(history.Mode, out var mode))
        {
            return null;
        }

        var points = history.Points.OrderBy(point => point.Sequence).ToList();

        switch (mode)
        {
            case JourneyMode.RouteFull:
                return history.RouteId is null
                    ? null
                    : new JourneyPlanRequest
                    {
                        Mode = JourneyContractNames.RouteFull,
                        Profile = history.Profile,
                        RouteId = history.RouteId,
                    };

            case JourneyMode.RouteSegment:
                return history.RouteId is null || points.Count != 2
                    ? null
                    : new JourneyPlanRequest
                    {
                        Mode = JourneyContractNames.RouteSegment,
                        Profile = history.Profile,
                        RouteId = history.RouteId,
                        FromStopId = points[0].ReferenceId,
                        ToStopId = points[1].ReferenceId,
                    };

            default:
                return points.Count < 2
                    ? null
                    : new JourneyPlanRequest
                    {
                        Mode = JourneyContractNames.Waypoints,
                        Profile = history.Profile,

                        /* Sıra dizinin KENDİ sırasıdır; kayıttaki sıra zaten
                           boşluksuz ve tekildir. */
                        Waypoints = [.. points.Select(point => new JourneyWaypointRequest
                        {
                            Source = point.Source,
                            ReferenceId = point.ReferenceId,
                        })],
                    };
        }
    }

    /// <summary>
    /// Yeniden kullanımın GERÇEKTEN ihtiyaç duyduğu ilk çözülemeyen referansın
    /// kullanıcıya gösterilebilir mesajı; hepsi çözülüyorsa <c>null</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Yalnızca KULLANILACAK referanslar denetlenir.</b> Tam hat kipinde
    /// yeniden kullanım hattın kimliğinden kurulur; kayıttaki uç noktaları
    /// tarihsel gösterimdir ve o duraklardan biri silinmiş olsa bile hattın
    /// yeniden yapılmasını engellememelidir.
    /// </para>
    /// <para>
    /// <b>Tarihsel ada göre yönlendirme YAPILMAZ.</b> Kayıt bir koordinat
    /// kopyası tutmaz: referans çözülüyorsa GÜNCEL konumu kullanılır,
    /// çözülmüyorsa yolculuk hiç başlamaz. Bayat bir konuma sessizce düşmek,
    /// kullanıcının istemediği bir yolculuğu onun istediği sanmasına yol
    /// açardı.
    /// </para>
    /// <para>
    /// Görünürlük EF global sorgu filtrelerinden gelir; <c>IgnoreQueryFilters</c>
    /// bilinçli olarak kullanılmaz. Durakların hattına açık bir <c>Join</c> ile
    /// bakılır: hattı silinmiş bir durak tek başına geçerli sayılmaz.
    /// </para>
    /// </remarks>
    private async Task<string?> FindMissingReferenceAsync(
        JourneyHistory history,
        CancellationToken cancellationToken)
    {
        if (!JourneyContractNames.TryParseMode(history.Mode, out var mode))
        {
            return CorruptRecordMessage;
        }

        if (history.RouteId is { } routeId)
        {
            var routeExists = await _dbContext.TransportRoutes
                .AsNoTracking()
                .AnyAsync(route => route.Id == routeId, cancellationToken);

            if (!routeExists)
            {
                return RouteMissingMessage;
            }
        }

        // Tam hat: yeniden kullanım noktalara ihtiyaç duymaz, hat yeter.
        if (mode == JourneyMode.RouteFull)
        {
            return null;
        }

        var points = history.Points.OrderBy(point => point.Sequence).ToList();

        if (points.Count == 0)
        {
            return CorruptRecordMessage;
        }

        var stopIds = points
            .Where(point => IsSource(point, JourneyWaypointSource.TransportStop))
            .Select(point => point.ReferenceId)
            .Distinct()
            .ToArray();

        var poiIds = points
            .Where(point => IsSource(point, JourneyWaypointSource.Poi))
            .Select(point => point.ReferenceId)
            .Distinct()
            .ToArray();

        List<int> availableStops = stopIds.Length == 0
            ? []
            : await _dbContext.TransportStops
                .AsNoTracking()
                .Where(stop => stopIds.Contains(stop.Id))
                .Join(
                    _dbContext.TransportRoutes.AsNoTracking(),
                    stop => stop.RouteId,
                    route => route.Id,
                    (stop, _) => stop.Id)
                .ToListAsync(cancellationToken);

        List<int> availablePois = poiIds.Length == 0
            ? []
            : await _dbContext.Pois
                .AsNoTracking()
                .Where(poi => poiIds.Contains(poi.Id))
                .Select(poi => poi.Id)
                .ToListAsync(cancellationToken);

        foreach (var point in points)
        {
            if (!JourneyContractNames.TryParseSource(point.Source, out var source))
            {
                return CorruptRecordMessage;
            }

            var resolved = source == JourneyWaypointSource.TransportStop
                ? availableStops.Contains(point.ReferenceId)
                : availablePois.Contains(point.ReferenceId);

            if (!resolved)
            {
                return MissingPointMessage(source, point);
            }
        }

        return null;
    }

    /// <summary>
    /// Eksik noktayı KULLANICININ tanıyacağı biçimde adlandırır.
    /// </summary>
    /// <remarks>
    /// Tarihsel ad burada bir ETİKET olarak kullanılır — kullanıcı hangi
    /// noktadan söz edildiğini ancak o gün gördüğü adla anlar. Yolculuk kurmakta
    /// hiç kullanılmaz.
    /// </remarks>
    private static string MissingPointMessage(JourneyWaypointSource source, JourneyHistoryPoint point)
    {
        var kind = source == JourneyWaypointSource.TransportStop ? "durak" : "POI";

        return string.IsNullOrWhiteSpace(point.DisplayName)
            ? $"Bu yolculuktaki bir {kind} artık mevcut değil. Yolculuk yeniden oluşturulamadı."
            : $"“{point.DisplayName}” adlı {kind} artık mevcut değil. Yolculuk yeniden oluşturulamadı.";
    }

    private static bool IsSource(JourneyHistoryPoint point, JourneyWaypointSource expected) =>
        JourneyContractNames.TryParseSource(point.Source, out var source) && source == expected;

    /* --- Ortak yardımcılar --------------------------------------------------------- */

    /// <summary>
    /// Kaydı YALNIZCA sahibi için okur.
    /// </summary>
    /// <remarks>
    /// <c>AsNoTracking</c> bilinçlidir: geçmiş DEĞİŞMEZ ve bu servisin onu
    /// güncelleyebileceği hiçbir yol yoktur.
    /// </remarks>
    private Task<JourneyHistory?> FindOwnedAsync(
        int journeyHistoryId,
        int userId,
        CancellationToken cancellationToken) =>
        _dbContext.JourneyHistories
            .AsNoTracking()
            .Include(item => item.Points)
            .FirstOrDefaultAsync(
                item => item.Id == journeyHistoryId && item.UserId == userId,
                cancellationToken);

    private static bool TryParseTerminalStatus(string? value, out JourneySimulationStatus status)
    {
        status = default;

        if (Enum.TryParse(value?.Trim(), ignoreCase: true, out JourneySimulationStatus parsed)
            && parsed is JourneySimulationStatus.Completed or JourneySimulationStatus.Cancelled)
        {
            status = parsed;
            return true;
        }

        // `Running` GEÇERSİZDİR: çalışan bir yolculuk geçmişte aranamaz.
        return false;
    }

    private static JourneyHistoryDetailResponse ToDetail(JourneyHistory history)
    {
        var points = history.Points.OrderBy(point => point.Sequence).ToList();

        return new JourneyHistoryDetailResponse
        {
            Id = history.Id,
            SimulationId = history.SimulationId,
            Mode = history.Mode,
            Profile = history.Profile,
            TerminalStatus = history.TerminalStatus,
            StartedAt = history.StartedAt,
            EndedAt = history.EndedAt,
            DurationSeconds = history.DurationSeconds,
            DistanceMeters = history.DistanceMeters,
            CoveredDistanceMeters = history.CoveredDistanceMeters,
            RouteId = history.RouteId,
            RouteDisplayName = history.RouteDisplayName,
            Points = [.. points.Select((point, index) => new JourneyHistoryPointResponse
            {
                Sequence = point.Sequence,
                Source = point.Source,
                ReferenceId = point.ReferenceId,
                DisplayName = point.DisplayName,

                /* Rol SIRADAN türetilir; tabloda böyle bir kolon yoktur.
                   Saklansaydı sırayla çelişebilen ikinci bir otorite olurdu. */
                Role = JourneyContractNames.Of(RoleAt(index, points.Count)),
            })],
        };
    }

    private static JourneyWaypointRole RoleAt(int index, int total) => index == 0
        ? JourneyWaypointRole.Origin
        : index == total - 1
            ? JourneyWaypointRole.Destination
            : JourneyWaypointRole.Via;
}
