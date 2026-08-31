using System.Collections.Concurrent;
using StajProject.Application.Simulation;

namespace StajProject.Infrastructure.Simulation;

/// <summary>
/// <see cref="ITransportSimulationStateStore"/>'un süreç içi uygulaması.
/// </summary>
/// <remarks>
/// <para>
/// <b>Anahtar rota kimliğidir</b> ve "rota başına en fazla bir simülasyon"
/// kuralı buradan doğar: sözlükte bir rota için ikinci bir giriş
/// OLUŞTURULAMAZ. Kural servis katmanında bir <i>önce oku–sonra yaz</i>
/// denetimiyle tekrarlanmaz; eşzamanlı iki isteğin ikisinin de "boş" görüp
/// ikisinin de yazdığı yarış, yalnızca atomik <see cref="ConcurrentDictionary{TKey,TValue}.TryAdd"/>
/// ile kapanır.
/// </para>
/// <para>
/// <b>Depoda yalnızca değişmez veri tutulur.</b> Buraya giren hiçbir nesne bir
/// <c>DbContext</c>'e bağlı değildir (bkz. <see cref="ActiveTransportSimulation"/>);
/// singleton bir sözlükte tutulan takip edilen bir varlık, kapanmış bir
/// istek kapsamını süresiz canlı tutardı.
/// </para>
/// <para>
/// <b>Singleton olarak kaydedilir.</b> Aktif durum istek ömrünü aşar; scoped
/// bir depo her istekte boş bir dünya görürdü.
/// </para>
/// </remarks>
public sealed class InMemoryTransportSimulationStateStore : ITransportSimulationStateStore
{
    private readonly ConcurrentDictionary<int, ActiveTransportSimulation> _active = new();

    public bool TryStart(ActiveTransportSimulation simulation) =>
        _active.TryAdd(simulation.RouteId, simulation);

    public ActiveTransportSimulation? Find(int routeId) =>
        _active.TryGetValue(routeId, out var simulation) ? simulation : null;

    /* ConcurrentDictionary'nin değer görüntüsü kilit almadan alınır ve
       gezinirken değişebilir; runner zaten her yazmada kimlik denetimi
       yaptığı için tutarlı bir "an" gerekmez. */
    public IReadOnlyList<ActiveTransportSimulation> Active() => [.. _active.Values];

    public bool TryUpdateSnapshot(int routeId, Guid simulationId, TransportSimulationSnapshot snapshot)
    {
        /* Kimlik denetimi ile yazma arasında rota durdurulup yeniden
           başlatılmış olabilir; TryUpdate yalnızca OKUNAN sürüm hâlâ yerinde
           duruyorsa yazar. Geç kalmış bir runner böylece kendisinden sonraki
           çalıştırmanın konumunu geri saramaz. */
        while (_active.TryGetValue(routeId, out var current))
        {
            if (current.SimulationId != simulationId)
            {
                return false;
            }

            if (_active.TryUpdate(routeId, current.With(snapshot), current))
            {
                return true;
            }
        }

        return false;
    }

    public bool TryStop(int routeId, Guid simulationId)
    {
        while (_active.TryGetValue(routeId, out var current))
        {
            if (current.SimulationId != simulationId)
            {
                return false;
            }

            if (_active.TryRemove(KeyValuePair.Create(routeId, current)))
            {
                return true;
            }
        }

        return false;
    }
}
