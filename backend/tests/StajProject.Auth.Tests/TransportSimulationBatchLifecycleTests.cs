using System.Collections.Concurrent;
using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.AspNetCore.SignalR;
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
/// ÇOK HATLI paylaşılan simülasyon yönetimi (Faz 4B).
/// </summary>
/// <remarks>
/// <para>
/// Ölçülen asıl iddia ÇALIŞTIRMA KİMLİĞİDİR. Toplu komut, tekil komutun
/// gevşetilmiş hâli DEĞİLDİR: her hedef kendi rota VE çalıştırma kimliğini
/// taşır, bayat bir hedef yerine geçmiş yeni çalıştırmaya DOKUNAMAZ ve
/// başarısız bir hedef kardeşlerinin uygulanmış komutunu geri almaz.
/// </para>
/// <para>
/// İkinci iddia YENİDEN BAŞLATMANIN yarış güvenliğidir: hattın aktif yuvası
/// bir an bile boşalmaz, dolayısıyla "sıfırla sonra başlat" penceresinden
/// çalınacak bir hat yoktur. Aynı kimlik ASLA geri sarılmaz — sonuç daima
/// YENİ bir çalıştırmadır.
/// </para>
/// <para>
/// Zaman DIŞARIDAN verilir; hiçbir test gerçek bekleme yapmaz.
/// </para>
/// </remarks>
public class TransportSimulationBatchLifecycleTests
{
    /* --- 1-5. İSTEK SÖZLEŞMESİ ---------------------------------------------------- */

    [Theory]
    [InlineData(TransportSimulationBatchOperation.Pause)]
    [InlineData(TransportSimulationBatchOperation.Resume)]
    [InlineData(TransportSimulationBatchOperation.Reset)]
    [InlineData(TransportSimulationBatchOperation.Restart)]
    public async Task An_empty_or_missing_target_list_is_rejected(TransportSimulationBatchOperation operation)
    {
        await using var fixture = await Fixture.CreateAsync();

        var missing = await fixture.Service.ExecuteBatchAsync(operation, null);
        var nullTargets = await fixture.Service.ExecuteBatchAsync(operation, new TransportSimulationBatchRequest());
        var empty = await fixture.Service.ExecuteBatchAsync(
            operation,
            new TransportSimulationBatchRequest { Targets = [] });

        foreach (var result in new[] { missing, nullTargets, empty })
        {
            Assert.False(result.IsSuccess);
            // Gövde kusurlu: DOĞRULAMA hatasıdır, çakışma değil.
            Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
        }
    }

    [Fact]
    public async Task A_malformed_route_identifier_is_rejected()
    {
        await using var fixture = await Fixture.CreateAsync();

        foreach (var routeId in new[] { 0, -1 })
        {
            var result = await fixture.Service.ExecuteBatchAsync(
                TransportSimulationBatchOperation.Pause,
                Request((routeId, Guid.NewGuid())));

            Assert.False(result.IsSuccess);
            Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
        }
    }

    [Fact]
    public async Task An_empty_simulation_identifier_is_rejected_and_never_treated_as_a_wildcard()
    {
        await using var fixture = await Fixture.CreateAsync();
        var run = await fixture.StartRouteAsync("A");

        var result = await fixture.Service.ExecuteBatchAsync(
            TransportSimulationBatchOperation.Reset,
            Request((run.RouteId, Guid.Empty)));

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);

        // Ve hiçbir şey durmadı: boş kimlik "hattaki güncel olan" demek DEĞİLDİR.
        Assert.NotNull(fixture.Store.Find(run.RouteId));
    }

    [Fact]
    public async Task The_same_route_cannot_be_targeted_twice_in_one_batch()
    {
        await using var fixture = await Fixture.CreateAsync();
        var run = await fixture.StartRouteAsync("A");

        var result = await fixture.Service.ExecuteBatchAsync(
            TransportSimulationBatchOperation.Pause,
            Request((run.RouteId, run.SimulationId), (run.RouteId, Guid.NewGuid())));

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);

        // Belirsiz istek HİÇ uygulanmaz: hat hâlâ çalışıyor.
        Assert.Equal(TransportSimulationStatus.Running, fixture.Store.Find(run.RouteId)!.Status);
    }

    [Fact]
    public async Task More_targets_than_the_declared_maximum_are_rejected()
    {
        await using var fixture = await Fixture.CreateAsync();

        var targets = Enumerable
            .Range(1, TransportSimulationBatch.MaxTargets + 1)
            .Select(routeId => (routeId, Guid.NewGuid()))
            .ToArray();

        var result = await fixture.Service.ExecuteBatchAsync(
            TransportSimulationBatchOperation.Reset,
            Request(targets));

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);

        // Sınır DETERMİNİSTİKTİR ve sınırsız bir yığın kabul edilmez.
        Assert.Equal(100, TransportSimulationBatch.MaxTargets);
    }

    /* --- 6. SONUÇ SIRASI ---------------------------------------------------------- */

    [Fact]
    public async Task Results_come_back_in_request_order_regardless_of_completion_order()
    {
        await using var fixture = await Fixture.CreateAsync();

        var a = await fixture.StartRouteAsync("A");
        var b = await fixture.StartRouteAsync("B");
        var c = await fixture.StartRouteAsync("C");

        /* Sıra BİLEREK alfabetik/artan DEĞİLDİR: yanıt, isteğin sırasını
           korumalıdır — ne rota kimliğinin ne de görev tamamlanmasının
           sırasını. */
        var requested = new[]
        {
            (c.RouteId, c.SimulationId),
            (a.RouteId, a.SimulationId),
            (b.RouteId, b.SimulationId)
        };

        var result = await fixture.Service.ExecuteBatchAsync(
            TransportSimulationBatchOperation.Pause,
            Request(requested));

        Assert.True(result.IsSuccess);

        Assert.Equal(
            requested.Select(target => target.Item1),
            result.Value!.Results.Select(item => item.RequestedRouteId));

        Assert.Equal(
            requested.Select(target => target.Item2),
            result.Value!.Results.Select(item => item.RequestedSimulationId));
    }

    /* --- 7-15. YETKİ SÖZLEŞMESİ --------------------------------------------------- */

    [Theory]
    [InlineData(nameof(TransportSimulationController.BatchPause), "batch/pause")]
    [InlineData(nameof(TransportSimulationController.BatchResume), "batch/resume")]
    [InlineData(nameof(TransportSimulationController.BatchReset), "batch/reset")]
    public void Pause_resume_and_reset_batches_require_only_the_shared_lifecycle_permission(
        string methodName,
        string template)
    {
        var method = typeof(TransportSimulationController).GetMethod(methodName)!;
        var http = Assert.Single(method
            .GetCustomAttributes(typeof(HttpPostAttribute), true)
            .Cast<HttpMethodAttribute>());

        Assert.Equal(template, http.Template);

        var required = Assert.Single(method.GetCustomAttributes<RequirePermissionAttribute>(true));
        Assert.Equal(PermissionCodes.TransportSimulationStop, required.PermissionCode);

        // Bu faz üç yeni yetki kodu UYDURMAZ.
        Assert.NotEqual(PermissionCodes.TransportSimulationStart, required.PermissionCode);
        Assert.NotEqual(PermissionCodes.TransportView, required.PermissionCode);
    }

    [Fact]
    public void Restart_declares_both_the_stop_and_the_start_permission()
    {
        var method = typeof(TransportSimulationController)
            .GetMethod(nameof(TransportSimulationController.BatchRestart))!;

        var http = Assert.Single(method
            .GetCustomAttributes(typeof(HttpPostAttribute), true)
            .Cast<HttpMethodAttribute>());
        Assert.Equal("batch/restart", http.Template);

        var codes = method
            .GetCustomAttributes<RequirePermissionAttribute>(true)
            .Select(attribute => attribute.PermissionCode)
            .OrderBy(code => code, StringComparer.Ordinal)
            .ToArray();

        Assert.Equal(
            new[] { PermissionCodes.TransportSimulationStart, PermissionCodes.TransportSimulationStop }
                .OrderBy(code => code, StringComparer.Ordinal),
            codes);

        // Öznitelik birden çok kez uygulanabilir olmalıdır; yoksa VE kurulamaz.
        var usage = typeof(RequirePermissionAttribute)
            .GetCustomAttribute<AttributeUsageAttribute>()!;
        Assert.True(usage.AllowMultiple);
    }

    /// <summary>
    /// YIĞILMIŞ <c>[RequirePermission]</c> gerçekten mantıksal VE midir?
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Varsayılmaz, KANITLANIR.</b> ASP.NET Core aynı endpoint'teki tüm
    /// authorization verilerini TEK bir politikada birleştirir ve
    /// <see cref="AuthorizationHandlerContext.HasSucceeded"/> ancak
    /// requirement'ların TAMAMI sağlandığında doğrudur. Test bu kuralı iki
    /// requirement'lı tek bir bağlam üzerinde ölçer: yalnızca biri sağlanırsa
    /// bağlam BAŞARISIZDIR.
    /// </para>
    /// <para>
    /// Kural VEYA olsaydı, yalnızca başlatma yetkisi olan bir kullanıcı çok
    /// kullanıcılı yayınları sonlandırabilirdi.
    /// </para>
    /// </remarks>
    [Theory]
    [InlineData(false, false, false)]
    [InlineData(true, false, false)]
    [InlineData(false, true, false)]
    [InlineData(true, true, true)]
    public async Task Stacked_permission_requirements_are_a_logical_and(bool canStop, bool canStart, bool allowed)
    {
        var permissions = Substitute.For<IEffectivePermissionService>();
        permissions
            .HasPermissionAsync(42, PermissionCodes.TransportSimulationStop, Arg.Any<CancellationToken>())
            .Returns(canStop);
        permissions
            .HasPermissionAsync(42, PermissionCodes.TransportSimulationStart, Arg.Any<CancellationToken>())
            .Returns(canStart);

        var handler = new PermissionAuthorizationHandler(permissions);

        var context = new AuthorizationHandlerContext(
            [
                new PermissionRequirement(PermissionCodes.TransportSimulationStop),
                new PermissionRequirement(PermissionCodes.TransportSimulationStart)
            ],
            new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, "42")], "test")),
            resource: null);

        /* GERÇEK ve KAMUYA AÇIK giriş noktası kullanılır: `HandleAsync`,
           `AuthorizationHandler<PermissionRequirement>`'in bağlamdaki TÜM
           `PermissionRequirement`'ları gezip korumalı `HandleRequirementAsync`'i
           kendi çağırdığı yoldur — yani politikanın çalışma zamanında izlediği
           yolun aynısı. Korumalı metodu testten doğrudan çağırmak, üretimin
           kapsüllemesini test uğruna açmayı gerektirirdi ve ölçülen şey artık
           gerçek hat olmazdı. Depodaki mevcut kalıp da budur. */
        await handler.HandleAsync(context);

        /* Ve başarı TEST TARAFINDAN UYDURULMAZ: `context.Succeed(...)` burada
           çağrılmaz. Denetlenen tek sahte, etkin yetki KAYNAĞIDIR — dört
           kombinasyon onunla kurulur; kararı handler'ın kendisi verir. */
        Assert.Equal(allowed, context.HasSucceeded);
    }

    [Fact]
    public void No_role_name_or_username_shortcut_guards_the_batch_surface()
    {
        var authorize = Assert.Single(typeof(TransportSimulationController)
            .GetCustomAttributes(typeof(AuthorizeAttribute), true)
            .Cast<AuthorizeAttribute>());

        Assert.Null(authorize.Roles);
        Assert.Null(authorize.Policy);

        // Ve üçüncü bir yetki kodu (transport.simulation.restart) UYDURULMADI.
        Assert.DoesNotContain(
            PermissionCatalog.AllCodes,
            code => code.Contains("restart", StringComparison.OrdinalIgnoreCase)
                || code.Contains("batch", StringComparison.OrdinalIgnoreCase));
    }

    /* --- 16-21. DURAKLAT ---------------------------------------------------------- */

    [Fact]
    public async Task Batch_pause_freezes_only_the_requested_runs_and_keeps_their_identity()
    {
        await using var fixture = await Fixture.CreateAsync();

        var a = await fixture.StartRouteAsync("A");
        var b = await fixture.StartRouteAsync("B");

        await fixture.AdvanceAsync(seconds: 10);

        var progressA = fixture.Store.Find(a.RouteId)!.Snapshot.ProgressRatio;
        Assert.True(progressA > 0);

        var result = await fixture.Service.ExecuteBatchAsync(
            TransportSimulationBatchOperation.Pause,
            Request((a.RouteId, a.SimulationId)));

        var single = Assert.Single(result.Value!.Results);
        Assert.True(single.Succeeded);
        Assert.Equal(TransportSimulationOperationResultCode.Succeeded, single.ResultCode);

        var pausedA = fixture.Store.Find(a.RouteId)!;

        // AYNI çalıştırma: kimlik ve ilerleme değişmez.
        Assert.Equal(a.SimulationId, pausedA.SimulationId);
        Assert.Equal(TransportSimulationStatus.Paused, pausedA.Status);
        AssertClose(progressA, pausedA.Snapshot.ProgressRatio);

        // B'ye DOKUNULMADI ve ilerlemeye devam eder.
        Assert.Equal(TransportSimulationStatus.Running, fixture.Store.Find(b.RouteId)!.Status);
        var beforeB = fixture.Store.Find(b.RouteId)!.Snapshot.ProgressRatio;
        await fixture.AdvanceAsync(seconds: 10);
        Assert.True(fixture.Store.Find(b.RouteId)!.Snapshot.ProgressRatio > beforeB);

        // A donmuş kalır.
        AssertClose(progressA, fixture.Store.Find(a.RouteId)!.Snapshot.ProgressRatio);

        // Aktif küme ÜYELİĞİ değişmedi: duraklatma terminal değildir.
        Assert.Equal(2, fixture.Store.Active().Count);
        Assert.DoesNotContain(
            fixture.Discovery.Changes,
            change => change.RouteId == a.RouteId && change.Change == TransportActiveSetChange.Ended);
    }

    [Fact]
    public async Task A_paused_run_is_not_paused_again_and_a_mixed_batch_applies_only_where_it_is_eligible()
    {
        await using var fixture = await Fixture.CreateAsync();

        var a = await fixture.StartRouteAsync("A");
        var b = await fixture.StartRouteAsync("B");
        var c = await fixture.StartRouteAsync("C");

        await fixture.AdvanceAsync(seconds: 10);
        Assert.True((await fixture.Service.PauseAsync(b.RouteId, b.SimulationId)).IsSuccess);

        var pausedAtB = fixture.Store.Find(b.RouteId)!.PausedAt;

        var result = await fixture.Service.ExecuteBatchAsync(
            TransportSimulationBatchOperation.Pause,
            Request(
                (a.RouteId, a.SimulationId),
                (b.RouteId, b.SimulationId),
                (c.RouteId, c.SimulationId)));

        var results = result.Value!.Results;

        Assert.True(results[0].Succeeded);
        Assert.False(results[1].Succeeded);
        Assert.True(results[2].Succeeded);

        // Zaten duraklatılmış çalıştırma GÜVENLİ biçimde reddedilir.
        Assert.Equal(TransportSimulationOperationResultCode.NotRunning, results[1].ResultCode);

        /* Ve muhasebesi BOZULMAZ: PausedAt ileri kaymaz, aksi hâlde sürdürmede
           süre eksik sayılırdı. */
        Assert.Equal(pausedAtB, fixture.Store.Find(b.RouteId)!.PausedAt);

        Assert.Equal(2, result.Value!.SucceededCount);
        Assert.Equal(1, result.Value!.FailedCount);
    }

    /* --- 22-26. DEVAM ETTİR -------------------------------------------------------- */

    [Fact]
    public async Task Batch_resume_continues_the_same_run_without_a_progress_jump()
    {
        await using var fixture = await Fixture.CreateAsync();

        var a = await fixture.StartRouteAsync("A");
        var b = await fixture.StartRouteAsync("B");

        await fixture.AdvanceAsync(seconds: 10);
        Assert.True((await fixture.Service.PauseAsync(a.RouteId, a.SimulationId)).IsSuccess);

        var frozen = fixture.Store.Find(a.RouteId)!.Snapshot.ProgressRatio;

        // Duraklamada UZUN süre geçer: sürdürme bu sürenin tamamı kadar sıçramamalıdır.
        await fixture.AdvanceAsync(seconds: 200);
        AssertClose(frozen, fixture.Store.Find(a.RouteId)!.Snapshot.ProgressRatio);

        var result = await fixture.Service.ExecuteBatchAsync(
            TransportSimulationBatchOperation.Resume,
            Request((a.RouteId, a.SimulationId), (b.RouteId, b.SimulationId)));

        var results = result.Value!.Results;

        Assert.True(results[0].Succeeded);

        // ÇALIŞAN bir çalıştırma "sürdürülemez": önkoşul tutmaz, hiçbir şey olmaz.
        Assert.False(results[1].Succeeded);
        Assert.Equal(TransportSimulationOperationResultCode.NotPaused, results[1].ResultCode);

        var resumed = fixture.Store.Find(a.RouteId)!;
        Assert.Equal(a.SimulationId, resumed.SimulationId);
        Assert.Equal(TransportSimulationStatus.Running, resumed.Status);
        AssertClose(frozen, resumed.Snapshot.ProgressRatio);

        // Bir sonraki tick kaldığı yerden DEVAM eder.
        await fixture.AdvanceAsync(seconds: 10);
        var after = fixture.Store.Find(a.RouteId)!.Snapshot.ProgressRatio;
        Assert.True(after > frozen);
        Assert.True(after < frozen + 0.2);

        // Üyelik değişmedi.
        Assert.Equal(2, fixture.Store.Active().Count);
    }

    /* --- 27-32. SIFIRLA ------------------------------------------------------------ */

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Batch_reset_terminates_running_and_paused_runs_and_creates_no_replacement(bool pauseFirst)
    {
        await using var fixture = await Fixture.CreateAsync();

        var a = await fixture.StartRouteAsync("A");
        var b = await fixture.StartRouteAsync("B");

        await fixture.AdvanceAsync(seconds: 10);

        if (pauseFirst)
        {
            Assert.True((await fixture.Service.PauseAsync(a.RouteId, a.SimulationId)).IsSuccess);
        }

        fixture.Broadcaster.Clear();
        fixture.Discovery.Clear();

        var result = await fixture.Service.ExecuteBatchAsync(
            TransportSimulationBatchOperation.Reset,
            Request((a.RouteId, a.SimulationId)));

        var single = Assert.Single(result.Value!.Results);
        Assert.True(single.Succeeded);

        // Terminal güncelleme yanıtta da taşınır: istemci onu UYDURMAZ.
        Assert.NotNull(single.Update);
        Assert.Equal(TransportSimulationStatus.Cancelled, single.Update!.Status);
        Assert.Equal(a.SimulationId, single.Update.SimulationId);

        // Yerine YENİ bir çalıştırma KONMAZ.
        Assert.Null(single.Simulation);
        Assert.Null(fixture.Store.Find(a.RouteId));

        // Mevcut terminal yayın ve keşif çıkışı korunur.
        Assert.Contains(
            fixture.Broadcaster.Updates,
            update => update.SimulationId == a.SimulationId
                && update.Status == TransportSimulationStatus.Cancelled);

        Assert.Contains(
            fixture.Discovery.Changes,
            change => change.SimulationId == a.SimulationId
                && change.Change == TransportActiveSetChange.Ended);

        // B'ye dokunulmadı.
        Assert.NotNull(fixture.Store.Find(b.RouteId));
        Assert.Equal(b.SimulationId, fixture.Store.Find(b.RouteId)!.SimulationId);
    }

    [Fact]
    public async Task A_stale_reset_can_never_touch_the_replacement_run()
    {
        await using var fixture = await Fixture.CreateAsync();

        var a = await fixture.StartRouteAsync("A");

        // A biter, AYNI hatta B başlar.
        Assert.True((await fixture.Service.StopAsync(a.RouteId, a.SimulationId)).IsSuccess);
        var b = (await fixture.Service.StartAsync(a.RouteId)).Value!;
        Assert.NotEqual(a.SimulationId, b.SimulationId);

        // Eski sekmenin dondurulmuş niyeti hâlâ A'yı gösteriyor.
        var result = await fixture.Service.ExecuteBatchAsync(
            TransportSimulationBatchOperation.Reset,
            Request((a.RouteId, a.SimulationId)));

        var single = Assert.Single(result.Value!.Results);
        Assert.False(single.Succeeded);
        Assert.Equal(TransportSimulationOperationResultCode.Stale, single.ResultCode);

        // İstenen kimlik geri verilir; sonuç B'ye BAĞLANMAZ.
        Assert.Equal(a.SimulationId, single.RequestedSimulationId);

        // B'ye hiç dokunulmadı.
        Assert.Equal(b.SimulationId, fixture.Store.Find(a.RouteId)!.SimulationId);
        Assert.Equal(TransportSimulationStatus.Running, fixture.Store.Find(a.RouteId)!.Status);
    }

    [Fact]
    public async Task Two_concurrent_resets_of_the_same_run_produce_exactly_one_winner()
    {
        await using var fixture = await Fixture.CreateAsync();
        var a = await fixture.StartRouteAsync("A");

        var first = fixture.Service.StopAsync(a.RouteId, a.SimulationId);
        var second = fixture.Service.StopAsync(a.RouteId, a.SimulationId);

        var outcomes = await Task.WhenAll(first, second);

        Assert.Single(outcomes, outcome => outcome.IsSuccess);
        Assert.Null(fixture.Store.Find(a.RouteId));
    }

    /* --- 33-47. YENİDEN BAŞLAT ----------------------------------------------------- */

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Restart_ends_the_old_run_and_starts_a_brand_new_one_from_zero(bool pauseFirst)
    {
        await using var fixture = await Fixture.CreateAsync();

        var a = await fixture.StartRouteAsync("A");
        await fixture.AdvanceAsync(seconds: 100);

        if (pauseFirst)
        {
            Assert.True((await fixture.Service.PauseAsync(a.RouteId, a.SimulationId)).IsSuccess);
        }

        var beforeProgress = fixture.Store.Find(a.RouteId)!.Snapshot.ProgressRatio;
        Assert.True(beforeProgress > 0);

        fixture.Broadcaster.Clear();
        fixture.Discovery.Clear();

        var result = await fixture.Service.ExecuteBatchAsync(
            TransportSimulationBatchOperation.Restart,
            Request((a.RouteId, a.SimulationId)));

        var single = Assert.Single(result.Value!.Results);
        Assert.True(single.Succeeded);

        var replacement = single.Simulation!;

        // YENİ kimlik: aynı çalıştırma GERİ SARILMADI.
        Assert.NotEqual(a.SimulationId, replacement.SimulationId);
        Assert.Equal(a.RouteId, replacement.RouteId);
        Assert.Equal(0, replacement.ProgressRatio);
        Assert.Equal(TransportSimulationStatus.Running, replacement.Status);

        var stored = fixture.Store.Find(a.RouteId)!;
        Assert.Equal(replacement.SimulationId, stored.SimulationId);
        Assert.Equal(0, stored.Snapshot.ProgressRatio);
        Assert.Null(stored.PausedAt);

        // OTORİTER kalıcı güzergah yeniden kullanılır; OSRM çağrılmaz.
        Assert.Equal(Fixture.PathDurationSeconds, replacement.DurationSeconds);
        Assert.Equal(500, replacement.DistanceMeters);
        Assert.Equal("driving", replacement.Profile);
        Assert.Equal(2, stored.Path.Points.Count);
        Assert.Equal(stored.Path.Points[0], stored.Snapshot.Position);

        // Hat üzerinde TAM OLARAK BİR aktif çalıştırma kalır.
        Assert.Single(fixture.Store.Active(), run => run.RouteId == a.RouteId);

        /* OLAY SIRASI: önce A'nın terminali ve keşif çıkışı, sonra B'nin
           başlangıcı ve keşif girişi. */
        var updates = fixture.Broadcaster.Updates;
        var cancelledIndex = updates.FindIndex(update =>
            update.SimulationId == a.SimulationId && update.Status == TransportSimulationStatus.Cancelled);
        var startedIndex = updates.FindIndex(update =>
            update.SimulationId == replacement.SimulationId && update.Status == TransportSimulationStatus.Running);

        Assert.True(cancelledIndex >= 0);
        Assert.True(startedIndex > cancelledIndex);
        Assert.Equal(0, updates[startedIndex].ProgressPercent);

        var changes = fixture.Discovery.Changes;
        var endedIndex = changes.FindIndex(change =>
            change.SimulationId == a.SimulationId && change.Change == TransportActiveSetChange.Ended);
        var enteredIndex = changes.FindIndex(change =>
            change.SimulationId == replacement.SimulationId && change.Change == TransportActiveSetChange.Started);

        Assert.True(endedIndex >= 0);
        Assert.True(enteredIndex > endedIndex);
    }

    [Fact]
    public async Task A_stale_restart_cannot_rewind_or_replace_the_current_run()
    {
        await using var fixture = await Fixture.CreateAsync();

        var a = await fixture.StartRouteAsync("A");
        var first = await fixture.Service.RestartAsync(a.RouteId, a.SimulationId);
        Assert.True(first.IsSuccess);

        var b = first.Value!;
        await fixture.AdvanceAsync(seconds: 100);
        var progressB = fixture.Store.Find(a.RouteId)!.Snapshot.ProgressRatio;
        Assert.True(progressB > 0);

        // Bayat niyet hâlâ A'yı gösteriyor.
        var stale = await fixture.Service.ExecuteBatchAsync(
            TransportSimulationBatchOperation.Restart,
            Request((a.RouteId, a.SimulationId)));

        var single = Assert.Single(stale.Value!.Results);
        Assert.False(single.Succeeded);
        Assert.Equal(TransportSimulationOperationResultCode.Stale, single.ResultCode);
        Assert.Null(single.Simulation);

        // B ne değiştirildi ne de geri sarıldı.
        var stored = fixture.Store.Find(a.RouteId)!;
        Assert.Equal(b.SimulationId, stored.SimulationId);
        AssertClose(progressB, stored.Snapshot.ProgressRatio);
    }

    [Fact]
    public async Task The_old_runner_can_neither_overwrite_nor_remove_the_replacement()
    {
        await using var fixture = await Fixture.CreateAsync();

        var a = await fixture.StartRouteAsync("A");
        await fixture.AdvanceAsync(seconds: 100);

        var old = fixture.Store.Find(a.RouteId)!;

        var restarted = await fixture.Service.RestartAsync(a.RouteId, a.SimulationId);
        var b = restarted.Value!;

        /* ESKİ çalıştırmanın yolda kalmış bir tick'i: kimlik denetimli yazma
           B'yi EZEMEZ. */
        Assert.False(fixture.Store.TryUpdateSnapshot(
            a.RouteId,
            a.SimulationId,
            old.Snapshot with { ProgressRatio = 0.9 }));

        // ESKİ kimlikle sonlandırma da B'yi KALDIRAMAZ.
        Assert.Null(await fixture.Runner.TerminateAsync(a.RouteId, a.SimulationId));
        Assert.False(fixture.Store.TryStop(a.RouteId, a.SimulationId));

        var stored = fixture.Store.Find(a.RouteId)!;
        Assert.Equal(b.SimulationId, stored.SimulationId);
        Assert.Equal(0, stored.Snapshot.ProgressRatio);

        // Ve ilerletme döngüsü artık YALNIZCA B'yi ilerletir.
        await fixture.AdvanceAsync(seconds: 10);
        Assert.Equal(b.SimulationId, fixture.Store.Find(a.RouteId)!.SimulationId);
        Assert.True(fixture.Store.Find(a.RouteId)!.Snapshot.ProgressRatio > 0);
    }

    /// <summary>
    /// YENİDEN BAŞLATMA ile BAŞLATMA yarışı: çalınacak bir pencere var mı?
    /// </summary>
    /// <remarks>
    /// <para>
    /// Test SIRALI çağrılar varsaymaz: rakip başlatma tam olarak TEHLİKELİ
    /// SINIRDA — yani değiştirme kararının verildiği anda — tetiklenir. Bunu
    /// yapmanın yolu deponun kendisini sarmalamaktır: <c>TryReplace</c>
    /// çağrılmadan hemen önce rakip <c>StartAsync</c> çalıştırılır.
    /// </para>
    /// <para>
    /// "Sıfırla sonra başlat" biçimindeki bir uygulama burada DÜŞER: o
    /// pencerede hattın yuvası boş olurdu ve rakip başlatma onu kapardı.
    /// </para>
    /// </remarks>
    [Fact]
    public async Task A_competing_start_cannot_steal_the_route_while_a_restart_is_being_applied()
    {
        await using var fixture = await Fixture.CreateAsync();

        var a = await fixture.StartRouteAsync("A");
        var routeId = a.RouteId;

        var competitorSucceeded = false;

        fixture.Store.BeforeReplace = () =>
        {
            /* TAM SINIR: yeniden başlatma değiştirmeyi uygulamak üzereyken
               başka bir kullanıcı aynı hattı başlatmaya çalışır. */
            competitorSucceeded = fixture.Service.StartAsync(routeId).GetAwaiter().GetResult().IsSuccess;
        };

        var restarted = await fixture.Service.RestartAsync(routeId, a.SimulationId);

        // Yuva hiç boşalmadı: rakip başlatma REDDEDİLDİ.
        Assert.False(competitorSucceeded);

        Assert.True(restarted.IsSuccess);
        var b = restarted.Value!;
        Assert.NotEqual(a.SimulationId, b.SimulationId);

        // Ve hat üzerinde TEK bir otoriter çalıştırma vardır.
        var active = fixture.Store.Active().Where(run => run.RouteId == routeId).ToArray();
        Assert.Single(active);
        Assert.Equal(b.SimulationId, active[0].SimulationId);
    }

    [Fact]
    public async Task A_reset_that_wins_the_race_makes_the_restart_a_deterministic_conflict()
    {
        await using var fixture = await Fixture.CreateAsync();

        var a = await fixture.StartRouteAsync("A");
        var routeId = a.RouteId;

        fixture.Store.BeforeReplace = () =>
        {
            // Sıfırlama, değiştirme uygulanmadan hemen önce kazanır.
            fixture.Service.StopAsync(routeId, a.SimulationId).GetAwaiter().GetResult();
        };

        var restarted = await fixture.Service.RestartAsync(routeId, a.SimulationId);

        // Deterministik ÇAKIŞMA: yerine yeni bir çalıştırma KURULMAZ.
        Assert.False(restarted.IsSuccess);
        Assert.Equal(ServiceErrorKind.Conflict, restarted.ErrorKind);
        Assert.Null(fixture.Store.Find(routeId));
    }

    [Fact]
    public async Task Repeated_restarts_keep_producing_new_identities_that_each_start_at_zero()
    {
        await using var fixture = await Fixture.CreateAsync();

        var a = await fixture.StartRouteAsync("A");
        var seen = new List<Guid> { a.SimulationId };
        var current = a.SimulationId;

        for (var round = 0; round < 2; round++)
        {
            await fixture.AdvanceAsync(seconds: 50);
            Assert.True(fixture.Store.Find(a.RouteId)!.Snapshot.ProgressRatio > 0);

            var restarted = await fixture.Service.RestartAsync(a.RouteId, current);
            Assert.True(restarted.IsSuccess);

            current = restarted.Value!.SimulationId;
            Assert.DoesNotContain(current, seen);
            seen.Add(current);

            Assert.Equal(0, restarted.Value!.ProgressRatio);
            Assert.Equal(0, fixture.Store.Find(a.RouteId)!.Snapshot.ProgressRatio);
        }

        Assert.Equal(3, seen.Distinct().Count());
        Assert.Single(fixture.Store.Active(), run => run.RouteId == a.RouteId);
    }

    /* --- 48-53. KISMİ SONUÇ VE ROTA YALITIMI --------------------------------------- */

    [Fact]
    public async Task A_stale_sibling_does_not_roll_back_the_targets_that_succeeded()
    {
        await using var fixture = await Fixture.CreateAsync();

        var a = await fixture.StartRouteAsync("A");
        var b = await fixture.StartRouteAsync("B");
        var c = await fixture.StartRouteAsync("C");
        var d = await fixture.StartRouteAsync("D");

        // B, istek yola çıkmadan önce yerini yeni bir çalıştırmaya bırakır.
        Assert.True((await fixture.Service.StopAsync(b.RouteId, b.SimulationId)).IsSuccess);
        var replacementB = (await fixture.Service.StartAsync(b.RouteId)).Value!;

        var result = await fixture.Service.ExecuteBatchAsync(
            TransportSimulationBatchOperation.Pause,
            Request(
                (a.RouteId, a.SimulationId),
                (b.RouteId, b.SimulationId),
                (c.RouteId, c.SimulationId)));

        var results = result.Value!.Results;
        Assert.Equal(3, results.Count);

        Assert.True(results[0].Succeeded);
        Assert.False(results[1].Succeeded);
        Assert.Equal(TransportSimulationOperationResultCode.Stale, results[1].ResultCode);
        Assert.True(results[2].Succeeded);

        Assert.Equal(2, result.Value!.SucceededCount);
        Assert.Equal(1, result.Value!.FailedCount);
        Assert.Equal(3, result.Value!.RequestedCount);

        // A ve C GERİ ALINMAZ.
        Assert.Equal(TransportSimulationStatus.Paused, fixture.Store.Find(a.RouteId)!.Status);
        Assert.Equal(TransportSimulationStatus.Paused, fixture.Store.Find(c.RouteId)!.Status);

        // B'nin yerine geçen çalıştırma ÇALIŞMAYA devam eder.
        Assert.Equal(replacementB.SimulationId, fixture.Store.Find(b.RouteId)!.SimulationId);
        Assert.Equal(TransportSimulationStatus.Running, fixture.Store.Find(b.RouteId)!.Status);

        // Hedeflenmemiş D'ye HİÇ dokunulmadı.
        Assert.Equal(TransportSimulationStatus.Running, fixture.Store.Find(d.RouteId)!.Status);
        Assert.Equal(d.SimulationId, fixture.Store.Find(d.RouteId)!.SimulationId);
    }

    [Fact]
    public async Task A_missing_route_fails_only_its_own_target()
    {
        await using var fixture = await Fixture.CreateAsync();

        var a = await fixture.StartRouteAsync("A");

        var result = await fixture.Service.ExecuteBatchAsync(
            TransportSimulationBatchOperation.Reset,
            Request((a.RouteId, a.SimulationId), (999_999, Guid.NewGuid())));

        var results = result.Value!.Results;

        Assert.True(results[0].Succeeded);
        Assert.False(results[1].Succeeded);
        Assert.Equal(TransportSimulationOperationResultCode.RouteNotFound, results[1].ResultCode);

        Assert.Null(fixture.Store.Find(a.RouteId));
    }

    [Fact]
    public async Task Batch_restart_across_routes_produces_distinct_new_identities()
    {
        await using var fixture = await Fixture.CreateAsync();

        var a = await fixture.StartRouteAsync("A");
        var b = await fixture.StartRouteAsync("B");
        var c = await fixture.StartRouteAsync("C");

        await fixture.AdvanceAsync(seconds: 100);

        var result = await fixture.Service.ExecuteBatchAsync(
            TransportSimulationBatchOperation.Restart,
            Request(
                (a.RouteId, a.SimulationId),
                (b.RouteId, b.SimulationId),
                (c.RouteId, c.SimulationId)));

        var results = result.Value!.Results;
        Assert.All(results, item => Assert.True(item.Succeeded));

        var newIds = results.Select(item => item.Simulation!.SimulationId).ToArray();
        var oldIds = new[] { a.SimulationId, b.SimulationId, c.SimulationId };

        // Her hat KENDİ yeni kimliğini alır; kimse eskisini devralmaz.
        Assert.Equal(3, newIds.Distinct().Count());
        Assert.Empty(newIds.Intersect(oldIds));

        Assert.All(results, item => Assert.Equal(0, item.Simulation!.ProgressRatio));
        Assert.Equal(3, fixture.Store.Active().Count);
    }

    [Fact]
    public void The_batch_path_introduces_no_global_cross_route_lock()
    {
        /* Rota başına atomiklik DEPONUN CAS işlemindedir. Servise konan
           küresel bir kilit/semafor, ilgisiz hatların komutlarını birbirine
           bağlar ve tek bir yavaş hat tüm ağı bekletirdi. */
        var fields = typeof(TransportSimulationService)
            .GetFields(BindingFlags.Instance | BindingFlags.Static | BindingFlags.NonPublic | BindingFlags.Public)
            .Select(field => field.FieldType)
            .ToArray();

        Assert.DoesNotContain(fields, type => type == typeof(SemaphoreSlim));
        Assert.DoesNotContain(fields, type => type.Name.Contains("Lock", StringComparison.Ordinal));
        Assert.DoesNotContain(fields, type => type == typeof(object));
    }

    [Fact]
    public async Task Commands_on_unrelated_routes_do_not_block_each_other()
    {
        await using var fixture = await Fixture.CreateAsync();

        var a = await fixture.StartRouteAsync("A");
        var b = await fixture.StartRouteAsync("B");

        /* İki bağımsız toplu istek AYNI ANDA yola çıkar (üretimde iki ayrı
           kapsam; burada iki ayrı servis örneği aynı süreç içi depoyu
           paylaşır). İkisi de başarılı olmalıdır. */
        var first = fixture.NewService().ExecuteBatchAsync(
            TransportSimulationBatchOperation.Pause,
            Request((a.RouteId, a.SimulationId)));

        var second = fixture.NewService().ExecuteBatchAsync(
            TransportSimulationBatchOperation.Pause,
            Request((b.RouteId, b.SimulationId)));

        var outcomes = await Task.WhenAll(first, second);

        Assert.All(outcomes, outcome => Assert.True(outcome.IsSuccess));
        Assert.All(outcomes, outcome => Assert.True(Assert.Single(outcome.Value!.Results).Succeeded));

        Assert.Equal(TransportSimulationStatus.Paused, fixture.Store.Find(a.RouteId)!.Status);
        Assert.Equal(TransportSimulationStatus.Paused, fixture.Store.Find(b.RouteId)!.Status);
    }

    /* --- 58-64. MİMARİ ------------------------------------------------------------- */

    [Fact]
    public void The_controller_stays_thin_and_reuses_the_single_run_service_contract()
    {
        var dependencies = typeof(TransportSimulationController)
            .GetConstructors()
            .Single()
            .GetParameters()
            .Select(parameter => parameter.ParameterType)
            .ToArray();

        // Controller yalnızca uygulama sözleşmesini tanır.
        Assert.Contains(typeof(ITransportSimulationService), dependencies);
        Assert.DoesNotContain(typeof(ITransportSimulationStateStore), dependencies);
        Assert.DoesNotContain(typeof(ITransportSimulationLifecycle), dependencies);
        Assert.DoesNotContain(typeof(ITransportSimulationReplacer), dependencies);

        // Ve hiçbir uç başka bir ucu ÇAĞIRMAZ: HTTP istemcisi bağımlılığı yoktur.
        Assert.DoesNotContain(dependencies, type => type == typeof(HttpClient));
        Assert.DoesNotContain(dependencies, type => type == typeof(IHttpClientFactory));

        /* Toplu uçların gövdesi TEK bir servis metoduna iner; dördü de aynı
           istek tipini alır. */
        foreach (var name in new[]
        {
            nameof(TransportSimulationController.BatchPause),
            nameof(TransportSimulationController.BatchResume),
            nameof(TransportSimulationController.BatchReset),
            nameof(TransportSimulationController.BatchRestart)
        })
        {
            var method = typeof(TransportSimulationController).GetMethod(name)!;
            Assert.Contains(
                method.GetParameters(),
                parameter => parameter.ParameterType == typeof(TransportSimulationBatchRequest));
        }
    }

    [Fact]
    public void The_runtime_primitives_carry_no_authorization_or_http_concern()
    {
        foreach (var port in new[]
        {
            typeof(ITransportSimulationReplacer),
            typeof(ITransportSimulationLifecycle),
            typeof(ITransportSimulationTerminator)
        })
        {
            Assert.DoesNotContain(
                port.GetMethods(),
                method => method.GetParameters().Any(parameter =>
                    parameter.ParameterType.Name.Contains("Principal", StringComparison.Ordinal)
                    || parameter.ParameterType.Name.Contains("HttpContext", StringComparison.Ordinal)));
        }

        /* Çalışma zamanı sahibi TEKTİR: değiştirme, sonlandırma, duraklat/sürdür
           ve iç iptal aynı runner'dadır. İkinci bir uygulama, izleri sızdıran ya
           da terminal olayı hiç yayınlamayan sessizce farklı bir yol doğururdu. */
        Assert.True(typeof(ITransportSimulationReplacer).IsAssignableFrom(typeof(TransportSimulationRunner)));
        Assert.True(typeof(ITransportSimulationTerminator).IsAssignableFrom(typeof(TransportSimulationRunner)));
        Assert.True(typeof(ITransportSimulationLifecycle).IsAssignableFrom(typeof(TransportSimulationRunner)));
    }

    [Fact]
    public void No_second_lifecycle_status_vocabulary_was_introduced()
    {
        // Durum sözlüğü hâlâ DÖRT değerdir.
        Assert.Equal(
            new[] { "Running", "Paused", "Completed", "Cancelled" },
            Enum.GetNames<TransportSimulationStatus>());

        /* Komut sonuç kodları AYRI bir eksendir ve simülasyon durumu adı
           TAŞIMAZ: "Running" ya da "Paused" adında bir sonuç kodu, iki
           kavramın karışmaya başladığı ilk yer olurdu. */
        foreach (var status in Enum.GetNames<TransportSimulationStatus>())
        {
            Assert.DoesNotContain(status, Enum.GetNames<TransportSimulationOperationResultCode>());
        }
    }

    [Fact]
    public void No_new_hub_and_no_new_live_channel_were_added()
    {
        var hubs = typeof(TransportSimulationController).Assembly
            .GetTypes()
            .Where(type => typeof(Hub).IsAssignableFrom(type) && type != typeof(Hub))
            .Select(type => type.Name)
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToArray();

        Assert.Equal(new[] { "JourneySimulationHub", "TransportSimulationHub" }, hubs);

        // Sözleşme yeni bir istemci metodu ya da grup UYDURMADI.
        Assert.Equal("SimulationUpdated", TransportSimulationHubContract.UpdateMethod);
        Assert.Equal("ActiveSimulationSetChanged", TransportSimulationHubContract.ActiveSetChangedMethod);
    }

    [Fact]
    public void Personal_journey_is_untouched_by_the_shared_batch_surface()
    {
        var personal = typeof(IJourneySimulationService)
            .GetMethods()
            .Select(method => method.Name)
            .ToArray();

        Assert.DoesNotContain(personal, name => name.Contains("Batch", StringComparison.Ordinal));
        Assert.DoesNotContain(personal, name => name.Contains("Restart", StringComparison.Ordinal));

        // Ve paylaşılan toplu sözleşme kişisel yolculuk tipine hiç bağlanmaz.
        var batchTypes = typeof(TransportSimulationBatchRequest).Assembly
            .GetTypes()
            .Where(type => type.Name.StartsWith("TransportSimulationBatch", StringComparison.Ordinal)
                || type.Name.StartsWith("TransportSimulationOperation", StringComparison.Ordinal))
            .ToArray();

        Assert.NotEmpty(batchTypes);
        Assert.All(batchTypes, type => Assert.DoesNotContain(
            type.GetProperties(),
            property => property.PropertyType.Name.Contains("Journey", StringComparison.Ordinal)));
    }

    [Fact]
    public void The_phase_added_no_entity_and_therefore_needs_no_migration()
    {
        /* Aktif simülasyon durumu SÜREÇ İÇİDİR ve bu faz o kararı değiştirmez:
           toplu komutlar da yalnızca çalışma zamanı durumuna dokunur. Yeni bir
           varlık ya da tablo yoktur, dolayısıyla göç de yoktur. */
        var entities = typeof(TransportRoute).Assembly
            .GetTypes()
            .Where(type => type.Namespace == typeof(TransportRoute).Namespace)
            .Select(type => type.Name)
            .ToArray();

        Assert.DoesNotContain(entities, name => name.Contains("Batch", StringComparison.Ordinal));
        Assert.DoesNotContain(entities, name => name.Contains("Simulation", StringComparison.Ordinal));
    }

    /* --- Yardımcılar --------------------------------------------------------------- */

    private static TransportSimulationBatchRequest Request(params (int RouteId, Guid SimulationId)[] targets) =>
        new()
        {
            Targets = [.. targets.Select(target => new TransportSimulationTargetRequest
            {
                RouteId = target.RouteId,
                SimulationId = target.SimulationId
            })]
        };

    private static void AssertClose(double expected, double actual, double tolerance = 1e-6) =>
        Assert.True(
            Math.Abs(expected - actual) <= tolerance,
            $"beklenen {expected}, bulunan {actual} (tolerans {tolerance})");

    /// <summary>
    /// Yayınları KAYDEDEN yayıncı. Toplu yol hedefleri eşzamanlı işlediği için
    /// kayıt iş parçacığı güvenlidir; aksi hâlde testin kendisi yarışırdı.
    /// </summary>
    private sealed class RecordingBroadcaster : ITransportSimulationBroadcaster
    {
        private readonly object _gate = new();

        public List<TransportSimulationLiveUpdate> Updates { get; } = [];

        public Task PublishAsync(
            TransportSimulationLiveUpdate update,
            CancellationToken cancellationToken = default)
        {
            lock (_gate)
            {
                Updates.Add(update);
            }

            return Task.CompletedTask;
        }

        public void Clear()
        {
            lock (_gate)
            {
                Updates.Clear();
            }
        }
    }

    private sealed class RecordingDiscoveryBroadcaster : ITransportSimulationDiscoveryBroadcaster
    {
        private readonly object _gate = new();

        public List<TransportActiveSimulationSetChanged> Changes { get; } = [];

        public Task PublishActiveSetChangedAsync(
            TransportActiveSimulationSetChanged change,
            CancellationToken cancellationToken = default)
        {
            lock (_gate)
            {
                Changes.Add(change);
            }

            return Task.CompletedTask;
        }

        public void Clear()
        {
            lock (_gate)
            {
                Changes.Clear();
            }
        }
    }

    /// <summary>
    /// Gerçek depoyu SARMALAYAN ve değiştirme anına bir kanca takan depo.
    /// </summary>
    /// <remarks>
    /// Yarış testleri "önce şunu, sonra bunu çağır" varsaymamalıdır: rakip
    /// komut TAM OLARAK tehlikeli sınırda — atomik değiştirme uygulanmadan
    /// hemen önce — çalışmalıdır. Kanca bunu deterministik biçimde mümkün
    /// kılar ve gerçek kuralı (CAS) hiç değiştirmez.
    /// </remarks>
    private sealed class InterceptingStateStore : ITransportSimulationStateStore
    {
        private readonly InMemoryTransportSimulationStateStore _inner = new();

        public Action? BeforeReplace { get; set; }

        public bool TryStart(ActiveTransportSimulation simulation) => _inner.TryStart(simulation);

        public ActiveTransportSimulation? Find(int routeId) => _inner.Find(routeId);

        public IReadOnlyList<ActiveTransportSimulation> Active() => _inner.Active();

        public bool TryUpdateSnapshot(int routeId, Guid simulationId, TransportSimulationSnapshot snapshot) =>
            _inner.TryUpdateSnapshot(routeId, simulationId, snapshot);

        public bool TryStop(int routeId, Guid simulationId) => _inner.TryStop(routeId, simulationId);

        public ActiveTransportSimulation? TryPause(int routeId, Guid simulationId, DateTime now) =>
            _inner.TryPause(routeId, simulationId, now);

        public ActiveTransportSimulation? TryResume(int routeId, Guid simulationId, DateTime now) =>
            _inner.TryResume(routeId, simulationId, now);

        public bool TryReplace(int routeId, Guid expectedSimulationId, ActiveTransportSimulation replacement)
        {
            var hook = BeforeReplace;
            BeforeReplace = null;
            hook?.Invoke();

            return _inner.TryReplace(routeId, expectedSimulationId, replacement);
        }
    }

    /// <summary>Runner'ın ilerletme saatiyle AYNI ekseni paylaşan sentetik saat.</summary>
    private sealed class SyntheticTimeProvider : TimeProvider
    {
        public DateTime UtcNow { get; set; } = DateTime.UtcNow;

        public override DateTimeOffset GetUtcNow() => new(UtcNow, TimeSpan.Zero);
    }

    private sealed class Fixture : IAsyncDisposable
    {
        /// <summary>
        /// Yol süresi BİLİNÇLİ olarak uzundur: saati ilerletmek, testin
        /// ilgilenmediği hatların kendiliğinden tamamlanmasına yol açmamalıdır.
        /// </summary>
        public const double PathDurationSeconds = 1_000;

        private const int UserId = 42;

        private readonly SyntheticTimeProvider _time = new();
        private readonly ConcurrentDictionary<string, TransportSimulationResponse> _runs = new();
        private readonly ICurrentUserService _currentUser;

        private Fixture(AppDbContext db)
        {
            Db = db;

            /* Depo DAİMA sarmalayıcıdır ve kanca varsayılan olarak boştur:
               yarış testleri onu takar, diğerleri gerçek davranışı görür. */
            Store = new InterceptingStateStore();

            Broadcaster = new RecordingBroadcaster();
            Discovery = new RecordingDiscoveryBroadcaster();

            _currentUser = Substitute.For<ICurrentUserService>();
            _currentUser.UserId.Returns(UserId);
            _currentUser.IsAuthenticated.Returns(true);

            Runner = new TransportSimulationRunner(
                Store,
                Broadcaster,
                new TransportSimulationOptions
                {
                    TickIntervalMilliseconds = 1_000,
                    SpeedMultiplier = 1,
                    FallbackDurationSeconds = 300
                },
                Substitute.For<ILogger<TransportSimulationRunner>>(),
                _time,
                Discovery);

            Service = NewService();
        }

        public AppDbContext Db { get; }

        public InterceptingStateStore Store { get; }

        public RecordingBroadcaster Broadcaster { get; }

        public RecordingDiscoveryBroadcaster Discovery { get; }

        public TransportSimulationRunner Runner { get; }

        public TransportSimulationService Service { get; }

        private DateTime Clock
        {
            get => _time.UtcNow;
            set => _time.UtcNow = value;
        }

        /// <summary>
        /// Aynı süreç içi durumu paylaşan İKİNCİ bir servis örneği.
        /// </summary>
        /// <remarks>
        /// Üretimde servis scoped'dır: eşzamanlı iki istek iki ayrı örnek
        /// görür ve aynı singleton depoyu paylaşır. Rotalar arası
        /// eşzamanlılığı ölçerken bu gerçek kurulum taklit edilir.
        /// </remarks>
        public TransportSimulationService NewService() =>
            new(Db, _currentUser, Store, Runner, Runner, Runner, Discovery);

        public static async Task<Fixture> CreateAsync()
        {
            var options = new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase($"transport-batch-{Guid.NewGuid():N}")
                .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
                .Options;

            var fixture = new Fixture(new AppDbContext(options));
            fixture.Clock = DateTime.UtcNow;
            await Task.CompletedTask;
            return fixture;
        }

        /// <summary>Adlandırılmış bir hat oluşturur, yolunu ekler ve başlatır.</summary>
        public async Task<TransportSimulationResponse> StartRouteAsync(
            string name,
            double durationSeconds = PathDurationSeconds)
        {
            var route = new TransportRoute
            {
                Name = name,
                ColorHex = "#123456",
                IsActive = true,
                IsDeleted = false,
                CreatedDate = DateTime.UtcNow
            };
            Db.TransportRoutes.Add(route);
            await Db.SaveChangesAsync();

            Db.TransportRoutePaths.Add(new TransportRoutePath
            {
                RouteId = route.Id,
                Geometry = new LineString([new Coordinate(30, 40), new Coordinate(31, 41)]) { SRID = 4326 },
                DistanceMeters = 500,
                DurationSeconds = durationSeconds,
                Profile = "driving",
                GeneratedAt = DateTime.UtcNow,
                IsStale = false
            });
            await Db.SaveChangesAsync();

            var started = await Service.StartAsync(route.Id);
            Assert.True(started.IsSuccess);

            // Çalıştırma saati SENTETİK eksene bağlanır.
            Clock = Store.Find(route.Id)!.StartedAt;

            _runs[name] = started.Value!;
            return started.Value!;
        }

        /// <summary>Saati ilerletir ve runner'ı O ANDA çalıştırır.</summary>
        public Task AdvanceAsync(double seconds)
        {
            Clock = Clock.AddSeconds(seconds);
            return Runner.AdvanceAsync(Clock);
        }

        public ValueTask DisposeAsync() => Db.DisposeAsync();
    }
}
