using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging;
using NetTopologySuite.Geometries;
using NSubstitute;
using StajProject.Api.Authorization;
using StajProject.Api.Controllers;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;
using StajProject.Application.Simulation;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;
using StajProject.Infrastructure.Simulation;

namespace StajProject.Auth.Tests;

/// <summary>
/// PAYLAŞILAN hat simülasyonunun DURAKLAT / DEVAM ETTİR yaşam döngüsü
/// (Faz 3B).
/// </summary>
/// <remarks>
/// <para>
/// Ölçülen asıl iddia SİMÜLASYON SAATİDİR: duraklatılmışken ilerleme donar ve
/// devam ettirmede araç, duraklamada geçen sürenin tamamı kadar İLERİ SIÇRAMAZ.
/// Bu, ham <c>utcNow - StartedAt</c> ölçümünün doğrudan sonucu olurdu; bu
/// yüzden duraklama süresi ayrı ve açık bir muhasebede tutulur ve
/// <c>StartedAt</c> hiç değişmez.
/// </para>
/// <para>
/// İkinci iddia YALITIMDIR: komutlar rota ve çalıştırma kimliğine bağlıdır;
/// bir hattı duraklatmak başka hatları etkilemez. Bu, sonraki fazın çok hatlı
/// yönetim merkezinin temelidir.
/// </para>
/// <para>
/// Zaman DIŞARIDAN verilir (<c>AdvanceAsync(utcNow)</c>); hiçbir test gerçek
/// bekleme yapmaz.
/// </para>
/// </remarks>
public class TransportSimulationPauseResumeTests
{
    /* --- 1. Paused terminal DEĞİLDİR --------------------------------------------- */

    [Fact]
    public void Paused_is_a_declared_non_terminal_status()
    {
        Assert.Equal("Paused", TransportSimulationStatus.Paused.ToString());

        /* Terminal olanlar SADECE ikisidir. Duraklatılmış çalıştırma hattın
           aktif yuvasını işgal etmeye devam eder. */
        Assert.NotEqual(TransportSimulationStatus.Completed, TransportSimulationStatus.Paused);
        Assert.NotEqual(TransportSimulationStatus.Cancelled, TransportSimulationStatus.Paused);
        Assert.NotEqual(TransportSimulationStatus.Running, TransportSimulationStatus.Paused);
    }

    /* --- 2/3/4/5/30. Yetki sözleşmesi -------------------------------------------- */

    [Theory]
    [InlineData(nameof(TransportSimulationController.Pause), "routes/{routeId:int}/{simulationId:guid}/pause")]
    [InlineData(nameof(TransportSimulationController.Resume), "routes/{routeId:int}/{simulationId:guid}/resume")]
    public void The_lifecycle_endpoints_are_gated_by_the_shared_stop_permission(string methodName, string template)
    {
        var method = typeof(TransportSimulationController).GetMethod(methodName)!;
        var http = Assert.Single(method.GetCustomAttributes(typeof(HttpPostAttribute), true).Cast<HttpMethodAttribute>());
        var required = Assert.Single(method.GetCustomAttributes<RequirePermissionAttribute>(true));

        Assert.Equal(template, http.Template);

        /* Bu faz ÜÇ yeni yetki kodu uydurmaz: duraklat/sürdür/sıfırla mevcut
           çalıştırmanın mutasyonlarıdır ve aynı yaşam döngüsü otoritesini
           paylaşır. */
        Assert.Equal(PermissionCodes.TransportSimulationStop, required.PermissionCode);
        Assert.NotEqual(PermissionCodes.TransportSimulationStart, required.PermissionCode);
        Assert.NotEqual(PermissionCodes.TransportView, required.PermissionCode);

        // Komut İKİ kimliği birden taşır.
        Assert.Contains(method.GetParameters(), parameter => parameter.ParameterType == typeof(int));
        Assert.Contains(method.GetParameters(), parameter => parameter.ParameterType == typeof(Guid));
    }

    [Fact]
    public async Task Start_permission_never_satisfies_the_lifecycle_policy_and_the_reverse_holds()
    {
        // start=true, stop=false → yaşam döngüsü mutasyonu YAPAMAZ.
        var starter = Substitute.For<IEffectivePermissionService>();
        starter.HasPermissionAsync(42, PermissionCodes.TransportSimulationStart, Arg.Any<CancellationToken>()).Returns(true);
        starter.HasPermissionAsync(42, PermissionCodes.TransportSimulationStop, Arg.Any<CancellationToken>()).Returns(false);

        var deniedLifecycle = HandlerContext(PermissionCodes.TransportSimulationStop);
        await new PermissionAuthorizationHandler(starter).HandleAsync(deniedLifecycle);
        Assert.False(deniedLifecycle.HasSucceeded);

        // start=false, stop=true → başlatamaz ama duraklat/sürdür/sıfırla YAPAR.
        var operatorOnly = Substitute.For<IEffectivePermissionService>();
        operatorOnly.HasPermissionAsync(42, PermissionCodes.TransportSimulationStop, Arg.Any<CancellationToken>()).Returns(true);
        operatorOnly.HasPermissionAsync(42, PermissionCodes.TransportSimulationStart, Arg.Any<CancellationToken>()).Returns(false);

        var allowedLifecycle = HandlerContext(PermissionCodes.TransportSimulationStop);
        await new PermissionAuthorizationHandler(operatorOnly).HandleAsync(allowedLifecycle);
        Assert.True(allowedLifecycle.HasSucceeded);

        var deniedStart = HandlerContext(PermissionCodes.TransportSimulationStart);
        await new PermissionAuthorizationHandler(operatorOnly).HandleAsync(deniedStart);
        Assert.False(deniedStart.HasSucceeded);
    }

    [Fact]
    public void The_controller_stays_thin_and_carries_no_role_name_shortcut()
    {
        var authorize = Assert.Single(
            typeof(TransportSimulationController)
                .GetCustomAttributes(typeof(AuthorizeAttribute), true)
                .Cast<AuthorizeAttribute>());

        Assert.Null(authorize.Roles);
        Assert.Null(authorize.Policy);

        var dependencies = typeof(TransportSimulationController).GetConstructors().Single()
            .GetParameters().Select(parameter => parameter.ParameterType).ToArray();

        Assert.Contains(typeof(ITransportSimulationService), dependencies);
        Assert.DoesNotContain(typeof(ITransportSimulationStateStore), dependencies);
        Assert.DoesNotContain(typeof(ITransportSimulationLifecycle), dependencies);
        Assert.DoesNotContain(dependencies, type => type.Name.Contains("Role", StringComparison.Ordinal));

        // Çalışma zamanı ilkeli yetki/HTTP taşımaz.
        Assert.DoesNotContain(
            typeof(ITransportSimulationLifecycle).GetMethods(),
            method => method.GetParameters().Any(parameter =>
                parameter.ParameterType.Name.Contains("Principal", StringComparison.Ordinal)
                || parameter.ParameterType.Name.Contains("HttpContext", StringComparison.Ordinal)));
    }

    /* --- 6/7/15/16/17/18. Mutlu yol --------------------------------------------- */

    [Fact]
    public async Task Pause_freezes_the_run_and_broadcasts_paused_with_the_same_identity()
    {
        await using var fixture = await Fixture.WithRunningRouteAsync();
        var run = fixture.Run!;

        // %0'dan biraz ilerlesin ki donan değer anlamlı olsun.
        await fixture.AdvanceAsync(seconds: 30);
        var progressBefore = fixture.Store.Find(fixture.RouteId)!.Snapshot.ProgressRatio;
        Assert.True(progressBefore > 0);

        fixture.Broadcaster.Updates.Clear();
        var paused = await fixture.Service.PauseAsync(fixture.RouteId, run.SimulationId);

        Assert.True(paused.IsSuccess);
        Assert.Equal(TransportSimulationStatus.Paused, paused.Value!.Status);
        // AYNI çalıştırma: duraklatma yeni bir simülasyon üretmez.
        Assert.Equal(run.SimulationId, paused.Value.SimulationId);

        // İlerleme duraklatma anında AYNIDIR.
        AssertClose(progressBefore * 100, paused.Value.ProgressPercent);

        // Kayıt YERİNDE kalır ve terminal değildir.
        var stored = fixture.Store.Find(fixture.RouteId);
        Assert.NotNull(stored);
        Assert.True(stored!.IsPaused);
        Assert.Equal(run.SimulationId, stored.SimulationId);

        // MEVCUT kanaldan ANINDA yayınlanır.
        var published = Assert.Single(fixture.Broadcaster.Updates);
        Assert.Equal(TransportSimulationStatus.Paused, published.Status);
        Assert.Equal(run.SimulationId, published.SimulationId);
        Assert.Equal(fixture.RouteId, published.RouteId);
    }

    [Fact]
    public async Task Resume_broadcasts_running_immediately_without_moving_the_vehicle()
    {
        await using var fixture = await Fixture.WithRunningRouteAsync();
        var run = fixture.Run!;

        await fixture.AdvanceAsync(seconds: 30);
        Assert.True((await fixture.Service.PauseAsync(fixture.RouteId, run.SimulationId)).IsSuccess);

        var frozen = fixture.Store.Find(fixture.RouteId)!.Snapshot;
        fixture.Broadcaster.Updates.Clear();

        var resumed = await fixture.Service.ResumeAsync(fixture.RouteId, run.SimulationId);

        Assert.True(resumed.IsSuccess);
        Assert.Equal(TransportSimulationStatus.Running, resumed.Value!.Status);
        Assert.Equal(run.SimulationId, resumed.Value.SimulationId);

        // Geçiş anında araç TAM OLARAK duraklatıldığı yerdedir.
        AssertClose(frozen.ProgressRatio * 100, resumed.Value.ProgressPercent);

        var published = Assert.Single(fixture.Broadcaster.Updates);
        Assert.Equal(TransportSimulationStatus.Running, published.Status);
        Assert.Equal(run.SimulationId, published.SimulationId);
    }

    /* --- 19/20/21. SAAT: ışınlanma YOKTUR ---------------------------------------- */

    [Fact]
    public async Task Progress_stays_frozen_for_an_arbitrary_paused_duration_and_never_jumps_on_resume()
    {
        /* Sözleşmenin çekirdeği. Hız çarpanı 1 ve yol süresi 100 saniye:
           böylece "10 saniye = %10" ilişkisi elle okunabilir. */
        await using var fixture = await Fixture.WithRunningRouteAsync(pathDurationSeconds: 100, speedMultiplier: 1);
        var run = fixture.Run!;

        await fixture.AdvanceAsync(seconds: 10);
        var atPause = fixture.Store.Find(fixture.RouteId)!.Snapshot.ProgressRatio;
        AssertClose(0.10, atPause);

        Assert.True((await fixture.Service.PauseAsync(fixture.RouteId, run.SimulationId)).IsSuccess);

        /* Duraklatılmışken SAAT DURUR: runner 90 saniye boyunca dönse bile
           ilerleme değişmez ve hiçbir yayın üretilmez. */
        fixture.Broadcaster.Updates.Clear();
        await fixture.AdvanceAsync(seconds: 90);

        AssertClose(atPause, fixture.Store.Find(fixture.RouteId)!.Snapshot.ProgressRatio);
        Assert.Empty(fixture.Broadcaster.Updates);

        // t = 100'de devam: ilerleme HÂLÂ %10'dur.
        Assert.True((await fixture.Service.ResumeAsync(fixture.RouteId, run.SimulationId)).IsSuccess);
        AssertClose(atPause, fixture.Store.Find(fixture.RouteId)!.Snapshot.ProgressRatio);

        /* Devamdan 5 saniye sonra ETKİN geçen süre 15 saniyedir — 105 DEĞİL.
           Ham `utcNow - StartedAt` kullanılsaydı çalıştırma çoktan bitmiş
           olurdu. */
        await fixture.AdvanceAsync(seconds: 5);

        /* Çalıştırma HÂLÂ AKTİFTİR. Bu iddia bilinçlidir: saat ekseni bir
           daha ayrışırsa (duraklama gerçek duvar saatinden ölçülürse) geçen
           süre 105 saniye sanılır, çalıştırma kendiliğinden TAMAMLANIR ve
           depodan silinir. O zaman aşağıdaki okuma bir NullReference ile
           patlar ve gerçek neden görünmez olurdu — burada AÇIK bir mesajla
           düşer. */
        var afterResume = fixture.Store.Find(fixture.RouteId);
        Assert.True(
            afterResume is not null,
            "çalıştırma devam ettirmeden sonra kendiliğinden tamamlandı: duraklama saati ilerletme saatiyle aynı eksende değil");

        AssertClose(0.15, afterResume!.Snapshot.ProgressRatio);

        // Ve çalıştırma hâlâ AYNI kimliktedir; tamamlanmamıştır.
        Assert.Equal(run.SimulationId, afterResume.SimulationId);
    }

    [Fact]
    public void The_pause_clock_never_mutates_StartedAt()
    {
        /* `StartedAt` "bu çalıştırma ne zaman başladı" sorusunun cevabıdır;
           duraklama süresini gizlemek için ileri kaydırmak onu duraklatıldıkça
           sessizce değişen bir değere çevirirdi. */
        var started = new DateTime(2026, 9, 2, 10, 0, 0, DateTimeKind.Utc);
        var run = Simulation(routeId: 7, startedAt: started);

        var paused = run.Pause(started.AddSeconds(10));
        Assert.Equal(started, paused.StartedAt);
        AssertClose(10, paused.ElapsedSeconds(started.AddSeconds(999)));

        var resumed = paused.Resume(started.AddSeconds(100));
        Assert.Equal(started, resumed.StartedAt);
        Assert.Equal(TimeSpan.FromSeconds(90), resumed.AccumulatedPausedDuration);
        Assert.Null(resumed.PausedAt);

        // t = 105 → etkin 15 saniye.
        AssertClose(15, resumed.ElapsedSeconds(started.AddSeconds(105)));

        // İkinci bir duraklama muhasebeye EKLENİR.
        var again = resumed.Pause(started.AddSeconds(105)).Resume(started.AddSeconds(205));
        Assert.Equal(TimeSpan.FromSeconds(190), again.AccumulatedPausedDuration);
        AssertClose(15, again.ElapsedSeconds(started.AddSeconds(205)));
    }

    /* --- 8/9/10/11. Kimlik ve yarış ---------------------------------------------- */

    [Fact]
    public async Task A_wrong_simulation_id_can_neither_pause_nor_resume_the_current_run()
    {
        await using var fixture = await Fixture.WithRunningRouteAsync();
        var run = fixture.Run!;
        fixture.Broadcaster.Updates.Clear();

        var pause = await fixture.Service.PauseAsync(fixture.RouteId, Guid.NewGuid());
        Assert.False(pause.IsSuccess);
        Assert.Equal(ServiceErrorKind.Conflict, pause.ErrorKind);

        var resume = await fixture.Service.ResumeAsync(fixture.RouteId, Guid.NewGuid());
        Assert.False(resume.IsSuccess);
        Assert.Equal(ServiceErrorKind.Conflict, resume.ErrorKind);

        // Çalıştırmaya DOKUNULMADI ve hiçbir yayın üretilmedi.
        Assert.False(fixture.Store.Find(fixture.RouteId)!.IsPaused);
        Assert.Equal(run.SimulationId, fixture.Store.Find(fixture.RouteId)!.SimulationId);
        Assert.Empty(fixture.Broadcaster.Updates);
    }

    [Fact]
    public async Task A_stale_run_identity_can_neither_pause_nor_resume_the_replacement_run()
    {
        await using var fixture = await Fixture.WithRunningRouteAsync();
        var first = fixture.Run!;

        // A sıfırlanır, yerine B başlar.
        Assert.True((await fixture.Service.StopAsync(fixture.RouteId, first.SimulationId)).IsSuccess);
        var second = await fixture.StartAsync();
        Assert.NotEqual(first.SimulationId, second.SimulationId);

        fixture.Broadcaster.Updates.Clear();

        // Hâlâ A'yı tutan eski bir sekme B'ye dokunamaz.
        Assert.Equal(ServiceErrorKind.Conflict, (await fixture.Service.PauseAsync(fixture.RouteId, first.SimulationId)).ErrorKind);
        Assert.Equal(ServiceErrorKind.Conflict, (await fixture.Service.ResumeAsync(fixture.RouteId, first.SimulationId)).ErrorKind);
        Assert.Equal(ServiceErrorKind.Conflict, (await fixture.Service.StopAsync(fixture.RouteId, first.SimulationId)).ErrorKind);

        var stored = fixture.Store.Find(fixture.RouteId)!;
        Assert.Equal(second.SimulationId, stored.SimulationId);
        Assert.False(stored.IsPaused);
        Assert.Empty(fixture.Broadcaster.Updates);
    }

    /* --- 12/13. Durum önkoşulları ------------------------------------------------ */

    [Fact]
    public async Task Pause_requires_running_and_resume_requires_paused()
    {
        await using var fixture = await Fixture.WithRunningRouteAsync();
        var run = fixture.Run!;

        // Çalışan bir çalıştırma "sürdürülemez": muhasebeye sahte süre eklenirdi.
        var earlyResume = await fixture.Service.ResumeAsync(fixture.RouteId, run.SimulationId);
        Assert.False(earlyResume.IsSuccess);
        Assert.Equal(ServiceErrorKind.Conflict, earlyResume.ErrorKind);

        Assert.True((await fixture.Service.PauseAsync(fixture.RouteId, run.SimulationId)).IsSuccess);

        // İkinci duraklatma reddedilir: PausedAt ileri kayar ve süre eksik sayılırdı.
        var doublePause = await fixture.Service.PauseAsync(fixture.RouteId, run.SimulationId);
        Assert.False(doublePause.IsSuccess);
        Assert.Equal(ServiceErrorKind.Conflict, doublePause.ErrorKind);

        Assert.True((await fixture.Service.ResumeAsync(fixture.RouteId, run.SimulationId)).IsSuccess);

        // İkinci sürdürme de reddedilir.
        Assert.Equal(
            ServiceErrorKind.Conflict,
            (await fixture.Service.ResumeAsync(fixture.RouteId, run.SimulationId)).ErrorKind);
    }

    /* --- 14/22/23/24/25/26. Duraklatılmış çalıştırmanın yuvası ------------------- */

    [Fact]
    public async Task A_paused_run_still_occupies_the_route_and_blocks_a_second_start()
    {
        await using var fixture = await Fixture.WithRunningRouteAsync();
        var run = fixture.Run!;

        Assert.True((await fixture.Service.PauseAsync(fixture.RouteId, run.SimulationId)).IsSuccess);

        // Duraklatılmış hat BOŞ DEĞİLDİR.
        var blocked = await fixture.Service.StartAsync(fixture.RouteId);
        Assert.False(blocked.IsSuccess);
        Assert.Equal(ServiceErrorKind.Conflict, blocked.ErrorKind);

        // Durum ucu ve canlı görüntü onu DURAKLATILMIŞ olarak bildirir.
        var active = await fixture.Service.GetActiveAsync(fixture.RouteId);
        Assert.True(active.IsSuccess);
        Assert.Equal(TransportSimulationStatus.Paused, fixture.Service.FindActiveLiveUpdate(fixture.RouteId)!.Status);
    }

    [Fact]
    public async Task A_late_running_tick_cannot_overwrite_a_paused_run()
    {
        await using var fixture = await Fixture.WithRunningRouteAsync();
        var run = fixture.Run!;

        await fixture.AdvanceAsync(seconds: 20);
        Assert.True((await fixture.Service.PauseAsync(fixture.RouteId, run.SimulationId)).IsSuccess);

        var frozen = fixture.Store.Find(fixture.RouteId)!.Snapshot;

        /* Duraklatma ile yarışan, yolda olan bir tick donmuş konumu ileri
           taşıyamaz ve durumu Running'e geri çeviremez. */
        Assert.False(fixture.Store.TryUpdateSnapshot(
            fixture.RouteId,
            run.SimulationId,
            new TransportSimulationSnapshot(new TransportSimulationPoint(31, 41), 1, 0.99, 490, DateTime.UtcNow)));

        var stored = fixture.Store.Find(fixture.RouteId)!;
        Assert.True(stored.IsPaused);
        AssertClose(frozen.ProgressRatio, stored.Snapshot.ProgressRatio);
    }

    [Fact]
    public async Task Reset_and_internal_cancellation_both_work_on_a_paused_run()
    {
        await using var fixture = await Fixture.WithRunningRouteAsync();
        var run = fixture.Run!;
        Assert.True((await fixture.Service.PauseAsync(fixture.RouteId, run.SimulationId)).IsSuccess);
        fixture.Broadcaster.Updates.Clear();

        // SIFIRLA mevcut terminal ilkelini yeniden kullanır: Cancelled.
        var reset = await fixture.Service.StopAsync(fixture.RouteId, run.SimulationId);
        Assert.True(reset.IsSuccess);
        Assert.Equal(TransportSimulationStatus.Cancelled, reset.Value!.Status);
        Assert.Null(fixture.Store.Find(fixture.RouteId));

        // Sıfırlamadan sonra başlatma YENİ kimlikle ve %0'dan olur.
        var restarted = await fixture.StartAsync();
        Assert.NotEqual(run.SimulationId, restarted.SimulationId);
        Assert.Equal(0, restarted.ProgressRatio);

        // İç iptal de duraklatılmış çalıştırmada çalışır ve yetki İSTEMEZ.
        Assert.True((await fixture.Service.PauseAsync(fixture.RouteId, restarted.SimulationId)).IsSuccess);
        ITransportSimulationCanceller canceller = fixture.Runner;
        await canceller.CancelForRoutesAsync([fixture.RouteId]);
        Assert.Null(fixture.Store.Find(fixture.RouteId));
    }

    /* --- OKUMA SÖZLEŞMESİ: REST durumu da kanoniktir ----------------------------- */

    [Fact]
    public void The_read_response_carries_the_canonical_status_vocabulary()
    {
        /* REST ile canlı yayın AYNI tipi taşır; ikinci bir durum sözlüğü
           uydurulmadı. Enum'un kendisi JsonStringEnumConverter taşıdığı için
           tel üzerinde AD olarak gider ve istemci tek bir temsil çözer. */
        var status = typeof(TransportSimulationResponse).GetProperty(nameof(TransportSimulationResponse.Status));

        Assert.NotNull(status);
        Assert.Equal(typeof(TransportSimulationStatus), status!.PropertyType);
        Assert.Equal(
            status.PropertyType,
            typeof(TransportSimulationLiveUpdate)
                .GetProperty(nameof(TransportSimulationLiveUpdate.Status))!
                .PropertyType);
    }

    [Fact]
    public async Task The_status_read_path_reports_running_paused_and_running_again_for_the_same_run()
    {
        /* SERT YENİLEME SÖZLEŞMESİ. Panel, HİÇBİR SignalR olayı gelmeden
           yalnızca okuma yolundan doğru yaşam döngüsünü çizebilmelidir:
           duraklatılmış bir hat "çalışıyor" görünüp yanlış düğmeyi
           (Duraklat) sunamaz. */
        await using var fixture = await Fixture.WithRunningRouteAsync(pathDurationSeconds: 100, speedMultiplier: 1);
        var run = fixture.Run!;

        // Başlatma yanıtı da kanonik durumu taşır.
        Assert.Equal(TransportSimulationStatus.Running, run.Status);

        await fixture.AdvanceAsync(seconds: 37);
        var running = (await fixture.Service.GetActiveAsync(fixture.RouteId)).Value!;
        Assert.Equal(TransportSimulationStatus.Running, running.Status);

        Assert.True((await fixture.Service.PauseAsync(fixture.RouteId, run.SimulationId)).IsSuccess);

        var paused = (await fixture.Service.GetActiveAsync(fixture.RouteId)).Value!;

        // DURUM duraklatılmıştır; KİMLİK ve İLERLEME aynı kalır.
        Assert.Equal(TransportSimulationStatus.Paused, paused.Status);
        Assert.Equal(run.SimulationId, paused.SimulationId);
        AssertClose(running.ProgressRatio, paused.ProgressRatio);
        Assert.Equal(running.Longitude, paused.Longitude);
        Assert.Equal(running.Latitude, paused.Latitude);

        // Sürdürme okuma yolunda da Running'e döner.
        Assert.True((await fixture.Service.ResumeAsync(fixture.RouteId, run.SimulationId)).IsSuccess);
        var resumed = (await fixture.Service.GetActiveAsync(fixture.RouteId)).Value!;
        Assert.Equal(TransportSimulationStatus.Running, resumed.Status);
        Assert.Equal(run.SimulationId, resumed.SimulationId);
    }

    [Fact]
    public async Task The_read_status_is_never_inferred_from_progress_or_leftover_fields()
    {
        /* İlerleme ilerledikçe durum DEĞİŞMEZ ve duraklatma yalnızca gerçek
           duraklatma komutundan doğar. Durumu ilerlemeden ya da PausedAt'in
           dolu olmasından türetmek, otoriteyi sessizce ikinci bir yere
           taşırdı. */
        await using var fixture = await Fixture.WithRunningRouteAsync(pathDurationSeconds: 100, speedMultiplier: 1);
        var run = fixture.Run!;

        foreach (var seconds in (double[])[5, 20, 40])
        {
            await fixture.AdvanceAsync(seconds);
            var reading = (await fixture.Service.GetActiveAsync(fixture.RouteId)).Value!;
            Assert.Equal(TransportSimulationStatus.Running, reading.Status);
            Assert.True(reading.ProgressRatio > 0);
        }

        // Duraklat → sürdür sonrası PausedAt temizlenir ve durum Running kalır.
        Assert.True((await fixture.Service.PauseAsync(fixture.RouteId, run.SimulationId)).IsSuccess);
        Assert.True((await fixture.Service.ResumeAsync(fixture.RouteId, run.SimulationId)).IsSuccess);

        var afterResume = (await fixture.Service.GetActiveAsync(fixture.RouteId)).Value!;
        Assert.Equal(TransportSimulationStatus.Running, afterResume.Status);
        Assert.Null(fixture.Store.Find(fixture.RouteId)!.PausedAt);

        /* Ve duraklama muhasebesi DOLU olsa bile durum Running'dir: geçmişte
           duraklamış olmak "duraklatılmış" demek değildir. */
        Assert.True(fixture.Store.Find(fixture.RouteId)!.AccumulatedPausedDuration >= TimeSpan.Zero);
    }

    [Fact]
    public async Task The_status_read_endpoint_returns_the_mapped_status_not_merely_a_dto_property()
    {
        /* Sınıfta bir özellik BULUNMASI, ucun onu DOLDURDUĞU anlamına gelmez.
           Bu yüzden gerçek okuma ucu (controller → servis → depo) çağrılır ve
           gövdedeki değer okunur. */
        await using var fixture = await Fixture.WithRunningRouteAsync();
        var run = fixture.Run!;

        Assert.True((await fixture.Service.PauseAsync(fixture.RouteId, run.SimulationId)).IsSuccess);

        var controller = new TransportSimulationController(
            fixture.Service,
            Substitute.For<ILogger<TransportSimulationController>>())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };

        var response = await controller.GetActive(fixture.RouteId, CancellationToken.None);
        var body = Assert.IsType<TransportSimulationResponse>(
            Assert.IsAssignableFrom<ObjectResult>(response.Result).Value);

        Assert.Equal(TransportSimulationStatus.Paused, body.Status);
        Assert.Equal(run.SimulationId, body.SimulationId);
    }

    [Fact]
    public async Task Each_route_reports_its_own_status_through_the_read_path()
    {
        /* Okuma yolu da ROTA BAŞINADIR: bir hattı duraklatmak diğerinin
           bildirdiği durumu değiştirmez. */
        await using var fixture = await Fixture.WithRunningRouteAsync();
        var runA = fixture.Run!;

        var routeB = await fixture.AddRouteAsync();
        await fixture.AddPathAsync(routeB);
        var runB = (await fixture.Service.StartAsync(routeB.Id)).Value!;

        Assert.True((await fixture.Service.PauseAsync(fixture.RouteId, runA.SimulationId)).IsSuccess);

        var readA = (await fixture.Service.GetActiveAsync(fixture.RouteId)).Value!;
        var readB = (await fixture.Service.GetActiveAsync(routeB.Id)).Value!;

        Assert.Equal(TransportSimulationStatus.Paused, readA.Status);
        Assert.Equal(runA.SimulationId, readA.SimulationId);

        Assert.Equal(TransportSimulationStatus.Running, readB.Status);
        Assert.Equal(runB.SimulationId, readB.SimulationId);
    }

    /* --- 27/28/29. ÇOK HATLI YALITIM (Faz 4'ün temeli) --------------------------- */

    [Fact]
    public async Task Lifecycle_commands_are_scoped_to_one_route_and_never_touch_the_others()
    {
        await using var fixture = await Fixture.WithRunningRouteAsync();
        var runA = fixture.Run!;

        var routeB = await fixture.AddRouteAsync();
        await fixture.AddPathAsync(routeB);
        var runB = (await fixture.Service.StartAsync(routeB.Id)).Value!;

        var routeC = await fixture.AddRouteAsync();
        await fixture.AddPathAsync(routeC);
        var runC = (await fixture.Service.StartAsync(routeC.Id)).Value!;

        // A duraklatılır: B ve C ÇALIŞMAYA devam eder.
        Assert.True((await fixture.Service.PauseAsync(fixture.RouteId, runA.SimulationId)).IsSuccess);
        Assert.True(fixture.Store.Find(fixture.RouteId)!.IsPaused);
        Assert.False(fixture.Store.Find(routeB.Id)!.IsPaused);
        Assert.False(fixture.Store.Find(routeC.Id)!.IsPaused);

        // A duraklatılmışken B YİNE DE başlatılamaz (kendi yuvası dolu) ama
        // yeni bir hat başlatılabilir: küresel bir duraklama bayrağı YOKTUR.
        var routeD = await fixture.AddRouteAsync();
        await fixture.AddPathAsync(routeD);
        Assert.True((await fixture.Service.StartAsync(routeD.Id)).IsSuccess);

        // A sürdürülür: yalnızca A.
        Assert.True((await fixture.Service.ResumeAsync(fixture.RouteId, runA.SimulationId)).IsSuccess);
        Assert.False(fixture.Store.Find(fixture.RouteId)!.IsPaused);
        Assert.False(fixture.Store.Find(routeB.Id)!.IsPaused);

        // B sıfırlanır: yalnızca B biter.
        Assert.True((await fixture.Service.StopAsync(routeB.Id, runB.SimulationId)).IsSuccess);
        Assert.Null(fixture.Store.Find(routeB.Id));
        Assert.NotNull(fixture.Store.Find(fixture.RouteId));
        Assert.Equal(runC.SimulationId, fixture.Store.Find(routeC.Id)!.SimulationId);
        Assert.NotNull(fixture.Store.Find(routeD.Id));

        // Küresel tek bir aktif simülasyon kavramı yoktur.
        Assert.Equal(3, fixture.Store.Active().Count);
    }

    [Fact]
    public async Task A_paused_route_does_not_freeze_the_runner_for_other_routes()
    {
        await using var fixture = await Fixture.WithRunningRouteAsync(pathDurationSeconds: 100, speedMultiplier: 1);
        var runA = fixture.Run!;

        var routeB = await fixture.AddRouteAsync();
        await fixture.AddPathAsync(routeB);
        var runB = (await fixture.Service.StartAsync(routeB.Id)).Value!;

        await fixture.AdvanceAsync(seconds: 10);
        Assert.True((await fixture.Service.PauseAsync(fixture.RouteId, runA.SimulationId)).IsSuccess);

        var frozenA = fixture.Store.Find(fixture.RouteId)!.Snapshot.ProgressRatio;
        var beforeB = fixture.Store.Find(routeB.Id)!.Snapshot.ProgressRatio;

        await fixture.AdvanceAsync(seconds: 20);

        // A donmuş, B ilerlemiştir: saat ÇALIŞTIRMA BAŞINA tutulur.
        AssertClose(frozenA, fixture.Store.Find(fixture.RouteId)!.Snapshot.ProgressRatio);
        Assert.True(fixture.Store.Find(routeB.Id)!.Snapshot.ProgressRatio > beforeB);
        Assert.Equal(runB.SimulationId, fixture.Store.Find(routeB.Id)!.SimulationId);
    }

    /* --- Yardımcılar -------------------------------------------------------------- */

    /// <summary>
    /// Kayan nokta karşılaştırması TOLERANSLA yapılır: ilerleme oranı bölme
    /// ve çarpma sonucudur, bit birebir eşitlik beklemek kırılgan olurdu.
    /// </summary>
    private static void AssertClose(double expected, double actual, double tolerance = 1e-6) =>
        Assert.True(
            Math.Abs(expected - actual) <= tolerance,
            $"beklenen {expected}, bulunan {actual} (tolerans {tolerance})");

    private static AuthorizationHandlerContext HandlerContext(string permissionCode)
    {
        var requirement = new PermissionRequirement(permissionCode);
        var principal = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, "42")],
            "test"));
        return new AuthorizationHandlerContext([requirement], principal, resource: null);
    }

    private static ActiveTransportSimulation Simulation(int routeId, DateTime startedAt)
    {
        var points = new TransportSimulationPoint[] { new(30, 40), new(31, 41) };
        return new ActiveTransportSimulation(
            Guid.NewGuid(), routeId, "Hat", "#123456", 42, startedAt,
            new TransportSimulationPath(points, 500, 100, "driving", startedAt),
            new TransportSimulationSnapshot(points[0], 0, 0, 0, startedAt));
    }

    private sealed class RecordingBroadcaster : ITransportSimulationBroadcaster
    {
        public List<TransportSimulationLiveUpdate> Updates { get; } = [];

        public Task PublishAsync(
            TransportSimulationLiveUpdate update,
            CancellationToken cancellationToken = default)
        {
            Updates.Add(update);
            return Task.CompletedTask;
        }
    }

    /// <summary>
    /// Fixture'ın SENTETİK saati. Runner'ın ilerletme saatiyle AYNI ekseni
    /// paylaşır; böylece duraklama muhasebesi de deterministik olur ve hiçbir
    /// test gerçek bekleme yapmaz.
    /// </summary>
    private sealed class SyntheticTimeProvider : TimeProvider
    {
        public DateTime UtcNow { get; set; } = DateTime.UtcNow;

        public override DateTimeOffset GetUtcNow() => new(UtcNow, TimeSpan.Zero);
    }

    private sealed class Fixture : IAsyncDisposable
    {
        private const int UserId = 42;

        private readonly SyntheticTimeProvider _time = new();

        private Fixture(AppDbContext db, double speedMultiplier)
        {
            Db = db;
            Store = new InMemoryTransportSimulationStateStore();
            Broadcaster = new RecordingBroadcaster();

            var currentUser = Substitute.For<ICurrentUserService>();
            currentUser.UserId.Returns(UserId);
            currentUser.IsAuthenticated.Returns(true);

            Runner = new TransportSimulationRunner(
                Store,
                Broadcaster,
                new TransportSimulationOptions
                {
                    TickIntervalMilliseconds = 1_000,
                    SpeedMultiplier = speedMultiplier,
                    FallbackDurationSeconds = 300
                },
                Substitute.For<ILogger<TransportSimulationRunner>>(),
                _time);

            Service = new TransportSimulationService(db, currentUser, Store, Runner, Runner, Runner);
        }

        public AppDbContext Db { get; }
        public InMemoryTransportSimulationStateStore Store { get; }
        public RecordingBroadcaster Broadcaster { get; }
        public TransportSimulationRunner Runner { get; }
        public TransportSimulationService Service { get; }

        public TransportSimulationResponse? Run { get; private set; }
        public int RouteId { get; private set; }

        private double PathDurationSeconds { get; set; }

        /// <summary>
        /// Deterministik saat: gerçek bekleme YOKTUR.
        /// </summary>
        /// <remarks>
        /// Yazma AYNI ANDA sentetik sağlayıcıyı da ilerletir; ilerletme ile
        /// duraklat/sürdür TEK bir zaman ekseninde kalır. İkisi ayrışsaydı
        /// duraklama süresi gerçek duvar saatinden (yani ~0) ölçülür ve
        /// çalıştırma testin ortasında kendiliğinden TAMAMLANIRDI.
        /// </remarks>
        private DateTime Clock
        {
            get => _time.UtcNow;
            set => _time.UtcNow = value;
        }

        public static async Task<Fixture> WithRunningRouteAsync(
            double pathDurationSeconds = 300,
            double speedMultiplier = 1)
        {
            var options = new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase($"transport-pause-{Guid.NewGuid():N}")
                .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
                .Options;

            var fixture = new Fixture(new AppDbContext(options), speedMultiplier)
            {
                PathDurationSeconds = pathDurationSeconds
            };

            var route = await fixture.AddRouteAsync();
            await fixture.AddPathAsync(route);
            fixture.RouteId = route.Id;
            fixture.Run = await fixture.StartAsync();
            fixture.Clock = fixture.Store.Find(route.Id)!.StartedAt;
            fixture.Broadcaster.Updates.Clear();
            return fixture;
        }

        public async Task<TransportSimulationResponse> StartAsync()
        {
            var started = await Service.StartAsync(RouteId);
            Assert.True(started.IsSuccess);
            return started.Value!;
        }

        /// <summary>Saati ilerletir ve runner'ı O ANDA çalıştırır.</summary>
        public Task AdvanceAsync(double seconds)
        {
            Clock = Clock.AddSeconds(seconds);
            return Runner.AdvanceAsync(Clock);
        }

        public async Task<TransportRoute> AddRouteAsync()
        {
            var route = new TransportRoute
            {
                Name = "Hat",
                ColorHex = "#123456",
                IsActive = true,
                IsDeleted = false,
                CreatedDate = DateTime.UtcNow
            };
            Db.TransportRoutes.Add(route);
            await Db.SaveChangesAsync();
            return route;
        }

        public async Task<TransportRoutePath> AddPathAsync(TransportRoute route)
        {
            var path = new TransportRoutePath
            {
                RouteId = route.Id,
                Geometry = new LineString([new Coordinate(30, 40), new Coordinate(31, 41)]) { SRID = 4326 },
                DistanceMeters = 500,
                DurationSeconds = PathDurationSeconds,
                Profile = "driving",
                GeneratedAt = DateTime.UtcNow,
                IsStale = false
            };
            Db.TransportRoutePaths.Add(path);
            await Db.SaveChangesAsync();
            return path;
        }

        public ValueTask DisposeAsync() => Db.DisposeAsync();
    }
}
