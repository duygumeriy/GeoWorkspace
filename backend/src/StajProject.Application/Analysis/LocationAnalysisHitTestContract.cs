using StajProject.Application.Common;

namespace StajProject.Application.Analysis;

/// <summary>
/// Tıklama noktasının ve arama yarıçapının <b>saf</b> doğrulaması.
/// </summary>
/// <remarks>
/// <para>
/// <b>Analiz kurallarını YENİDEN YAZMAZ.</b> Alan ve ölçütler
/// <see cref="LocationAnalysisValidator"/>'dan geçer; burada denetlenen tek
/// şey isabet testine ÖZGÜ iki alandır: tıklanan koordinat ve yarıçap.
/// </para>
/// <para>
/// <b>Koordinat KANONİKTİR: X = boylam, Y = enlem.</b> Bu bir JSON uygulama
/// ucudur; WMS 1.3.0'ın EPSG:4326 için istediği enlem-önce sıra bir TAŞIMA
/// ayrıntısıdır ve yalnızca GeoServer isteğini kuran katmanı ilgilendirir
/// (bkz. <c>WmsBboxFormatter</c>, <c>Crs.Wgs84LonLat</c>). İkisini
/// karıştırmak, Ankara'ya tıklayan kullanıcıya Suudi Arabistan'daki bir
/// noktayı aratmak olurdu.
/// </para>
/// </remarks>
public static class LocationAnalysisHitTest
{
    /// <summary>
    /// Yarıçapın alt sınırı; bundan küçük bir değer hiçbir şeyi bulamazdı.
    /// </summary>
    public const double MinToleranceMeters = 5;

    /// <summary>
    /// Yarıçapın üst sınırı.
    /// </summary>
    /// <remarks>
    /// <b>Bu sınır bir GÜVENLİK denetimidir, bir kullanılabilirlik ayarı
    /// değil.</b> Yarıçap istemciden gelir; sınırsız bırakılırsa
    /// <c>toleranceMeters = 10_000_000</c> gönderen bir istemci, tek bir
    /// tıklamayla analiz alanındaki TÜM kayıtları tarayan bir sorgu
    /// açtırabilirdi. 5 km, en kaba yakınlaştırmada bile bir noktayı
    /// yakalamaya yeter ve alan yükleminin daralttığı kümenin ötesine
    /// geçmez.
    /// </remarks>
    public const double MaxToleranceMeters = 5_000;

    /// <summary>İstemci bir yarıçap söylemediğinde kullanılan değer.</summary>
    public const double DefaultToleranceMeters = 100;

    /// <summary>
    /// Yarıçapı kabul edilebilir aralığa <b>çeker</b>; reddetmez.
    /// </summary>
    /// <remarks>
    /// <b>Neden kırpma, neden 400 değil.</b> Yarıçap kullanıcının yazdığı bir
    /// değer değildir; tarayıcı onu haritanın çözünürlüğünden türetir ve çok
    /// kaba bir yakınlaştırmada meşru olarak büyük çıkar. Böyle bir isteği
    /// hata saymak, kullanıcının anlamadığı bir başarısızlık üretirdi.
    /// Sınırın aşılması bir SALDIRI olabilir ama aynı zamanda sıradan bir
    /// yakınlaştırma düzeyidir; ikisi de aynı şekilde güvenle karşılanır.
    /// Geçersiz sayılar (NaN, sonsuz, negatif) varsayılana düşer.
    /// </remarks>
    public static double ClampTolerance(double? requested)
    {
        if (requested is not { } value || !double.IsFinite(value) || value <= 0)
        {
            return DefaultToleranceMeters;
        }

        return Math.Min(MaxToleranceMeters, Math.Max(MinToleranceMeters, value));
    }

    /// <summary>
    /// Tıklanan koordinat geçerli bir EPSG:4326 noktası mı.
    /// </summary>
    /// <remarks>
    /// Sınırlar AYRIDIR: boylam ±180, enlem ±90. Tek bir sınır kullanmak,
    /// enlemi 120 olan bir noktayı geçerli sayardı — ve eksenleri ters
    /// gönderen bir istemci sessizce boş sonuç alırdı.
    /// </remarks>
    public static ServiceResult<bool> ValidateCoordinate(double longitude, double latitude)
    {
        if (!double.IsFinite(longitude) || Math.Abs(longitude) > 180)
        {
            return ServiceResult<bool>.Failure("longitude -180 ile 180 arasında olmalıdır.");
        }

        if (!double.IsFinite(latitude) || Math.Abs(latitude) > 90)
        {
            return ServiceResult<bool>.Failure("latitude -90 ile 90 arasında olmalıdır.");
        }

        return ServiceResult<bool>.Success(true);
    }
}
