using NetTopologySuite.IO;
using StajProject.Application.Activity;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Journeys;
using StajProject.Application.Simulation;

namespace StajProject.Infrastructure.Services;

/// <summary>
/// Kişisel yolculuk simülasyonunun başlatma, okuma ve durdurma kuralları.
/// </summary>
/// <remarks>
/// <para>
/// <b>GÜVEN SINIRI BURADADIR.</b> İstemci yalnızca yolculuk NİYETİNİ gönderir
/// (kip, profil, kimlikler). Geometri, mesafe, süre, manevra ya da bir plan
/// kimliği kabul edilmez — böyle bir alan <see cref="JourneyPlanRequest"/>'te
/// zaten yoktur. Sunucu planlamayı <see cref="IJourneyPlanningService.PlanAsync"/>
/// ile SÜREÇ İÇİNDE yeniden çalıştırır: referanslar yeniden çözülür, silinmiş
/// ya da pasif kayıtlar yeniden reddedilir, POI yetkisi yeniden sorulur ve
/// profil uygunluğu yeniden kontrol edilir.
/// </para>
/// <para>
/// <b>Önizleme SADECE arayüz verisidir.</b> Başlatma anında üretilen güzergah,
/// saniyeler önceki önizlemeden FARKLI olabilir; bu bir çelişki değil, yeniden
/// doğrulamanın beklenen sonucudur. İstemciye dönen yanıt yeni gerçektir.
/// </para>
/// <para>
/// <b>HTTP loopback YOKTUR.</b> Kendi önizleme ucumuza istek atmak, kendi
/// JSON'umuzu yazıp geri okumak ya da planlama algoritmasını ikinci kez yazmak
/// yerine aynı uygulama servisi doğrudan çağrılır.
/// </para>
/// <para>
/// Scoped'dır (planlama servisi ve kimlik istek kapsamına aittir); aktif durum
/// ise singleton depodadır ve bu servis onu KENDİ TUTMAZ.
/// </para>
/// </remarks>
public sealed class JourneySimulationService : IJourneySimulationService
{
    private const string UnknownUserMessage = "Yolculuk simülasyonu için kimlik doğrulaması gerekiyor.";
    private const string AlreadyRunningMessage =
        "Zaten çalışan bir yolculuk simülasyonunuz var. Önce onu durdurun.";
    private const string NoActiveMessage = "Çalışan bir yolculuk simülasyonunuz yok.";
    private const string NotFoundMessage = "Yolculuk simülasyonu bulunamadı.";
    private const string UnusableGeometryMessage =
        "Hesaplanan güzergah simülasyon için yeterli uzunlukta değil.";

    private static readonly WKTWriter WktWriter = new();

    private readonly IJourneyPlanningService _planning;
    private readonly ICurrentUserService _currentUser;
    private readonly IJourneySimulationStateStore _state;
    private readonly IJourneySimulationBroadcaster _broadcaster;
    private readonly IJourneyActivityRecorder _activity;

    /* GEÇMİŞ, denetim kaydından AYRI bir sorumluluktur ve ayrı bir bileşene
       aittir: biri "kim neyi değiştirdi" defteri, diğeri kullanıcının kendi
       yolculuk tutanağıdır. İkisi de terminal geçişi KAZANAN yolda, yalnızca
       bir kez çağrılır. */
    private readonly IJourneyHistoryWriter _history;

    public JourneySimulationService(
        IJourneyPlanningService planning,
        ICurrentUserService currentUser,
        IJourneySimulationStateStore state,
        IJourneySimulationBroadcaster broadcaster,
        IJourneyActivityRecorder activity,
        IJourneyHistoryWriter history)
    {
        _planning = planning;
        _currentUser = currentUser;
        _state = state;
        _broadcaster = broadcaster;
        _activity = activity;
        _history = history;
    }

    public async Task<ServiceResult<JourneySimulationResponse>> StartAsync(
        JourneyPlanRequest intent,
        CancellationToken cancellationToken = default)
    {
        if (_currentUser.UserId is not { } userId)
        {
            return ServiceResult<JourneySimulationResponse>.Forbidden(UnknownUserMessage);
        }

        /* Erken çıkış: zaten çalışan bir yolculuk varsa yeniden planlamaya hiç
           girilmez. BAĞLAYICI denetim yine de aşağıdaki TryStart'tadır. */
        if (_state.FindByOwner(userId) is not null)
        {
            return ServiceResult<JourneySimulationResponse>.Conflict(AlreadyRunningMessage);
        }

        /* YENİDEN PLANLAMA. Önizlemenin ne söylediğinin hiçbir önemi yoktur;
           doğrulama, referans çözümü, POI yetkisi ve profil uygunluğu burada
           baştan uygulanır. Profil kullanılamıyorsa istek burada durur ve
           sürüşe DÜŞÜLMEZ. */
        var planned = await _planning.PlanAsync(intent, cancellationToken);

        if (!planned.IsSuccess)
        {
            return Propagate<JourneySimulationResponse, JourneyPlanResult>(planned);
        }

        var plan = planned.Value!;

        /* Geometri BURADA sıradan sayılara kopyalanır. Bu satırdan sonra depoya
           giren hiçbir şey EF'e ya da NetTopologySuite nesnelerine bağlı
           değildir. */
        var points = plan.Geometry.Coordinates
            .Select(coordinate => new TransportSimulationPoint(coordinate.X, coordinate.Y))
            .ToArray();

        var track = TransportSimulationTrack.Create(points);

        if (!track.IsUsable)
        {
            return ServiceResult<JourneySimulationResponse>.Failure(UnusableGeometryMessage);
        }

        var now = DateTime.UtcNow;

        var simulation = new ActiveJourneySimulation(
            SimulationId: Guid.NewGuid(),
            OwnerUserId: userId,
            Mode: plan.Mode,
            RequestedProfile: plan.RequestedProfile,
            EffectiveProfile: plan.EffectiveProfile,
            StartedAt: now,
            Path: new JourneySimulationPath(
                points,
                plan.DistanceMeters,
                plan.DurationSeconds,
                JourneyStepDistances.CumulativeEnds(plan.Steps)),

            /* Sunum metadatası BURADA, sunucunun kendi plan sonucundan
               kopyalanır. İstemciden gelen hiçbir şey buraya girmez ve kopya
               tamamen değişmez değerlerden oluşur — yenilemeden sonra paneli
               geri kurmak için tablolara ya da motora dönmek gerekmez. */
            Details: new JourneySimulationDetails(
                WktWriter.Write(plan.Geometry),
                plan.RouteId,
                plan.RouteName,
                plan.Waypoints,
                plan.Steps),
            Snapshot: new JourneySimulationSnapshot(
                Position: points[0],
                SegmentIndex: 0,
                ProgressRatio: 0,
                DistanceCoveredMeters: 0,
                CurrentStepSequence: JourneyStepDistances.StepAt(
                    JourneyStepDistances.CumulativeEnds(plan.Steps), 0),
                CapturedAt: now));

        if (!_state.TryStart(simulation))
        {
            // Yukarıdaki kontrolden sonra başka bir istek öne geçti.
            return ServiceResult<JourneySimulationResponse>.Conflict(AlreadyRunningMessage);
        }

        /* Denetim kaydı GEÇİŞİ KAZANAN yoldadır: başarısız planlama, geçersiz
           seçim ya da çakışma buraya hiç ulaşmaz, dolayısıyla defterde yalnızca
           gerçekten oluşturulmuş çalıştırmalar bulunur. */
        await _activity.RecordAsync(
            new JourneyActivityOutcome(
                JourneyActivityKind.Started,
                simulation.SimulationId,
                simulation.Mode,
                simulation.RequestedProfile,
                RouteId: plan.RouteId,
                WaypointCount: plan.Waypoints?.Count,
                DistanceMeters: plan.DistanceMeters,
                DurationSeconds: plan.DurationSeconds),
            userId,
            cancellationToken);

        return ServiceResult<JourneySimulationResponse>.Success(ToResponse(simulation));
    }

    public Task<ServiceResult<JourneySimulationResponse>> GetCurrentAsync(
        CancellationToken cancellationToken = default)
    {
        if (_currentUser.UserId is not { } userId)
        {
            return Task.FromResult(ServiceResult<JourneySimulationResponse>.Forbidden(UnknownUserMessage));
        }

        var simulation = _state.FindByOwner(userId);

        /* Yalnızca ÇAĞIRANIN kendi çalıştırması sorulur; başkasının yolculuğunu
           bu yoldan görmek yapısal olarak mümkün değildir. */
        return Task.FromResult(simulation is null
            ? ServiceResult<JourneySimulationResponse>.NotFound(NoActiveMessage)
            : ServiceResult<JourneySimulationResponse>.Success(ToResponse(simulation)));
    }

    public async Task<ServiceResult<JourneySimulationSnapshotResponse>> StopAsync(
        Guid simulationId,
        CancellationToken cancellationToken = default)
    {
        if (_currentUser.UserId is not { } userId)
        {
            return ServiceResult<JourneySimulationSnapshotResponse>.Forbidden(UnknownUserMessage);
        }

        var simulation = _state.Find(simulationId);

        /* FAIL-CLOSED ve BİLGİ SIZDIRMAZ: "yok" ile "senin değil" aynı 404'ü
           üretir. Ayrı bir 403, kimlik tahmin eden birine o kimliğin gerçekten
           var olduğunu doğrulardı. */
        if (simulation is null || simulation.OwnerUserId != userId)
        {
            return ServiceResult<JourneySimulationSnapshotResponse>.NotFound(NotFoundMessage);
        }

        if (!_state.TryStop(simulationId))
        {
            // Araya girip kendi kendine bitmiş olabilir; bu bir hata değildir.
            return ServiceResult<JourneySimulationSnapshotResponse>.NotFound(NotFoundMessage);
        }

        var cancelled = simulation.With(simulation.Snapshot with { CapturedAt = DateTime.UtcNow });
        var update = JourneySimulationLiveUpdate.From(cancelled, JourneySimulationStatus.Cancelled);

        /* GEÇMİŞ önce yazılır: kullanıcının göreceği tutanak, denetim
           defterinden daha görünür bir üründür ve ikisi de bu isteğin kazandığı
           geçişe aittir. Terminal an, çalıştırmanın kendi son anlık
           görüntüsünün damgasıdır — ikinci bir saat okuması, aynı olay için iki
           farklı zaman üretirdi.

           Yazma başarısız olsa bile durdurma BAŞARILIDIR: geçiş zaten
           kazanılmıştır ve geri alınamaz. */
        await _history.RecordAsync(
            cancelled,
            JourneySimulationStatus.Cancelled,
            cancelled.Snapshot.CapturedAt,
            cancellationToken);

        /* Terminal geçişi BU istek kazandı (`TryStop` yukarıda true döndü);
           mükerrer ya da bayat bir durdurma isteği buraya ulaşamaz ve ikinci
           bir satır yazamaz. */
        await _activity.RecordAsync(
            new JourneyActivityOutcome(
                JourneyActivityKind.Cancelled,
                cancelled.SimulationId,
                cancelled.Mode,
                cancelled.RequestedProfile,
                RouteId: cancelled.Details.RouteId,
                ProgressPercent: cancelled.Snapshot.ProgressRatio * 100,
                DistanceMeters: cancelled.Path.DistanceMeters,
                DurationSeconds: cancelled.Path.DurationSeconds),
            userId,
            cancellationToken);

        // Tek bir terminal olay: istemci durduğunu YAYINDAN da öğrenir.
        await _broadcaster.PublishAsync(update, cancellationToken);

        return ServiceResult<JourneySimulationSnapshotResponse>.Success(ToSnapshotResponse(update));
    }

    public JourneySimulationLiveUpdate? FindOwnedLiveUpdate(Guid simulationId, int ownerUserId)
    {
        var simulation = _state.Find(simulationId);

        /* Sahiplik denetimi BURADADIR ve hub ona güvenir: kimlik tahmin eden
           biri başkasının konumunu okuyamaz. */
        return simulation is null || simulation.OwnerUserId != ownerUserId
            ? null
            : JourneySimulationLiveUpdate.From(simulation, JourneySimulationStatus.Running);
    }

    /* --- Eşleme ------------------------------------------------------------------ */

    /// <summary>
    /// Çalıştırmanın tam sunumu.
    /// </summary>
    /// <remarks>
    /// <b>TEK eşleme, iki uç.</b> Başlatma ve "mevcut çalıştırma" aynı
    /// fonksiyondan geçer ve YALNIZCA süreç içi oturumdan okur. Daha önce
    /// başlatma plan nesnesinden, kurtarma ise köşelerden okuyordu; iki kaynak,
    /// iki ucun zamanla farklı gövdeler döndürmesi demekti. Plan nesnesi artık
    /// buraya hiç girmez, dolayısıyla ayrışma yapısal olarak imkânsızdır.
    /// </remarks>
    private static JourneySimulationResponse ToResponse(ActiveJourneySimulation simulation) =>
        new()
        {
            SimulationId = simulation.SimulationId,
            Mode = JourneyContractNames.Of(simulation.Mode),
            RequestedProfile = JourneyContractNames.Of(simulation.RequestedProfile),
            EffectiveProfile = simulation.EffectiveProfile,
            StartedAt = simulation.StartedAt,
            GeometryWkt = simulation.Details.GeometryWkt,
            TotalDistanceMeters = simulation.Path.DistanceMeters,
            TotalDurationSeconds = simulation.Path.DurationSeconds,
            RouteId = simulation.Details.RouteId,
            RouteName = simulation.Details.RouteName,
            Waypoints = [.. simulation.Details.Waypoints.Select(JourneyPlanningService.ToWaypointResponse)],
            Steps = [.. simulation.Details.Steps.Select(JourneyPlanningService.ToStepResponse)],
            Snapshot = ToSnapshotResponse(
                JourneySimulationLiveUpdate.From(simulation, JourneySimulationStatus.Running)),
        };

    private static JourneySimulationSnapshotResponse ToSnapshotResponse(JourneySimulationLiveUpdate update) =>
        new()
        {
            SimulationId = update.SimulationId,
            Status = update.Status.ToString(),
            Longitude = update.Longitude,
            Latitude = update.Latitude,
            ProgressPercent = update.ProgressPercent,
            DistanceCoveredMeters = update.DistanceCoveredMeters,
            CurrentStepSequence = update.CurrentStepSequence,
            UpdatedAtUtc = update.UpdatedAtUtc,
        };

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
