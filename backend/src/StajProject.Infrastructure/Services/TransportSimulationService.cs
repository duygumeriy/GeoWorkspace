using Microsoft.EntityFrameworkCore;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Simulation;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Infrastructure.Services;

/// <summary>
/// Simülasyon başlatma ve okuma iş kuralları.
/// </summary>
/// <remarks>
/// <para>
/// <b>Sunucu otoritesi.</b> İstemci ne başlangıç konumu ne de ilerleme
/// gönderir; her ikisi de burada üretilir. İlk anlık görüntü daima %0'dır ve
/// güzergahın İLK köşesindedir.
/// </para>
/// <para>
/// <b>OSRM çağrılmaz.</b> Simülasyon yalnızca <c>TransportRoutePath</c>
/// içindeki KALICI yolu işletir; yolun üretimi mevcut
/// <see cref="ITransportService.GenerateRoutePathAsync"/> akışının işidir ve
/// orada kalır. Bayat bir yolu simülasyon sırasında sessizce yenilemek, hangi
/// geometrinin işletildiğini belirsizleştirirdi.
/// </para>
/// <para>
/// Scoped'dır: <see cref="AppDbContext"/>'e bağlıdır. Aktif durum ise
/// singleton depodadır — servis o durumu kendisi TUTMAZ.
/// </para>
/// </remarks>
public sealed class TransportSimulationService : ITransportSimulationService
{
    private const string RouteNotFoundMessage = "Ulaşım rotası bulunamadı veya kullanımda değil.";
    private const string PathNotFoundMessage =
        "Bu güzergah için henüz hesaplanmış bir rota bulunmuyor. Önce rotayı hesaplayın.";
    private const string StalePathMessage =
        "Rota güzergahı güncel değil. Simülasyon başlatmadan önce güzergah yeniden hesaplanmalıdır.";
    private const string InsufficientGeometryMessage =
        "Hesaplanmış güzergah simülasyon için yeterli sayıda nokta içermiyor.";
    private const string AlreadyRunningMessage = "Bu rota için zaten çalışan bir simülasyon var.";
    private const string NoActiveSimulationMessage = "Bu rota için çalışan bir simülasyon yok.";
    private const string UnknownUserMessage = "Simülasyon başlatmak için kimlik doğrulaması gerekiyor.";

    /// <summary>Bir çizgi için anlamlı en az köşe sayısı.</summary>
    private const int MinimumPathPoints = 2;

    private readonly AppDbContext _dbContext;
    private readonly ICurrentUserService _currentUser;
    private readonly ITransportSimulationStateStore _state;

    public TransportSimulationService(
        AppDbContext dbContext,
        ICurrentUserService currentUser,
        ITransportSimulationStateStore state)
    {
        _dbContext = dbContext;
        _currentUser = currentUser;
        _state = state;
    }

    public async Task<ServiceResult<TransportSimulationResponse>> StartAsync(
        int routeId,
        CancellationToken cancellationToken = default)
    {
        /* Yetkilendirme uçta yapılır (transport.simulation.start); burada
           yalnızca "kim başlattı" kaydı için kimliğe bakılır. Kimlik yoksa
           sahipsiz bir çalıştırma üretmek yerine istek reddedilir. */
        if (_currentUser.UserId is not { } userId)
        {
            return ServiceResult<TransportSimulationResponse>.Forbidden(UnknownUserMessage);
        }

        var route = await _dbContext.TransportRoutes
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(item => !item.IsDeleted && item.IsActive)
            .Select(item => new { item.Id, item.Name, item.ColorHex })
            .FirstOrDefaultAsync(item => item.Id == routeId, cancellationToken);

        if (route is null)
        {
            return ServiceResult<TransportSimulationResponse>.NotFound(RouteNotFoundMessage);
        }

        /* Erken çıkış: zaten çalışan bir simülasyon varsa yol hiç okunmaz.
           Kuralın BAĞLAYICI denetimi yine de aşağıdaki TryStart'tadır — bu
           kontrol yalnızca gereksiz işi önler. */
        if (_state.Find(routeId) is not null)
        {
            return ServiceResult<TransportSimulationResponse>.Conflict(AlreadyRunningMessage);
        }

        var path = await _dbContext.TransportRoutePaths
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.RouteId == routeId, cancellationToken);

        if (path is null)
        {
            return ServiceResult<TransportSimulationResponse>.NotFound(PathNotFoundMessage);
        }

        if (path.IsStale)
        {
            /* Bayat yol bir DOĞRULAMA hatası değildir: istek kusursuzdur,
               sistemin mevcut durumuyla çelişir. Çakışma (409), istemciye
               "önce güzergahı yeniden hesapla, sonra aynı isteği tekrarla"
               diyebilen tek kategoridir. */
            return ServiceResult<TransportSimulationResponse>.Conflict(StalePathMessage);
        }

        /* Geometri BURADA sıradan sayılara kopyalanır. Bu satırdan sonra depoya
           giren hiçbir şey EF'e ya da NetTopologySuite nesnelerine bağlı
           değildir. */
        var points = path.Geometry.Coordinates
            .Select(coordinate => new TransportSimulationPoint(coordinate.X, coordinate.Y))
            .ToArray();

        if (points.Length < MinimumPathPoints)
        {
            return ServiceResult<TransportSimulationResponse>.Failure(InsufficientGeometryMessage);
        }

        var now = DateTime.UtcNow;

        var simulation = new ActiveTransportSimulation(
            SimulationId: Guid.NewGuid(),
            RouteId: routeId,
            RouteName: route.Name,
            RouteColorHex: route.ColorHex,
            StartedByUserId: userId,
            StartedAt: now,
            Path: new TransportSimulationPath(
                points,
                path.DistanceMeters,
                path.DurationSeconds,
                path.Profile,
                path.GeneratedAt),
            Snapshot: new TransportSimulationSnapshot(
                Position: points[0],
                SegmentIndex: 0,
                ProgressRatio: 0,
                DistanceCoveredMeters: 0,
                CapturedAt: now));

        if (!_state.TryStart(simulation))
        {
            // Yukarıdaki kontrolden sonra başka bir istek öne geçti.
            return ServiceResult<TransportSimulationResponse>.Conflict(AlreadyRunningMessage);
        }

        return ServiceResult<TransportSimulationResponse>.Success(ToResponse(simulation));
    }

    public async Task<ServiceResult<TransportSimulationResponse>> GetActiveAsync(
        int routeId,
        CancellationToken cancellationToken = default)
    {
        if (!await _dbContext.TransportRoutes
                .IgnoreQueryFilters()
                .AnyAsync(item => item.Id == routeId && !item.IsDeleted, cancellationToken))
        {
            return ServiceResult<TransportSimulationResponse>.NotFound(RouteNotFoundMessage);
        }

        var simulation = _state.Find(routeId);

        return simulation is null
            ? ServiceResult<TransportSimulationResponse>.NotFound(NoActiveSimulationMessage)
            : ServiceResult<TransportSimulationResponse>.Success(ToResponse(simulation));
    }

    public TransportSimulationLiveUpdate? FindActiveLiveUpdate(int routeId)
    {
        var simulation = _state.Find(routeId);

        return simulation is null
            ? null
            : TransportSimulationLiveUpdate.From(simulation, TransportSimulationStatus.Running);
    }

    private static TransportSimulationResponse ToResponse(ActiveTransportSimulation simulation) =>
        new()
        {
            SimulationId = simulation.SimulationId,
            RouteId = simulation.RouteId,
            RouteName = simulation.RouteName,
            RouteColorHex = simulation.RouteColorHex,
            StartedByUserId = simulation.StartedByUserId,
            StartedAt = simulation.StartedAt,
            DistanceMeters = simulation.Path.DistanceMeters,
            DurationSeconds = simulation.Path.DurationSeconds,
            Profile = simulation.Path.Profile,
            PathGeneratedAt = simulation.Path.GeneratedAt,
            PointCount = simulation.Path.Points.Count,
            Longitude = simulation.Snapshot.Position.Longitude,
            Latitude = simulation.Snapshot.Position.Latitude,
            SegmentIndex = simulation.Snapshot.SegmentIndex,
            ProgressRatio = simulation.Snapshot.ProgressRatio,
            DistanceCoveredMeters = simulation.Snapshot.DistanceCoveredMeters,
            CapturedAt = simulation.Snapshot.CapturedAt
        };
}
