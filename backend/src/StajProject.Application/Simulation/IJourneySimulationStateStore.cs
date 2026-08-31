namespace StajProject.Application.Simulation;

/// <summary>
/// Aktif KİŞİSEL yolculuk simülasyonlarının süreç içi, sunucu otoriteli durumu.
/// </summary>
/// <remarks>
/// <para>
/// <b>Anahtar KULLANICIDIR, rota değil.</b> Tekillik "kullanıcı başına en fazla
/// bir yolculuk" olarak tanımlanır; iki farklı kullanıcı aynı A → B
/// yolculuğunu birbirinden bağımsız oynatabilmelidir. Rota düzeyinde bir
/// dışlama, kişisel bir simülasyonu paylaşılan bir kaynağa çevirirdi.
/// </para>
/// <para>
/// <b>Kalıcı değildir ve bilinçle öyledir.</b> "Şu anda çalışan" bir çalışma
/// zamanı olgusudur; tabloya yazmak, yeniden başlatmadan sonra "çalışıyor"
/// görünen ölü satırlar üretirdi. Bu fazda hiçbir yolculuk varlığı ya da
/// migration eklenmez.
/// </para>
/// <para>
/// <b>Uygulama atomik olmalıdır:</b> tekillik kuralı servis kodundaki bir
/// "önce oku sonra yaz" ile değil, deponun kendi işlemiyle sağlanır.
/// </para>
/// </remarks>
public interface IJourneySimulationStateStore
{
    /// <summary>
    /// Kullanıcının aktif yolculuğu YOKSA kaydeder.
    /// </summary>
    /// <returns>Kayıt yapıldıysa <c>true</c>; kullanıcının zaten bir çalıştırması varsa <c>false</c>.</returns>
    bool TryStart(ActiveJourneySimulation simulation);

    /// <summary>Kullanıcının aktif yolculuğu; yoksa <c>null</c>.</summary>
    ActiveJourneySimulation? FindByOwner(int ownerUserId);

    /// <summary>
    /// Kimliğe göre arar.
    /// </summary>
    /// <remarks>
    /// <b>Sahiplik denetimi ÇAĞIRANA aittir.</b> Bu metot varlığı bildirir;
    /// başkasının yolculuğunu döndürmemek hub ve servisin sorumluluğudur.
    /// </remarks>
    ActiveJourneySimulation? Find(Guid simulationId);

    /// <summary>Çalışan tüm yolculukların anlık kopyası; runner bunu gezer.</summary>
    IReadOnlyList<ActiveJourneySimulation> Active();

    /// <summary>Aynı çalıştırmanın anlık görüntüsünü değiştirir.</summary>
    /// <returns>Çalıştırma hâlâ aktifse <c>true</c>.</returns>
    bool TryUpdateSnapshot(Guid simulationId, JourneySimulationSnapshot snapshot);

    /// <summary>Yalnızca bu kimlikli çalıştırmayı kaldırır.</summary>
    bool TryStop(Guid simulationId);
}
