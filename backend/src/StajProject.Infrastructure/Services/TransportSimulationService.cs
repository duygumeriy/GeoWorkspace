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

    /* Eskimiş komut bir DOĞRULAMA hatası değildir: istek kusursuzdur, sistemin
       o anki durumuyla çelişir. Çakışma (409), istemciye "durumu tazele ve
       gerekiyorsa aynı komutu yeni kimlikle tekrarla" diyebilen tek
       kategoridir — başlatmadaki AlreadyRunning ile aynı gerekçe. */
    private const string NotRunningMessage =
        "Bu çalıştırma şu anda çalışmıyor; yalnızca çalışan bir simülasyon duraklatılabilir.";
    private const string NotPausedMessage =
        "Bu çalıştırma duraklatılmış değil; yalnızca duraklatılmış bir simülasyon sürdürülebilir.";

    private const string StaleSimulationMessage =
        "Bu çalıştırma artık aktif değil; hattaki güncel simülasyon farklı. Durumu yenileyip tekrar deneyin.";

    /// <summary>Bir çizgi için anlamlı en az köşe sayısı.</summary>
    private const int MinimumPathPoints = 2;

    private readonly AppDbContext _dbContext;
    private readonly ICurrentUserService _currentUser;
    private readonly ITransportSimulationStateStore _state;
    private readonly ITransportSimulationTerminator _terminator;
    private readonly ITransportSimulationLifecycle _lifecycle;

    public TransportSimulationService(
        AppDbContext dbContext,
        ICurrentUserService currentUser,
        ITransportSimulationStateStore state,
        ITransportSimulationTerminator terminator,
        ITransportSimulationLifecycle lifecycle)
    {
        _dbContext = dbContext;
        _currentUser = currentUser;
        _state = state;
        _terminator = terminator;
        _lifecycle = lifecycle;
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

    /// <summary>
    /// AÇIK kullanıcı durdurması. Yetki (<c>transport.simulation.stop</c>)
    /// uçtadır; burada KİMLİK ve DURUM denetlenir.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Aşağıdaki ön okumalar yalnızca DOĞRU HATA MESAJI içindir.</b>
    /// Bağlayıcı karar, deponun atomik <c>TryStop(routeId, simulationId)</c>
    /// işlemidir ve o da terminatörün içindedir: ön okuma ile sonlandırma
    /// arasında çalıştırma değişirse terminatör <c>null</c> döner ve komut yine
    /// reddedilir. "Her ihtimale karşı güncel olanı durdur" yolu YOKTUR.
    /// </para>
    /// <para>
    /// Kimlik (kim durdurdu) SORULMAZ: başlatmadan farklı olarak durdurma bir
    /// sahiplik işlemi değildir — hattı başlatan kişi ile durduran kişi aynı
    /// olmak zorunda değildir ve yetki bunu zaten söyler.
    /// </para>
    /// </remarks>
    public async Task<ServiceResult<TransportSimulationLiveUpdate>> StopAsync(
        int routeId,
        Guid simulationId,
        CancellationToken cancellationToken = default)
    {
        if (!await _dbContext.TransportRoutes
                .IgnoreQueryFilters()
                .AnyAsync(item => item.Id == routeId && !item.IsDeleted, cancellationToken))
        {
            return ServiceResult<TransportSimulationLiveUpdate>.NotFound(RouteNotFoundMessage);
        }

        var active = _state.Find(routeId);

        if (active is null)
        {
            /* Zaten terminal ya da hiç başlamamış: GÜVENLİ başarısızlık.
               Sessizce "başarılı" demek, istemciye durdurmadığı bir şeyi
               durdurmuş gibi gösterirdi. */
            return ServiceResult<TransportSimulationLiveUpdate>.NotFound(NoActiveSimulationMessage);
        }

        if (active.SimulationId != simulationId)
        {
            /* ASIL YARIŞ KORUMASI. Hatta bir çalıştırma var ama istenen O
               DEĞİL: eski bir sekme, yerine geçmiş yeni çalıştırmayı — başka
               kullanıcıların izlediği bir yayını — durduramaz. */
            return ServiceResult<TransportSimulationLiveUpdate>.Conflict(StaleSimulationMessage);
        }

        var terminated = await _terminator.TerminateAsync(routeId, simulationId, cancellationToken);

        return terminated is null
            /* Ön okuma ile sonlandırma arasında çalıştırma değişti; kimlik
               denetimi tuttu ve hiçbir şeye dokunulmadı. */
            ? ServiceResult<TransportSimulationLiveUpdate>.Conflict(StaleSimulationMessage)
            : ServiceResult<TransportSimulationLiveUpdate>.Success(terminated);
    }

    /// <summary>DURAKLAT. Yetki (<c>transport.simulation.stop</c>) uçtadır.</summary>
    public Task<ServiceResult<TransportSimulationLiveUpdate>> PauseAsync(
        int routeId,
        Guid simulationId,
        CancellationToken cancellationToken = default) =>
        TransitionAsync(
            routeId,
            simulationId,
            TransportSimulationStatus.Running,
            NotRunningMessage,
            () => _lifecycle.PauseAsync(routeId, simulationId, cancellationToken),
            cancellationToken);

    /// <summary>DEVAM ETTİR. Yetki (<c>transport.simulation.stop</c>) uçtadır.</summary>
    public Task<ServiceResult<TransportSimulationLiveUpdate>> ResumeAsync(
        int routeId,
        Guid simulationId,
        CancellationToken cancellationToken = default) =>
        TransitionAsync(
            routeId,
            simulationId,
            TransportSimulationStatus.Paused,
            NotPausedMessage,
            () => _lifecycle.ResumeAsync(routeId, simulationId, cancellationToken),
            cancellationToken);

    /// <summary>
    /// Duraklat/Sürdür için ORTAK kapı: rota, kimlik ve durum önkoşulu.
    /// </summary>
    /// <remarks>
    /// <b>Ön okumalar yalnızca DOĞRU HATA MESAJI içindir.</b> Bağlayıcı karar
    /// deponun atomik geçişidir (<c>TryPause</c>/<c>TryResume</c>): ön okuma
    /// ile geçiş arasında çalıştırma değişirse ilkel <c>null</c> döner ve komut
    /// yine reddedilir. "Her ihtimale karşı güncel olanı duraklat" yolu YOKTUR.
    /// </remarks>
    private async Task<ServiceResult<TransportSimulationLiveUpdate>> TransitionAsync(
        int routeId,
        Guid simulationId,
        TransportSimulationStatus requiredStatus,
        string wrongStatusMessage,
        Func<Task<TransportSimulationLiveUpdate?>> transition,
        CancellationToken cancellationToken)
    {
        if (!await _dbContext.TransportRoutes
                .IgnoreQueryFilters()
                .AnyAsync(item => item.Id == routeId && !item.IsDeleted, cancellationToken))
        {
            return ServiceResult<TransportSimulationLiveUpdate>.NotFound(RouteNotFoundMessage);
        }

        var active = _state.Find(routeId);

        if (active is null)
        {
            return ServiceResult<TransportSimulationLiveUpdate>.NotFound(NoActiveSimulationMessage);
        }

        if (active.SimulationId != simulationId)
        {
            /* YARIŞ KORUMASI: hatta bir çalıştırma var ama istenen O DEĞİL.
               Eski bir sekme, yerine geçmiş yeni çalıştırmayı duraklatamaz. */
            return ServiceResult<TransportSimulationLiveUpdate>.Conflict(StaleSimulationMessage);
        }

        if (active.Status != requiredStatus)
        {
            return ServiceResult<TransportSimulationLiveUpdate>.Conflict(wrongStatusMessage);
        }

        var applied = await transition();

        return applied is null
            ? ServiceResult<TransportSimulationLiveUpdate>.Conflict(StaleSimulationMessage)
            : ServiceResult<TransportSimulationLiveUpdate>.Success(applied);
    }

    public TransportSimulationLiveUpdate? FindActiveLiveUpdate(int routeId)
    {
        var simulation = _state.Find(routeId);

        /* Durum çalıştırmanın KENDİSİNDEN okunur; sabit `Running` varsaymak,
           gruba geç katılan bir gözlemciye duraklatılmış aracı çalışıyormuş
           gibi gösterirdi. */
        return simulation is null
            ? null
            : TransportSimulationLiveUpdate.From(simulation, simulation.Status);
    }

    private static TransportSimulationResponse ToResponse(ActiveTransportSimulation simulation) =>
        new()
        {
            SimulationId = simulation.SimulationId,
            RouteId = simulation.RouteId,
            /* Durum ÇALIŞMA ZAMANI kaydından olduğu gibi alınır; ilerlemeden
               ya da PausedAt'in dolu olmasından TÜRETİLMEZ. */
            Status = simulation.Status,
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
