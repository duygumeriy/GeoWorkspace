using StajProject.Application.Simulation;

namespace StajProject.Application.Interfaces;

/// <summary>
/// Sona ermiş bir kişisel yolculuğu geçmişe yazan İÇ yaşam döngüsü bileşeni.
/// </summary>
/// <remarks>
/// <para>
/// <b>İstemciye açık bir ucu YOKTUR ve olmamalıdır.</b> Geçmiş, kullanıcının
/// oluşturabileceği bir kaynak değildir: "bu yolculuğu yaptım" iddiasını
/// tarayıcıdan kabul etmek, tutanağı uydurulabilir hâle getirirdi. Satırın tek
/// kaynağı sunucunun kendi terminal geçişidir.
/// </para>
/// <para>
/// <b>Yalnızca geçişi KAZANAN kod yolu çağırır.</b> Kişisel simülasyonda
/// terminal olma kararı tek bir atomik işlemle verilir
/// (<c>IJourneySimulationStateStore.TryStop</c>); bayat bir runner tick'i,
/// mükerrer bir durdurma isteği ya da tamamlanmayla yarışan bir iptal o
/// işlemi KAYBEDER ve buraya hiç ulaşamaz. Bu yüzden "tamamlandı" ve "iptal
/// edildi" satırlarının aynı çalıştırma için birlikte var olması yapısal
/// olarak imkânsızdır.
/// </para>
/// <para>
/// <b>Yazma çağıranı DÜŞÜRMEZ.</b> Terminal geçiş zaten kazanılmıştır ve geri
/// alınamaz; bir veritabanı arızası yüzünden simülasyon durumunu bozmak,
/// kaybedilen tutanaktan daha kötü olurdu. Arıza yutulmaz — iz bırakılır.
/// </para>
/// </remarks>
public interface IJourneyHistoryWriter
{
    /// <summary>
    /// Terminal çalıştırmayı geçmişe yazar; aynı çalıştırma için ikinci kez
    /// çağrılırsa hiçbir şey yapmaz.
    /// </summary>
    /// <param name="simulation">
    /// Çalıştırmanın terminal andaki DEĞİŞMEZ durumu. Kayda giren her ölçüm ve
    /// her ad buradan kopyalanır; istemciden gelen hiçbir şey giremez.
    /// </param>
    /// <param name="terminalStatus">
    /// <see cref="JourneySimulationStatus.Completed"/> ya da
    /// <see cref="JourneySimulationStatus.Cancelled"/>. <c>Running</c> geçersizdir:
    /// çalışan bir yolculuk geçmiş değildir.
    /// </param>
    /// <param name="endedAtUtc">
    /// Terminal geçişin kazanıldığı an. Çağıranın kendi otoriter saat okuması
    /// verilir; bileşen kendi başına saate bakmaz, böylece davranış gerçek
    /// beklemeler olmadan sınanabilir.
    /// </param>
    Task RecordAsync(
        ActiveJourneySimulation simulation,
        JourneySimulationStatus terminalStatus,
        DateTime endedAtUtc,
        CancellationToken cancellationToken = default);
}
