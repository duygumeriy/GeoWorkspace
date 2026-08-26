using System.Buffers.Binary;
using System.IO.Compression;
using StajProject.Application.Analysis;
using StajProject.Application.Rendering;

namespace StajProject.Auth.Tests;

/// <summary>
/// Ağırlıklı yoğunluk yüzeyinin DENKLEMİ ve YERELLİĞİ.
/// </summary>
/// <remarks>
/// <para>
/// <b>Sabitlenen şey PNG'nin baytları değil, denklemdir.</b> "İki görüntü
/// farklı" demek yeterli değildi ve bu ölçüldü: eski uygulamada 80/20 ile
/// 20/80 farklı PNG'ler üretiyordu ama boyalı piksellerin yalnızca %17'si
/// değişiyordu — kalabalık kategori her iki hâlde de baskındı. Buradaki
/// testler yüzeyin SAYISAL değerine bakar:
/// </para>
/// <code>
///   N_c(x) = D_c(x) / max_x D_c(x)
///   S(x)   = Σ_c (ağırlık_c / 100) · N_c(x)
/// </code>
/// </remarks>
public class LocationAnalysisHeatmapRendererTests
{
    /* Pencere: ~1° × 1°, Ankara enleminde. Gerçek analiz penceresi de bu
       mertebededir, dolayısıyla metre/piksel hesabı temsilîdir. */
    private const double MinX = 32.0;
    private const double MinY = 39.0;
    private const double MaxX = 33.0;
    private const double MaxY = 40.0;

    private const int Width = 256;
    private const int Height = 256;

    /* --- TEST §17: ağırlık semantiği ------------------------------------------------ */

    [Fact]
    public void Each_criterion_is_normalised_on_its_own_before_the_weights_apply()
    {
        /* <b>Kategori sayıları KASTEN çok farklıdır.</b> A'da 40, B'de 3 nokta
           var. Eski `ağırlık / sayı` modeli bu durumda kütleye göre
           normalleştirirdi ve iki ölçütün tepe değerleri arasında sayı
           oranına bağlı bir fark bırakırdı. Doğru model, her ölçütü KENDİ en
           yükseğine çeker: tepe değeri yalnızca AĞIRLIĞA eşit olmalıdır. */
        var points = new List<LocationAnalysisHeatmapPoint>();
        points.AddRange(Cluster(32.25, 39.5, count: 40, criterion: 0));
        points.AddRange(Cluster(32.75, 39.5, count: 3, criterion: 1));

        var surface = Build(points, [0.80, 0.20]);

        /* Kümeler birbirinden uzak (çekirdek bantları çakışmıyor), bu yüzden
           her kümenin tepesi yalnızca kendi ölçütünden gelir. */
        var westPeak = Peak(surface, 0, Width / 2);
        var eastPeak = Peak(surface, Width / 2, Width);

        Assert.Equal(0.80, westPeak, precision: 2);
        Assert.Equal(0.20, eastPeak, precision: 2);
    }

    [Fact]
    public void Flipping_the_weights_flips_which_cluster_dominates()
    {
        var points = new List<LocationAnalysisHeatmapPoint>();
        points.AddRange(Cluster(32.25, 39.5, count: 40, criterion: 0));
        points.AddRange(Cluster(32.75, 39.5, count: 3, criterion: 1));

        var heavyWest = Build(points, [0.80, 0.20]);
        var heavyEast = Build(points, [0.20, 0.80]);

        /* <b>Kalabalık kategori ağırlık düşünce GERÇEKTEN geriler.</b> Eski
           modelde 345'e karşı 52 gibi bir sayı farkı, kullanıcı 20 verse bile
           kalabalık kategoriyi baskın bırakıyordu. */
        Assert.True(Peak(heavyWest, 0, Width / 2) > Peak(heavyWest, Width / 2, Width));
        Assert.True(Peak(heavyEast, Width / 2, Width) > Peak(heavyEast, 0, Width / 2));

        // Oran, kullanıcının verdiği yüzdenin ta kendisidir.
        Assert.Equal(4.0, Peak(heavyWest, 0, Width / 2) / Peak(heavyWest, Width / 2, Width), precision: 1);
    }

    [Fact]
    public void A_sparse_dispersed_criterion_is_not_crushed_by_a_dense_one()
    {
        /* <b>Eski `ağırlık / sayı` modelinin ASIL hatası budur.</b> Kütle
           normalizasyonu, dağılmış bir kategorinin (bir hat boyunca dizilmiş
           duraklar) tepe değerini nokta sayısına bölerdi; kümelenmiş bir
           kategoriyi ise neredeyse hiç. Aynı ağırlıkla iki ölçüt, mekânsal
           dağılımları yüzünden farklı yükseklikte çıkardı.

           Burada A kümelenmiş (30 nokta, tek yerde), B dağılmış (30 nokta,
           birbirinden uzak). Ağırlıklar eşit; iki tepe de eşit olmalıdır. */
        var points = new List<LocationAnalysisHeatmapPoint>();
        points.AddRange(Cluster(32.25, 39.25, count: 30, criterion: 0));

        for (var index = 0; index < 30; index++)
        {
            // Doğu yarısına yayılmış, birbirine değmeyen yalıtık noktalar.
            points.Add(new LocationAnalysisHeatmapPoint(32.55 + index % 6 * 0.07, 39.6 + index / 6 * 0.07, 1));
        }

        var surface = Build(points, [0.50, 0.50]);

        Assert.Equal(
            Peak(surface, 0, Width / 2),
            Peak(surface, Width / 2, Width),
            precision: 2);
    }

    [Fact]
    public void A_criterion_with_no_points_keeps_its_weight_to_itself()
    {
        /* Hiç noktası olmayan bir ölçütün ağırlığı DİĞERLERİNE dağıtılmaz:
           kullanıcının verdiği yüzdeyi sessizce değiştirmek olurdu. Sonuç,
           var olan ölçütün kendi ağırlığıyla sınırlı kalır. */
        var surface = Build([.. Cluster(32.5, 39.5, count: 10, criterion: 0)], [0.60, 0.40]);

        Assert.Equal(0.60, surface.Values.Max(), precision: 2);
    }

    [Fact]
    public void A_single_criterion_view_is_that_criterions_own_density()
    {
        /* Tek ölçütlü görünümde ağırlık 1'dir ve yüzey N_c'nin kendisidir:
           en yoğun yer tam olarak 1.0'a oturur. */
        var surface = Build([.. Cluster(32.5, 39.5, count: 12, criterion: 0)], [1.0]);

        Assert.Equal(1.0, surface.Values.Max(), precision: 3);
    }

    [Fact]
    public void A_single_poi_is_normalised_by_its_exact_max_and_keeps_a_visible_halo()
    {
        var surface = Build([new LocationAnalysisHeatmapPoint(32.5, 39.5, 0)], [1.0]);
        var positive = surface.Values.Where(value => value > 0).ToArray();

        Assert.Equal(1.0, surface.Values.Max(), precision: 3);
        Assert.Contains(positive, value => value is > 0f and < 1f);
        Assert.Equal(0f, surface.Values.Min());
    }

    [Fact]
    public void The_four_LODs_resolve_to_7000_3000_1000_and_300_metres_by_default()
    {
        var expected = new Dictionary<string, (double Multiplier, double Metres)>
        {
            ["far"] = (3.5, 7000),
            ["medium"] = (1.5, 3000),
            ["near"] = (0.5, 1000),
            ["very_near"] = (0.15, 300)
        };

        foreach (var pair in expected)
        {
            Assert.True(LocationAnalysisHeatmapLods.TryResolve(pair.Key, out var lod));
            Assert.Equal(pair.Value.Multiplier, LocationAnalysisHeatmapLods.RadiusMultiplier(lod));
            Assert.Equal(
                pair.Value.Metres,
                LocationAnalysisHeatmapLods.RadiusMeters(
                    lod,
                    LocationAnalysisHeatmapRenderer.DefaultRadiusMeters));
        }

        Assert.False(LocationAnalysisHeatmapLods.TryResolve("street", out _));
    }

    /* --- TEST §18: yerellik --------------------------------------------------------- */

    [Fact]
    public void Heat_stays_local_and_the_empty_gap_stays_transparent()
    {
        /* Batıda bir küme, doğuda bir küme, ortada geniş bir boşluk.
           Beklenen: iki yerel leke ve aralarında BOYANMAMIŞ bir bant —
           kullanıcının bildirdiği "her yeri boyanmış" görüntüsünün tam
           tersi. */
        var points = new List<LocationAnalysisHeatmapPoint>();
        points.AddRange(Cluster(32.15, 39.5, count: 25, criterion: 0));
        points.AddRange(Cluster(32.85, 39.5, count: 25, criterion: 1));

        var surface = Build(points, [0.50, 0.50]);
        var rgba = LocationAnalysisHeatmapRenderer.Colorize(surface);

        var painted = 0;

        for (var index = 0; index < surface.Values.Length; index++)
        {
            if (rgba[index * 4 + 3] > 0) painted++;
        }

        var ratio = (double)painted / surface.Values.Length;

        /* Boyalı piksel oranı KÜÇÜK olmalıdır: iki küme, görüntünün küçük bir
           bölümünü kaplar. Bütün zarfın boyanması tam olarak düzeltilen
           hataydı. */
        Assert.InRange(ratio, 0.0005, 0.10);

        // Kümelerin TAM ORTASI boyanmamış olmalıdır.
        Assert.Equal(0, Alpha(rgba, Width / 2, Height / 2));

        // Kümelerin merkezleri ise boyalı.
        Assert.True(Alpha(rgba, PixelX(32.15), PixelY(39.5)) > 0);
        Assert.True(Alpha(rgba, PixelX(32.85), PixelY(39.5)) > 0);
    }

    [Fact]
    public void Nearby_clusters_merge_into_one_blob()
    {
        /* İki küme çekirdek bandı kadar yakınsa ARALARI da ısınır: yoğunluk
           yüzeyi süreklidir, ayrık lekeler üretmez. */
        var points = new List<LocationAnalysisHeatmapPoint>();
        points.AddRange(Cluster(32.50, 39.5, count: 20, criterion: 0));
        points.AddRange(Cluster(32.52, 39.5, count: 20, criterion: 1));

        var surface = Build(points, [0.50, 0.50]);
        var rgba = LocationAnalysisHeatmapRenderer.Colorize(surface);

        Assert.True(Alpha(rgba, PixelX(32.51), PixelY(39.5)) > 0);
    }

    [Fact]
    public void An_isolated_point_paints_a_bounded_disc_not_the_whole_window()
    {
        /* Quartic çekirdeğin taşıyıcısı SONLUdur: bant genişliğinin ötesinde
           katkı TAM OLARAK sıfırdır. Gauss çekirdeği burada bütün pencereye
           ölçülebilir bir taban değer yayardı. */
        var surface = Build([new LocationAnalysisHeatmapPoint(32.5, 39.5, 0)], [1.0]);
        var kernel = Kernel();

        var painted = surface.Values.Count(value => value > 0);
        var discArea = Math.PI * kernel.RadiusPixelsX * kernel.RadiusPixelsY;

        Assert.InRange(painted, discArea * 0.8, discArea * 1.3);
    }

    [Fact]
    public void A_single_POI_has_a_local_halo_and_transparent_distant_pixels()
    {
        var surface = Build([new LocationAnalysisHeatmapPoint(32.5, 39.5, 0)], [1.0]);
        var rgba = LocationAnalysisHeatmapRenderer.Colorize(surface);

        Assert.True(Alpha(rgba, PixelX(32.5), PixelY(39.5)) > 0);
        Assert.Equal(0, Alpha(rgba, 0, 0));
        Assert.Equal(0, Alpha(rgba, Width - 1, Height - 1));
        Assert.InRange(
            Enumerable.Range(0, surface.Values.Length).Count(index => rgba[index * 4 + 3] > 0),
            1,
            surface.Values.Length / 100);
    }

    [Fact]
    public void VERY_NEAR_singleton_is_not_area_filled()
    {
        Assert.True(LocationAnalysisHeatmapLods.TryResolve("very_near", out var lod));
        var render = Render(MinX, MinY, MaxX, MaxY);
        var kernel = LocationAnalysisHeatmapRenderer.ResolveKernel(
            render,
            LocationAnalysisHeatmapLods.RadiusMeters(lod, LocationAnalysisHeatmapRenderer.DefaultRadiusMeters));
        var surface = LocationAnalysisHeatmapRenderer.BuildSurface(
            render,
            [new LocationAnalysisHeatmapPoint(32.5, 39.5, 0)],
            [1.0],
            kernel);
        var rgba = LocationAnalysisHeatmapRenderer.Colorize(surface);

        var painted = Enumerable.Range(0, surface.Values.Length).Count(index => rgba[index * 4 + 3] > 0);

        Assert.True(Alpha(rgba, PixelX(32.5), PixelY(39.5)) > 0);
        Assert.InRange(painted, 1, surface.Values.Length / 100);
        Assert.Equal(0, Alpha(rgba, Width / 4, Height / 4));
    }

    [Fact]
    public void VERY_NEAR_POIs_one_kilometre_apart_have_separate_halos()
    {
        Assert.True(LocationAnalysisHeatmapLods.TryResolve("very_near", out var lod));
        var render = Render(32.4, 39.45, 32.6, 39.55);
        var kernel = LocationAnalysisHeatmapRenderer.ResolveKernel(
            render,
            LocationAnalysisHeatmapLods.RadiusMeters(lod, LocationAnalysisHeatmapRenderer.DefaultRadiusMeters));
        var surface = LocationAnalysisHeatmapRenderer.BuildSurface(
            render,
            [
                new LocationAnalysisHeatmapPoint(32.494, 39.5, 0),
                new LocationAnalysisHeatmapPoint(32.506, 39.5, 0)
            ],
            [1.0],
            kernel);

        /* Ankara enleminde 0.012° boylam yaklaşık 1 km'dir. 300 m'lik iki
           sonlu çekirdek arasında boş, tam saydam bir bant kalmalıdır. */
        Assert.Equal(0f, surface.Values[Height / 2 * Width + Width / 2]);
    }

    /* --- Yarıçap: yer ölçüsü, ekran ölçüsü değil ------------------------------------- */

    [Fact]
    public void The_kernel_radius_follows_the_ground_resolution()
    {
        /* Aynı bant genişliği, DAR bir pencerede daha çok piksele düşer. Eski
           sabit piksel yarıçapı bunun tam tersini yapıyordu: aynı piksel
           sayısı, geniş pencerede kilometrelerce bir bant demekti. */
        var wide = LocationAnalysisHeatmapRenderer.ResolveKernel(Render(32, 39, 34, 41), 1500);
        var narrow = LocationAnalysisHeatmapRenderer.ResolveKernel(Render(32.4, 39.4, 32.6, 39.6), 1500);

        Assert.True(narrow.RadiusPixelsX > wide.RadiusPixelsX);
    }

    [Fact]
    public void The_kernel_never_covers_more_than_a_small_share_of_the_image()
    {
        /* Çok dar bir alanda metre/piksel küçülür ve sabit bir metre bandı
           görüntünün yarısını kaplardı — yani yakınlaştıkça yeniden
           "boyanmış alan". Tavan bunu engeller. */
        var tiny = LocationAnalysisHeatmapRenderer.ResolveKernel(Render(32.500, 39.500, 32.505, 39.505), 1500);

        Assert.True(tiny.Clamped);
        Assert.InRange(
            tiny.RadiusPixelsX,
            LocationAnalysisHeatmapRenderer.MinRadiusPixels,
            Math.Max(Width, Height) * LocationAnalysisHeatmapRenderer.MaxRadiusImageFraction);
    }

    [Fact]
    public void The_kernel_is_a_circle_on_the_ground_not_on_the_screen()
    {
        /* Bir derece boylam, Türkiye enlemlerinde bir derece enlemin ~%77'si
           kadardır. Tek bir piksel yarıçapı, yerde daire olması gereken
           çekirdeği doğu-batı doğrultusunda ezerdi. */
        var kernel = LocationAnalysisHeatmapRenderer.ResolveKernel(Render(32, 39, 33, 40), 1500);

        Assert.True(kernel.RadiusPixelsX > kernel.RadiusPixelsY);
    }

    /* --- Renk ve PNG ---------------------------------------------------------------- */

    [Fact]
    public void Zero_density_is_fully_transparent()
    {
        var surface = new LocationAnalysisHeatmapSurface(2, 2, [0f, 0f, 0f, 0f]);
        var rgba = LocationAnalysisHeatmapRenderer.Colorize(surface);

        Assert.All(Enumerable.Range(0, 4), index => Assert.Equal(0, rgba[index * 4 + 3]));
    }

    [Fact]
    public void Zero_density_stays_fully_transparent_in_the_encoded_PNG()
    {
        var surface = new LocationAnalysisHeatmapSurface(2, 2, [0f, 0f, 0f, 0f]);
        var raw = DecodeUnfilteredRgba(LocationAnalysisHeatmapRenderer.RenderPng(surface), 2, 2);

        Assert.All(Enumerable.Range(0, 4), index => Assert.Equal(0, raw[index * 4 + 3]));
    }

    [Fact]
    public void The_ramp_matches_the_existing_drawing_heatmap_colours()
    {
        /* Ödev iki farklı ısı haritası için iki farklı renk dili
           gerektirmiyor; duraklar `point_density_heatmap` ile aynıdır.
           Değişen tek şey ALFA'nın alt ucudur: eski SLD rampası 0.00'dan
           0.25'e doğrusal geçtiği için çekirdeğin uzak kuyruğu bile ekranda
           gözle görülür bir mavi bırakıyordu. */
        var surface = new LocationAnalysisHeatmapSurface(4, 1, [0.25f, 0.50f, 0.75f, 1.00f]);
        var rgba = LocationAnalysisHeatmapRenderer.Colorize(surface);

        Assert.Equal("#2C7BB6", Hex(rgba, 0));
        Assert.Equal("#00A6CA", Hex(rgba, 1));
        Assert.Equal("#F9D057", Hex(rgba, 2));
        Assert.Equal("#D7191C", Hex(rgba, 3));
    }

    [Fact]
    public void The_encoded_image_is_a_real_PNG_of_the_requested_size()
    {
        var surface = Build([.. Cluster(32.5, 39.5, count: 5, criterion: 0)], [1.0]);
        var png = LocationAnalysisHeatmapRenderer.RenderPng(surface);

        Assert.Equal<byte[]>([137, 80, 78, 71, 13, 10, 26, 10], png[..8]);
        Assert.Equal("IHDR", System.Text.Encoding.ASCII.GetString(png, 12, 4));

        // IHDR genişlik/yükseklik: big-endian, imzadan sonra 16. bayttan.
        Assert.Equal(Width, (png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19]);
        Assert.Equal(Height, (png[20] << 24) | (png[21] << 16) | (png[22] << 8) | png[23]);

        Assert.Equal("IEND", System.Text.Encoding.ASCII.GetString(png, png.Length - 8, 4));
    }

    [Fact]
    public void An_empty_analysis_is_a_valid_fully_transparent_image()
    {
        /* "Burada aradığın kategorilerden yok" da geçerli bir cevaptır. */
        var surface = Build([], [0.5, 0.5]);

        Assert.All(surface.Values, value => Assert.Equal(0f, value));
        Assert.NotEmpty(LocationAnalysisHeatmapRenderer.RenderPng(surface));
    }

    [Fact]
    public void The_same_input_always_produces_the_same_image()
    {
        var points = Cluster(32.4, 39.6, count: 15, criterion: 0).ToList();

        Assert.Equal(
            LocationAnalysisHeatmapRenderer.RenderPng(Build(points, [1.0])),
            LocationAnalysisHeatmapRenderer.RenderPng(Build(points, [1.0])));
    }

    /* --- Yardımcılar ---------------------------------------------------------------- */

    private static ValidatedRender Render(double minX, double minY, double maxX, double maxY) =>
        WmsRenderContract.Validate(
            $"{minX.ToString(System.Globalization.CultureInfo.InvariantCulture)}," +
            $"{minY.ToString(System.Globalization.CultureInfo.InvariantCulture)}," +
            $"{maxX.ToString(System.Globalization.CultureInfo.InvariantCulture)}," +
            $"{maxY.ToString(System.Globalization.CultureInfo.InvariantCulture)}",
            Width,
            Height,
            1.0,
            WmsRenderContract.Crs.Wgs84LonLat).Value!;

    private static LocationAnalysisHeatmapKernel Kernel() =>
        LocationAnalysisHeatmapRenderer.ResolveKernel(
            Render(MinX, MinY, MaxX, MaxY),
            LocationAnalysisHeatmapRenderer.DefaultRadiusMeters);

    private static LocationAnalysisHeatmapSurface Build(
        IReadOnlyList<LocationAnalysisHeatmapPoint> points,
        IReadOnlyList<double> weights) =>
        LocationAnalysisHeatmapRenderer.BuildSurface(
            Render(MinX, MinY, MaxX, MaxY),
            points,
            weights,
            Kernel());

    /// <summary>Aynı noktaya yığılmış, tepe değeri belirgin bir küme.</summary>
    private static IEnumerable<LocationAnalysisHeatmapPoint> Cluster(
        double longitude,
        double latitude,
        int count,
        int criterion) =>
        Enumerable.Range(0, count).Select(index => new LocationAnalysisHeatmapPoint(
            longitude + (index % 3) * 0.002,
            latitude + (index / 3 % 3) * 0.002,
            criterion));

    private static double Peak(LocationAnalysisHeatmapSurface surface, int fromX, int toX)
    {
        var peak = 0f;

        for (var y = 0; y < surface.Height; y++)
        {
            for (var x = fromX; x < toX; x++)
            {
                var value = surface.Values[y * surface.Width + x];
                if (value > peak) peak = value;
            }
        }

        return peak;
    }

    private static int PixelX(double longitude) => (int)((longitude - MinX) / (MaxX - MinX) * Width);

    private static int PixelY(double latitude) => (int)((MaxY - latitude) / (MaxY - MinY) * Height);

    private static byte Alpha(byte[] rgba, int x, int y) => rgba[(y * Width + x) * 4 + 3];

    private static byte[] DecodeUnfilteredRgba(byte[] png, int width, int height)
    {
        using var idat = new MemoryStream();
        var offset = 8;

        while (offset < png.Length)
        {
            var length = BinaryPrimitives.ReadInt32BigEndian(png.AsSpan(offset, 4));
            var type = System.Text.Encoding.ASCII.GetString(png, offset + 4, 4);
            if (type == "IDAT") idat.Write(png, offset + 8, length);
            offset += 12 + length;
            if (type == "IEND") break;
        }

        idat.Position = 0;
        using var zlib = new ZLibStream(idat, CompressionMode.Decompress);
        using var decoded = new MemoryStream();
        zlib.CopyTo(decoded);
        var scanlines = decoded.ToArray();
        var stride = width * 4;
        var rgba = new byte[stride * height];

        for (var row = 0; row < height; row++)
        {
            Assert.Equal(0, scanlines[row * (stride + 1)]);
            Array.Copy(scanlines, row * (stride + 1) + 1, rgba, row * stride, stride);
        }

        return rgba;
    }

    private static string Hex(byte[] rgba, int index) =>
        $"#{rgba[index * 4]:X2}{rgba[index * 4 + 1]:X2}{rgba[index * 4 + 2]:X2}";
}
