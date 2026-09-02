using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using NetTopologySuite.Geometries;
using NSubstitute;
using StajProject.Api.Authorization;
using StajProject.Api.Controllers;
using StajProject.Application.Activity;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Journeys;
using StajProject.Application.Options;
using StajProject.Application.Simulation;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;
using StajProject.Infrastructure.Simulation;

namespace StajProject.Auth.Tests;

/// <summary>
/// Faz 8: SONA ERMİŞ kişisel yolculukların değişmez tutanağı.
/// </summary>
/// <remarks>
/// <para>
/// Ölçülen asıl iddialar: (1) satır yalnızca terminal geçişte ve TAM OLARAK
/// BİR KEZ yazılır; (2) tutanak çalışma zamanı durumu taşımaz; (3) gösterim
/// canlı kayıtlara bağımlı değildir ve silinmiş bir POI'yi içeren yolculuk da
/// açılabilir; (4) geçmişi yeniden yapmak eski çalıştırmayı diriltmez, YENİ
/// bir kimlik üretir.
/// </para>
/// <para>
/// Testler Docker'a, ağa ya da gerçek beklemelere BAĞLI DEĞİLDİR: zaman
/// runner'a dışarıdan verilir, yönlendirme sahte bir porttan gelir ve
/// veritabanı süreç içidir.
/// </para>
/// </remarks>
public sealed class JourneyHistoryTests
{
    private const int Owner = 42;
    private const int Stranger = 99;

    /* --- Tutanak, canlı durum DEĞİLDİR ------------------------------------------- */

    [Fact]
    public void The_history_record_has_no_field_for_live_runtime_state()
    {
        /* ASIL İDDİA: canlı durumu saklayabileceğimiz bir ALAN YOKTUR. Karar
           bir denetime değil, tablonun ve sözleşmenin ŞEKLİNE yaslanır. */
        foreach (var forbidden in (string[])
                 [
                     "Longitude", "Latitude", "Coordinate", "Position", "ProgressPercent",
                     "ProgressRatio", "CurrentStepSequence", "Steps", "GeometryWkt", "Geometry",
                     "IsFollowing", "IsPaused", "Status", "Snapshot", "EstimatedArrival"
                 ])
        {
            Assert.Null(typeof(JourneyHistory).GetProperty(forbidden));
            Assert.Null(typeof(JourneyHistoryPoint).GetProperty(forbidden));
            Assert.Null(typeof(JourneyHistoryDetailResponse).GetProperty(forbidden));
            Assert.Null(typeof(JourneyHistoryListItem).GetProperty(forbidden));
        }

        // Buna karşılık tutanağın kendi olguları oradadır.
        foreach (var required in (string[])
                 ["SimulationId", "Mode", "Profile", "TerminalStatus", "StartedAt", "EndedAt"])
        {
            Assert.NotNull(typeof(JourneyHistory).GetProperty(required));
        }
    }

    [Fact]
    public void History_is_a_record_rather_than_editable_content()
    {
        /* Geçmişte ad değiştirme, favori, güncelleme ya da silme YOKTUR:
           olmuş bir şeyin tutanağı düzenlenmez. Kaydedilmiş yolculuk (Faz 7)
           ise tam tersidir ve bu ayrım arayüzlerin ŞEKLİNDE görünür. */
        var methods = typeof(IJourneyHistoryService)
            .GetMethods()
            .Select(method => method.Name)
            .Order()
            .ToArray();

        /* Sıra YANSIMADA garanti değildir; ölçülen şey KÜMEDİR: okuma, ayrıntı
           ve yeniden yapma — başka hiçbir şey. */
        Assert.Equal(["GetAsync", "ListAsync", "ReuseAsync"], methods);

        foreach (var forbidden in (string[]) ["UpdateAsync", "RenameAsync", "DeleteAsync", "CreateAsync"])
        {
            Assert.Null(typeof(IJourneyHistoryService).GetMethod(forbidden));
        }

        // Kullanıcı adı verebileceği bir alan da yoktur.
        Assert.Null(typeof(JourneyHistory).GetProperty("Name"));
        Assert.Null(typeof(JourneyHistory).GetProperty("IsFavorite"));
    }

    /* --- Ne zaman yazılır, ne zaman yazılmaz ------------------------------------- */

    [Fact]
    public async Task Planning_and_previewing_write_no_history()
    {
        await using var fixture = await Fixture.CreateAsync();

        Assert.True((await fixture.Planning.PreviewAsync(fixture.Intent())).IsSuccess);

        Assert.Empty(await fixture.Db.JourneyHistories.ToListAsync());
    }

    [Fact]
    public async Task A_running_journey_is_not_history_yet()
    {
        await using var fixture = await Fixture.CreateAsync();

        var started = await fixture.Simulations.StartAsync(fixture.Intent());
        Assert.True(started.IsSuccess);

        /* Başlatma bir tutanak ÜRETMEZ: yolculuk henüz olup bitmedi.
           Aksi hâlde çalışan yolculuk "Geçmiş"te görünür ve kullanıcı onu
           bitmiş sanardı. */
        Assert.Empty(await fixture.Db.JourneyHistories.ToListAsync());
        Assert.NotNull(fixture.Store.FindByOwner(Owner));
    }

    [Fact]
    public async Task Saving_a_journey_definition_writes_no_history()
    {
        await using var fixture = await Fixture.CreateAsync();

        var saved = await fixture.SavedJourneys.CreateAsync(new CreateSavedJourneyRequest
        {
            Name = "Ev → İş", Journey = fixture.Intent(),
        });

        Assert.True(saved.IsSuccess);

        /* İKİ KAVRAM AYRIDIR: bir tanımı saklamak, bir yolculuk yapmak
           değildir. */
        Assert.Empty(await fixture.Db.JourneyHistories.ToListAsync());
    }

    [Fact]
    public async Task Reusing_a_saved_journey_writes_history_only_once_the_new_run_ends()
    {
        await using var fixture = await Fixture.CreateAsync();

        var saved = await fixture.SavedJourneys.CreateAsync(new CreateSavedJourneyRequest
        {
            Name = "Ev → İş", Journey = fixture.Intent(),
        });

        var started = await fixture.SavedJourneys.ReuseAsync(saved.Value!.Id);
        Assert.True(started.IsSuccess);

        // Yeniden kullanmak henüz bir geçmiş üretmez: yolculuk daha yeni başladı.
        Assert.Empty(await fixture.Db.JourneyHistories.ToListAsync());

        await fixture.Simulations.StopAsync(started.Value!.SimulationId);

        // Tutanak, YENİ çalıştırma sona erdiğinde ve onun kimliğiyle oluşur.
        var history = Assert.Single(await fixture.Db.JourneyHistories.ToListAsync());
        Assert.Equal(started.Value.SimulationId, history.SimulationId);
    }

    /* --- Tamamlanma --------------------------------------------------------------- */

    [Fact]
    public async Task A_completed_run_writes_exactly_one_record_with_the_servers_own_facts()
    {
        await using var fixture = await Fixture.CreateAsync();

        var started = await fixture.Simulations.StartAsync(fixture.Intent());
        Assert.True(started.IsSuccess);

        var endedAt = await fixture.CompleteAsync();

        var history = Assert.Single(await fixture.Db.JourneyHistories.Include(item => item.Points).ToListAsync());

        Assert.Equal(Owner, history.UserId);
        Assert.Equal(started.Value!.SimulationId, history.SimulationId);
        Assert.Equal(JourneyContractNames.Waypoints, history.Mode);
        Assert.Equal(JourneyContractNames.Driving, history.Profile);
        Assert.Equal(nameof(JourneySimulationStatus.Completed), history.TerminalStatus);

        // Zaman damgaları SUNUCUNUNDUR: biri çalıştırmanın kendi başlangıcı,
        // diğeri terminal geçişin kazanıldığı an.
        Assert.Equal(started.Value.StartedAt, history.StartedAt);
        Assert.Equal(endedAt, history.EndedAt);
        Assert.True(history.EndedAt >= history.StartedAt);

        /* Mesafe ve süre MOTORUN ölçümleridir; tarayıcıdan ya da duvar
           saatinden türetilmez. */
        Assert.Equal(FakeJourneyRouter.DefaultDistanceMeters, history.DistanceMeters);
        Assert.Equal(FakeJourneyRouter.DefaultDurationSeconds, history.DurationSeconds);

        // Tamamlanan yolculukta kat edilen mesafe toplamı geçemez.
        Assert.Equal(history.DistanceMeters, history.CoveredDistanceMeters);
    }

    [Fact]
    public async Task The_recorded_duration_is_the_engines_travel_time_not_the_playback_wall_clock()
    {
        await using var fixture = await Fixture.CreateAsync();

        Assert.True((await fixture.Simulations.StartAsync(fixture.Intent())).IsSuccess);

        // Oynatma çarpanı 10: gösterim gerçek süreden ON KAT hızlı biter.
        var endedAt = await fixture.CompleteAsync(speedMultiplier: 10);

        var history = Assert.Single(await fixture.Db.JourneyHistories.ToListAsync());
        var wallClockSeconds = (endedAt - history.StartedAt).TotalSeconds;

        /* ASIL İDDİA: `EndedAt − StartedAt` YOLCULUK SÜRESİ DEĞİLDİR. Kişisel
           simülasyon bir demo çarpanıyla oynatılır; duvar saati farkını süre
           diye göstermek, 460 metrelik bir sürüşü "10 saniye" diye sunardı.
           Kullanıcıya gösterilecek süre motorun ölçtüğü gerçek süredir. */
        Assert.Equal(FakeJourneyRouter.DefaultDurationSeconds, history.DurationSeconds);
        Assert.True(
            wallClockSeconds < history.DurationSeconds,
            $"duvar saati {wallClockSeconds}s, motor süresi {history.DurationSeconds}s");
    }

    [Fact]
    public async Task A_duplicate_completion_tick_cannot_write_a_second_record()
    {
        await using var fixture = await Fixture.CreateAsync();

        var started = await fixture.Simulations.StartAsync(fixture.Intent());
        Assert.True(started.IsSuccess);

        var runner = fixture.Runner(speedMultiplier: 10);
        var terminal = started.Value!.StartedAt.AddSeconds(FakeJourneyRouter.DefaultDurationSeconds);

        /* Aynı terminal an için tick DEFALARCA çalıştırılır: gecikmiş bir
           zamanlayıcı, yeniden deneme ya da üst üste binen bir çalıştırma
           gerçek hayatta tam olarak böyle görünür. */
        await runner.AdvanceAsync(terminal);
        await runner.AdvanceAsync(terminal);
        await runner.AdvanceAsync(terminal);

        Assert.Single(await fixture.Db.JourneyHistories.ToListAsync());
    }

    [Fact]
    public async Task The_writer_itself_refuses_to_record_the_same_run_twice()
    {
        await using var fixture = await Fixture.CreateAsync();

        var started = await fixture.Simulations.StartAsync(fixture.Intent());
        var running = fixture.Store.FindByOwner(Owner)!;
        var endedAt = running.StartedAt.AddSeconds(30);

        /* Yazıcı DOĞRUDAN, üst üste çağrılır. Yukarıdaki senaryolarda
           mükerrerliği depo (tek terminal kazanan) engelliyordu; burada
           ölçülen şey yazıcının KENDİ savunmasıdır — çünkü o savunma, geçiş
           kuralı bir gün gevşerse geriye kalan tek katmandır. */
        await fixture.Writer.RecordAsync(running, JourneySimulationStatus.Completed, endedAt);
        await fixture.Writer.RecordAsync(running, JourneySimulationStatus.Completed, endedAt);
        await fixture.Writer.RecordAsync(running, JourneySimulationStatus.Cancelled, endedAt);

        var history = Assert.Single(await fixture.Db.JourneyHistories.ToListAsync());

        // İlk yazan kazanır; sonrakiler sessizce vazgeçer ve durumu EZEMEZ.
        Assert.Equal(started.Value!.SimulationId, history.SimulationId);
        Assert.Equal(nameof(JourneySimulationStatus.Completed), history.TerminalStatus);

        // Noktalar da tek kez yazılır: yarım ya da çift bir tutanak oluşmaz.
        Assert.Equal(2, await fixture.Db.JourneyHistoryPoints.CountAsync());
    }

    [Fact]
    public async Task A_running_status_can_never_reach_the_history_table()
    {
        await using var fixture = await Fixture.CreateAsync();

        Assert.True((await fixture.Simulations.StartAsync(fixture.Intent())).IsSuccess);
        var running = fixture.Store.FindByOwner(Owner)!;

        /* Savunmacı: çağıranların hepsi terminal yoldadır, ama bu tabloya
           çalışan bir yolculuğun sızabileceği tek bir yol bile bırakılmaz. */
        await fixture.Writer.RecordAsync(
            running, JourneySimulationStatus.Running, running.StartedAt.AddSeconds(5));

        Assert.Empty(await fixture.Db.JourneyHistories.ToListAsync());
    }

    /* --- İptal -------------------------------------------------------------------- */

    [Fact]
    public async Task A_cancelled_run_writes_exactly_one_record_and_keeps_the_covered_distance()
    {
        await using var fixture = await Fixture.CreateAsync();

        var started = await fixture.Simulations.StartAsync(fixture.Intent());
        Assert.True(started.IsSuccess);

        var stopped = await fixture.Simulations.StopAsync(started.Value!.SimulationId);
        Assert.True(stopped.IsSuccess);

        var history = Assert.Single(await fixture.Db.JourneyHistories.ToListAsync());

        Assert.Equal(nameof(JourneySimulationStatus.Cancelled), history.TerminalStatus);
        Assert.Equal(started.Value.SimulationId, history.SimulationId);

        /* Yarıda durdurulan yolculukta kat edilen mesafe, toplam mesafeden
           AYRI bir olgudur ve ikisi birlikte "ne kadarını yaptım" sorusunu
           yanıtlar. */
        Assert.True(history.CoveredDistanceMeters <= history.DistanceMeters);
        Assert.Equal(FakeJourneyRouter.DefaultDistanceMeters, history.DistanceMeters);
    }

    [Fact]
    public async Task A_duplicate_stop_request_cannot_write_a_second_record()
    {
        await using var fixture = await Fixture.CreateAsync();

        var started = await fixture.Simulations.StartAsync(fixture.Intent());
        var simulationId = started.Value!.SimulationId;

        Assert.True((await fixture.Simulations.StopAsync(simulationId)).IsSuccess);

        // İkinci durdurma geçişi KAYBEDER: 404 alır ve tutanağa dokunamaz.
        var second = await fixture.Simulations.StopAsync(simulationId);
        Assert.False(second.IsSuccess);
        Assert.Equal(ServiceErrorKind.NotFound, second.ErrorKind);

        Assert.Single(await fixture.Db.JourneyHistories.ToListAsync());
    }

    [Fact]
    public async Task Cancellation_and_completion_cannot_both_be_recorded_for_one_run()
    {
        await using var fixture = await Fixture.CreateAsync();

        var started = await fixture.Simulations.StartAsync(fixture.Intent());
        var simulationId = started.Value!.SimulationId;

        // Kullanıcı durdurur…
        Assert.True((await fixture.Simulations.StopAsync(simulationId)).IsSuccess);

        /* …ve tam o sırada tamamlanma tick'i gelir. Geçişi durdurma kazanmıştı;
           tick artık çalışan bir yolculuk BULAMAZ ve hiçbir satır yazamaz. */
        await fixture.Runner(speedMultiplier: 10).AdvanceAsync(
            started.Value.StartedAt.AddSeconds(FakeJourneyRouter.DefaultDurationSeconds));

        /* ASIL İDDİA: tek çalıştırma, tek ve ÇELİŞKİSİZ tutanak. Terminal olma
           kararı tek bir atomik işlemle verilir; kaybeden yol hiçbir satır
           yazamaz. */
        var history = Assert.Single(await fixture.Db.JourneyHistories.ToListAsync());
        Assert.Equal(nameof(JourneySimulationStatus.Cancelled), history.TerminalStatus);
    }

    [Fact]
    public async Task A_run_that_ends_on_an_unusable_route_still_leaves_a_record()
    {
        await using var fixture = await Fixture.CreateAsync();

        var started = await fixture.Simulations.StartAsync(fixture.Intent());
        Assert.True(started.IsSuccess);

        /* Güzergah kullanılamaz hâle gelirse runner çalıştırmayı iptal eder.
           Denetim defterinde bu geçişin karşılığı yoktur (kullanıcı bir şey
           yapmadı) ama çalıştırma SONA ERMİŞTİR ve kullanıcının geçmişinden
           iz bırakmadan yok olmamalıdır. */
        fixture.CollapseTrack();

        await fixture.Runner(speedMultiplier: 1).AdvanceAsync(started.Value!.StartedAt.AddSeconds(1));

        var history = Assert.Single(await fixture.Db.JourneyHistories.ToListAsync());
        Assert.Equal(nameof(JourneySimulationStatus.Cancelled), history.TerminalStatus);
    }

    /* --- Denetim defteri KORUNUR --------------------------------------------------- */

    [Fact]
    public async Task The_activity_ledger_keeps_its_own_entries_alongside_history()
    {
        await using var fixture = await Fixture.CreateAsync();

        var started = await fixture.Simulations.StartAsync(fixture.Intent());
        await fixture.Simulations.StopAsync(started.Value!.SimulationId);

        /* İKİ DEFTER, İKİ SORU. Denetim defteri "kim neyi yaptı" sorusunu
           yanıtlamaya devam eder ve geçmiş onun YERİNE GEÇMEZ; satır sayısı da
           değişmez. */
        Assert.Equal(
            [JourneyActivityKind.Started, JourneyActivityKind.Cancelled],
            fixture.Activity.Written.Select(entry => entry.Outcome.Kind).ToArray());

        Assert.All(fixture.Activity.Written, entry => Assert.Equal(Owner, entry.OwnerUserId));
        Assert.Single(await fixture.Db.JourneyHistories.ToListAsync());
    }

    [Fact]
    public async Task Completion_writes_one_activity_entry_and_one_history_row()
    {
        await using var fixture = await Fixture.CreateAsync();

        Assert.True((await fixture.Simulations.StartAsync(fixture.Intent())).IsSuccess);
        await fixture.CompleteAsync();

        var completions = fixture.Activity.Written
            .Where(entry => entry.Outcome.Kind == JourneyActivityKind.Completed)
            .ToArray();

        Assert.Single(completions);
        Assert.Single(await fixture.Db.JourneyHistories.ToListAsync());
    }

    /* --- Tarihsel anlık görüntü ----------------------------------------------------- */

    [Fact]
    public async Task Free_journeys_record_every_point_in_order_with_the_names_of_that_moment()
    {
        await using var fixture = await Fixture.CreateAsync();

        var started = await fixture.Simulations.StartAsync(fixture.Intent());
        await fixture.Simulations.StopAsync(started.Value!.SimulationId);

        var history = Assert.Single(await fixture.Db.JourneyHistories.Include(item => item.Points).ToListAsync());
        var points = history.Points.OrderBy(point => point.Sequence).ToList();

        Assert.Equal([0, 1], points.Select(point => point.Sequence).ToArray());
        Assert.Equal(
            [JourneyContractNames.TransportStop, JourneyContractNames.Poi],
            points.Select(point => point.Source).ToArray());
        Assert.Equal(
            [fixture.StopIds[0], fixture.PoiId],
            points.Select(point => point.ReferenceId).ToArray());

        // Adlar ÇALIŞTIRMA ANINDAKİ adlardır.
        Assert.Equal(["A", "Kütüphane"], points.Select(point => point.DisplayName).ToArray());
    }

    [Fact]
    public async Task A_full_route_journey_records_the_line_and_its_endpoints()
    {
        await using var fixture = await Fixture.CreateAsync();

        var started = await fixture.Simulations.StartAsync(fixture.Intent(JourneyContractNames.RouteFull));
        Assert.True(started.IsSuccess);
        await fixture.Simulations.StopAsync(started.Value!.SimulationId);

        var history = Assert.Single(await fixture.Db.JourneyHistories.Include(item => item.Points).ToListAsync());

        Assert.Equal(JourneyContractNames.RouteFull, history.Mode);
        Assert.Equal(fixture.RouteId, history.RouteId);

        // Hattın O GÜNKÜ adı kaydedilir; sonradan değişmesi geçmişi bozmamalıdır.
        Assert.Equal("Hat", history.RouteDisplayName);

        /* Tam hat kaydında yolculuğun otuz durağı kopyalanmaz: kaydın anlattığı
           şey hattın kendisidir ve listede okunacak olan "nereden nereye"dir. */
        Assert.Equal(["A", "B"], history.Points.OrderBy(p => p.Sequence).Select(p => p.DisplayName).ToArray());
    }

    [Fact]
    public async Task A_route_segment_journey_records_its_two_chosen_stops()
    {
        await using var fixture = await Fixture.CreateAsync();

        var started = await fixture.Simulations.StartAsync(new JourneyPlanRequest
        {
            Mode = JourneyContractNames.RouteSegment,
            Profile = JourneyContractNames.Driving,
            RouteId = fixture.RouteId,
            FromStopId = fixture.StopIds[0],
            ToStopId = fixture.StopIds[1],
        });

        Assert.True(started.IsSuccess);
        await fixture.Simulations.StopAsync(started.Value!.SimulationId);

        var history = Assert.Single(await fixture.Db.JourneyHistories.Include(item => item.Points).ToListAsync());
        var points = history.Points.OrderBy(point => point.Sequence).ToList();

        Assert.Equal(JourneyContractNames.RouteSegment, history.Mode);
        Assert.Equal([fixture.StopIds[0], fixture.StopIds[1]], points.Select(p => p.ReferenceId).ToArray());
    }

    [Fact]
    public async Task History_and_its_points_are_written_as_one_unit()
    {
        await using var fixture = await Fixture.CreateAsync();

        var started = await fixture.Simulations.StartAsync(fixture.Intent());
        await fixture.Simulations.StopAsync(started.Value!.SimulationId);

        /* Yarım bir tutanak (başlığı olan ama noktaları olmayan) oluşamaz:
           ikisi TEK bir kayıt işleminde yazılır. */
        var history = Assert.Single(await fixture.Db.JourneyHistories.ToListAsync());
        var points = await fixture.Db.JourneyHistoryPoints
            .Where(point => point.JourneyHistoryId == history.Id)
            .ToListAsync();

        Assert.Equal(2, points.Count);
    }

    /* --- Silinmiş kaynaklardan sağ çıkma --------------------------------------------- */

    [Fact]
    public async Task History_still_opens_after_the_referenced_poi_is_deleted()
    {
        await using var fixture = await Fixture.CreateAsync();

        var started = await fixture.Simulations.StartAsync(fixture.Intent());
        await fixture.Simulations.StopAsync(started.Value!.SimulationId);

        // POI yolculuktan SONRA silinir.
        var poi = await fixture.Db.Pois.SingleAsync(item => item.Id == fixture.PoiId);
        poi.IsDeleted = true;
        await fixture.Db.SaveChangesAsync();

        var listed = await fixture.History.ListAsync(new JourneyHistoryQuery());
        var row = Assert.Single(listed.Value!.Items);

        /* ASIL İDDİA: gösterim canlı kayıtlara BAĞIMLI DEĞİLDİR. Kullanıcı o
           gün "Kütüphane"ye gitti ve geçmişinde hâlâ orayı görmelidir. */
        Assert.Equal("Kütüphane", row.DestinationName);

        var detail = await fixture.History.GetAsync(row.Id);
        Assert.True(detail.IsSuccess);
        Assert.Contains(detail.Value!.Points, point => point.DisplayName == "Kütüphane");
    }

    [Fact]
    public async Task History_still_opens_after_the_referenced_route_is_deleted()
    {
        await using var fixture = await Fixture.CreateAsync();

        var started = await fixture.Simulations.StartAsync(fixture.Intent(JourneyContractNames.RouteFull));
        await fixture.Simulations.StopAsync(started.Value!.SimulationId);

        var route = await fixture.Db.TransportRoutes.SingleAsync(item => item.Id == fixture.RouteId);
        route.IsDeleted = true;
        await fixture.Db.SaveChangesAsync();

        var listed = await fixture.History.ListAsync(new JourneyHistoryQuery());
        var row = Assert.Single(listed.Value!.Items);

        Assert.Equal("Hat", row.RouteDisplayName);
        Assert.True((await fixture.History.GetAsync(row.Id)).IsSuccess);
    }

    /* --- Liste ve ayrıntı ------------------------------------------------------------ */

    [Fact]
    public async Task The_list_returns_only_the_callers_own_records_newest_first()
    {
        await using var fixture = await Fixture.CreateAsync();

        var first = await fixture.RunAndStopAsync();
        var second = await fixture.RunAndStopAsync();

        var stranger = fixture.As(Stranger);
        await stranger.RunAndStopAsync();

        var listed = await fixture.History.ListAsync(new JourneyHistoryQuery());

        Assert.True(listed.IsSuccess);

        // Yabancının yolculuğu bu listede YOKTUR ve sıra en son bitenden başlar.
        Assert.Equal(2, listed.Value!.TotalCount);
        Assert.Equal([second, first], listed.Value.Items.Select(item => item.SimulationId).ToArray());

        // Aynı istek iki kez aynı sırayı verir.
        var again = await fixture.History.ListAsync(new JourneyHistoryQuery());
        Assert.Equal(
            listed.Value.Items.Select(item => item.Id).ToArray(),
            again.Value!.Items.Select(item => item.Id).ToArray());
    }

    [Fact]
    public async Task The_list_pages_rather_than_returning_everything()
    {
        await using var fixture = await Fixture.CreateAsync();

        for (var index = 0; index < 3; index++)
        {
            await fixture.RunAndStopAsync();
        }

        var firstPage = await fixture.History.ListAsync(new JourneyHistoryQuery { PageSize = 2 });

        Assert.Equal(2, firstPage.Value!.Items.Count);
        Assert.Equal(3, firstPage.Value.TotalCount);
        Assert.Equal(2, firstPage.Value.TotalPages);

        var secondPage = await fixture.History.ListAsync(new JourneyHistoryQuery { Page = 2, PageSize = 2 });
        Assert.Single(secondPage.Value!.Items);

        /* Sayfalar ÖRTÜŞMEZ: kararsız bir sıra, satır tekrarına ya da kaybına
           yol açardı. */
        Assert.Empty(firstPage.Value.Items
            .Select(item => item.Id)
            .Intersect(secondPage.Value.Items.Select(item => item.Id)));
    }

    [Fact]
    public async Task The_page_size_is_bounded_so_one_request_cannot_drain_the_table()
    {
        await using var fixture = await Fixture.CreateAsync();
        await fixture.RunAndStopAsync();

        var huge = await fixture.History.ListAsync(new JourneyHistoryQuery { PageSize = 100_000 });

        Assert.Equal(JourneyHistoryService.MaxPageSize, huge.Value!.PageSize);

        // Anlamsız bir sayfa numarası da ilk sayfaya indirgenir.
        var negative = await fixture.History.ListAsync(new JourneyHistoryQuery { Page = -3 });
        Assert.Equal(1, negative.Value!.Page);
    }

    [Fact]
    public async Task The_status_filter_narrows_the_list_and_refuses_values_it_cannot_honour()
    {
        await using var fixture = await Fixture.CreateAsync();

        await fixture.RunAndStopAsync();
        Assert.True((await fixture.Simulations.StartAsync(fixture.Intent())).IsSuccess);
        await fixture.CompleteAsync();

        var completed = await fixture.History.ListAsync(new JourneyHistoryQuery { Status = "Completed" });
        var cancelled = await fixture.History.ListAsync(new JourneyHistoryQuery { Status = "cancelled" });

        Assert.Single(completed.Value!.Items);
        Assert.Single(cancelled.Value!.Items);
        Assert.Equal(nameof(JourneySimulationStatus.Completed), completed.Value.Items[0].TerminalStatus);

        /* Bilinmeyen bir değer sessizce "hepsi"ne DÜŞMEZ: kullanıcı süzdüğünü
           sanırken süzülmemiş bir liste görürdü. Çalışan bir yolculuk da
           geçmişte aranamaz. */
        foreach (var invalid in (string[])["Running", "finished", "kapalı"])
        {
            var rejected = await fixture.History.ListAsync(new JourneyHistoryQuery { Status = invalid });
            Assert.False(rejected.IsSuccess, invalid);
            Assert.Equal(ServiceErrorKind.Validation, rejected.ErrorKind);
        }
    }

    [Fact]
    public async Task The_detail_derives_point_roles_from_their_order()
    {
        await using var fixture = await Fixture.CreateAsync();
        var simulationId = await fixture.RunAndStopAsync();

        var row = Assert.Single((await fixture.History.ListAsync(new JourneyHistoryQuery())).Value!.Items);
        var detail = await fixture.History.GetAsync(row.Id);

        Assert.True(detail.IsSuccess);
        Assert.Equal(simulationId, detail.Value!.SimulationId);

        // Rol SAKLANMAZ, sıradan türetilir.
        Assert.Equal(["origin", "destination"], detail.Value.Points.Select(point => point.Role).ToArray());
    }

    /* --- Sahiplik -------------------------------------------------------------------- */

    [Fact]
    public async Task A_stranger_can_neither_read_nor_reuse_another_users_record()
    {
        await using var fixture = await Fixture.CreateAsync();
        await fixture.RunAndStopAsync();

        var mine = Assert.Single((await fixture.History.ListAsync(new JourneyHistoryQuery())).Value!.Items);
        var stranger = fixture.As(Stranger);

        /* "Yok" ile "senin değil" AYNI cevabı verir: ayrı bir 403, kimlik
           tahmin eden birine o kaydın gerçekten var olduğunu doğrulardı. */
        Assert.Equal(ServiceErrorKind.NotFound, (await stranger.History.GetAsync(mine.Id)).ErrorKind);
        Assert.Equal(ServiceErrorKind.NotFound, (await stranger.History.ReuseAsync(mine.Id)).ErrorKind);
        Assert.Empty((await stranger.History.ListAsync(new JourneyHistoryQuery())).Value!.Items);

        // Ve yabancıya ait bir çalıştırma doğmaz.
        Assert.Null(fixture.Store.FindByOwner(Stranger));
    }

    [Fact]
    public async Task Ownership_does_not_bend_for_an_administrator_identity()
    {
        await using var fixture = await Fixture.CreateAsync();
        await fixture.RunAndStopAsync();

        var mine = Assert.Single((await fixture.History.ListAsync(new JourneyHistoryQuery())).Value!.Items);

        /* Yetkilendirme ETKİN YETKİ üzerindendir. Rol adı, `IsAdmin` bayrağı ya
           da kullanıcı adı bir kestirme DEĞİLDİR: yönetici kimliğiyle gelen
           yabancı da başkasının geçmişini göremez. */
        var admin = fixture.As(Stranger, isAdmin: true, roles: ["Admin"]);

        Assert.Equal(ServiceErrorKind.NotFound, (await admin.History.GetAsync(mine.Id)).ErrorKind);
        Assert.Empty((await admin.History.ListAsync(new JourneyHistoryQuery())).Value!.Items);
    }

    /* --- Yeniden kullanım -------------------------------------------------------------- */

    [Fact]
    public async Task Reuse_creates_a_brand_new_run_and_leaves_the_record_untouched()
    {
        await using var fixture = await Fixture.CreateAsync();
        var historicalId = await fixture.RunAndStopAsync();

        var row = Assert.Single((await fixture.History.ListAsync(new JourneyHistoryQuery())).Value!.Items);
        var before = await fixture.Db.JourneyHistories.AsNoTracking().SingleAsync();

        var callsBefore = fixture.Router.CallCount;
        var reused = await fixture.History.ReuseAsync(row.Id);

        Assert.True(reused.IsSuccess);

        /* ASIL İDDİA: tarihsel kimlik bir ETİKETTİR, yeniden kullanılabilir bir
           kaynak değil. Ölü çalıştırma diriltilmez; yenisi doğar. */
        Assert.NotEqual(historicalId, reused.Value!.SimulationId);

        // Güzergah TAZE hesaplanır: kayıtta geometri yoktur ve olsa da kullanılmazdı.
        Assert.True(fixture.Router.CallCount > callsBefore);

        // Tutanak DEĞİŞMEZ: geçmiş, yeniden yapıldığı için farklılaşmaz.
        var after = await fixture.Db.JourneyHistories.AsNoTracking().SingleAsync(item => item.Id == row.Id);
        Assert.Equal(before.SimulationId, after.SimulationId);
        Assert.Equal(before.TerminalStatus, after.TerminalStatus);
        Assert.Equal(before.EndedAt, after.EndedAt);
    }

    [Fact]
    public async Task Reuse_resolves_the_current_coordinate_of_a_moved_poi()
    {
        await using var fixture = await Fixture.CreateAsync();
        await fixture.RunAndStopAsync();

        // POI yolculuktan SONRA taşınır.
        var poi = await fixture.Db.Pois.SingleAsync(item => item.Id == fixture.PoiId);
        poi.Coordinate = new Point(33.5, 43.5) { SRID = 4326 };
        await fixture.Db.SaveChangesAsync();

        var row = Assert.Single((await fixture.History.ListAsync(new JourneyHistoryQuery())).Value!.Items);
        Assert.True((await fixture.History.ReuseAsync(row.Id)).IsSuccess);

        /* Motora giden koordinat POI'nin GÜNCEL konumudur: kayıt bir koordinat
           kopyası tutmadığı için bayat konuma düşülmesi yapısal olarak imkânsız.
           Tarihsel AD ise değişmedi — gösterim ile yeniden kullanım ayrı iki
           sorudur. */
        var sent = fixture.Router.LastCoordinates[^1];
        Assert.Equal(33.5, sent.Longitude, 6);
        Assert.Equal(43.5, sent.Latitude, 6);
    }

    [Fact]
    public async Task Reuse_fails_before_any_simulation_when_a_reference_is_gone()
    {
        await using var fixture = await Fixture.CreateAsync();
        await fixture.RunAndStopAsync();

        var poi = await fixture.Db.Pois.SingleAsync(item => item.Id == fixture.PoiId);
        poi.IsDeleted = true;
        await fixture.Db.SaveChangesAsync();

        var row = Assert.Single((await fixture.History.ListAsync(new JourneyHistoryQuery())).Value!.Items);
        var callsBefore = fixture.Router.CallCount;

        var reused = await fixture.History.ReuseAsync(row.Id);

        Assert.False(reused.IsSuccess);
        Assert.Equal(ServiceErrorKind.NotFound, reused.ErrorKind);

        // Kullanıcı HANGİ noktanın kaybolduğunu öğrenir — o günkü adıyla.
        Assert.Contains("Kütüphane", reused.Error);

        /* Yarım bir yolculuk BAŞLATILMAZ: motora hiç gidilmez, hiçbir
           çalıştırma oluşmaz ve geçmiş kaydı okunabilir kalır. */
        Assert.Equal(callsBefore, fixture.Router.CallCount);
        Assert.Null(fixture.Store.FindByOwner(Owner));
        Assert.True((await fixture.History.GetAsync(row.Id)).IsSuccess);
    }

    [Fact]
    public async Task Reusing_history_never_creates_a_saved_journey()
    {
        await using var fixture = await Fixture.CreateAsync();
        await fixture.RunAndStopAsync();

        var row = Assert.Single((await fixture.History.ListAsync(new JourneyHistoryQuery())).Value!.Items);
        Assert.True((await fixture.History.ReuseAsync(row.Id)).IsSuccess);

        /* İKİ ÜRÜN AYRIDIR: geçmişi yeniden yapmak onu saklamak değildir.
           Saklamak isteyen kullanıcının kendi "Kaydet" eylemi zaten vardır. */
        Assert.Empty(await fixture.Db.SavedJourneys.ToListAsync());
    }

    /* --- Yetki ve sınırlar -------------------------------------------------------------- */

    [Fact]
    public void Every_history_endpoint_is_gated_by_journey_use_and_nothing_else()
    {
        var endpoints = new[]
        {
            nameof(JourneyHistoryController.List),
            nameof(JourneyHistoryController.Get),
            nameof(JourneyHistoryController.Reuse),
        };

        foreach (var endpoint in endpoints)
        {
            var required = Assert.Single(
                typeof(JourneyHistoryController).GetMethod(endpoint)!
                    .GetCustomAttributes<RequirePermissionAttribute>(true));

            Assert.Equal(PermissionCodes.JourneyUse, required.PermissionCode);
        }

        /* Bu faz YENİ bir yetki kodu açmadı: kişisel yolculuğu kullanabilen
           biri kendi yolculuklarını zaten görebilmelidir. */
        Assert.DoesNotContain(
            PermissionCatalog.AllCodes,
            code => code.Contains("history", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void The_history_api_exposes_no_way_for_a_client_to_write_a_record()
    {
        /* ASIL İDDİA: "bu yolculuğu yaptım" iddiası tarayıcıdan KABUL EDİLMEZ.
           Tutanağın tek kaynağı sunucunun kendi terminal geçişidir. */
        var writeVerbs = typeof(JourneyHistoryController)
            .GetMethods(BindingFlags.Public | BindingFlags.DeclaredOnly | BindingFlags.Instance)
            .SelectMany(method => method.GetCustomAttributes<Microsoft.AspNetCore.Mvc.Routing.HttpMethodAttribute>(true))
            .SelectMany(attribute => attribute.HttpMethods)
            .Distinct()
            .Order()
            .ToArray();

        // Yalnızca okuma ve YENİDEN YAPMA vardır; PUT/PATCH/DELETE yoktur.
        Assert.Equal(["GET", "POST"], writeVerbs);

        // Ve yazıcı arayüzü controller'ın hiç tanımadığı bir bileşendir.
        Assert.DoesNotContain(
            typeof(JourneyHistoryController).GetConstructors().SelectMany(item => item.GetParameters()),
            parameter => parameter.ParameterType == typeof(IJourneyHistoryWriter));
    }

    [Fact]
    public void The_history_endpoints_never_take_an_owner_identity_from_the_route_or_query()
    {
        /* Sahip kimliği DAİMA doğrulanmış JWT'den gelir. Yoldan ya da sorgudan
           bir kullanıcı kimliği kabul eden bir uç, tahminle başkasının
           geçmişine açılan bir kapı olurdu. */
        foreach (var method in typeof(JourneyHistoryController)
                     .GetMethods(BindingFlags.Public | BindingFlags.DeclaredOnly | BindingFlags.Instance))
        {
            foreach (var parameter in method.GetParameters())
            {
                Assert.DoesNotContain("userId", parameter.Name, StringComparison.OrdinalIgnoreCase);
                Assert.DoesNotContain("ownerId", parameter.Name, StringComparison.OrdinalIgnoreCase);
            }
        }

        Assert.Null(typeof(JourneyHistoryQuery).GetProperty("UserId"));
        Assert.Null(typeof(JourneyHistoryQuery).GetProperty("OwnerUserId"));
    }

    /* --- Düzenek --------------------------------------------------------------------- */

    private sealed class Fixture : IAsyncDisposable
    {
        private Fixture(
            AppDbContext db,
            FakeJourneyRouter router,
            InMemoryJourneySimulationStateStore store,
            RecordingBroadcaster broadcaster,
            RecordingActivityRecorder activity,
            int? userId,
            bool isAdmin,
            string[] roles)
        {
            Db = db;
            Router = router;
            Store = store;
            Broadcaster = broadcaster;
            Activity = activity;

            var currentUser = Substitute.For<ICurrentUserService>();
            currentUser.UserId.Returns(userId);
            currentUser.IsAuthenticated.Returns(userId is not null);

            /* Kimlik nesnesi rol bilgisi TAŞIYABİLİR; ölçülen şey üretim
               kodunun ona bakmamasıdır. */
            currentUser.IsAdmin.Returns(isAdmin);
            currentUser.Roles.Returns(roles);

            var permissions = Substitute.For<IEffectivePermissionService>();
            permissions
                .HasPermissionAsync(Arg.Any<int>(), PermissionCodes.PoiView, Arg.Any<CancellationToken>())
                .Returns(true);
            permissions
                .HasPermissionAsync(Arg.Any<int>(), PermissionCodes.TransportView, Arg.Any<CancellationToken>())
                .Returns(true);

            /* GERÇEK yazıcı, GERÇEK veritabanının üzerinde: mükerrerlik ve
               atomiklik ancak burada kanıtlanabilir. Sahte bir yazıcı yalnızca
               kendi davranışını doğrulardı. */
            Writer = new JourneyHistoryWriter(db, NullLogger<JourneyHistoryWriter>.Instance);

            Planning = new JourneyPlanningService(db, currentUser, permissions, router);
            Simulations = new JourneySimulationService(Planning, currentUser, store, broadcaster, activity, Writer);
            History = new JourneyHistoryService(db, currentUser, Simulations);
            SavedJourneys = new SavedJourneyService(db, currentUser, Planning, Simulations);
        }

        public AppDbContext Db { get; }
        public FakeJourneyRouter Router { get; }
        public InMemoryJourneySimulationStateStore Store { get; }
        public RecordingBroadcaster Broadcaster { get; }
        public RecordingActivityRecorder Activity { get; }
        public JourneyHistoryWriter Writer { get; }
        public JourneyPlanningService Planning { get; }
        public JourneySimulationService Simulations { get; }
        public JourneyHistoryService History { get; }
        public SavedJourneyService SavedJourneys { get; }

        public int RouteId { get; private set; }
        public int[] StopIds { get; private set; } = [];
        public int PoiId { get; private set; }

        /// <summary>Aynı dünyayı BAŞKA bir kimlikle gören ikinci bir görünüm.</summary>
        public Fixture As(int? userId, bool isAdmin = false, string[]? roles = null) =>
            new(Db, Router, Store, Broadcaster, Activity, userId, isAdmin, roles ?? [])
            {
                RouteId = RouteId,
                StopIds = StopIds,
                PoiId = PoiId,
            };

        public static async Task<Fixture> CreateAsync()
        {
            var options = new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase($"journey-history-{Guid.NewGuid():N}")
                .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
                .Options;

            var fixture = new Fixture(
                new AppDbContext(options),
                new FakeJourneyRouter(),
                new InMemoryJourneySimulationStateStore(),
                new RecordingBroadcaster(),
                new RecordingActivityRecorder(),
                Owner,
                isAdmin: false,
                roles: []);

            var route = new TransportRoute
            {
                Name = "Hat", ColorHex = "#123456", IsActive = true, CreatedDate = DateTime.UtcNow,
            };
            fixture.Db.TransportRoutes.Add(route);
            await fixture.Db.SaveChangesAsync();

            var stops = new List<TransportStop>();
            var index = 1;
            foreach (var (longitude, latitude, name) in
                     new (double, double, string)[] { (30, 40, "A"), (31, 41, "B") })
            {
                var stop = new TransportStop
                {
                    RouteId = route.Id, UserId = Owner, Name = name,
                    Coordinate = new Point(longitude, latitude) { SRID = 4326 },
                    SequenceOrder = index++, IsActive = true, CreatedDate = DateTime.UtcNow,
                };
                fixture.Db.TransportStops.Add(stop);
                stops.Add(stop);
            }

            var poi = new Poi
            {
                Name = "Kütüphane",
                CategoryId = 1,
                Coordinate = new Point(32, 42) { SRID = 4326 },
                UserId = Owner,
                IsActive = true,
                CreatedDate = DateTime.UtcNow,
            };
            fixture.Db.Pois.Add(poi);
            await fixture.Db.SaveChangesAsync();

            fixture.RouteId = route.Id;
            fixture.StopIds = [.. stops.Select(stop => stop.Id)];
            fixture.PoiId = poi.Id;
            return fixture;
        }

        /// <summary>Varsayılan niyet: bir durak ve bir POI'den oluşan serbest yolculuk.</summary>
        public JourneyPlanRequest Intent(string mode = JourneyContractNames.Waypoints) => mode switch
        {
            JourneyContractNames.RouteFull => new JourneyPlanRequest
            {
                Mode = mode, Profile = JourneyContractNames.Driving, RouteId = RouteId,
            },
            _ => new JourneyPlanRequest
            {
                Mode = JourneyContractNames.Waypoints,
                Profile = JourneyContractNames.Driving,
                Waypoints =
                [
                    new() { Source = JourneyContractNames.TransportStop, ReferenceId = StopIds[0] },
                    new() { Source = JourneyContractNames.Poi, ReferenceId = PoiId },
                ],
            },
        };

        public JourneySimulationRunner Runner(double speedMultiplier) =>
            new(
                Store,
                Broadcaster,
                new JourneySimulationOptions { SpeedMultiplier = speedMultiplier },
                /* Runner singleton, yazıcılar scoped: gerçek uygulamadaki gibi
                   bir kapsam fabrikasından çözülür. */
                new TerminalScopeFactory(Activity, Writer),
                NullLogger<JourneySimulationRunner>.Instance);

        /// <summary>Çalışan yolculuğu doğal tamamlanmaya kadar ilerletir.</summary>
        /// <remarks>
        /// Terminal an, çalıştırmanın KENDİ başlangıcından türetilir: başlangıç
        /// sunucunun saatiyle damgalanır ve test onu uyduramaz. Motorun süresi
        /// çarpana bölünür, üstüne bir saniye pay bırakılır — böylece test
        /// zamanlamanın sınırında değil, kuralın üzerinde durur.
        /// </remarks>
        /// <returns>Terminal geçişin damgalandığı an.</returns>
        public async Task<DateTime> CompleteAsync(double speedMultiplier = 10)
        {
            var running = Store.FindByOwner(Owner)!;
            var endedAt = running.StartedAt.AddSeconds(
                (FakeJourneyRouter.DefaultDurationSeconds / speedMultiplier) + 1);

            await Runner(speedMultiplier).AdvanceAsync(endedAt);
            return endedAt;
        }

        /// <summary>Bir yolculuk başlatıp durdurur; kaydın çalıştırma kimliğini döndürür.</summary>
        public async Task<Guid> RunAndStopAsync()
        {
            var started = await Simulations.StartAsync(Intent());
            Assert.True(started.IsSuccess, started.Error);

            var stopped = await Simulations.StopAsync(started.Value!.SimulationId);
            Assert.True(stopped.IsSuccess, stopped.Error);

            return started.Value.SimulationId;
        }

        /// <summary>
        /// Çalışan yolculuğun güzergahını KULLANILAMAZ hâle getirir.
        /// </summary>
        /// <remarks>
        /// Runner'ın savunmacı iptal dalını tetiklemenin tek dürüst yolu budur:
        /// depodaki çalıştırma tek köşeli bir yolla değiştirilir.
        /// </remarks>
        public void CollapseTrack()
        {
            var running = Store.FindByOwner(Owner)!;
            var collapsed = running with
            {
                Path = running.Path with { Points = [running.Path.Points[0]] },
            };

            Store.TryStop(running.SimulationId);
            Store.TryStart(collapsed);
        }

        public ValueTask DisposeAsync() => Db.DisposeAsync();
    }

    /// <summary>Runner'a hem denetim kaydediciyi hem geçmiş yazıcısını veren kapsam.</summary>
    private sealed class TerminalScopeFactory : IServiceScopeFactory, IServiceScope, IServiceProvider
    {
        private readonly IJourneyActivityRecorder _recorder;
        private readonly IJourneyHistoryWriter _history;

        public TerminalScopeFactory(IJourneyActivityRecorder recorder, IJourneyHistoryWriter history)
        {
            _recorder = recorder;
            _history = history;
        }

        public IServiceScope CreateScope() => this;

        public IServiceProvider ServiceProvider => this;

        public object? GetService(Type serviceType)
        {
            if (serviceType == typeof(IJourneyActivityRecorder)) return _recorder;
            if (serviceType == typeof(IJourneyHistoryWriter)) return _history;
            return null;
        }

        public void Dispose()
        {
        }
    }

    /// <summary>Yayınlanan kişisel yolculuk güncellemelerini toplar.</summary>
    private sealed class RecordingBroadcaster : IJourneySimulationBroadcaster
    {
        public List<JourneySimulationLiveUpdate> Published { get; } = [];

        public Task PublishAsync(
            JourneySimulationLiveUpdate update,
            CancellationToken cancellationToken = default)
        {
            Published.Add(update);
            return Task.CompletedTask;
        }
    }

    /// <summary>Yazılan yolculuk aktivite olaylarını toplar.</summary>
    private sealed class RecordingActivityRecorder : IJourneyActivityRecorder
    {
        public List<(JourneyActivityOutcome Outcome, int OwnerUserId)> Written { get; } = [];

        public Task RecordAsync(
            JourneyActivityOutcome outcome,
            int ownerUserId,
            CancellationToken cancellationToken = default)
        {
            Written.Add((outcome, ownerUserId));
            return Task.CompletedTask;
        }
    }
}
