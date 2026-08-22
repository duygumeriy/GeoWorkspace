using StajProject.Application.Common;

namespace StajProject.Application.Pois;

/// <summary>
/// POI'nin ad ve koordinat doğrulaması.
/// </summary>
/// <remarks>
/// Çizim tarafındaki <c>DrawingAttributeValidator</c> ile aynı sözleşmeyi
/// izler: doğrulama exception fırlatmaz, <see cref="ServiceResult{T}"/> döner
/// ve controller onu 400'e çevirir.
/// </remarks>
public static class PoiAttributeValidator
{
    /// <summary>EF <c>HasMaxLength</c> ve <c>Poi.MaxNameLength</c> ile aynı sınır.</summary>
    public const int MaxNameLength = 200;

    /// <summary>Adı kırpar ve zorunluluk/uzunluk kurallarını uygular.</summary>
    public static ServiceResult<string> ValidateName(string? name)
    {
        var trimmed = (name ?? string.Empty).Trim();

        if (trimmed.Length == 0)
        {
            return ServiceResult<string>.Failure("POI adı zorunludur.");
        }

        return trimmed.Length > MaxNameLength
            ? ServiceResult<string>.Failure($"POI adı en fazla {MaxNameLength} karakter olabilir.")
            : ServiceResult<string>.Success(trimmed);
    }

    /// <summary>
    /// EPSG:4326 koordinat doğrulaması.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>NaN ve sonsuz AÇIKÇA reddedilir.</b> JSON gövdesi bu değerleri
    /// taşıyabilir ve aralık karşılaştırmaları NaN için her zaman false döner —
    /// yani yalnızca "-180..180 dışında mı" diye sormak NaN'ı geçirirdi.
    /// Sonuç, veritabanına yazılan ve hiçbir haritada gösterilemeyen bir
    /// geometri olurdu.
    /// </para>
    /// <para>
    /// <b>Değerler EPSG:4326 kabul edilir.</b> API projeksiyon dönüşümü
    /// yapmaz; 3857 metre koordinatları zaten aralık dışına düştüğü için
    /// burada reddedilir.
    /// </para>
    /// </remarks>
    public static ServiceResult<(double Longitude, double Latitude)> ValidateCoordinate(
        double longitude,
        double latitude)
    {
        if (!double.IsFinite(longitude) || !double.IsFinite(latitude))
        {
            return ServiceResult<(double, double)>.Failure(
                "Koordinat geçersiz: boylam ve enlem sonlu sayılar olmalıdır.");
        }

        if (longitude is < -180 or > 180)
        {
            return ServiceResult<(double, double)>.Failure("Boylam -180 ile 180 arasında olmalıdır.");
        }

        if (latitude is < -90 or > 90)
        {
            return ServiceResult<(double, double)>.Failure("Enlem -90 ile 90 arasında olmalıdır.");
        }

        return ServiceResult<(double, double)>.Success((longitude, latitude));
    }
}
