namespace StajProject.Application.Journeys;

/// <summary>
/// Talep edilen seyahat profilinin, bu kurulumdaki yönlendirme motoruyla
/// DÜRÜSTÇE ne kadar karşılanabildiğine dair karar.
/// </summary>
/// <param name="Requested">İstemcinin talep ettiği profil.</param>
/// <param name="EffectiveEngineProfile">
/// Planın gerçekte üzerine kurulacağı OSRM profili — sunucu yapılandırmasından
/// gelir, istekten değil.
/// </param>
/// <param name="Support">Karşılanma derecesi.</param>
/// <param name="Note">
/// Sonuçta kullanıcıya taşınacak, iç ayrıntı içermeyen açıklama. Boş olabilir
/// (talep birebir karşılanıyorsa).
/// </param>
public sealed record JourneyProfileDecision(
    JourneyTravelProfile Requested,
    string EffectiveEngineProfile,
    JourneyProfileSupport Support,
    string? Note);

/// <summary>
/// Profil sözleşmesi ile GERÇEK yönlendirme yeteneği arasındaki tek karar yeri.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden ayrı bir politika.</b> Mevcut kurulumda <c>OsrmOptions.Validate</c>
/// tek bir sunucu-yönetimli profile (<c>driving</c>) izin verir; walking ve
/// cycling için AYRI bir OSRM örneği YOKTUR. Sözleşme üç profili
/// taşıyabilmelidir (arayüz onları sunacaktır), ama servis üçünü de
/// yönlendirebiliyormuş gibi davranamaz. Karar tek yerde durur ki sonuç gövdesi
/// ile gerçeklik ayrışmasın.
/// </para>
/// <para>
/// <b>Toplu taşıma KAPSAM DIŞIDIR.</b> Projede GTFS, transit grafiği veya
/// tarife altyapısı bulunmadığı için bir otobüs profili hiç TANIMLANMAZ:
/// karayolu geometrisiyle desteklenen sahte bir toplu taşıma seçeneği sunmak,
/// kullanıcıya yanlış bir varış saati göstermek olurdu. Sözleşmede yer
/// almadığından <c>bus</c> talebi bilinmeyen bir profil olarak reddedilir.
/// </para>
/// <para>
/// <b>Yaklaşım ≠ sessiz düşüş.</b> <see cref="JourneyProfileSupport.Approximated"/>
/// bir hata değildir ama gizlenmez: sonuç özetinde hem talep edilen hem de
/// etkin profil, destek derecesi ve gerekçe metni yer alır.
/// </para>
/// </remarks>
public static class JourneyProfilePolicy
{
    /// <summary>Karayolu ağı üzerinde yönlendirilebilen tek motor profili.</summary>
    public const string DrivingEngineProfile = "driving";

    private const string NonDrivingNote =
        "Bu kurulumdaki yönlendirme motoru yalnızca karayolu (driving) profilini üretebiliyor. "
        + "Plan karayolu ağı üzerinden kurulur; mesafe yaklaşık, süre ise bu profil için bağlayıcı değildir.";

    private const string UnavailableNote =
        "Talep edilen seyahat profili bu kurulumdaki yönlendirme motoru tarafından üretilemiyor.";

    /// <summary>
    /// Talep edilen profili, yapılandırılmış motor profiliyle karşılaştırıp
    /// karara bağlar.
    /// </summary>
    /// <param name="requested">İstemcinin talebi.</param>
    /// <param name="engineProfile">
    /// <c>OsrmOptions.Profile</c>. Bugün daima <c>driving</c>'dir; parametre
    /// olarak alınır ki yapılandırma ileride genişlediğinde bu politika tek
    /// noktadan doğru cevabı vermeye devam etsin.
    /// </param>
    public static JourneyProfileDecision Decide(JourneyTravelProfile requested, string? engineProfile)
    {
        var engine = string.IsNullOrWhiteSpace(engineProfile)
            ? DrivingEngineProfile
            : engineProfile.Trim();

        var engineIsDriving = string.Equals(engine, DrivingEngineProfile, StringComparison.OrdinalIgnoreCase);

        // Motor tam olarak talep edilen profilse hiçbir uyarı gerekmez.
        if (string.Equals(engine, JourneyContractNames.Of(requested), StringComparison.OrdinalIgnoreCase))
        {
            return new JourneyProfileDecision(requested, engine, JourneyProfileSupport.Routed, Note: null);
        }

        /* Karayolu motoru, yaya ve bisiklet taleplerini TAŞIMAZ ama geometrik
           bir yaklaşım üretebilir. Motor başka bir şeye ayarlanmışsa (bugün
           yapılandırma buna izin vermiyor) yaklaşım iddiası da dürüst olmaz. */
        return engineIsDriving
            ? new JourneyProfileDecision(requested, engine, JourneyProfileSupport.Approximated, NonDrivingNote)
            : new JourneyProfileDecision(requested, engine, JourneyProfileSupport.Unsupported, UnavailableNote);
    }
}
