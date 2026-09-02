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

    /* TOPLU İSTEĞİN SÖZLEŞME HATALARI doğrulamadır (400): gövde kusurludur ve
       sistemin o anki durumundan bağımsız olarak reddedilir. Hedeflerin tek
       tek sonuçları AYRI bir eksendir ve yanıt gövdesinde döner. */
    private const string EmptyTargetsMessage =
        "Toplu yaşam döngüsü komutu en az bir çalıştırma hedefi içermelidir.";
    private static readonly string TooManyTargetsMessage =
        $"Tek istekte en fazla {TransportSimulationBatch.MaxTargets} çalıştırma hedeflenebilir.";
    private const string InvalidRouteTargetMessage =
        "Geçersiz hat kimliği içeren bir hedef gönderildi.";
    private const string InvalidSimulationTargetMessage =
        "Her hedef geçerli bir çalıştırma kimliği taşımalıdır; yalnızca hat kimliği yeterli değildir.";
    private const string DuplicateRouteTargetMessage =
        "Aynı hat birden çok kez hedeflenemez; hat başına en fazla bir aktif çalıştırma vardır.";

    /// <summary>Bir çizgi için anlamlı en az köşe sayısı.</summary>
    private const int MinimumPathPoints = 2;

    private readonly AppDbContext _dbContext;
    private readonly ICurrentUserService _currentUser;
    private readonly ITransportSimulationStateStore _state;
    private readonly ITransportSimulationTerminator _terminator;
    private readonly ITransportSimulationLifecycle _lifecycle;

    /* YENİDEN BAŞLATMANIN çalışma zamanı ilkeli. İsteğe bağlı DEĞİLDİR:
       duraklat/sürdür/sıfırla gibi bu da ürünün kendisidir ve kanalı
       kurulmamış bir bileşimde sessizce "çalışmıyor" hâline düşmemelidir —
       keşif duyurusundan farklı olarak burada kaybedilen şey bir kolaylık
       değil, komutun ta kendisidir. */
    private readonly ITransportSimulationReplacer _replacer;

    /* KEŞİF sinyali BAŞLATMADA buradan çıkar; sonlandırma/tamamlanma
       sinyalleri ise çalışma zamanı sahibinin (runner) işidir. Ayrım
       bilinçlidir: aktif kümeye GİRİŞ yalnızca bu servisin başarılı
       TryStart'ıyla olur, ÇIKIŞ ise runner'ın tek terminal yolundan.

       Bağımlılık İSTEĞE BAĞLIDIR ve varsayılanı yoktur: sinyal kanalı
       kurulmamış bir bileşimde (dar kapsamlı testler) simülasyon yine
       DOĞRU çalışır — keşif bir SUNUM kolaylığıdır, yaşam döngüsünün
       koşulu değil. Üretim bileşimi onu her zaman kaydeder. */
    private readonly ITransportSimulationDiscoveryBroadcaster? _discovery;

    public TransportSimulationService(
        AppDbContext dbContext,
        ICurrentUserService currentUser,
        ITransportSimulationStateStore state,
        ITransportSimulationTerminator terminator,
        ITransportSimulationLifecycle lifecycle,
        ITransportSimulationReplacer replacer,
        ITransportSimulationDiscoveryBroadcaster? discovery = null)
    {
        _dbContext = dbContext;
        _currentUser = currentUser;
        _state = state;
        _terminator = terminator;
        _lifecycle = lifecycle;
        _replacer = replacer;
        _discovery = discovery;
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

        /* Yol okuma ve geometri kopyalama TEK yerdedir ve yeniden başlatma da
           AYNI yerden geçer: iki ayrı okuma, "hangi geometri işletiliyor"
           kuralının zamanla ikiye ayrılması demekti. */
        var runnable = await ReadRunnablePathAsync(routeId, cancellationToken);

        if (runnable.Path is null)
        {
            return MapCode<TransportSimulationResponse>(runnable.Code, runnable.Message);
        }

        var now = DateTime.UtcNow;

        var simulation = NewRun(
            new RouteFacts(route.Id, route.Name, route.ColorHex),
            runnable.Path,
            userId,
            now);

        if (!_state.TryStart(simulation))
        {
            // Yukarıdaki kontrolden sonra başka bir istek öne geçti.
            return ServiceResult<TransportSimulationResponse>.Conflict(AlreadyRunningMessage);
        }

        /* AKTİF KÜME BÜYÜDÜ: sinyal ANCAK kayıt gerçekten yapıldıktan sonra
           çıkar. Ters sıra, reddedilen bir başlatmanın da tüm gözlemcilere
           gereksiz bir liste okuması yaptırması demekti. */
        await AnnounceAsync(
            TransportActiveSimulationSetChanged.Started(simulation, now),
            cancellationToken);

        return ServiceResult<TransportSimulationResponse>.Success(ToResponse(simulation));
    }

    /// <summary>
    /// AKTİF KEŞİF okuması. Veritabanına dokunmaz; yanıt tamamen süreç içi
    /// durumdan gelir.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Süzgeç YOKTUR ve gerekmez.</b> Depo yalnızca terminal OLMAYAN
    /// çalıştırmaları tutar — sonlandırma kaydı kaldırır — bu yüzden
    /// "Completed/Cancelled hariç" kuralı burada ikinci kez yazılmaz. İkinci
    /// bir süzgeç, iki yerin zamanla ayrışabildiği bir aktiflik tanımı
    /// üretirdi.
    /// </para>
    /// <para>
    /// <b>Sıra deterministiktir:</b> hat adı (kültürden bağımsız, büyük/küçük
    /// harf duyarsız), eşitlikte rota kimliği. Sözlük gezinme sırası arayüze
    /// ASLA sızmaz. İlerlemeye göre sıralamak, listeyi her tick'te yeniden
    /// dizerdi.
    /// </para>
    /// </remarks>
    public IReadOnlyList<TransportSimulationResponse> GetActiveSimulations() =>
    [
        .. _state.Active()
            .OrderBy(simulation => simulation.RouteName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(simulation => simulation.RouteId)
            .Select(ToResponse)
    ];

    /// <summary>Keşif sinyalini duyurur; kanal yoksa hiçbir şey olmaz.</summary>
    /// <remarks>
    /// Duyuru hatasının YUTULDUĞU yer burası DEĞİLDİR: port sözleşmesi gereği
    /// uygulama (Api adaptörü) taşıma arızasını kendi loglar ve dışarı
    /// sızdırmaz. Sorumluluğu orada tutmak, her çağıranın aynı try/catch'i
    /// kopyalamasını önler.
    /// </remarks>
    private Task AnnounceAsync(
        TransportActiveSimulationSetChanged change,
        CancellationToken cancellationToken) =>
        _discovery is null
            ? Task.CompletedTask
            : _discovery.PublishActiveSetChangedAsync(change, cancellationToken);

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

        /* Kimlik/durum/yarış kuralı ÇEKİRDEKTEDİR ve toplu yol da tam olarak
           oradan geçer; tekil uç kendi kopyasını tutmaz. */
        var outcome = await TerminateCoreAsync(routeId, simulationId, cancellationToken);

        return outcome.Update is null
            ? MapCode<TransportSimulationLiveUpdate>(outcome.Code, outcome.Message)
            : ServiceResult<TransportSimulationLiveUpdate>.Success(outcome.Update);
    }

    /// <summary>DURAKLAT. Yetki (<c>transport.simulation.stop</c>) uçtadır.</summary>
    public Task<ServiceResult<TransportSimulationLiveUpdate>> PauseAsync(
        int routeId,
        Guid simulationId,
        CancellationToken cancellationToken = default) =>
        TransitionAsync(routeId, simulationId, TransportSimulationBatchOperation.Pause, cancellationToken);

    /// <summary>DEVAM ETTİR. Yetki (<c>transport.simulation.stop</c>) uçtadır.</summary>
    public Task<ServiceResult<TransportSimulationLiveUpdate>> ResumeAsync(
        int routeId,
        Guid simulationId,
        CancellationToken cancellationToken = default) =>
        TransitionAsync(routeId, simulationId, TransportSimulationBatchOperation.Resume, cancellationToken);

    /// <summary>
    /// Duraklat/Sürdür için ORTAK kapı: rota varlığı + çekirdek geçiş.
    /// </summary>
    /// <remarks>
    /// Geçişin kendisi <see cref="TransitionCoreAsync"/>'dedir ve toplu yol da
    /// oradan geçer; burada yalnızca TEKİL uca ait rota okuması yapılır (toplu
    /// yol o okumayı hedeflerin tamamı için TEK sorguda yapar).
    /// </remarks>
    private async Task<ServiceResult<TransportSimulationLiveUpdate>> TransitionAsync(
        int routeId,
        Guid simulationId,
        TransportSimulationBatchOperation operation,
        CancellationToken cancellationToken)
    {
        if (!await RouteExistsAsync(routeId, cancellationToken))
        {
            return ServiceResult<TransportSimulationLiveUpdate>.NotFound(RouteNotFoundMessage);
        }

        var outcome = await TransitionCoreAsync(routeId, simulationId, operation, cancellationToken);

        return outcome.Update is null
            ? MapCode<TransportSimulationLiveUpdate>(outcome.Code, outcome.Message)
            : ServiceResult<TransportSimulationLiveUpdate>.Success(outcome.Update);
    }

    /// <summary>
    /// YENİDEN BAŞLAT (tekil). Yetki İKİ koddur ve uçtadır:
    /// <c>transport.simulation.stop</c> + <c>transport.simulation.start</c>.
    /// </summary>
    public async Task<ServiceResult<TransportSimulationResponse>> RestartAsync(
        int routeId,
        Guid simulationId,
        CancellationToken cancellationToken = default)
    {
        if (_currentUser.UserId is not { } userId)
        {
            return ServiceResult<TransportSimulationResponse>.Forbidden(UnknownUserMessage);
        }

        var route = await FindStartableRouteAsync(routeId, cancellationToken);

        if (route is null)
        {
            return ServiceResult<TransportSimulationResponse>.NotFound(RouteNotFoundMessage);
        }

        /* OTORİTER YOL, YIKICI ADIMDAN ÖNCE çözülür. Ters sıra, A'yı
           bitirdikten sonra yolun okunamadığını öğrenmek ve hattı hiç
           istenmeyen biçimde boş bırakmak demekti. */
        var runnable = await ReadRunnablePathAsync(routeId, cancellationToken);

        if (runnable.Path is null)
        {
            return MapCode<TransportSimulationResponse>(runnable.Code, runnable.Message);
        }

        var outcome = await RestartCoreAsync(
            routeId,
            simulationId,
            route,
            runnable.Path,
            userId,
            cancellationToken);

        return outcome.Simulation is null
            ? MapCode<TransportSimulationResponse>(outcome.Code, outcome.Message)
            : ServiceResult<TransportSimulationResponse>.Success(ToResponse(outcome.Simulation));
    }

    /* --- TOPLU YAŞAM DÖNGÜSÜ -----------------------------------------------------
       Tek giriş, dört işlem. Sözleşme doğrulaması, veritabanı okumaları ve
       sonuç sıralaması burada; KURAL çekirdek ilkellerde. */

    public async Task<ServiceResult<TransportSimulationBatchResponse>> ExecuteBatchAsync(
        TransportSimulationBatchOperation operation,
        TransportSimulationBatchRequest? request,
        CancellationToken cancellationToken = default)
    {
        var targets = request?.Targets;

        if (targets is null || targets.Count == 0)
        {
            return ServiceResult<TransportSimulationBatchResponse>.Failure(EmptyTargetsMessage);
        }

        if (targets.Count > TransportSimulationBatch.MaxTargets)
        {
            return ServiceResult<TransportSimulationBatchResponse>.Failure(TooManyTargetsMessage);
        }

        foreach (var target in targets)
        {
            if (target is null || target.RouteId <= 0)
            {
                return ServiceResult<TransportSimulationBatchResponse>.Failure(InvalidRouteTargetMessage);
            }

            /* BOŞ kimlik bir kimlik DEĞİLDİR: kabul etmek, "hattaki güncel
               çalıştırma" anlamına gelen sessiz bir joker açardı. */
            if (target.SimulationId == Guid.Empty)
            {
                return ServiceResult<TransportSimulationBatchResponse>.Failure(InvalidSimulationTargetMessage);
            }
        }

        /* AYNI ROTA İKİ KEZ HEDEFLENEMEZ. Rota başına en fazla bir aktif
           çalıştırma vardır; aynı rotanın iki hedefi ya aynı komutun kopyası
           ya da birbiriyle çelişen iki kimliktir. İkisi de belirsizdir ve
           hedefler eşzamanlı işlendiği için sıraya bağlı bir sonuç üretirdi. */
        if (targets.Select(target => target.RouteId).Distinct().Count() != targets.Count)
        {
            return ServiceResult<TransportSimulationBatchResponse>.Failure(DuplicateRouteTargetMessage);
        }

        var routeIds = targets.Select(target => target.RouteId).ToArray();
        var restarting = operation == TransportSimulationBatchOperation.Restart;

        int? actorId = null;

        if (restarting)
        {
            if (_currentUser.UserId is not { } userId)
            {
                return ServiceResult<TransportSimulationBatchResponse>.Forbidden(UnknownUserMessage);
            }

            actorId = userId;
        }

        /* VERİTABANI OKUMALARI ÖNCE ve TOPLU yapılır — iki nedenle. Hedef
           başına ayrı sorgu, hat sayısıyla doğru orantılı bir sorgu yağmuru
           demekti; dahası çekirdek ilkeller bundan sonra tamamen SÜREÇ İÇİ
           kalır ve rotalar arası eşzamanlılık mümkün olur (DbContext iş
           parçacığı güvenli değildir, ama artık ona hiç dokunulmaz). */
        IReadOnlySet<int> knownRouteIds = restarting
            ? new HashSet<int>()
            : await ExistingRouteIdsAsync(routeIds, cancellationToken);

        var startableRoutes = restarting
            ? await FindStartableRoutesAsync(routeIds, cancellationToken)
            : new Dictionary<int, RouteFacts>();

        var paths = restarting
            ? await ReadRunnablePathsAsync(startableRoutes.Keys, cancellationToken)
            : new Dictionary<int, RunnablePath>();

        /* Hedefler EŞZAMANLI işlenir: ilgisiz rotalar birbirini BEKLEMEZ ve
           küresel bir kilit YOKTUR. Rota başına atomiklik deponun CAS
           işlemindedir; aynı rota iki kez hedeflenemediği için iki görev asla
           aynı yuvaya yazmaz. */
        var tasks = new Task<TransportSimulationOperationResult>[targets.Count];

        for (var index = 0; index < targets.Count; index++)
        {
            var target = targets[index];

            tasks[index] = restarting
                ? RunRestartTargetAsync(target, startableRoutes, paths, actorId!.Value, cancellationToken)
                : RunTransitionTargetAsync(target, knownRouteIds, operation, cancellationToken);
        }

        // SIRA İSTEĞİN SIRASIDIR: görev tamamlanma sırası arayüze SIZMAZ.
        var results = await Task.WhenAll(tasks);
        var succeeded = results.Count(result => result.Succeeded);

        return ServiceResult<TransportSimulationBatchResponse>.Success(new TransportSimulationBatchResponse
        {
            Operation = operation,
            Results = results,
            RequestedCount = results.Length,
            SucceededCount = succeeded,
            FailedCount = results.Length - succeeded
        });
    }

    private async Task<TransportSimulationOperationResult> RunTransitionTargetAsync(
        TransportSimulationTargetRequest target,
        IReadOnlySet<int> knownRouteIds,
        TransportSimulationBatchOperation operation,
        CancellationToken cancellationToken)
    {
        if (!knownRouteIds.Contains(target.RouteId))
        {
            return Result(target, new CoreOutcome(
                TransportSimulationOperationResultCode.RouteNotFound,
                RouteNotFoundMessage));
        }

        var outcome = operation == TransportSimulationBatchOperation.Reset
            ? await TerminateCoreAsync(target.RouteId, target.SimulationId, cancellationToken)
            : await TransitionCoreAsync(target.RouteId, target.SimulationId, operation, cancellationToken);

        return Result(target, outcome);
    }

    private async Task<TransportSimulationOperationResult> RunRestartTargetAsync(
        TransportSimulationTargetRequest target,
        IReadOnlyDictionary<int, RouteFacts> routes,
        IReadOnlyDictionary<int, RunnablePath> paths,
        int actorId,
        CancellationToken cancellationToken)
    {
        if (!routes.TryGetValue(target.RouteId, out var route))
        {
            return Result(target, new CoreOutcome(
                TransportSimulationOperationResultCode.RouteNotFound,
                RouteNotFoundMessage));
        }

        if (!paths.TryGetValue(target.RouteId, out var runnable))
        {
            // Hatta hiç hesaplanmış güzergah yok.
            return Result(target, new CoreOutcome(
                TransportSimulationOperationResultCode.PathNotFound,
                PathNotFoundMessage));
        }

        if (runnable.Path is null)
        {
            // Var ama işletilemez: bayat ya da yetersiz geometri.
            return Result(target, new CoreOutcome(runnable.Code, runnable.Message));
        }

        var outcome = await RestartCoreAsync(
            target.RouteId,
            target.SimulationId,
            route,
            runnable.Path,
            actorId,
            cancellationToken);

        return Result(target, outcome);
    }

    /* --- ÇEKİRDEK İLKELLER --------------------------------------------------------
       Tekil uçlar da toplu uçlar da BURADAN geçer. Veritabanına DOKUNMAZLAR:
       rota varlığı çağıranın işidir (tekilde tek sorgu, topluda tek toplu
       sorgu). Bağlayıcı karar her zaman deponun atomik işlemidir; buradaki ön
       okumalar yalnızca DOĞRU SONUÇ KODU içindir. */

    /// <summary>Duraklat/Sürdür çekirdeği: kimlik + durum önkoşulu + atomik geçiş.</summary>
    private async Task<CoreOutcome> TransitionCoreAsync(
        int routeId,
        Guid simulationId,
        TransportSimulationBatchOperation operation,
        CancellationToken cancellationToken)
    {
        var pausing = operation == TransportSimulationBatchOperation.Pause;

        var requiredStatus = pausing
            ? TransportSimulationStatus.Running
            : TransportSimulationStatus.Paused;

        var wrongStatusCode = pausing
            ? TransportSimulationOperationResultCode.NotRunning
            : TransportSimulationOperationResultCode.NotPaused;

        var wrongStatusMessage = pausing ? NotRunningMessage : NotPausedMessage;

        var active = _state.Find(routeId);

        if (active is null)
        {
            return new CoreOutcome(
                TransportSimulationOperationResultCode.NoActiveSimulation,
                NoActiveSimulationMessage);
        }

        if (active.SimulationId != simulationId)
        {
            /* YARIŞ KORUMASI: hatta bir çalıştırma var ama istenen O DEĞİL.
               Eski bir sekme, yerine geçmiş yeni çalıştırmayı duraklatamaz. */
            return Stale();
        }

        if (active.Status != requiredStatus)
        {
            return new CoreOutcome(wrongStatusCode, wrongStatusMessage);
        }

        var applied = pausing
            ? await _lifecycle.PauseAsync(routeId, simulationId, cancellationToken)
            : await _lifecycle.ResumeAsync(routeId, simulationId, cancellationToken);

        // Ön okuma ile atomik geçiş arasında çalıştırma değişmiş olabilir.
        return applied is null
            ? Stale()
            : new CoreOutcome(
                TransportSimulationOperationResultCode.Succeeded,
                string.Empty,
                applied,
                _state.Find(routeId));
    }

    /// <summary>SIFIRLA çekirdeği: kimlik denetimli sonlandırma. Yerine yeni çalıştırma KONMAZ.</summary>
    private async Task<CoreOutcome> TerminateCoreAsync(
        int routeId,
        Guid simulationId,
        CancellationToken cancellationToken)
    {
        var active = _state.Find(routeId);

        if (active is null)
        {
            /* Zaten terminal ya da hiç başlamamış: GÜVENLİ başarısızlık.
               Sessizce "başarılı" demek, istemciye durdurmadığı bir şeyi
               durdurmuş gibi gösterirdi. */
            return new CoreOutcome(
                TransportSimulationOperationResultCode.NoActiveSimulation,
                NoActiveSimulationMessage);
        }

        if (active.SimulationId != simulationId)
        {
            /* ASIL YARIŞ KORUMASI: eski bir sekme, yerine geçmiş yeni
               çalıştırmayı — başka kullanıcıların izlediği bir yayını —
               durduramaz. */
            return Stale();
        }

        var terminated = await _terminator.TerminateAsync(routeId, simulationId, cancellationToken);

        return terminated is null
            ? Stale()
            : new CoreOutcome(
                TransportSimulationOperationResultCode.Succeeded,
                string.Empty,
                terminated);
    }

    /// <summary>
    /// YENİDEN BAŞLAT çekirdeği: eski çalıştırmayı bitirir, YERİNE %0'dan yeni
    /// bir çalıştırma kurar.
    /// </summary>
    /// <remarks>
    /// <b>Sıfırla-sonra-başlat DEĞİLDİR.</b> Değiştirme tek atomik adımdır ve
    /// hattın yuvası bir an bile boşalmaz; aksi hâlde araya giren bir başlatma
    /// yuvayı kapabilir ve komut yabancı bir çalıştırmayı vurabilirdi.
    /// </remarks>
    private async Task<CoreOutcome> RestartCoreAsync(
        int routeId,
        Guid simulationId,
        RouteFacts route,
        TransportSimulationPath path,
        int actorId,
        CancellationToken cancellationToken)
    {
        var active = _state.Find(routeId);

        if (active is null)
        {
            return new CoreOutcome(
                TransportSimulationOperationResultCode.NoActiveSimulation,
                NoActiveSimulationMessage);
        }

        if (active.SimulationId != simulationId)
        {
            return Stale();
        }

        // YENİ kimlik, %0 ilerleme, güzergahın İLK köşesi.
        var replacement = NewRun(route, path, actorId, DateTime.UtcNow);

        var replaced = await _replacer.ReplaceAsync(
            routeId,
            simulationId,
            replacement,
            cancellationToken);

        return replaced is null
            ? Stale()
            : new CoreOutcome(
                TransportSimulationOperationResultCode.Succeeded,
                string.Empty,
                replaced.Terminated,
                replacement);
    }

    /* --- ORTAK OKUMALAR VE EŞLEMELER ---------------------------------------------- */

    private Task<bool> RouteExistsAsync(int routeId, CancellationToken cancellationToken) =>
        _dbContext.TransportRoutes
            .IgnoreQueryFilters()
            .AnyAsync(item => item.Id == routeId && !item.IsDeleted, cancellationToken);

    private async Task<IReadOnlySet<int>> ExistingRouteIdsAsync(
        IReadOnlyCollection<int> routeIds,
        CancellationToken cancellationToken) =>
        (await _dbContext.TransportRoutes
            .IgnoreQueryFilters()
            .Where(item => !item.IsDeleted && routeIds.Contains(item.Id))
            .Select(item => item.Id)
            .ToListAsync(cancellationToken))
        .ToHashSet();

    /// <summary>Başlatılabilir rota: silinmemiş VE kullanımda.</summary>
    /// <remarks>
    /// Sıfırlama/duraklatma yalnızca silinmemiş olmayı arar (çalışan bir
    /// yayını, rota pasife alınmış olsa da durdurabilmek gerekir); YENİ bir
    /// çalıştırma kurmak ise başlatmayla AYNI koşulu ister.
    /// </remarks>
    private async Task<RouteFacts?> FindStartableRouteAsync(int routeId, CancellationToken cancellationToken) =>
        await _dbContext.TransportRoutes
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(item => !item.IsDeleted && item.IsActive && item.Id == routeId)
            .Select(item => new RouteFacts(item.Id, item.Name, item.ColorHex))
            .FirstOrDefaultAsync(cancellationToken);

    private async Task<Dictionary<int, RouteFacts>> FindStartableRoutesAsync(
        IReadOnlyCollection<int> routeIds,
        CancellationToken cancellationToken) =>
        (await _dbContext.TransportRoutes
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(item => !item.IsDeleted && item.IsActive && routeIds.Contains(item.Id))
            .Select(item => new RouteFacts(item.Id, item.Name, item.ColorHex))
            .ToListAsync(cancellationToken))
        .ToDictionary(route => route.Id);

    /// <summary>
    /// Kalıcı güzergahı OKUR ve geometriyi sıradan sayılara KOPYALAR.
    /// </summary>
    /// <remarks>
    /// Başlatma da yeniden başlatma da buradan geçer: OSRM çağrılmaz, bayat yol
    /// sessizce yenilenmez ve depoya EF'e bağlı hiçbir nesne girmez.
    /// </remarks>
    private async Task<RunnablePath> ReadRunnablePathAsync(int routeId, CancellationToken cancellationToken)
    {
        var path = await _dbContext.TransportRoutePaths
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.RouteId == routeId, cancellationToken);

        return ToRunnablePath(path);
    }

    private async Task<Dictionary<int, RunnablePath>> ReadRunnablePathsAsync(
        IReadOnlyCollection<int> routeIds,
        CancellationToken cancellationToken)
    {
        var paths = await _dbContext.TransportRoutePaths
            .AsNoTracking()
            .Where(item => routeIds.Contains(item.RouteId))
            .ToListAsync(cancellationToken);

        return paths.ToDictionary(path => path.RouteId, ToRunnablePath);
    }

    private static RunnablePath ToRunnablePath(Domain.Entities.TransportRoutePath? path)
    {
        if (path is null)
        {
            return new RunnablePath(null, TransportSimulationOperationResultCode.PathNotFound, PathNotFoundMessage);
        }

        if (path.IsStale)
        {
            /* Bayat yol bir DOĞRULAMA hatası değildir: istek kusursuzdur,
               sistemin mevcut durumuyla çelişir. */
            return new RunnablePath(null, TransportSimulationOperationResultCode.StalePath, StalePathMessage);
        }

        /* Geometri BURADA sıradan sayılara kopyalanır. Bu satırdan sonra depoya
           giren hiçbir şey EF'e ya da NetTopologySuite nesnelerine bağlı
           değildir. */
        var points = path.Geometry.Coordinates
            .Select(coordinate => new TransportSimulationPoint(coordinate.X, coordinate.Y))
            .ToArray();

        if (points.Length < MinimumPathPoints)
        {
            return new RunnablePath(
                null,
                TransportSimulationOperationResultCode.InsufficientGeometry,
                InsufficientGeometryMessage);
        }

        return new RunnablePath(
            new TransportSimulationPath(
                points,
                path.DistanceMeters,
                path.DurationSeconds,
                path.Profile,
                path.GeneratedAt),
            TransportSimulationOperationResultCode.Succeeded,
            string.Empty);
    }

    /// <summary>
    /// %0'dan YENİ bir çalıştırma. Başlatma ve yeniden başlatma AYNI kurucudan
    /// geçer: ikisi arasında "nereden başlar" sorusunun iki cevabı olamaz.
    /// </summary>
    private static ActiveTransportSimulation NewRun(
        RouteFacts route,
        TransportSimulationPath path,
        int startedByUserId,
        DateTime now) =>
        new(
            SimulationId: Guid.NewGuid(),
            RouteId: route.Id,
            RouteName: route.Name,
            RouteColorHex: route.ColorHex,
            StartedByUserId: startedByUserId,
            StartedAt: now,
            Path: path,
            Snapshot: new TransportSimulationSnapshot(
                Position: path.Points[0],
                SegmentIndex: 0,
                ProgressRatio: 0,
                DistanceCoveredMeters: 0,
                CapturedAt: now));

    private static CoreOutcome Stale() =>
        new(TransportSimulationOperationResultCode.Stale, StaleSimulationMessage);

    private static TransportSimulationOperationResult Result(
        TransportSimulationTargetRequest target,
        CoreOutcome outcome) =>
        new()
        {
            /* İSTENEN kimlikler olduğu gibi geri verilir: istemci sonucu kendi
               dondurulmuş niyetiyle eşleştirir, "şu an hatta ne varsa" ile
               DEĞİL. */
            RequestedRouteId = target.RouteId,
            RequestedSimulationId = target.SimulationId,
            Succeeded = outcome.Succeeded,
            ResultCode = outcome.Code,
            Message = outcome.Message,
            Update = outcome.Update,
            Simulation = outcome.Simulation is null ? null : ToResponse(outcome.Simulation)
        };

    /// <summary>Komut sonucu kodunun mevcut HTTP eşlemesine çevrilmesi.</summary>
    /// <remarks>
    /// İkinci bir hata sistemi kurulmaz: kodlar mevcut
    /// <see cref="ServiceErrorKind"/> kategorilerine düşer. Bayatlık ve durum
    /// önkoşulu ÇAKIŞMADIR (409) — istek kusursuzdur, sistemin o anki
    /// durumuyla çelişir.
    /// </remarks>
    private static ServiceResult<T> MapCode<T>(TransportSimulationOperationResultCode code, string message) =>
        code switch
        {
            TransportSimulationOperationResultCode.RouteNotFound => ServiceResult<T>.NotFound(message),
            TransportSimulationOperationResultCode.NoActiveSimulation => ServiceResult<T>.NotFound(message),
            TransportSimulationOperationResultCode.PathNotFound => ServiceResult<T>.NotFound(message),
            TransportSimulationOperationResultCode.InsufficientGeometry => ServiceResult<T>.Failure(message),
            _ => ServiceResult<T>.Conflict(message)
        };

    /// <summary>Rotanın çalıştırma kurmak için gereken KALICI bilgileri.</summary>
    private sealed record RouteFacts(int Id, string Name, string ColorHex);

    /// <summary>Okunmuş ve kopyalanmış güzergah ya da neden okunamadığı.</summary>
    private readonly record struct RunnablePath(
        TransportSimulationPath? Path,
        TransportSimulationOperationResultCode Code,
        string Message);

    /// <summary>Bir çekirdek ilkelin sonucu; HTTP ve toplu yanıt buradan türer.</summary>
    private sealed record CoreOutcome(
        TransportSimulationOperationResultCode Code,
        string Message,
        TransportSimulationLiveUpdate? Update = null,
        ActiveTransportSimulation? Simulation = null)
    {
        public bool Succeeded => Code == TransportSimulationOperationResultCode.Succeeded;
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
