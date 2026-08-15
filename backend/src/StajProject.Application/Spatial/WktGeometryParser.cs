using NetTopologySuite;
using NetTopologySuite.Geometries;
using NetTopologySuite.IO;
using StajProject.Application.Common;

namespace StajProject.Application.Spatial;

/// <summary>
/// WKT metnini NetTopologySuite geometry'sine çevirir ve beklenen tip/SRID
/// kontratını doğrular. API kontratı: gelen WKT zaten EPSG:4326'dır, burada
/// hiçbir projection dönüşümü yapılmaz.
/// </summary>
public static class WktGeometryParser
{
    public const int Srid4326 = 4326;

    /// <summary>Varsayılan SRID'i 4326 olan geometry servisi.</summary>
    private static readonly NtsGeometryServices GeometryServices = new(
        NetTopologySuite.Geometries.Implementation.CoordinateArraySequenceFactory.Instance,
        new PrecisionModel(PrecisionModels.Floating),
        Srid4326);

    public static ServiceResult<TGeometry> Parse<TGeometry>(string? wkt)
        where TGeometry : Geometry
    {
        if (string.IsNullOrWhiteSpace(wkt))
        {
            return ServiceResult<TGeometry>.Failure("WKT alanı boş olamaz.");
        }

        Geometry geometry;
        try
        {
            geometry = new WKTReader(GeometryServices).Read(wkt);
        }
        catch (Exception)
        {
            // İç exception detayı dışarı sızdırılmaz.
            return ServiceResult<TGeometry>.Failure("WKT ayrıştırılamadı. Geçerli bir WKT metni gönderin.");
        }

        // WKTReader, "SRID=3857;POINT(...)" gibi EWKT girdilerinde SRID'i taşır.
        // Bu API 4326 dışını yeniden etiketlemez; reddeder.
        if (geometry.SRID != 0 && geometry.SRID != Srid4326)
        {
            return ServiceResult<TGeometry>.Failure(
                $"Yalnızca EPSG:{Srid4326} kabul edilir. Gelen SRID: {geometry.SRID}. Projection dönüşümü istemci tarafında yapılmalıdır.");
        }

        if (geometry is not TGeometry typed)
        {
            return ServiceResult<TGeometry>.Failure(
                $"Beklenen geometry tipi {ExpectedTypeName<TGeometry>()}, gelen tip {geometry.GeometryType}.");
        }

        if (typed.IsEmpty)
        {
            // Nötr ifade: bu parser hem kayıt hem de analiz yolunda kullanılır.
            return ServiceResult<TGeometry>.Failure("Boş geometry kabul edilmez.");
        }

        if (!HasValidLonLatRange(typed))
        {
            return ServiceResult<TGeometry>.Failure(
                $"Koordinatlar EPSG:{Srid4326} aralığının dışında (boylam -180..180, enlem -90..90). " +
                "Metrik koordinatlar (ör. EPSG:3857) sadece SRID etiketlenerek kabul edilmez.");
        }

        /* Topolojik geçerlilik. NetTopologySuite'in IsValid'i kendisiyle kesişen
           halkaları (bowtie), bozuk/kapanmamış ring'leri ve benzeri hatalı
           poligonları yakalar.

           Kontrol yalnızca yüzey geometrilerine uygulanır: bir LineString'in
           kendisiyle kesişmesi geçerli bir çizimdir (kavşaklı güzergâh) ve
           reddedilmemelidir.

           Burada durması önemlidir — hem kayıt hem analiz yolu bu parser'dan
           geçtiği için geçersiz poligon ne veritabanına yazılabilir ne de
           PostGIS tarafında TopologyException'a (500) dönüşür; kullanıcı 400
           ile anlaşılır bir mesaj alır. */
        if (typed is IPolygonal && !typed.IsValid)
        {
            return ServiceResult<TGeometry>.Failure(
                "Geçersiz poligon: kenarları kendisiyle kesişiyor veya halkası hatalı. Lütfen alanı yeniden çizin.");
        }

        typed.SRID = Srid4326;
        return ServiceResult<TGeometry>.Success(typed);
    }

    private static bool HasValidLonLatRange(Geometry geometry) =>
        geometry.Coordinates.All(c =>
            c.X is >= -180 and <= 180 &&
            c.Y is >= -90 and <= 90);

    private static string ExpectedTypeName<TGeometry>() => typeof(TGeometry).Name;
}
