using System.Globalization;

namespace StajProject.Application.Rendering;

/// <summary>
/// Doğrulanmış render penceresini bir WMS <c>BBOX</c> metnine çevirir —
/// sürüm ve CRS'e göre <b>eksen sırasını</b> uygulayarak.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden ayrı bir tip.</b> Eksen sırası bir TAŞIMA ayrıntısıdır: uygulamanın
/// geometri anlambilimi (X = boylam, Y = enlem) hiçbir yerde değişmez, yalnızca
/// tek bir WMS parametresinin yazımı değişir. Kuralı isteği kuran servisin
/// içine gömmek, ikinci bir renderer eklendiğinde sessizce unutulacak bir
/// ayrıntı bırakmak olurdu.
/// </para>
/// <para>
/// <b>Kural.</b> WMS 1.3.0, EPSG kodlarını yetkilinin tanımladığı eksen
/// sırasıyla yorumlar. EPSG:4326 için bu sıra <c>enlem, boylam</c>'dır —
/// uygulamanın ve OpenLayers'ın kullandığı <c>boylam, enlem</c> DEĞİL.
/// EPSG:3857 her iki sürümde de X,Y olduğu için etkilenmez; WMS 1.1.1 ise
/// tüm CRS'leri X,Y okur.
/// </para>
/// <para>
/// <b>Ölçüldü.</b> Kayıtlı <c>geoworkspace:analysis_poi_read</c> katmanında
/// aynı Ankara penceresi, WMS 1.3.0 + EPSG:4326 ile:
/// <c>boylam,enlem</c> sırası 5.622 baytlık boş bir PNG üretti;
/// <c>enlem,boylam</c> sırası 175.650 baytlık gerçek bir ısı haritası üretti.
/// </para>
/// <para>
/// <b>Genel bir EPSG ekseni tablosu KURULMAZ.</b> Yalnızca bu depoda gerçekten
/// kullanılan bileşimler bilinir; eksik bir genel tablo, doğru sanılan yanlış
/// cevaplar üretirdi. Bilinmeyen bir bileşim kanonik XY'de bırakılır — bugünkü
/// davranışın aynısı.
/// </para>
/// </remarks>
public static class WmsBboxFormatter
{
    /// <summary>
    /// <c>BBOX</c> metni: gerekiyorsa eksenleri takas ederek.
    /// </summary>
    /// <remarks>
    /// Yalnızca <b>WMS 1.3.0 + EPSG:4326</b> takas edilir; diğer her bileşim
    /// kanonik XY sırasında kalır, dolayısıyla mevcut EPSG:3857 uçlarının
    /// ürettiği istek metni DEĞİŞMEZ.
    /// </remarks>
    public static string Format(string version, string crs, ValidatedRender window)
    {
        ArgumentNullException.ThrowIfNull(window);

        return RequiresLatitudeFirst(version, crs)
            ? Join(window.MinY, window.MinX, window.MaxY, window.MaxX)
            : CanonicalXy(window);
    }

    /// <summary>Kanonik uygulama sırası: <c>minX,minY,maxX,maxY</c>.</summary>
    public static string CanonicalXy(ValidatedRender window)
    {
        ArgumentNullException.ThrowIfNull(window);

        return Join(window.MinX, window.MinY, window.MaxX, window.MaxY);
    }

    /// <summary>
    /// Bu sürüm/CRS bileşimi enlemi önce mi ister?
    /// </summary>
    public static bool RequiresLatitudeFirst(string version, string crs) =>
        string.Equals(version, WmsRenderContract.WmsVersion.V130, StringComparison.Ordinal)
        && string.Equals(crs, WmsRenderContract.Crs.Wgs84, StringComparison.Ordinal);

    /* G17 ve InvariantCulture: değer tam olarak yeniden üretilir ve ondalık
       ayracı hiçbir kültürde virgüle dönmez — virgül burada alan ayracıdır ve
       bbox'ı sessizce bozardı. */
    private static string Join(double first, double second, double third, double fourth) =>
        string.Join(
            ',',
            first.ToString("G17", CultureInfo.InvariantCulture),
            second.ToString("G17", CultureInfo.InvariantCulture),
            third.ToString("G17", CultureInfo.InvariantCulture),
            fourth.ToString("G17", CultureInfo.InvariantCulture));
}
