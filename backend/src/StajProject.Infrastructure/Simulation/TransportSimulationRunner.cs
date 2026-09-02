using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;
using StajProject.Application.Options;
using StajProject.Application.Simulation;

namespace StajProject.Infrastructure.Simulation;

/// <summary>
/// Hareketin SUNUCU tarafındaki tek üreticisi.
/// </summary>
/// <remarks>
/// <para>
/// <b>Zamanı tarayıcı ölçmez.</b> İlerleme, istemcinin bir timer'ından ya da
/// biriktirilen tick sayısından değil, <see cref="ActiveTransportSimulation.StartedAt"/>
/// ile sunucu saati arasındaki GEÇEN SÜREDEN türetilir. Tick sayısı toplamak,
/// her gecikmede kalıcı bir sapma biriktirirdi; geçen süreden türetmek ise bir
/// tick kaçsa da bir sonraki yayında doğru konumu verir.
/// </para>
/// <para>
/// <b>Simülasyon tarayıcıdan bağımsızdır.</b> Durum süreç içi depodadır ve
/// runner bir arka plan servisidir; başlatan sekme kapansa da araç yoluna
/// devam eder, hiçbir istemci bağlı olmasa bile.
/// </para>
/// <para>
/// <b>Veritabanına konum YAZILMAZ.</b> Tick başına bir UPDATE, saniyede bir
/// yazma yükü ve kalıcı bir hareket geçmişi demekti; bu fazın konusu canlı
/// durumdur. Runner hiçbir <c>DbContext</c> tutmaz ve hiçbir EF varlığına
/// dokunmaz — yalnızca Faz 1'de kopyalanmış değişmez veriyi okur.
/// </para>
/// <para>
/// <b>Kimlik denetimi korunur.</b> Her yazma <c>(routeId, simulationId)</c>
/// çiftiyle yapılır; geç kalmış bir tick, aynı rotada sonradan başlatılmış
/// YENİ bir çalıştırmayı ne günceller ne de durdurur.
/// </para>
/// </remarks>
public sealed class TransportSimulationRunner
    : ITransportSimulationCanceller,
      ITransportSimulationTerminator,
      ITransportSimulationLifecycle,
      ITransportSimulationReplacer
{
    private readonly ITransportSimulationStateStore _state;
    private readonly ITransportSimulationBroadcaster _broadcaster;
    private readonly TransportSimulationOptions _options;
    private readonly ILogger<TransportSimulationRunner> _logger;

    /* AKTİF KÜMEDEN ÇIKIŞIN tek sahibi burasıdır: doğal tamamlanma, kullanıcı
       sıfırlaması ve iç iptal aynı iki terminal yoldan geçer. Girişi (başlatma)
       servis duyurur.

       DURAKLAT/SÜRDÜR burada BİLİNÇLİ OLARAK duyurulmaz: duraklatılmış
       çalıştırma hattın aktif yuvasını işgal etmeye devam eder, yani üyelik
       değişmez. Her duraklatmada sinyal üretmek, tüm gözlemcilere gereksiz bir
       aktif liste okuması yaptırırdı — o geçişler zaten rota bazlı
       SimulationUpdated akışında görünür. */
    private readonly ITransportSimulationDiscoveryBroadcaster? _discovery;

    /* ZAMAN DIŞARIDAN GELİR — ilerletmede olduğu gibi geçişlerde de.
       `AdvanceAsync` saati parametre olarak alır; duraklat/sürdür ise
       doğrudan `DateTime.UtcNow` okuyordu ve bu, sınıfın kendi ilkesini
       bozuyordu: iki bağımsız zaman kaynağı, duraklama muhasebesinin
       ilerletme saatiyle aynı eksende olmasını imkânsız kılıyordu.
       Üretimde ikisi zaten aynı duvar saatidir; ayrım YALNIZCA saatin
       enjekte edilebilmesi içindir — fazın çekirdek garantisi (devam
       ettirmede ışınlanma yok) ancak böyle deterministik kanıtlanabilir. */
    private readonly TimeProvider _time;

    /* Kümülatif mesafeler çalıştırma başına BİR KEZ hesaplanır. Binlerce
       köşeli bir güzergahı her tick'te yeniden ölçmek boşuna iştir; anahtar
       simulationId olduğu için aynı rotanın yeni çalıştırması eski ölçümü
       devralmaz. */
    private readonly ConcurrentDictionary<Guid, TransportSimulationTrack> _tracks = new();

    public TransportSimulationRunner(
        ITransportSimulationStateStore state,
        ITransportSimulationBroadcaster broadcaster,
        TransportSimulationOptions options,
        ILogger<TransportSimulationRunner> logger,
        TimeProvider? timeProvider = null,
        ITransportSimulationDiscoveryBroadcaster? discovery = null)
    {
        _state = state;
        _broadcaster = broadcaster;
        _options = options;
        _logger = logger;
        _time = timeProvider ?? TimeProvider.System;
        _discovery = discovery;
    }

    /// <summary>Geçişlerin okuduğu AN. İlerletme saatiyle aynı eksendedir.</summary>
    private DateTime UtcNow => _time.GetUtcNow().UtcDateTime;

    /// <summary>
    /// Tek bir ilerleme adımı. Zaman DIŞARIDAN verilir; böylece davranış gerçek
    /// beklemeler olmadan, tamamen deterministik biçimde sınanabilir.
    /// </summary>
    public async Task AdvanceAsync(DateTime utcNow, CancellationToken cancellationToken = default)
    {
        foreach (var simulation in _state.Active())
        {
            if (cancellationToken.IsCancellationRequested)
            {
                return;
            }

            /* DURAKLATILMIŞ çalıştırma İLERLETİLMEZ ve yayın ÜRETMEZ. Sahte
               Running tick'leri, donmuş bir aracı canlıymış gibi gösterir ve
               durumu istemcide geri çevirirdi. Kayıt yerinde kalır: hattın
               aktif yuvasını işgal etmeye devam eder. */
            if (simulation.IsPaused)
            {
                continue;
            }

            try
            {
                await AdvanceOneAsync(simulation, utcNow, cancellationToken);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                /* Bir çalıştırmadaki hata diğerlerini durdurmamalıdır: runner
                   sürecin ömrü boyunca ayakta kalmak zorundadır. */
                _logger.LogError(
                    exception,
                    "Simülasyon ilerletilemedi. RouteId: {RouteId}, SimulationId: {SimulationId}",
                    simulation.RouteId,
                    simulation.SimulationId);
            }
        }
    }

    /// <summary>
    /// SİSTEMİN kendi iptali: güzergah geçersizleştiğinde o rotada ne
    /// çalışıyorsa durur.
    /// </summary>
    /// <remarks>
    /// Burada bir kullanıcı niyeti YOKTUR ve bu yüzden hiçbir yetki aranmaz —
    /// tetikleyen şey bir veri gerçeğidir. Kullanıcının açık durdurma komutu
    /// AYRI bir yoldur (<see cref="TerminateAsync"/>) ve kendi yetkisini uçta
    /// ister.
    /// </remarks>
    public async Task CancelForRoutesAsync(
        IReadOnlyCollection<int> routeIds,
        CancellationToken cancellationToken = default)
    {
        foreach (var routeId in routeIds.Distinct())
        {
            var simulation = _state.Find(routeId);

            if (simulation is null)
            {
                continue;
            }

            /* Kimlik denetimi burada da geçerlidir: Find ile TryStop arasında
               çalıştırma değişmişse eski kimlikle durdurma BAŞARISIZ olur ve
               yeni çalıştırmaya dokunulmaz. */
            var terminated = await TerminateAsync(routeId, simulation.SimulationId, cancellationToken);

            if (terminated is not null)
            {
                _logger.LogInformation(
                    "Güzergah geçersizleştiği için simülasyon iptal edildi. RouteId: {RouteId}, SimulationId: {SimulationId}",
                    routeId,
                    simulation.SimulationId);
            }
        }
    }

    /// <summary>
    /// KULLANICI komutunun çalışma zamanı ilkeli: yalnızca verilen kimlikli
    /// çalıştırmayı sonlandırır.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Sıra, doğal tamamlanmanın sırasıyla AYNIDIR</b> ve bilinçlidir:
    /// önce durumdan kaldırılır (atomik ve kimlik denetimli), sonra terminal
    /// olay yayınlanır. Ters sıra bir "hayalet Running" bırakırdı — yayın
    /// gitmişken kayıt hâlâ aktif görünürdü. Kaldırma başarısız olursa hiçbir
    /// şey yayınlanmaz: geç kalmış bir komut, yerine geçmiş YENİ çalıştırmayı
    /// ne durdurur ne de onun adına terminal olay üretir.
    /// </para>
    /// <para>
    /// Anlık görüntü kaldırmadan ÖNCE okunur; kayıt değişmez bir record olduğu
    /// için kaldırıldıktan sonra da geçerli kalır ve terminal yayın son bilinen
    /// OTORİTER konumu taşır.
    /// </para>
    /// </remarks>
    public async Task<TransportSimulationLiveUpdate?> TerminateAsync(
        int routeId,
        Guid simulationId,
        CancellationToken cancellationToken = default)
    {
        var simulation = _state.Find(routeId);

        if (simulation is null || simulation.SimulationId != simulationId)
        {
            return null;
        }

        // BAĞLAYICI denetim: kimlik tutmuyorsa hiçbir şeye dokunulmaz.
        if (!_state.TryStop(routeId, simulationId))
        {
            return null;
        }

        _tracks.TryRemove(simulationId, out _);

        var update = TransportSimulationLiveUpdate.From(simulation, TransportSimulationStatus.Cancelled);

        await PublishAsync(simulation, TransportSimulationStatus.Cancelled, cancellationToken);

        /* AKTİF KÜME KÜÇÜLDÜ. Sinyal, terminal yayından SONRA çıkar: rotayı
           zaten izleyen istemci gerçeği önce otoriter olaydan öğrenir, aktif
           listeyi izleyen ise hemen ardından tazeler. */
        await AnnounceEndedAsync(simulation, cancellationToken);

        return update;
    }

    /// <summary>
    /// DURAKLAT: saati dondurur, kaydı yerinde bırakır ve terminal OLMAYAN
    /// <c>Paused</c> yayınını yapar.
    /// </summary>
    /// <remarks>
    /// İz (<c>_tracks</c>) TEMİZLENMEZ: çalıştırma sürdürülecektir ve aynı
    /// güzergah ölçümü yeniden hesaplanmamalıdır.
    /// </remarks>
    public async Task<TransportSimulationLiveUpdate?> PauseAsync(
        int routeId,
        Guid simulationId,
        CancellationToken cancellationToken = default)
    {
        var paused = _state.TryPause(routeId, simulationId, UtcNow);

        if (paused is null)
        {
            return null;
        }

        var update = TransportSimulationLiveUpdate.From(paused, TransportSimulationStatus.Paused);
        await PublishAsync(paused, TransportSimulationStatus.Paused, cancellationToken);

        return update;
    }

    /// <summary>
    /// DEVAM ETTİR: duraklama süresini muhasebeye ekler ve <c>Running</c>
    /// yayınını ANINDA yapar.
    /// </summary>
    /// <remarks>
    /// Yayın anlık görüntüyü DEĞİŞTİRMEZ: araç tam olarak duraklatıldığı
    /// yerdedir ve hareket bir sonraki tick'ten itibaren oradan sürer.
    /// </remarks>
    public async Task<TransportSimulationLiveUpdate?> ResumeAsync(
        int routeId,
        Guid simulationId,
        CancellationToken cancellationToken = default)
    {
        var resumed = _state.TryResume(routeId, simulationId, UtcNow);

        if (resumed is null)
        {
            return null;
        }

        var update = TransportSimulationLiveUpdate.From(resumed, TransportSimulationStatus.Running);
        await PublishAsync(resumed, TransportSimulationStatus.Running, cancellationToken);

        return update;
    }

    /// <summary>
    /// YENİDEN BAŞLAT: eski çalıştırmayı bitirir ve yerine YENİ çalıştırmayı
    /// TEK adımda koyar.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Hattın yuvası bir an bile boşalmaz.</b> "Sıfırla sonra başlat"
    /// biçimindeki iki adımlı bir uygulama, aradaki pencerede başka bir
    /// kullanıcının başlatma isteğine yuvayı kaptırırdı; devamında bu metot
    /// kendi ürettiği B'yi kuramaz, üstelik yabancı bir çalıştırmayı vurmuş
    /// olurdu. Bağlayıcı karar deponun atomik <c>TryReplace</c>'idir.
    /// </para>
    /// <para>
    /// <b>Eski çalıştırma KİMLİĞİYLE emekliye ayrılır.</b> İz kaydı
    /// (<c>_tracks</c>) yalnızca ESKİ kimlikle silinir; B'nin izine
    /// dokunulmaz. Ayrı bir "bu rotayı iptal et" yolu ÇAĞRILMAZ — rota
    /// tabanlı bir iptal, tam da yerine yeni konmuş B'yi kaldırırdı.
    /// </para>
    /// <para>
    /// <b>Eski çalıştırmanın yolda kalmış tick'i B'yi EZEMEZ:</b> her yazma
    /// <c>(routeId, simulationId)</c> denetimlidir ve A artık hattın güncel
    /// çalıştırması değildir. Ayrıca ilerletme döngüsü depodan okuduğu için
    /// A bir daha hiç ilerletilmez.
    /// </para>
    /// <para>
    /// <b>Olay sırası anlamlıdır:</b> önce A'nın terminal yayını ve keşif
    /// çıkışı, sonra B'nin başlangıç yayını ve keşif girişi. Ters sıra,
    /// listeyi izleyen bir istemcinin B'yi görüp hemen ardından A'nın çıkışını
    /// işlemesi ve hattı bir an "aktif değil" sanması demekti.
    /// </para>
    /// </remarks>
    public async Task<TransportSimulationReplacement?> ReplaceAsync(
        int routeId,
        Guid expectedSimulationId,
        ActiveTransportSimulation replacement,
        CancellationToken cancellationToken = default)
    {
        /* Ön okuma yalnızca eski kaydın son bilinen OTORİTER konumunu terminal
           yayına koyabilmek içindir; bağlayıcı denetim aşağıdaki CAS'tır. */
        var previous = _state.Find(routeId);

        if (previous is null || previous.SimulationId != expectedSimulationId)
        {
            return null;
        }

        if (!_state.TryReplace(routeId, expectedSimulationId, replacement))
        {
            // Ön okuma ile değiştirme arasında çalıştırma değişti: dokunulmadı.
            return null;
        }

        // YALNIZCA eski kimliğin izi silinir.
        _tracks.TryRemove(expectedSimulationId, out _);

        var terminated = TransportSimulationLiveUpdate.From(previous, TransportSimulationStatus.Cancelled);
        var started = TransportSimulationLiveUpdate.From(replacement, TransportSimulationStatus.Running);

        await PublishAsync(previous, TransportSimulationStatus.Cancelled, cancellationToken);
        await AnnounceEndedAsync(previous, cancellationToken);

        await PublishAsync(replacement, TransportSimulationStatus.Running, cancellationToken);

        /* AKTİF KÜMEYE GİRİŞ de duyurulur. Hat genel olarak aktif kalsa da
           aktif ÇALIŞTIRMA kimliği değişmiştir; keşif listesini izleyen
           istemci yeni kimliği ancak bu sinyalden sonra yaptığı okumayla
           öğrenir. */
        await AnnounceStartedAsync(replacement, cancellationToken);

        return new TransportSimulationReplacement(terminated, started);
    }

    private async Task AdvanceOneAsync(
        ActiveTransportSimulation simulation,
        DateTime utcNow,
        CancellationToken cancellationToken)
    {
        var track = _tracks.GetOrAdd(
            simulation.SimulationId,
            _ => TransportSimulationTrack.Create(simulation.Path.Points));

        if (!track.IsUsable)
        {
            /* Savunmacı: tek köşeli ya da sıfır uzunluklu bir güzergahta araç
               asla ilerleyemez. Sonsuza dek %0'da bırakmak yerine çalıştırma
               iptal edilir ve istemci bunu ÖĞRENİR. */
            _logger.LogWarning(
                "Simülasyon kullanılamayan bir güzergah üzerinde başlatılmış; iptal ediliyor. RouteId: {RouteId}",
                simulation.RouteId);

            await CancelForRoutesAsync([simulation.RouteId], cancellationToken);
            return;
        }

        var durationSeconds = _options.EffectiveDurationSeconds(simulation.Path.DurationSeconds);

        /* GEÇEN SÜRE duraklamalar DÜŞÜLEREK ölçülür ve hesabın sahibi
           çalıştırmanın kendisidir (`ElapsedSeconds`). Ham `utcNow -
           StartedAt` kullanmak, devam ettirmede aracın duraklamada geçen
           sürenin tamamı kadar ileri SIÇRAMASI demekti. `StartedAt` bu
           yüzden hiç değiştirilmez. */
        var elapsedSeconds = simulation.ElapsedSeconds(utcNow) * _options.SpeedMultiplier;
        var ratio = Math.Clamp(elapsedSeconds / durationSeconds, 0, 1);

        var position = track.At(ratio);
        var snapshot = Snapshot(simulation, position, utcNow);

        var advanced = simulation.With(snapshot);

        if (position.ProgressRatio >= 1)
        {
            /* Tamamlanma: önce durumdan KALDIRILIR, sonra son konum ve
               tamamlanma tek olayda yayınlanır. Sıra bilinçlidir — kaldırma
               başarısız olursa (araya yeni bir çalıştırma girmişse) hiçbir şey
               yayınlanmaz ve bu tick sessizce düşer. */
            if (_state.TryStop(simulation.RouteId, simulation.SimulationId))
            {
                _tracks.TryRemove(simulation.SimulationId, out _);
                await PublishAsync(advanced, TransportSimulationStatus.Completed, cancellationToken);

                /* Doğal tamamlanma da bir ÜYELİK değişimidir: hat aktif
                   kümeden çıkar ve listeyi izleyen istemciler bunu bir tıklama
                   ya da yenileme beklemeden görmelidir. */
                await AnnounceEndedAsync(advanced, cancellationToken);
            }
            else
            {
                _tracks.TryRemove(simulation.SimulationId, out _);
            }

            return;
        }

        if (!_state.TryUpdateSnapshot(simulation.RouteId, simulation.SimulationId, snapshot))
        {
            // Çalıştırma iptal edilmiş ya da yerine yenisi geçmiş: yayın YOK.
            _tracks.TryRemove(simulation.SimulationId, out _);
            return;
        }

        await PublishAsync(advanced, TransportSimulationStatus.Running, cancellationToken);
    }

    /// <summary>
    /// Konumdan OTORİTER anlık görüntü — navigasyon dahil.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>HANGİ MANEVRADA OLDUĞUMUZA SUNUCU KARAR VERİR.</b> Değer burada, kat
    /// edilen mesafeden çözülür ve anlık görüntüye YAZILIR; tarayıcı onu ne
    /// hesaplar ne ilerletir. Adımı istemcide çözmek, çizginin kıvrımına bakıp
    /// "sağa dön" demeye kadar giden bir yol açardı.
    /// </para>
    /// <para>
    /// <b>Mesafe MOTORUN ekseninde ölçülür.</b> Adım sınırları güzergahı üreten
    /// motorun metrelerindedir; ilerleme oranı bu yüzden yolun KALICI
    /// <c>DistanceMeters</c>'ı ile çarpılır. İzin kendi haversine kümülatifi
    /// yalnızca KONUM interpolasyonu içindir ve buraya karıştırılmaz — iki
    /// ölçüyü karıştırmak aracı yanlış manevrada gösterirdi.
    /// </para>
    /// </remarks>
    private static TransportSimulationSnapshot Snapshot(
        ActiveTransportSimulation simulation,
        TransportSimulationPosition position,
        DateTime utcNow)
    {
        var navigation = simulation.Steps;

        if (!navigation.HasSteps)
        {
            /* Manevrası olmayan güzergah GEÇERLİDİR: araç yine hareket eder,
               yalnızca navigasyon sunulmaz. Uydurulmuş bir adım, sunucunun
               bilmediği bir gerçeği bildiriyormuş gibi olurdu. */
            return new TransportSimulationSnapshot(
                position.Point,
                position.SegmentIndex,
                position.ProgressRatio,
                position.DistanceMeters,
                utcNow);
        }

        var distanceAlongRoute = position.ProgressRatio * simulation.Path.DistanceMeters;

        return new TransportSimulationSnapshot(
            position.Point,
            position.SegmentIndex,
            position.ProgressRatio,
            position.DistanceMeters,
            utcNow,
            navigation.SequenceAt(distanceAlongRoute),
            navigation.DistanceToNextManeuverMeters(distanceAlongRoute));
    }

    /// <summary>
    /// "Bu çalıştırma aktif kümeden çıktı" sinyali. Kanal yoksa hiçbir şey
    /// olmaz.
    /// </summary>
    /// <remarks>
    /// Duyuru hatası burada YAKALANMAZ: port sözleşmesi gereği uygulama
    /// (Api adaptörü) taşıma arızasını kendi loglar ve dışarı sızdırmaz.
    /// </remarks>
    private Task AnnounceEndedAsync(
        ActiveTransportSimulation simulation,
        CancellationToken cancellationToken) =>
        _discovery is null
            ? Task.CompletedTask
            : _discovery.PublishActiveSetChangedAsync(
                TransportActiveSimulationSetChanged.Ended(simulation, UtcNow),
                cancellationToken);

    /// <summary>
    /// "Bu çalıştırma aktif kümeye girdi" sinyali.
    /// </summary>
    /// <remarks>
    /// Runner bunu YALNIZCA yeniden başlatmada duyurur: sıradan bir başlatmanın
    /// girişini servis duyurur (aktif kümeye giriş orada olur) ve bu ayrım
    /// korunur. Yeniden başlatmada giriş de çıkış da AYNI atomik adımda olur;
    /// ikisini iki ayrı sahibe bölmek, aradaki pencerede listenin hattı hiç
    /// aktif değilmiş gibi göstermesi demekti.
    /// </remarks>
    private Task AnnounceStartedAsync(
        ActiveTransportSimulation simulation,
        CancellationToken cancellationToken) =>
        _discovery is null
            ? Task.CompletedTask
            : _discovery.PublishActiveSetChangedAsync(
                TransportActiveSimulationSetChanged.Started(simulation, UtcNow),
                cancellationToken);

    private async Task PublishAsync(
        ActiveTransportSimulation simulation,
        TransportSimulationStatus status,
        CancellationToken cancellationToken)
    {
        try
        {
            await _broadcaster.PublishAsync(
                TransportSimulationLiveUpdate.From(simulation, status),
                cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            /* Yayın hattındaki bir arıza simülasyonu DURDURMAZ: sunucu durumu
               otoriterdir ve istemciler yeniden bağlandıklarında güncel anlık
               görüntüyü zaten alır. */
            _logger.LogError(
                exception,
                "Simülasyon güncellemesi yayınlanamadı. RouteId: {RouteId}",
                simulation.RouteId);
        }
    }
}
