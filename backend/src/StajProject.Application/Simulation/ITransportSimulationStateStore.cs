namespace StajProject.Application.Simulation;

/// <summary>
/// Aktif simülasyonların sunucu otoriteli, süreç içi durumu.
/// </summary>
/// <remarks>
/// <para>
/// <b>Kalıcı değildir ve bilinçli olarak öyledir.</b> "Şu anda çalışan"
/// simülasyon, sürecin ömrüyle sınırlı bir ÇALIŞMA ZAMANI olgusudur; yeniden
/// başlatmadan sonra hiçbir araç hareket etmiyor olacaktır. Bunu tabloya
/// yazmak, uygulama durumu ile veritabanı durumunun sessizce ayrışabildiği
/// (ölü satırlar "çalışıyor" görünen) ikinci bir gerçek kaynağı yaratırdı.
/// Kalıcı simülasyon GEÇMİŞİ ayrı bir karardır ve bu fazın konusu değildir.
/// </para>
/// <para>
/// <b>Tek instance varsayımı.</b> Durum süreç içidir; birden fazla API
/// instance'ı çalıştırıldığında her biri kendi aktif kümesini görür. Ölçekleme
/// gerekirse burası paylaşılan bir backplane ile değiştirilecek TEK yerdir —
/// arayüz o gün için bilinçle dar tutulmuştur.
/// </para>
/// <para>
/// <b>Uygulama atomik olmalıdır.</b> "Rota başına en fazla bir simülasyon"
/// kuralı, önce okuyup sonra yazan bir servis koduyla değil, deponun kendi
/// atomik işlemiyle sağlanır; aksi hâlde eşzamanlı iki istek aynı rotada iki
/// simülasyon başlatabilirdi.
/// </para>
/// </remarks>
public interface ITransportSimulationStateStore
{
    /// <summary>
    /// Rotada aktif simülasyon YOKSA kaydeder.
    /// </summary>
    /// <returns>
    /// Kayıt yapıldıysa <c>true</c>; rotada zaten bir simülasyon çalışıyorsa
    /// <c>false</c>. Kontrol ve kayıt tek atomik adımdır.
    /// </returns>
    bool TryStart(ActiveTransportSimulation simulation);

    /// <summary>Rotanın aktif simülasyonu; yoksa <c>null</c>.</summary>
    ActiveTransportSimulation? Find(int routeId);

    /// <summary>
    /// O anda çalışan tüm simülasyonların ANLIK kopyası.
    /// </summary>
    /// <remarks>
    /// Runner her tick'te bu listeyi gezer. Dönen liste bir görüntüdür: gezinti
    /// sırasında bir çalıştırma başlayabilir ya da bitebilir, bu yüzden her
    /// yazma yine kimlik denetimli <see cref="TryUpdateSnapshot"/> /
    /// <see cref="TryStop"/> üzerinden yapılır.
    /// </remarks>
    IReadOnlyList<ActiveTransportSimulation> Active();

    /// <summary>
    /// Aynı çalıştırmanın anlık görüntüsünü değiştirir. Runner'ın (sonraki faz)
    /// tek yazma yolu budur.
    /// </summary>
    /// <returns>
    /// Rotada <paramref name="simulationId"/> kimlikli çalıştırma hâlâ
    /// ÇALIŞIYORSA <c>true</c>; durdurulmuş, DURAKLATILMIŞ ya da yerine
    /// yenisi başlatılmışsa <c>false</c>.
    /// </returns>
    /// <remarks>
    /// Duraklatılmış çalıştırmaya yazılmaz: duraklatma ile yarışan, yolda olan
    /// bir tick aksi hâlde donmuş konumu ileri taşır ve durumu sessizce
    /// <c>Running</c>'e geri çevirirdi.
    /// </remarks>
    bool TryUpdateSnapshot(int routeId, Guid simulationId, TransportSimulationSnapshot snapshot);

    /// <summary>
    /// Yalnızca <paramref name="simulationId"/> kimlikli çalıştırmayı kaldırır.
    /// </summary>
    /// <remarks>
    /// Durum ÖNKOŞULU YOKTUR: hem çalışan hem duraklatılmış bir çalıştırma
    /// sonlandırılabilir. Sıfırlama ve iç iptal aynı ilkeli kullanır.
    /// </remarks>
    bool TryStop(int routeId, Guid simulationId);

    /// <summary>
    /// Çalışan çalıştırmayı DURAKLATIR (atomik, kimlik ve durum denetimli).
    /// </summary>
    /// <remarks>
    /// <para>
    /// Duraklatma TERMİNAL DEĞİLDİR: kayıt hattın aktif yuvasında KALIR, bu
    /// yüzden aynı hatta ikinci bir başlatma reddedilmeye devam eder.
    /// </para>
    /// <para>
    /// Önkoşul <c>Running</c>'dir. Zaten duraklatılmış bir çalıştırmayı
    /// yeniden duraklatmak duraklama muhasebesini bozardı (<c>PausedAt</c>
    /// ileri kayar ve devam ettirmede süre eksik sayılırdı); bu yüzden
    /// sessizce kabul edilmez.
    /// </para>
    /// </remarks>
    /// <returns>
    /// Duraklatılmış YENİ durum; kimlik tutmuyorsa ya da çalıştırma zaten
    /// çalışmıyorsa <c>null</c> — bu durumda hiçbir şeye dokunulmamıştır.
    /// </returns>
    ActiveTransportSimulation? TryPause(int routeId, Guid simulationId, DateTime now);

    /// <summary>
    /// Duraklatılmış çalıştırmayı SÜRDÜRÜR (atomik, kimlik ve durum denetimli).
    /// </summary>
    /// <remarks>
    /// Duraklama süresi burada muhasebeye eklenir; <c>StartedAt</c> ASLA
    /// değişmez. Önkoşul <c>Paused</c>'dır: çalışan bir çalıştırmayı
    /// "sürdürmek" duraklama muhasebesine sahte bir süre eklerdi.
    /// </remarks>
    /// <returns>
    /// Sürdürülmüş YENİ durum; kimlik tutmuyorsa ya da çalıştırma duraklatılmış
    /// değilse <c>null</c>.
    /// </returns>
    ActiveTransportSimulation? TryResume(int routeId, Guid simulationId, DateTime now);
}
