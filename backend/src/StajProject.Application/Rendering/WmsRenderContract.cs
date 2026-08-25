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

    /* --- Piksel yoğunluğu -------------------------------------------------------

       İstemci görüntüyü CSS pikselinden DAHA YOĞUN isteyebilir: Retina bir
       ekranda 1 CSS pikseli 2 fiziksel piksele düşer ve görüntü CSS boyutunda
       çizileceği için, aynı çözünürlükte istenen bir PNG bulanık görünür.

       Ama yoğunluk yalnızca KESKİNLİK sorunu değildir. WMS görüntüsü coğrafi
       bir kapsama raptedilip CSS boyutuna küçültülür; SLD'deki her ÖLÇÜ
       (işaretçi boyutu, yazı tipi, çizgi kalınlığı) piksel cinsindendir ve bu
       küçültmeyle birlikte aynı oranda küçülür. 30 piksellik bir rozet, oran 2
       iken ekranda 15 CSS pikseli olarak görünür — kullanıcının bildirdiği
       "WMS gelince simge küçülüyor" davranışı tam olarak budur.

       Sınır 3'tür: bugünkü ekranların en yükseği 3'tür ve üstü, doğrulanmış
       genişlik/yükseklikle birlikte GeoServer'ı boşuna yorardı. */

    public const double MinimumPixelRatio = 1.0;
    public const double MaximumPixelRatio = 3.0;

    /// <summary>
    /// OGC'nin kanonik piksel boyutundan (0.28 mm) türeyen taban DPI.
    /// </summary>
    /// <remarks>
    /// GeoServer'ın varsayılanı da budur; <c>FORMAT_OPTIONS</c> gönderilmediğinde
    /// kullandığı değerdir ve buradaki hesap ondan TÜRETİLİR, elle seçilmez.
    /// </remarks>
    public const double BaseDpi = 25.4 / 0.28;

    /// <summary>Oranın "yoğunluk yok" sayıldığı tolerans.</summary>
    private const double RatioEpsilon = 0.001;

    /// <summary>EPSG:3857'nin geçerli koordinat sınırı.</summary>
    public const double WebMercatorLimit = 20_037_508.342789244;

    public static ServiceResult<ValidatedRender> Validate(
        string? bbox,
        int width,
        int height,
        double pixelRatio = MinimumPixelRatio)
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

        if (!double.IsFinite(pixelRatio)
            || pixelRatio < MinimumPixelRatio
            || pixelRatio > MaximumPixelRatio)
        {
            return ServiceResult<ValidatedRender>.Failure(
                $"pixelRatio {MinimumPixelRatio.ToString(CultureInfo.InvariantCulture)} ile "
                + $"{MaximumPixelRatio.ToString(CultureInfo.InvariantCulture)} arasında olmalıdır.");
        }

        /* Oran BOYUTLARI ÇARPMAZ. Genişlik ve yükseklik istemcinin gönderdiği,
           burada doğrulanan ve sınırlanan değerlerdir; oran yalnızca o
           boyutların CSS pikseline göre ne kadar yoğun olduğunu SÖYLER. İkisini
           birden çarpmak, piksel bütçesini sessizce dört katına çıkarırdı. */

        return ServiceResult<ValidatedRender>.Success(new ValidatedRender(
            string.Join(',', coordinates.Select(value => value.ToString("G17", CultureInfo.InvariantCulture))),
            width,
            height,
            pixelRatio));
    }

    /// <summary>
    /// Bir piksel oranının GeoServer'a bildirilecek çizim DPI'ı; yoğunluk yoksa
    /// <c>null</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Tek bir düğme iki sorunu birden çözer.</b> GeoServer'ın <c>dpi</c>
    /// seçeneği hem SLD ölçülerini <c>dpi / BaseDpi</c> katıyla büyütür hem de
    /// ölçek paydası hesabına girer. İkisi birlikte tam olarak istenen sonucu
    /// verir:
    /// </para>
    /// <para>
    /// Görüntü çözünürlüğü CSS çözünürlüğünün 1/ρ katıdır (aynı kapsam, ρ kat
    /// piksel). Ölçek paydası = çözünürlük × dpi / 0.0254 olduğundan, dpi =
    /// BaseDpi × ρ verildiğinde ρ'lar sadeleşir ve GeoServer ölçeği CSS
    /// ölçeğiymiş gibi hesaplar — yani <c>MinScaleDenominator</c> /
    /// <c>MaxScaleDenominator</c> bantları KAYMAZ. Aynı anda 30 piksellik bir
    /// işaretçi 30ρ piksel çizilir ve CSS boyutuna küçültüldüğünde yine 30 CSS
    /// pikseli olur.
    /// </para>
    /// <para>
    /// Oran 1 iken <c>null</c> döner ve istek hiç <c>FORMAT_OPTIONS</c>
    /// taşımaz: mevcut davranış birebir korunur.
    /// </para>
    /// </remarks>
    public static int? RendererDpi(double pixelRatio)
    {
        if (!double.IsFinite(pixelRatio) || Math.Abs(pixelRatio - MinimumPixelRatio) < RatioEpsilon)
        {
            return null;
        }

        /* Tam sayı: GeoServer bu seçeneği tam sayı olarak ayrıştırır. Yuvarlama
           hatası binde üçten küçüktür ve gözle görülmez. */
        return (int)Math.Round(BaseDpi * pixelRatio, MidpointRounding.AwayFromZero);
    }
}

/// <summary>Doğrulanmış ve yeniden üretilmiş render penceresi.</summary>
/// <param name="PixelRatio">
/// <see cref="Width"/>/<see cref="Height"/>'ın CSS pikseline göre yoğunluğu.
/// Boyutları ÇARPMAZ; yalnızca çizim DPI'ını belirler.
/// </param>
public sealed record ValidatedRender(string Bbox, int Width, int Height, double PixelRatio = 1.0)
{
    /// <summary>GeoServer'a bildirilecek çizim DPI'ı; yoğunluk yoksa <c>null</c>.</summary>
    public int? RendererDpi => WmsRenderContract.RendererDpi(PixelRatio);
}
