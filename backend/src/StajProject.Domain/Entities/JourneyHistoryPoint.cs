namespace StajProject.Domain.Entities;

/// <summary>
/// Sona ermiş bir yolculuğun tek, sıralı noktası — ÇALIŞTIRMA ANINDAKİ hâliyle.
/// </summary>
/// <remarks>
/// <para>
/// <b>İki farklı işi aynı anda görür.</b> <see cref="DisplayName"/> tarihsel
/// gösterim içindir: POI sonradan yeniden adlandırılsa bile geçmiş, kullanıcının
/// o gün gördüğü adı göstermeye devam eder. <see cref="ReferenceId"/> ise
/// KANONİK kimliktir ve yalnızca yeniden kullanımda okunur; orada kaydın
/// GÜNCEL hâli çözülür.
/// </para>
/// <para>
/// <b>Koordinat kolonu YOKTUR.</b> Kişisel yolculuk sözleşmesi istemciden ham
/// koordinat kabul etmez ve konumu daima kalıcı kayıttan çözer; tarihsel bir
/// koordinat kopyası, yeniden kullanımda "bayat konuma sessizce düşme" yolunu
/// açardı. Geçmişin gösterimi için ada ihtiyaç vardır, koordinata değil.
/// </para>
/// <para>
/// <b>Rol saklanmaz, SIRADAN türetilir</b> (ilk nokta başlangıç, son nokta
/// varış): ayrıca yazmak, sırayla çelişebilen ikinci bir otorite yaratırdı.
/// </para>
/// <para>
/// <b><see cref="ReferenceId"/> çok biçimlidir</b> (durak ya da POI) ve bu
/// yüzden yabancı anahtar taşımaz; ayrıca geçmiş, işaret ettiği kaydın
/// silinmesini engellememelidir.
/// </para>
/// </remarks>
public class JourneyHistoryPoint
{
    public int Id { get; set; }

    public int JourneyHistoryId { get; set; }

    public JourneyHistory? JourneyHistory { get; set; }

    /// <summary>Sıfır tabanlı, kayıt içinde benzersiz ve boşluksuz sıra.</summary>
    public int Sequence { get; set; }

    /// <summary><c>transportStop</c> veya <c>poi</c>.</summary>
    public string Source { get; set; } = string.Empty;

    /// <summary>Kaynak tablodaki kayıt kimliği; yeniden kullanımda çözülür.</summary>
    public int ReferenceId { get; set; }

    /// <summary>Noktanın ÇALIŞTIRMA ANINDAKİ adı; tarihsel gösterimin kaynağıdır.</summary>
    public string DisplayName { get; set; } = string.Empty;
}
