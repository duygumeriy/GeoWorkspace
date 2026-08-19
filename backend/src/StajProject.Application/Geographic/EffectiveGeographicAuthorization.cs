using NetTopologySuite.Geometries;

namespace StajProject.Application.Geographic;

/// <summary>
/// Bir kullanıcının YÜRÜRLÜKTEKİ coğrafi yetkisi: kısıtlı mı, kısıtlıysa nerede.
/// </summary>
/// <remarks>
/// <para>
/// <b>"Kısıt yok" ile "hiçbir yere çizemez" ayrı şeylerdir</b> ve bu tip tam da
/// o ayrımı korumak için vardır. Kısıtsızlık boş bir poligonla temsil edilseydi
/// — ki en kolay yol odur — hiç coğrafi alan tanımlanmamış her kullanıcı bir
/// anda hiçbir yere çizemez hâle gelirdi. Mevcut kurulumlarda tek bir alan bile
/// tanımlı olmadığı için bu, tüm çizim özelliğinin sessizce kapanması demekti.
/// </para>
/// <para>
/// Bu yüzden kısıtsızlık AÇIK bir durumdur: <see cref="IsRestricted"/> false
/// iken <see cref="AllowedArea"/> anlamsızdır ve okunmaz.
/// </para>
/// </remarks>
public sealed class EffectiveGeographicAuthorization
{
    private EffectiveGeographicAuthorization(bool isRestricted, Geometry? allowedArea)
    {
        IsRestricted = isRestricted;
        AllowedArea = allowedArea;
    }

    /// <summary>Kullanıcının coğrafi bir sınırı var mı.</summary>
    public bool IsRestricted { get; }

    /// <summary>
    /// İzin verilen alan. <see cref="IsRestricted"/> false ise <c>null</c>'dır.
    /// </summary>
    /// <remarks>
    /// Polygon ya da MultiPolygon olabilir: tek hedefin alanı Polygon olarak
    /// saklanır, ama birden çok rolün alanı birleştirildiğinde sonuç kopuk
    /// parçalardan oluşabilir.
    /// </remarks>
    public Geometry? AllowedArea { get; }

    /// <summary>Coğrafi sınırı olmayan kullanıcı: her yere çizebilir.</summary>
    public static EffectiveGeographicAuthorization Unrestricted { get; } = new(false, null);

    public static EffectiveGeographicAuthorization Restricted(Geometry allowedArea) =>
        new(true, allowedArea);

    /// <summary>
    /// Aday geometri BÜTÜNÜYLE izin verilen alanın içinde mi.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Predicate <c>Covers</c>'tır, <c>Contains</c> DEĞİL.</b> İkisi yalnızca
    /// sınırda ayrışır: <c>Contains</c>, adayın tamamı sınır çizgisinin üstünde
    /// kalıyorsa false döner. Bu, izin verilen alanın kenarına çizilen bir
    /// noktayı ya da tam sınır boyunca giden bir çizgiyi reddetmek olurdu —
    /// kullanıcı alanının kenarı, alanının dışı değildir.
    /// </para>
    /// <para>
    /// <b>Geometrinin TAMAMI sınanır.</b> Merkez noktası, ilk koordinatı, uç
    /// noktaları veya kapsayan dikdörtgeni değil: içbükey bir alandan çıkıp
    /// yeniden giren bir çizginin iki ucu da içeride olabilir, ama aradaki
    /// bölüm dışarıdadır ve izinli değildir.
    /// </para>
    /// </remarks>
    public bool Allows(Geometry candidate) =>
        !IsRestricted || AllowedArea!.Covers(candidate);
}
