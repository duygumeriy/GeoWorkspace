namespace StajProject.Domain.Entities;

/// <summary>
/// Kaydedilmiş bir yolculuğun tek, sıralı geçiş noktası.
/// </summary>
/// <remarks>
/// <para>
/// <b>Koordinat KOLONU yoktur.</b> Kişisel yolculuk sözleşmesi istemciden ham
/// koordinat kabul etmez (<c>JourneyWaypointRequest</c>'te böyle bir alan
/// bulunmaz); konum daima kalıcı kaydın kendisinden çözülür. Bir koordinat
/// kopyası saklamak, kaydın taşındığı durumda "bayat koordinata sessizce geri
/// düşme" yolunu açardı — tam olarak istenmeyen davranış.
/// </para>
/// <para>
/// <b>Rol saklanmaz, SIRADAN türetilir.</b> İlk nokta başlangıç, son nokta
/// varış, aradakiler ara noktadır. Rolü ayrıca yazmak, sırayla çelişebilen
/// ikinci bir otorite yaratırdı.
/// </para>
/// <para>
/// <b><see cref="ReferenceId"/> çok biçimlidir</b> (durak ya da POI) ve bu
/// yüzden veritabanı yabancı anahtarı taşımaz: tek bir kolondan iki farklı
/// tabloya FK kurulamaz. Doğrulama uygulama katmanındadır ve çözülemeyen bir
/// referans yeniden kullanımı SİMÜLASYON BAŞLAMADAN reddeder.
/// </para>
/// </remarks>
public class SavedJourneyPoint
{
    public int Id { get; set; }

    public int SavedJourneyId { get; set; }

    public SavedJourney? SavedJourney { get; set; }

    /// <summary>Sıfır tabanlı, yolculuk içinde benzersiz ve boşluksuz sıra.</summary>
    public int Sequence { get; set; }

    /// <summary><c>transportStop</c> veya <c>poi</c>.</summary>
    public string Source { get; set; } = string.Empty;

    /// <summary>Kaynak tablodaki kayıt kimliği.</summary>
    public int ReferenceId { get; set; }

    /// <summary>
    /// Kaydetme anındaki ad — YALNIZCA gösterim içindir, otorite değildir.
    /// </summary>
    /// <remarks>
    /// Liste ve inceleme ekranları bunu okur; yeniden kullanım ise adı da
    /// konumu da kalıcı kayıttan TAZE çözer.
    /// </remarks>
    public string? DisplayName { get; set; }
}
