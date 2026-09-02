using NetTopologySuite.Geometries;

namespace StajProject.Application.Routing;

/// <summary>
/// Güzergah üzerinde tek bir seyir manevrası ve onun KÜMÜLATİF sınırları.
/// </summary>
/// <remarks>
/// <para>
/// <b>Sağlayıcıdan bağımsız alanlar.</b> OSRM'nin JSON şekli, alan adları ve
/// iç yapısı bu sözleşmenin parçası DEĞİLDİR. Aynı gerekçeyle kişisel
/// yolculuğun <c>JourneyRouteStep</c>'i de burada yeniden kullanılmaz: iki
/// ürün ayrı kalır ve biri diğerinin yönlendirme modeline bağlanmaz.
/// </para>
/// <para>
/// <b>Kümülatif sınırlar burada üretilir ve bu kasıtlıdır.</b> "Araç şu anda
/// hangi manevrada?" sorusunun cevabı, adımın kendi uzunluğundan değil,
/// güzergahın BAŞINDAN itibaren nerede başlayıp bittiğinden gelir. Sınırları
/// üretim anında hesaplayıp saklamak, her tick'te adım listesini baştan
/// toplamayı gereksiz kılar.
/// </para>
/// <para>
/// <b>Ölçü OSRM metresidir</b> ve simülasyonun interpolasyon ölçüsüyle
/// (haversine kümülatifi) KARIŞTIRILMAZ. Adım çözümü daima OSRM toplamına
/// göre yapılır; ikisi aynı eksende olmadığı için karıştırmak aracı yanlış
/// manevrada gösterirdi.
/// </para>
/// </remarks>
/// <param name="Sequence">Sıfır tabanlı, güzergah boyunca artan OTORİTER sıra.</param>
/// <param name="StartDistanceMeters">Güzergah başından adımın başlangıcına.</param>
/// <param name="EndDistanceMeters">Güzergah başından adımın bitişine.</param>
public sealed record OsrmRouteStep(
    int Sequence,
    string ManeuverType,
    string? ManeuverModifier,
    string? Name,
    double DistanceMeters,
    double DurationSeconds,
    double StartDistanceMeters,
    double EndDistanceMeters);

/// <summary>
/// Hesaplanmış güzergah ve — varsa — manevra adımları.
/// </summary>
/// <remarks>
/// <b>Boş adım listesi GEÇERLİDİR ve bir hata değildir.</b> Motor adım
/// üretmeyebilir; o durumda hat yine simüle edilir, yalnızca navigasyon
/// bilgisi sunulmaz. Eksik veriyi doldurmak (ör. geometriden dönüş çıkarmak)
/// kullanıcıya sunucunun bilmediği bir şeyi bildiği izlenimini verirdi.
/// </remarks>
public sealed record OsrmRouteResult(
    LineString Geometry,
    double DistanceMeters,
    double DurationSeconds,
    string Profile,
    IReadOnlyList<OsrmRouteStep> Steps);
