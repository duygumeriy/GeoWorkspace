using System.Globalization;
using StajProject.Application.Common;

namespace StajProject.Application.Rendering;

/// <summary>
/// İstemcinin bir WMS görüntüsü için belirleyebildiği TEK şeyin — görüntü
/// penceresi — doğrulaması.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden ortak.</b> Isı haritası ve normal çizim sunumu aynı güvenlik
/// sorusunu sorar: gelen metin gerçekten bir EPSG:3857 bbox mı, boyutlar
/// sunucuyu yoracak kadar büyük mü. Bu doğrulamanın iki ayrı kopyası zamanla
/// birbirinden ayrılabilir ve ayrılan taraf sessizce zayıf kalır; bu yüzden
/// kural tek yerde durur.
/// </para>
/// <para>
/// <b>Burada yetki yoktur.</b> Kullanıcı kimliği, sahiplik, CQL, workspace,
/// layer ve style bu tipe hiç uğramaz — onların sahibi çağıran servistir.
/// Doğrulanmış bbox metni yeniden üretilir (<c>G17</c>), böylece istemcinin
/// gönderdiği ham metin GeoServer'a hiçbir zaman olduğu gibi geçmez.
/// </para>
/// </remarks>
public static class WmsRenderContract
{
    public const int MinimumDimension = 64;
    public const int MaximumDimension = 2048;
    public const long MaximumPixels = 4_194_304;

    /// <summary>EPSG:3857'nin geçerli koordinat sınırı.</summary>
    public const double WebMercatorLimit = 20_037_508.342789244;

    public static ServiceResult<ValidatedRender> Validate(string? bbox, int width, int height)
    {
        var parts = (bbox ?? string.Empty).Split(',', StringSplitOptions.None);

        if (parts.Length != 4)
        {
            return ServiceResult<ValidatedRender>.Failure("bbox tam olarak dört sayı içermelidir.");
        }

        var coordinates = new double[4];

        for (var index = 0; index < parts.Length; index++)
        {
            if (!double.TryParse(
                    parts[index],
                    NumberStyles.Float,
                    CultureInfo.InvariantCulture,
                    out coordinates[index])
                || !double.IsFinite(coordinates[index])
                || Math.Abs(coordinates[index]) > WebMercatorLimit)
            {
                return ServiceResult<ValidatedRender>.Failure(
                    "bbox geçerli EPSG:3857 koordinatlarından oluşmalıdır.");
            }
        }

        if (coordinates[0] >= coordinates[2] || coordinates[1] >= coordinates[3])
        {
            return ServiceResult<ValidatedRender>.Failure("bbox minimum değerleri maksimumlardan küçük olmalıdır.");
        }

        if (width is < MinimumDimension or > MaximumDimension
            || height is < MinimumDimension or > MaximumDimension)
        {
            return ServiceResult<ValidatedRender>.Failure(
                $"width ve height {MinimumDimension} ile {MaximumDimension} arasında olmalıdır.");
        }

        if ((long)width * height > MaximumPixels)
        {
            return ServiceResult<ValidatedRender>.Failure(
                $"Harita görüntüsü en fazla {MaximumPixels} piksel olabilir.");
        }

        return ServiceResult<ValidatedRender>.Success(new ValidatedRender(
            string.Join(',', coordinates.Select(value => value.ToString("G17", CultureInfo.InvariantCulture))),
            width,
            height));
    }
}

/// <summary>Doğrulanmış ve yeniden üretilmiş render penceresi.</summary>
public sealed record ValidatedRender(string Bbox, int Width, int Height);
