namespace StajProject.Application.Journeys;

/// <summary>
/// Talep edilen seyahat profilinin bu kurulumda GERÇEKTEN yönlendirilip
/// yönlendirilemediğine dair karar.
/// </summary>
/// <param name="Requested">İstemcinin talep ettiği profil.</param>
/// <param name="Support">Karşılanma durumu.</param>
/// <param name="Note">
/// Karşılanamıyorsa kullanıcıya gösterilebilecek, iç ayrıntı içermeyen
/// açıklama; karşılanıyorsa <c>null</c>.
/// </param>
public sealed record JourneyProfileDecision(
    JourneyTravelProfile Requested,
    JourneyProfileSupport Support,
    string? Note);

/// <summary>
/// Profil sözleşmesi ile GERÇEK yönlendirme yeteneği arasındaki tek karar yeri.
/// </summary>
/// <remarks>
/// <para>
/// <b>YAKLAŞIM YOKTUR.</b> Faz 5A'da yürüyüş/bisiklet, sürüş ağı üzerinde
/// "yaklaşık" sayılıyordu. Faz 5B bu kapıyı KAPATIR: bir profil ya kendi
/// motoruyla gerçekten yönlendirilir ya da kullanılamaz olarak bildirilir.
/// Ara durum, sürüş süresini bir katsayıyla çarpıp yürüyüş diye sunmanın
/// önünü açardı; rota GEOMETRİSİ de moda göre değiştiği için böyle bir
/// yaklaşım zaten yanlış olurdu.
/// </para>
/// <para>
/// <b>Karar yönlendirme portundan gelir.</b> Politika hangi adresin
/// yapılandırıldığını bilmez; yalnızca "bu profil yönlendirilebiliyor mu"
/// cevabını sözleşmeye çevirir. Böylece yapılandırma bilgisi iş kuralına
/// sızmaz.
/// </para>
/// <para>
/// <b>Toplu taşıma KAPSAM DIŞIDIR.</b> Projede GTFS, transit grafiği veya
/// tarife altyapısı bulunmadığı için bir otobüs profili hiç TANIMLANMAZ ve
/// <c>bus</c> talebi bilinmeyen bir profil olarak reddedilir.
/// </para>
/// </remarks>
public static class JourneyProfilePolicy
{
    /// <summary>Mevcut <c>Osrm</c> yapılandırmasının hizmet ettiği profil.</summary>
    public const string DrivingEngineProfile = "driving";

    private const string WalkingUnavailableNote =
        "Yürüyüş rotası için yapılandırılmış bir yürüyüş yönlendirme servisi bulunmuyor. "
        + "Sürüş rotası yürüyüş gibi gösterilmez; lütfen sürüş profilini kullanın.";

    private const string CyclingUnavailableNote =
        "Bisiklet rotası için yapılandırılmış bir bisiklet yönlendirme servisi bulunmuyor. "
        + "Sürüş rotası bisiklet gibi gösterilmez; lütfen sürüş profilini kullanın.";

    private const string DrivingUnavailableNote =
        "Sürüş rotası hesaplama servisi bu kurulumda yapılandırılmamış.";

    /// <summary>
    /// Talep edilen profili, o profilin gerçek yönlendirilebilirliğiyle
    /// karara bağlar.
    /// </summary>
    /// <param name="requested">İstemcinin talebi.</param>
    /// <param name="isRoutable">
    /// <see cref="Interfaces.IJourneyRoutingService.IsProfileRoutable"/> cevabı.
    /// </param>
    public static JourneyProfileDecision Decide(JourneyTravelProfile requested, bool isRoutable) =>
        isRoutable
            ? new JourneyProfileDecision(requested, JourneyProfileSupport.Routed, Note: null)
            : new JourneyProfileDecision(requested, JourneyProfileSupport.Unavailable, UnavailableNote(requested));

    private static string UnavailableNote(JourneyTravelProfile requested) => requested switch
    {
        JourneyTravelProfile.Walking => WalkingUnavailableNote,
        JourneyTravelProfile.Cycling => CyclingUnavailableNote,
        _ => DrivingUnavailableNote
    };
}
