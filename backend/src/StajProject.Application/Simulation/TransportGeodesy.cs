namespace StajProject.Application.Simulation;

/// <summary>
/// SRID 4326 koordinatları arasındaki mesafenin METRE cinsinden hesabı.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden var.</b> EPSG:4326'da <c>LineString.Length</c> DERECE cinsindendir;
/// metre değildir ve enlemle birlikte ölçeği değişir. Bu değeri mesafe sanmak,
/// aracı kuzeyde bir, güneyde başka bir hızla yürütürdü. Proje içinde C#
/// tarafında bir jeodezik yardımcı bulunmadığı için (mesafe hesapları bugüne
/// dek PostGIS <c>geography</c> üzerinden yapılıyordu) mümkün olan en küçük
/// izole uygulama buraya konur.
/// </para>
/// <para>
/// <b>Haversine, küresel yaklaşım.</b> Yeryüzü elipsoit olduğundan hata
/// büyüklüğü binde birkaç mertebesindedir; bir aracın harita üzerindeki
/// animasyonu için fazlasıyla yeterlidir ve kalıcı hiçbir veriyi etkilemez.
/// Ölçüm gerektiren işler (analiz, envanter) hâlâ PostGIS'e aittir.
/// </para>
/// </remarks>
public static class TransportGeodesy
{
    /// <summary>IUGG ortalama yeryarıçapı (metre).</summary>
    private const double EarthRadiusMeters = 6_371_008.8;

    private const double DegreesToRadians = Math.PI / 180d;

    /// <summary>
    /// İki nokta arasındaki büyük çember mesafesi (metre). Girdi sonlu değilse
    /// <c>0</c> döner — bozuk bir köşe, tüm güzergahı NaN'a çevirmemelidir.
    /// </summary>
    public static double DistanceMeters(
        double longitude1,
        double latitude1,
        double longitude2,
        double latitude2)
    {
        if (!double.IsFinite(longitude1) || !double.IsFinite(latitude1)
            || !double.IsFinite(longitude2) || !double.IsFinite(latitude2))
        {
            return 0;
        }

        var lat1 = latitude1 * DegreesToRadians;
        var lat2 = latitude2 * DegreesToRadians;
        var deltaLat = (latitude2 - latitude1) * DegreesToRadians;
        var deltaLon = (longitude2 - longitude1) * DegreesToRadians;

        var haversine = (Math.Sin(deltaLat / 2) * Math.Sin(deltaLat / 2))
            + (Math.Cos(lat1) * Math.Cos(lat2) * Math.Sin(deltaLon / 2) * Math.Sin(deltaLon / 2));

        var angle = 2 * Math.Atan2(Math.Sqrt(haversine), Math.Sqrt(Math.Max(0, 1 - haversine)));

        return EarthRadiusMeters * angle;
    }

    /// <summary>Aynı hesabın nokta kayıtlarıyla kullanımı.</summary>
    public static double DistanceMeters(TransportSimulationPoint from, TransportSimulationPoint to) =>
        DistanceMeters(from.Longitude, from.Latitude, to.Longitude, to.Latitude);
}
