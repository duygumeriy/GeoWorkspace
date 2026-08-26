using StajProject.Application.Analysis;

namespace StajProject.Auth.Tests;

/// <summary>
/// İsabet testinin <b>saf</b> girdi sözleşmesi: tıklanan koordinat ve yarıçap.
/// </summary>
/// <remarks>
/// Yarıçap tarayıcıdan gelir ve sorgunun KAPSAMINI belirler; kırpma bu yüzden
/// bir kullanılabilirlik ayarı değil, güvenlik denetimidir. Koordinat denetimi
/// ise eksenleri ters gönderen bir istemcinin sessizce boş sonuç almasını
/// engeller.
/// </remarks>
public class LocationAnalysisHitTestContractTests
{
    /* --- Yarıçap ---------------------------------------------------------------- */

    [Fact]
    public void A_hostile_tolerance_is_clamped_not_honoured()
    {
        /* Sınırsız bir yarıçap, tek tıklamayla analiz alanındaki tüm kayıtları
           tarayan bir sorgu açtırırdı. */
        Assert.Equal(
            LocationAnalysisHitTest.MaxToleranceMeters,
            LocationAnalysisHitTest.ClampTolerance(10_000_000));

        Assert.Equal(
            LocationAnalysisHitTest.MaxToleranceMeters,
            LocationAnalysisHitTest.ClampTolerance(double.MaxValue));
    }

    [Fact]
    public void A_tiny_tolerance_is_raised_to_the_floor()
    {
        Assert.Equal(
            LocationAnalysisHitTest.MinToleranceMeters,
            LocationAnalysisHitTest.ClampTolerance(0.0001));
    }

    [Fact]
    public void A_reasonable_tolerance_passes_through_untouched()
    {
        Assert.Equal(250, LocationAnalysisHitTest.ClampTolerance(250));
    }

    [Theory]
    [InlineData(null)]
    [InlineData(0d)]
    [InlineData(-1d)]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    public void An_absent_or_nonsensical_tolerance_falls_back_to_the_default(double? requested)
    {
        /* Bozuk bir sayı için hata döndürmek, tarayıcının türettiği bir değer
           yüzünden kullanıcıya anlamadığı bir başarısızlık göstermek olurdu. */
        Assert.Equal(
            LocationAnalysisHitTest.DefaultToleranceMeters,
            LocationAnalysisHitTest.ClampTolerance(requested));
    }

    [Fact]
    public void The_clamp_range_is_defensible()
    {
        Assert.True(LocationAnalysisHitTest.MinToleranceMeters > 0);
        Assert.True(
            LocationAnalysisHitTest.MaxToleranceMeters <= 5_000,
            "Üst sınır birkaç kilometreyi aşmamalıdır.");
    }

    /* --- Koordinat -------------------------------------------------------------- */

    [Fact]
    public void A_real_Ankara_click_is_accepted()
    {
        Assert.True(LocationAnalysisHitTest.ValidateCoordinate(32.852724, 39.885072).IsSuccess);
    }

    [Theory]
    [InlineData(181, 39.9)]
    [InlineData(-181, 39.9)]
    [InlineData(double.NaN, 39.9)]
    [InlineData(double.PositiveInfinity, 39.9)]
    public void An_out_of_range_longitude_is_rejected(double longitude, double latitude)
    {
        Assert.False(LocationAnalysisHitTest.ValidateCoordinate(longitude, latitude).IsSuccess);
    }

    [Theory]
    [InlineData(32.85, 91)]
    [InlineData(32.85, -91)]
    [InlineData(32.85, double.NaN)]
    public void An_out_of_range_latitude_is_rejected(double longitude, double latitude)
    {
        Assert.False(LocationAnalysisHitTest.ValidateCoordinate(longitude, latitude).IsSuccess);
    }

    [Fact]
    public void The_axes_have_separate_limits()
    {
        /* Tek bir ±180 sınırı kullanılsaydı, eksenleri ters gönderen bir
           istemcinin enlemi 120 olan noktası geçerli sayılır ve kullanıcı
           sebebini anlamadan hep boş sonuç alırdı. */
        Assert.False(LocationAnalysisHitTest.ValidateCoordinate(39.9, 120).IsSuccess);
        Assert.True(LocationAnalysisHitTest.ValidateCoordinate(120, 39.9).IsSuccess);
    }
}
