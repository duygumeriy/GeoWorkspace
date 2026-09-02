using Microsoft.EntityFrameworkCore;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Journeys;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Infrastructure.Services;

/// <summary>
/// Kaydedilmiş kişisel yolculuk tanımlarının sahiplik, doğrulama ve yeniden
/// kullanım kuralları.
/// </summary>
/// <remarks>
/// <para>
/// <b>SAKLANAN ŞEY NİYETTİR.</b> Tabloya giren tek şey kip, profil, hat
/// referansı ve sıralı kayıt kimlikleridir. Simülasyon kimliği, ilerleme,
/// anlık konum, güzergah geometrisi, manevralar, varış tahmini ve takip
/// durumu HİÇBİR yolla yazılmaz — sözleşmede ve tabloda böyle bir alan
/// yoktur. Bu bilinçlidir: bir çalıştırmanın anlık görüntüsünü saklamak,
/// "yeniden kullan" eylemini ölü bir çalıştırmayı diriltmeye çalışmak hâline
/// getirirdi.
/// </para>
/// <para>
/// <b>Doğrulama İKİNCİ KEZ YAZILMAZ.</b> Hem kaydetme hem yeniden kullanma
/// mevcut planlama/başlatma hattından geçer; kip ve profil çözümü, referans
/// varlığı, silinmiş/pasif kayıt reddi ve POI yetkisi orada nasıl
/// uygulanıyorsa burada da öyle uygulanır.
/// </para>
/// <para>
/// <b>SAHİPLİK HER SORGUDA VARDIR.</b> Kayıtlar sahibine özeldir ve her
/// okuma/yazma <c>UserId</c> ile sınırlanır. Başkasının kaydı için yapılan
/// istek "bulunamadı" ile biter: ayrı bir 403, kimlik tahmin eden birine o
/// kaydın var olduğunu doğrulardı.
/// </para>
/// <para>
/// <b>Paylaşılan ulaşım verisine YAZILMAZ.</b> Hat, durak ve kalıcı güzergah
/// tabloları yalnızca OKUNUR; paylaşılan simülasyonun yaşam döngüsüne
/// dokunulmaz.
/// </para>
/// </remarks>
public sealed class SavedJourneyService : ISavedJourneyService
{
    private const string UnknownUserMessage = "Kaydedilen yolculuklar için kimlik doğrulaması gerekiyor.";
    private const string NotFoundMessage = "Kaydedilen yolculuk bulunamadı.";
    private const string EmptyRequestMessage = "İstek boş olamaz.";
    private const string DefinitionRequiredMessage = "Kaydedilecek yolculuk tanımı boş olamaz.";
    private const string NameRequiredMessage = "Yolculuk için bir ad girin.";
    private static readonly string NameTooLongMessage =
        $"Yolculuk adı en fazla {SavedJourney.MaxNameLength} karakter olabilir.";
    private const string NothingToUpdateMessage = "Güncellenecek bir alan gönderilmedi.";
    private const string RouteMissingMessage =
        "Bu yolculuğun hattı artık mevcut değil. Yolculuk yeniden oluşturulamadı.";
    private const string CorruptDefinitionMessage = "Bu yolculuk yeniden oluşturulamadı.";

    private readonly AppDbContext _dbContext;
    private readonly ICurrentUserService _currentUser;
    private readonly IJourneyPlanningService _planning;
    private readonly IJourneySimulationService _simulations;

    public SavedJourneyService(
        AppDbContext dbContext,
        ICurrentUserService currentUser,
        IJourneyPlanningService planning,
        IJourneySimulationService simulations)
    {
        _dbContext = dbContext;
        _currentUser = currentUser;
        _planning = planning;
        _simulations = simulations;
    }

    /* --- Oluşturma ---------------------------------------------------------------- */

    public async Task<ServiceResult<SavedJourneyResponse>> CreateAsync(
        CreateSavedJourneyRequest request,
        CancellationToken cancellationToken = default)
    {
        if (_currentUser.UserId is not { } userId)
        {
            return ServiceResult<SavedJourneyResponse>.Forbidden(UnknownUserMessage);
        }

        if (request is null)
        {
            return ServiceResult<SavedJourneyResponse>.Failure(EmptyRequestMessage);
        }

        var name = ValidateName(request.Name);
        if (!name.IsSuccess)
        {
            return ServiceResult<SavedJourneyResponse>.Failure(name.Error!);
        }

        if (request.Journey is not { } intent)
        {
            return ServiceResult<SavedJourneyResponse>.Failure(DefinitionRequiredMessage);
        }

        /* MEVCUT planlama hattı doğrulayıcıdır: kip/profil, referans varlığı,
           silinmiş/pasif kayıt reddi ve POI yetkisi burada yeniden yazılmaz.
           Böylece kaydedilebilen her tanım, kaydedildiği anda gerçekten
           planlanabilir bir tanımdır — ve normalleştirilmiş nokta sırası da
           aynı yerden gelir, ikinci bir sıralama kuralı kurulmaz. */
        var planned = await _planning.PlanAsync(intent, cancellationToken);

        if (!planned.IsSuccess)
        {
            return Propagate<SavedJourneyResponse, JourneyPlanResult>(planned);
        }

        var plan = planned.Value!;
        var now = DateTime.UtcNow;

        var saved = new SavedJourney
        {
            UserId = userId,
            Name = name.Value!,
            Mode = JourneyContractNames.Of(plan.Mode),

            /* TALEP EDİLEN profil saklanır, motorun gerçekleştirdiği değil:
               niyet kullanıcınındır. Etkin profil bir çalışma zamanı
               sonucudur ve her yeniden kullanımda yeniden kararlaştırılır. */
            Profile = JourneyContractNames.Of(plan.RequestedProfile),
            RouteId = plan.RouteId,
            RouteDisplayName = plan.RouteName,
            IsFavorite = request.IsFavorite,
            CreatedDate = now,
            ModifiedDate = now,
        };

        foreach (var point in BuildPoints(plan.Mode, intent, plan))
        {
            saved.Points.Add(point);
        }

        _dbContext.SavedJourneys.Add(saved);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return ServiceResult<SavedJourneyResponse>.Success(ToResponse(saved));
    }

    /// <summary>
    /// Kipe göre KANONİK noktalar.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Kip ayrımı KORUNUR.</b> Tam-hat yolculuğu hattın KENDİSİNE bağlıdır:
    /// durakları o anda çözülür ve kaydın parçası değildir — hatta sonradan
    /// durak eklenirse yeniden kullanım o durakları da içermelidir. Bölüm
    /// kipinin niyeti ise tam olarak SEÇİLEN İKİ DURAKTIR; aradaki duraklar
    /// türetilmiş sonuçtur ve saklanmaz. Serbest kipte niyetin kendisi
    /// noktaların sırasıdır.
    /// </para>
    /// <para>
    /// Gösterim adları planın çözdüğü adlardan kopyalanır; otorite değildirler
    /// ve yeniden kullanımda kullanılmazlar.
    /// </para>
    /// </remarks>
    private static IEnumerable<SavedJourneyPoint> BuildPoints(
        JourneyMode mode,
        JourneyPlanRequest intent,
        JourneyPlanResult plan)
    {
        switch (mode)
        {
            case JourneyMode.RouteFull:
                yield break;

            case JourneyMode.RouteSegment:
                yield return new SavedJourneyPoint
                {
                    Sequence = 0,
                    Source = JourneyContractNames.TransportStop,
                    ReferenceId = intent.FromStopId!.Value,
                    DisplayName = plan.Waypoints.Count > 0 ? plan.Waypoints[0].Name : null,
                };
                yield return new SavedJourneyPoint
                {
                    Sequence = 1,
                    Source = JourneyContractNames.TransportStop,
                    ReferenceId = intent.ToStopId!.Value,
                    DisplayName = plan.Waypoints.Count > 1 ? plan.Waypoints[^1].Name : null,
                };
                break;

            default:
                /* Sıra PLANIN normalleştirdiği sıradır: açık `order` verilmiş
                   olsa da olmasa da tek bir kanonik dizi kalır. */
                foreach (var waypoint in plan.Waypoints)
                {
                    yield return new SavedJourneyPoint
                    {
                        Sequence = waypoint.Position,
                        Source = JourneyContractNames.Of(waypoint.Source),
                        ReferenceId = waypoint.ReferenceId,
                        DisplayName = waypoint.Name,
                    };
                }

                break;
        }
    }

    /* --- Okuma -------------------------------------------------------------------- */

    public async Task<ServiceResult<IReadOnlyList<SavedJourneySummaryResponse>>> ListAsync(
        CancellationToken cancellationToken = default)
    {
        if (_currentUser.UserId is not { } userId)
        {
            return ServiceResult<IReadOnlyList<SavedJourneySummaryResponse>>.Forbidden(UnknownUserMessage);
        }

        /* Liste HAFİFTİR: geometri, manevra ve çözülmüş koordinat taşımaz ve
           hiçbir satır için yönlendirme motoruna gidilmez. */
        var rows = await _dbContext.SavedJourneys
            .AsNoTracking()
            .Where(item => item.UserId == userId)

            /* Sıra KARARLIDIR: önce favoriler, sonra en son değiştirilen, en
               sonda kimlik. Son ayraç olmasaydı aynı milisaniyede değişen iki
               kayıt her istekte yer değiştirebilirdi. */
            .OrderByDescending(item => item.IsFavorite)
            .ThenByDescending(item => item.ModifiedDate)
            .ThenByDescending(item => item.Id)
            .Select(item => new
            {
                item.Id,
                item.Name,
                item.Mode,
                item.Profile,
                item.IsFavorite,
                item.RouteDisplayName,
                item.CreatedDate,
                item.ModifiedDate,
                Points = item.Points.OrderBy(point => point.Sequence)
                    .Select(point => point.DisplayName)
                    .ToList(),
            })
            .ToListAsync(cancellationToken);

        var summaries = rows
            .Select(row => new SavedJourneySummaryResponse
            {
                Id = row.Id,
                Name = row.Name,
                Mode = row.Mode,
                Profile = row.Profile,
                IsFavorite = row.IsFavorite,
                RouteDisplayName = row.RouteDisplayName,
                PointCount = row.Points.Count,
                OriginName = row.Points.Count > 0 ? row.Points[0] : null,
                DestinationName = row.Points.Count > 1 ? row.Points[^1] : null,
                CreatedDate = row.CreatedDate,
                ModifiedDate = row.ModifiedDate,
            })
            .ToList();

        return ServiceResult<IReadOnlyList<SavedJourneySummaryResponse>>.Success(summaries);
    }

    public async Task<ServiceResult<SavedJourneyResponse>> GetAsync(
        int savedJourneyId,
        CancellationToken cancellationToken = default)
    {
        if (_currentUser.UserId is not { } userId)
        {
            return ServiceResult<SavedJourneyResponse>.Forbidden(UnknownUserMessage);
        }

        var saved = await FindOwnedAsync(savedJourneyId, userId, tracked: false, cancellationToken);

        return saved is null
            ? ServiceResult<SavedJourneyResponse>.NotFound(NotFoundMessage)
            : ServiceResult<SavedJourneyResponse>.Success(ToResponse(saved));
    }

    /* --- Üst veri güncellemesi ----------------------------------------------------- */

    public async Task<ServiceResult<SavedJourneyResponse>> UpdateAsync(
        int savedJourneyId,
        UpdateSavedJourneyRequest request,
        CancellationToken cancellationToken = default)
    {
        if (_currentUser.UserId is not { } userId)
        {
            return ServiceResult<SavedJourneyResponse>.Forbidden(UnknownUserMessage);
        }

        if (request is null)
        {
            return ServiceResult<SavedJourneyResponse>.Failure(EmptyRequestMessage);
        }

        if (request.Name is null && request.IsFavorite is null)
        {
            return ServiceResult<SavedJourneyResponse>.Failure(NothingToUpdateMessage);
        }

        var saved = await FindOwnedAsync(savedJourneyId, userId, tracked: true, cancellationToken);

        if (saved is null)
        {
            return ServiceResult<SavedJourneyResponse>.NotFound(NotFoundMessage);
        }

        if (request.Name is not null)
        {
            var name = ValidateName(request.Name);
            if (!name.IsSuccess)
            {
                return ServiceResult<SavedJourneyResponse>.Failure(name.Error!);
            }

            saved.Name = name.Value!;
        }

        if (request.IsFavorite is { } favorite)
        {
            /* Sunucu tarafında "tersine çevir" YOKTUR: istemci istediği DEĞERİ
               gönderir. Toggle olsaydı, iki hızlı tıklama ya da geç gelen bir
               cevap yıldızı kullanıcının görmediği bir duruma çevirebilirdi. */
            saved.IsFavorite = favorite;
        }

        /* Damga BURADA atılır: kayıt IAuditableEntity değildir (çöp kutusu ve
           geri yükleme kavramı yoktur), dolayısıyla SaveChanges onu damgalamaz. */
        saved.ModifiedDate = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);

        return ServiceResult<SavedJourneyResponse>.Success(ToResponse(saved));
    }

    /* --- Silme -------------------------------------------------------------------- */

    public async Task<ServiceResult<int>> DeleteAsync(
        int savedJourneyId,
        CancellationToken cancellationToken = default)
    {
        if (_currentUser.UserId is not { } userId)
        {
            return ServiceResult<int>.Forbidden(UnknownUserMessage);
        }

        var saved = await FindOwnedAsync(savedJourneyId, userId, tracked: true, cancellationToken);

        if (saved is null)
        {
            return ServiceResult<int>.NotFound(NotFoundMessage);
        }

        /* GERÇEK silme. POI ve çizimlerdeki yumuşak silme, o kayıtların bir
           ÇÖP KUTUSU ve bir geri yükleme ucu olduğu için vardır; kaydedilmiş
           yolculuğun ikisi de yoktur ve işaretlenmiş bir satır hiçbir zaman
           okunmayacak ölü veri olurdu. Noktalar CASCADE ile gider; yüklenmiş
           oldukları için EF de aynı kararı verir. */
        _dbContext.SavedJourneys.Remove(saved);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return ServiceResult<int>.Success(savedJourneyId);
    }

    /* --- Yeniden kullanım ---------------------------------------------------------- */

    public async Task<ServiceResult<JourneySimulationResponse>> ReuseAsync(
        int savedJourneyId,
        CancellationToken cancellationToken = default)
    {
        if (_currentUser.UserId is not { } userId)
        {
            return ServiceResult<JourneySimulationResponse>.Forbidden(UnknownUserMessage);
        }

        var saved = await FindOwnedAsync(savedJourneyId, userId, tracked: false, cancellationToken);

        if (saved is null)
        {
            return ServiceResult<JourneySimulationResponse>.NotFound(NotFoundMessage);
        }

        /* Kanonik referanslar ÖNCE çözülür. Başlatma yolu zaten fail-closed'dur
           ama mesajı genel olurdu; buradaki denetim kullanıcıya HANGİ kayıtlı
           noktanın çözülemediğini söyler. Bu bir yetki denetimi DEĞİLDİR ve
           bağlayıcı doğrulamanın yerine geçmez — başlatma aynı kuralları kendi
           güven sınırının içinde yeniden uygular. */
        var missing = await FindMissingReferenceAsync(saved, cancellationToken);

        if (missing is not null)
        {
            /* Kayıt SİLİNMEZ ya da işaretlenmez: incelenebilir, yeniden
               adlandırılabilir ve silinebilir kalır. Bu yolda hiçbir simülasyon
               oluşturulmaz. */
            return ServiceResult<JourneySimulationResponse>.NotFound(missing);
        }

        var intent = ToIntent(saved);

        if (intent is null)
        {
            return ServiceResult<JourneySimulationResponse>.Failure(CorruptDefinitionMessage);
        }

        /* MEVCUT başlatma yolu: güzergah yeniden hesaplanır, referanslar
           yeniden çözülür ve YENİ bir simulationId üretilir. Kayıtta hiçbir
           çalıştırma kimliği yoktur; olsaydı burada diriltilmeye çalışılırdı. */
        return await _simulations.StartAsync(intent, cancellationToken);
    }

    /// <summary>
    /// Kaydedilmiş tanımı, mevcut yolculuk NİYETİ sözleşmesine çevirir.
    /// </summary>
    /// <remarks>
    /// Geometri, ölçüm ya da plan kimliği taşınmaz — sözleşmede böyle bir alan
    /// yoktur; taşınan yalnızca kip, profil ve kimliklerdir.
    /// </remarks>
    private static JourneyPlanRequest? ToIntent(SavedJourney saved)
    {
        if (!JourneyContractNames.TryParseMode(saved.Mode, out var mode))
        {
            return null;
        }

        var points = saved.Points.OrderBy(point => point.Sequence).ToList();

        switch (mode)
        {
            case JourneyMode.RouteFull:
                return saved.RouteId is null
                    ? null
                    : new JourneyPlanRequest
                    {
                        Mode = JourneyContractNames.RouteFull,
                        Profile = saved.Profile,
                        RouteId = saved.RouteId,
                    };

            case JourneyMode.RouteSegment:
                return saved.RouteId is null || points.Count != 2
                    ? null
                    : new JourneyPlanRequest
                    {
                        Mode = JourneyContractNames.RouteSegment,
                        Profile = saved.Profile,
                        RouteId = saved.RouteId,
                        FromStopId = points[0].ReferenceId,
                        ToStopId = points[1].ReferenceId,
                    };

            default:
                return points.Count < 2
                    ? null
                    : new JourneyPlanRequest
                    {
                        Mode = JourneyContractNames.Waypoints,
                        Profile = saved.Profile,

                        /* Sıra dizinin KENDİ sırasıdır; `order` gönderilmez.
                           Kayıttaki sıra zaten boşluksuz ve tekildir. */
                        Waypoints = [.. points.Select(point => new JourneyWaypointRequest
                        {
                            Source = point.Source,
                            ReferenceId = point.ReferenceId,
                        })],
                    };
        }
    }

    /// <summary>
    /// Çözülemeyen İLK kanonik referansın kullanıcıya gösterilebilir mesajı;
    /// hepsi çözülüyorsa <c>null</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Bayat koordinata düşülmez.</b> Kayıtta koordinat zaten yoktur:
    /// referans çözülüyorsa GÜNCEL konumu kullanılır, çözülmüyorsa yolculuk
    /// hiç başlamaz. Sessizce başka bir noktaya yönlenmek, kullanıcının
    /// istemediği bir yolculuğu onun istediği sanmasına yol açardı.
    /// </para>
    /// <para>
    /// Görünürlük EF global sorgu filtrelerinden gelir; <c>IgnoreQueryFilters</c>
    /// bilinçli olarak KULLANILMAZ, böylece "silinmiş" ile "yok" aynı ve
    /// güvenli cevabı üretir. Durakların hattına açık bir <c>Join</c> ile
    /// bakılır: hattı silinmiş bir durak tek başına geçerli sayılmaz.
    /// </para>
    /// </remarks>
    private async Task<string?> FindMissingReferenceAsync(
        SavedJourney saved,
        CancellationToken cancellationToken)
    {
        if (saved.RouteId is { } routeId)
        {
            var routeExists = await _dbContext.TransportRoutes
                .AsNoTracking()
                .AnyAsync(route => route.Id == routeId, cancellationToken);

            if (!routeExists)
            {
                return RouteMissingMessage;
            }
        }

        var points = saved.Points.OrderBy(point => point.Sequence).ToList();

        if (points.Count == 0)
        {
            return null;
        }

        var stopIds = points
            .Where(point => JourneyContractNames.TryParseSource(point.Source, out var source)
                && source == JourneyWaypointSource.TransportStop)
            .Select(point => point.ReferenceId)
            .Distinct()
            .ToArray();

        var poiIds = points
            .Where(point => JourneyContractNames.TryParseSource(point.Source, out var source)
                && source == JourneyWaypointSource.Poi)
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
                return CorruptDefinitionMessage;
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
    /// Kaydetme anındaki ad yalnızca BURADA, kaydın kendisini bulmaya yarayan
    /// bir etiket olarak kullanılır; yolculuk kurmakta hiç kullanılmaz. Ad
    /// yoksa tür adı verilir — ham bir kimlik göstermek kullanıcıya hiçbir şey
    /// anlatmazdı.
    /// </remarks>
    private static string MissingPointMessage(JourneyWaypointSource source, SavedJourneyPoint point)
    {
        var kind = source == JourneyWaypointSource.TransportStop ? "durak" : "POI";

        return string.IsNullOrWhiteSpace(point.DisplayName)
            ? $"Bu yolculuktaki bir {kind} artık mevcut değil. Yolculuk yeniden oluşturulamadı."
            : $"“{point.DisplayName}” adlı {kind} artık mevcut değil. Yolculuk yeniden oluşturulamadı.";
    }

    /* --- Ortak yardımcılar --------------------------------------------------------- */

    /// <summary>
    /// Kaydı YALNIZCA sahibi için okur.
    /// </summary>
    /// <remarks>
    /// Sahiplik süzgeci sorgunun KENDİSİNDEDİR: önce kaydı okuyup sonra sahibini
    /// karşılaştırmak, filtreyi eklemeyi unutan bir çağrı yolu bıraktığı için
    /// tercih edilmez.
    /// </remarks>
    private Task<SavedJourney?> FindOwnedAsync(
        int savedJourneyId,
        int userId,
        bool tracked,
        CancellationToken cancellationToken)
    {
        var query = _dbContext.SavedJourneys.Include(item => item.Points).AsQueryable();

        if (!tracked)
        {
            query = query.AsNoTracking();
        }

        return query.FirstOrDefaultAsync(
            item => item.Id == savedJourneyId && item.UserId == userId,
            cancellationToken);
    }

    private static ServiceResult<string> ValidateName(string? value)
    {
        var name = value?.Trim() ?? string.Empty;

        /* Ad SAHİP İÇİNDE BENZERSİZ DEĞİLDİR ve olmamalıdır: "Ev → İş"
           yolculuğunu farklı profillerle ya da farklı ara noktalarla birden
           fazla kez saklamak meşru bir kullanımdır. */
        if (name.Length == 0)
        {
            return ServiceResult<string>.Failure(NameRequiredMessage);
        }

        return name.Length > SavedJourney.MaxNameLength
            ? ServiceResult<string>.Failure(NameTooLongMessage)
            : ServiceResult<string>.Success(name);
    }

    private static SavedJourneyResponse ToResponse(SavedJourney saved)
    {
        var points = saved.Points.OrderBy(point => point.Sequence).ToList();

        return new SavedJourneyResponse
        {
            Id = saved.Id,
            Name = saved.Name,
            Mode = saved.Mode,
            Profile = saved.Profile,
            IsFavorite = saved.IsFavorite,
            RouteId = saved.RouteId,
            RouteDisplayName = saved.RouteDisplayName,
            CreatedDate = saved.CreatedDate,
            ModifiedDate = saved.ModifiedDate,
            Points = [.. points.Select((point, index) => new SavedJourneyPointResponse
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

    private static ServiceResult<TTarget> Propagate<TTarget, TSource>(ServiceResult<TSource> failure) =>
        failure.ErrorKind switch
        {
            ServiceErrorKind.NotFound => ServiceResult<TTarget>.NotFound(failure.Error!),
            ServiceErrorKind.Forbidden => ServiceResult<TTarget>.Forbidden(failure.Error!),
            ServiceErrorKind.Conflict => ServiceResult<TTarget>.Conflict(failure.Error!),
            ServiceErrorKind.Upstream => ServiceResult<TTarget>.Upstream(failure.Error!),
            ServiceErrorKind.Timeout => ServiceResult<TTarget>.Timeout(failure.Error!),
            _ => ServiceResult<TTarget>.Failure(failure.Error!)
        };
}
