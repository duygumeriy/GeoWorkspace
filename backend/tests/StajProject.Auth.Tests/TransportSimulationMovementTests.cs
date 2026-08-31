using StajProject.Application.Simulation;

namespace StajProject.Auth.Tests;

/// <summary>
/// Hareketin SAF çekirdeği: mesafe ölçümü ve güzergah üzerinde interpolasyon.
/// </summary>
/// <remarks>
/// Burada ne zamanlayıcı, ne SignalR, ne veritabanı vardır. Konumun doğruluğu
/// bir arka plan servisi çalıştırmadan sınanabilir olmalıdır; bu dosya o
/// iddianın kendisidir.
/// </remarks>
public sealed class TransportSimulationMovementTests
{
    /* --- Mesafe: derece DEĞİL, metre ------------------------------------------- */

    [Fact]
    public void One_degree_of_longitude_is_not_a_constant_distance()
    {
        /* ASIL İDDİA: EPSG:4326'da "1 derece" her yerde aynı uzunluktadır (bir
           LineString.Length için 1.0'dır), ama YERYÜZÜNDE değildir. Ekvatorda
           ~111 km olan bir derece, 60. enlemde ~yarısıdır. Derece uzunluğunu
           metre sanan bir simülasyon aracı kuzeyde iki kat hızlı yürütürdü. */
        var atEquator = TransportGeodesy.DistanceMeters(30, 0, 31, 0);
        var atSixty = TransportGeodesy.DistanceMeters(30, 60, 31, 60);

        Assert.InRange(atEquator, 111_000, 111_500);
        Assert.InRange(atSixty, 55_000, 56_000);

        // Derece farkı İKİSİNDE DE 1.0'dır; ayrım yalnızca metrik hesapta doğar.
        Assert.True(atEquator > atSixty * 1.9);
    }

    [Fact]
    public void Distance_is_symmetric_zero_for_identical_points_and_safe_for_invalid_input()
    {
        Assert.Equal(
            TransportGeodesy.DistanceMeters(32, 39, 33, 40),
            TransportGeodesy.DistanceMeters(33, 40, 32, 39),
            6);
        Assert.Equal(0, TransportGeodesy.DistanceMeters(32, 39, 32, 39));

        // Bozuk bir köşe tüm güzergahı NaN'a çevirmemelidir.
        Assert.Equal(0, TransportGeodesy.DistanceMeters(double.NaN, 39, 33, 40));
        Assert.Equal(0, TransportGeodesy.DistanceMeters(32, 39, double.PositiveInfinity, 40));
    }

    [Fact]
    public void One_degree_of_latitude_is_measured_in_meters()
    {
        var meters = TransportGeodesy.DistanceMeters(30, 39, 30, 40);

        Assert.InRange(meters, 111_000, 111_500);
    }

    /* --- Kümülatif mesafe ------------------------------------------------------- */

    [Fact]
    public void Cumulative_distance_is_monotonic_and_totals_the_segments()
    {
        var track = Track((30, 40), (30.1, 40), (30.2, 40));

        Assert.True(track.IsUsable);
        Assert.Equal(0, track.CumulativeMeters[0]);
        Assert.True(track.CumulativeMeters[1] > 0);
        Assert.True(track.CumulativeMeters[2] > track.CumulativeMeters[1]);
        Assert.Equal(track.CumulativeMeters[^1], track.TotalMeters);

        // Eşit uzunluktaki iki segment: orta köşe toplam mesafenin yarısındadır.
        Assert.Equal(track.TotalMeters / 2, track.CumulativeMeters[1], 3);
    }

    /* --- İnterpolasyon: %0, ara, %100 ------------------------------------------ */

    [Fact]
    public void Zero_progress_is_the_first_vertex()
    {
        var track = Track((30, 40), (31, 40), (32, 40));

        var position = track.At(0);

        Assert.Equal(30, position.Point.Longitude, 9);
        Assert.Equal(40, position.Point.Latitude, 9);
        Assert.Equal(0, position.DistanceMeters);
        Assert.Equal(0, position.ProgressRatio);
        Assert.Equal(0, position.SegmentIndex);
    }

    [Fact]
    public void Half_progress_lands_on_the_middle_vertex_of_two_equal_segments()
    {
        var track = Track((30, 0), (31, 0), (32, 0));

        var position = track.At(0.5);

        Assert.Equal(31, position.Point.Longitude, 6);
        Assert.Equal(0, position.Point.Latitude, 9);
        Assert.Equal(track.TotalMeters / 2, position.DistanceMeters, 3);
    }

    [Fact]
    public void Intermediate_progress_interpolates_inside_the_correct_segment()
    {
        var track = Track((30, 0), (31, 0), (32, 0));

        var quarter = track.At(0.25);
        var threeQuarters = track.At(0.75);

        // İlk segmentin ortası ve ikinci segmentin ortası.
        Assert.Equal(30.5, quarter.Point.Longitude, 3);
        Assert.Equal(0, quarter.SegmentIndex);
        Assert.Equal(31.5, threeQuarters.Point.Longitude, 3);
        Assert.Equal(1, threeQuarters.SegmentIndex);
    }

    [Fact]
    public void Full_progress_is_exactly_the_last_vertex()
    {
        var track = Track((30, 40), (31, 41), (32, 42));

        var position = track.At(1);

        Assert.Equal(32, position.Point.Longitude, 9);
        Assert.Equal(42, position.Point.Latitude, 9);
        Assert.Equal(track.TotalMeters, position.DistanceMeters, 6);
        Assert.Equal(1, position.ProgressRatio);

        // Son köşe SON segmentin içindedir; indeks köşe sayısının iki eksiğidir.
        Assert.Equal(1, position.SegmentIndex);
    }

    [Theory]
    [InlineData(-0.5)]
    [InlineData(-100)]
    public void Progress_below_zero_is_clamped_to_the_start(double ratio)
    {
        var track = Track((30, 40), (31, 41));

        var position = track.At(ratio);

        Assert.Equal(30, position.Point.Longitude, 9);
        Assert.Equal(0, position.ProgressRatio);
    }

    [Theory]
    [InlineData(1.5)]
    [InlineData(1_000)]
    [InlineData(double.PositiveInfinity)]
    public void Progress_above_one_is_clamped_to_the_end(double ratio)
    {
        var track = Track((30, 40), (31, 41));

        var position = track.At(ratio);

        Assert.Equal(31, position.Point.Longitude, 9);
        Assert.Equal(1, position.ProgressRatio);
    }

    /* --- Savunmacı davranış ----------------------------------------------------- */

    [Fact]
    public void A_single_vertex_path_is_not_usable_but_never_throws()
    {
        var track = Track((30, 40));

        Assert.False(track.IsUsable);
        Assert.Equal(0, track.TotalMeters);

        var position = track.At(0.5);
        Assert.Equal(30, position.Point.Longitude, 9);
        Assert.Equal(0, position.DistanceMeters);
    }

    [Fact]
    public void A_zero_length_path_is_not_usable_and_does_not_divide_by_zero()
    {
        // Tüm köşeler aynı: toplam uzunluk sıfırdır.
        var track = Track((30, 40), (30, 40), (30, 40));

        Assert.False(track.IsUsable);
        Assert.Equal(0, track.TotalMeters);

        var position = track.At(0.5);
        Assert.Equal(30, position.Point.Longitude, 9);
        Assert.False(double.IsNaN(position.Point.Latitude));
    }

    [Fact]
    public void An_empty_path_is_handled_without_throwing()
    {
        var track = TransportSimulationTrack.Create([]);

        Assert.False(track.IsUsable);
        var position = track.At(0.5);
        Assert.False(double.IsNaN(position.Point.Longitude));
    }

    [Fact]
    public void A_repeated_vertex_inside_a_usable_path_does_not_produce_nan()
    {
        var track = Track((30, 0), (30, 0), (31, 0));

        Assert.True(track.IsUsable);

        var position = track.At(0.5);

        Assert.False(double.IsNaN(position.Point.Longitude));
        Assert.InRange(position.Point.Longitude, 30, 31);
    }

    [Fact]
    public void Nan_progress_is_read_as_the_start()
    {
        var track = Track((30, 40), (31, 41));

        var position = track.At(double.NaN);

        Assert.Equal(30, position.Point.Longitude, 9);
        Assert.Equal(0, position.ProgressRatio);
    }

    private static TransportSimulationTrack Track(params (double Longitude, double Latitude)[] points) =>
        TransportSimulationTrack.Create(
            [.. points.Select(point => new TransportSimulationPoint(point.Longitude, point.Latitude))]);
}
