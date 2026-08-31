using System.Collections.Concurrent;
using StajProject.Application.Simulation;

namespace StajProject.Infrastructure.Simulation;

/// <summary>
/// <see cref="IJourneySimulationStateStore"/>'un süreç içi uygulaması.
/// </summary>
/// <remarks>
/// <para>
/// <b>Anahtar SAHİP kimliğidir</b> ve "kullanıcı başına en fazla bir yolculuk"
/// kuralı buradan doğar. Rota anahtarlı paylaşılan depodan farkı bilinçlidir:
/// iki kullanıcı aynı A → B yolculuğunu aynı anda, birbirinden habersiz
/// oynatabilmelidir — rota düzeyinde bir dışlama kişisel bir gösterimi
/// paylaşılan bir kaynağa çevirirdi.
/// </para>
/// <para>
/// <b>Kimlikten sahibe ikinci bir dizin tutulur.</b> Hub ve durdurma yolu
/// simülasyonu KİMLİĞİYLE arar; her aramada tüm sözlüğü taramak yerine küçük
/// bir eşleme tutulur. İki yapı tek bir yazma yolundan güncellenir ki
/// ayrışmasınlar.
/// </para>
/// <para>
/// Depoya yalnızca değişmez veri girer; hiçbir EF varlığı ya da istek nesnesi
/// burada yaşamaz.
/// </para>
/// </remarks>
public sealed class InMemoryJourneySimulationStateStore : IJourneySimulationStateStore
{
    private readonly ConcurrentDictionary<int, ActiveJourneySimulation> _byOwner = new();
    private readonly ConcurrentDictionary<Guid, int> _ownerBySimulation = new();

    public bool TryStart(ActiveJourneySimulation simulation)
    {
        /* Atomik: eşzamanlı iki istek ikisi de "boş" görüp ikisi de
           yazamamalıdır. Kural servis katmanında TEKRARLANMAZ. */
        if (!_byOwner.TryAdd(simulation.OwnerUserId, simulation))
        {
            return false;
        }

        _ownerBySimulation[simulation.SimulationId] = simulation.OwnerUserId;
        return true;
    }

    public ActiveJourneySimulation? FindByOwner(int ownerUserId) =>
        _byOwner.TryGetValue(ownerUserId, out var simulation) ? simulation : null;

    public ActiveJourneySimulation? Find(Guid simulationId)
    {
        if (!_ownerBySimulation.TryGetValue(simulationId, out var ownerUserId)) return null;
        var simulation = FindByOwner(ownerUserId);

        /* Dizin bayat olabilir (sahip yeni bir yolculuk başlatmış): kimlik
           eşleşmiyorsa "yok" denir. Yanlış çalıştırmayı döndürmek, bir
           kullanıcının eski kimliğiyle yeni yolculuğuna erişmesi olurdu. */
        return simulation?.SimulationId == simulationId ? simulation : null;
    }

    public IReadOnlyList<ActiveJourneySimulation> Active() => [.. _byOwner.Values];

    public bool TryUpdateSnapshot(Guid simulationId, JourneySimulationSnapshot snapshot)
    {
        if (!_ownerBySimulation.TryGetValue(simulationId, out var ownerUserId)) return false;

        /* Okuma ile yazma arasında çalıştırma durdurulup yenisi başlatılmış
           olabilir; TryUpdate yalnızca OKUNAN sürüm hâlâ yerindeyse yazar.
           Geç kalmış bir tick böylece yeni çalıştırmayı geri saramaz. */
        while (_byOwner.TryGetValue(ownerUserId, out var current))
        {
            if (current.SimulationId != simulationId) return false;
            if (_byOwner.TryUpdate(ownerUserId, current.With(snapshot), current)) return true;
        }

        return false;
    }

    public bool TryStop(Guid simulationId)
    {
        if (!_ownerBySimulation.TryGetValue(simulationId, out var ownerUserId)) return false;

        while (_byOwner.TryGetValue(ownerUserId, out var current))
        {
            if (current.SimulationId != simulationId) return false;

            // Yalnızca BU çalıştırma kaldırılır; araya giren yenisi korunur.
            if (_byOwner.TryRemove(new KeyValuePair<int, ActiveJourneySimulation>(ownerUserId, current)))
            {
                _ownerBySimulation.TryRemove(new KeyValuePair<Guid, int>(simulationId, ownerUserId));
                return true;
            }
        }

        _ownerBySimulation.TryRemove(new KeyValuePair<Guid, int>(simulationId, ownerUserId));
        return false;
    }
}
