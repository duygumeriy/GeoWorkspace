using NetTopologySuite.Geometries;
using StajProject.Application.Common;

namespace StajProject.Application.Interfaces;

/// <summary>
/// Konum analizinin hedef alanını çağıranın <b>coğrafi yetkisine</b> karşı
/// denetler.
/// </summary>
/// <remarks>
/// <para>
/// <b>Bu, projenin okuma yolundaki İLK coğrafi sınırıdır ve bilinçli bir
/// kural değişikliğidir.</b> Bugüne dek coğrafi yetki yalnızca bir YAZMA
/// sınırıydı (POI/çizim oluşturma <c>Covers</c> ile denetlenir); okuma
/// yollarının hiçbiri onu uygulamıyordu ve konum analizi de bu gerekçeyle
/// uygulamıyordu. Kural artık analiz için değişti: kısıtlı bir kullanıcı
/// yalnızca kendi alanında analiz çalıştırabilir.
/// </para>
/// <para>
/// <b>Neden ayrı bir tip.</b> Analiz alanını kabul eden DÖRT uç vardır (özet,
/// ağırlıklı raster, vektör listesi, isabet testi). Denetimi her birinin
/// içine ayrı ayrı yazmak, birine eklemeyi unutmanın sessiz bir atlatma yolu
/// bırakması demekti; tek bir kapı, dördünün de aynı kararı vermesini
/// yapısal olarak garanti eder.
/// </para>
/// </remarks>
public interface ILocationAnalysisAreaGuard
{
    /// <summary>
    /// <paramref name="target"/> çağıranın yetkili alanının içinde mi.
    /// </summary>
    /// <remarks>
    /// Doğrulanmış hedef geometriyi alır — istemcinin ham WKT metnini DEĞİL.
    /// Böylece denetlenen şey, sorguya gerçekten girecek olan geometrinin
    /// kendisidir.
    /// </remarks>
    Task<ServiceResult<bool>> AuthorizeAsync(Geometry target, CancellationToken cancellationToken = default);

    /// <summary>
    /// Hazır il/bölge seçiminde kaynak kimliğini ve gönderilen geometriyi
    /// backend kataloğuyla da doğrular. Varsayılan uygulama eski test
    /// koruyucularının geometrik sözleşmesini korur.
    /// </summary>
    Task<ServiceResult<bool>> AuthorizeAsync(
        Geometry target,
        string? administrativeTargetType,
        string? administrativeTargetKey,
        CancellationToken cancellationToken = default) =>
        AuthorizeAsync(target, cancellationToken);
}
