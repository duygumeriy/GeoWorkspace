using Microsoft.Extensions.Logging;
using StajProject.Application.Activity;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;

namespace StajProject.Infrastructure.Services;

/// <summary>
/// Yolculuk yaşam döngüsü olaylarını mevcut aktivite defterine yazar.
/// </summary>
/// <remarks>
/// <para>
/// <b>Tek yazma yolu, üç olay.</b> Kanonik kod, kaynak türü ve güvenli
/// ayrıntılar burada tek yerde eşlenir; çağıranlar (simülasyon servisi ve arka
/// plan runner'ı) yalnızca "hangi geçişi kazandım" bilgisini verir.
/// </para>
/// <para>
/// <b>Yol ve metot SENTETİKTİR ve bilinçlidir.</b> Başlatma/durdurma birer HTTP
/// isteğinin sonucudur ve gerçek uçlarıyla yazılır; doğal tamamlanma ise arka
/// planda, hiçbir istek olmadan gerçekleşir. Ona uydurma bir HTTP metodu
/// vermek yerine <c>SYSTEM</c> denir: satır, olayın bir istekten değil sunucu
/// çalışma zamanından geldiğini açıkça söyler.
/// </para>
/// </remarks>
public sealed class JourneyActivityRecorder : IJourneyActivityRecorder
{
    /// <summary>Kaynağın kanonik yolu; sorgu dizesi taşımaz.</summary>
    private const string ResourcePath = "/api/transport/journeys/simulations";

    private const string ResourceType = "journey_simulation";

    /// <summary>İstekten değil, sunucu çalışma zamanından gelen olay.</summary>
    private const string SystemMethod = "SYSTEM";

    private readonly IActivityLogWriter _writer;
    private readonly ILogger<JourneyActivityRecorder> _logger;

    public JourneyActivityRecorder(IActivityLogWriter writer, ILogger<JourneyActivityRecorder> logger)
    {
        _writer = writer;
        _logger = logger;
    }

    public async Task RecordAsync(
        JourneyActivityOutcome outcome,
        int ownerUserId,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var entry = new ActivityLogEntry(
                ActionOf(outcome.Kind),
                ResourceType,
                outcome.SimulationId.ToString(),
                MethodOf(outcome.Kind),
                PathOf(outcome),
                StatusCodeOf(outcome.Kind),
                JourneyActivityDetails.Build(outcome),
                // Arka plan olayında istemci adresi YOKTUR; uydurulmaz.
                null);

            /* Aktör daima çalıştırmanın SAHİBİDİR. İstek yolunda bu, oturumdaki
               kimliğin ta kendisidir; arka planda ise simülasyonun başlatılırken
               doğrulanmış token'dan yazılmış sahibi. Uydurma bir "sistem
               kullanıcısı" olayın gerçek sahibini gizlerdi. */
            await _writer.WriteAsync(entry, new ActivityActor(ownerUserId), cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            /* TEK politika, ÜÇ yol. Yazıcı hatayı zaten yutar; bu sınır ise
               yazıcının kendisinin çözülememesi, ayrıntıların üretilememesi ya
               da ileride başka bir uygulamanın fırlatması gibi durumları da
               kapsar. Geçiş kazanılmıştır ve öyle kalır: durum geri alınmaz,
               olay yeniden denenmez, çağırana yanlış bir başarısızlık
               bildirilmez. */
            _logger.LogWarning(
                exception,
                "Yolculuk aktivitesi kaydedilemedi. Kind: {Kind}, SimulationId: {SimulationId}",
                outcome.Kind,
                outcome.SimulationId);
        }
    }

    private static string ActionOf(JourneyActivityKind kind) => kind switch
    {
        JourneyActivityKind.Started => ActivityActionCatalog.JourneySimulationStart,
        JourneyActivityKind.Cancelled => ActivityActionCatalog.JourneySimulationCancel,
        _ => ActivityActionCatalog.JourneySimulationComplete
    };

    private static string MethodOf(JourneyActivityKind kind) => kind switch
    {
        // Başlatma ve durdurma birer POST ucudur; tamamlanma bir istek değildir.
        JourneyActivityKind.Started => "POST",
        JourneyActivityKind.Cancelled => "POST",
        _ => SystemMethod
    };

    private static string PathOf(JourneyActivityOutcome outcome) => outcome.Kind switch
    {
        JourneyActivityKind.Started => ResourcePath,
        JourneyActivityKind.Cancelled => $"{ResourcePath}/{outcome.SimulationId}/stop",
        _ => $"{ResourcePath}/{outcome.SimulationId}"
    };

    /* Kayıt YALNIZCA geçişi kazanan yolda oluşur; dolayısıyla her satır bir
       başarıdır. Başarısız denemeler bu deftere hiç girmez. */
    private static int StatusCodeOf(JourneyActivityKind kind) =>
        kind == JourneyActivityKind.Started ? 201 : 200;
}
