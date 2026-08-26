using StajProject.Application.Rendering;

namespace StajProject.Application.Analysis;

/// <summary>Rasterlenecek tek bir nokta: konum + ait olduğu ölçüt.</summary>
/// <param name="CriterionIndex">
/// Ölçütün istekteki SIRASI. Kategori kimliği DEĞİLDİR: bir ölçüt bir alt
/// ağacı temsil eder ve o alt ağaçtaki bütün kategoriler aynı yüzeye katkı
/// verir (bkz. <see cref="ResolvedLocationAnalysisCriteria"/> karşılığı olan
/// çözücü).
/// </param>
public readonly record struct LocationAnalysisHeatmapPoint(
    double Longitude,
    double Latitude,
    int CriterionIndex);

/// <summary>
/// Çözülmüş çekirdek yarıçapı: yer metresi ve karşılığı olan piksel yarıçapı.
/// </summary>
/// <param name="RadiusPixelsX">Boylam ekseninde piksel yarıçapı.</param>
/// <param name="RadiusPixelsY">Enlem ekseninde piksel yarıçapı.</param>
/// <remarks>
/// <b>İki eksen AYRIDIR ve bu bilinçlidir.</b> Pencere coğrafi derecelerle
/// ifade edilir; Türkiye enlemlerinde bir derece boylam bir derece enlemin
/// yaklaşık %77'si kadardır. Tek bir piksel yarıçapı kullanmak, yer üzerinde
/// DAİRE olması gereken çekirdeği doğu-batı doğrultusunda ezilmiş bir elipse
/// çevirirdi — yani yoğunluk lekeleri sistematik olarak yanlış biçimde
/// çıkardı.
/// </remarks>
public readonly record struct LocationAnalysisHeatmapKernel(
    double RadiusMeters,
    double RadiusPixelsX,
    double RadiusPixelsY,
    bool Clamped);

/// <summary>Ağırlıklı yüzey: piksel başına 0–1 arası birleşik yoğunluk.</summary>
public sealed record LocationAnalysisHeatmapSurface(int Width, int Height, float[] Values);

/// <summary>Harita yakınlığına göre seçilen dört deterministik ısı bandı.</summary>
public enum LocationAnalysisHeatmapLod
{
    Far,
    Medium,
    Near,
    VeryNear
}

/// <summary>Bir LOD bandının sunucu tarafındaki coğrafi çekirdek çarpanı.</summary>
public static class LocationAnalysisHeatmapLods
{
    public const string DefaultWireName = "near";

    public static bool TryResolve(string? wireName, out LocationAnalysisHeatmapLod lod)
    {
        var normalized = string.IsNullOrWhiteSpace(wireName)
            ? DefaultWireName
            : wireName.Trim().ToLowerInvariant();

        lod = normalized switch
        {
            "far" => LocationAnalysisHeatmapLod.Far,
            "medium" => LocationAnalysisHeatmapLod.Medium,
            "near" => LocationAnalysisHeatmapLod.Near,
            "very_near" => LocationAnalysisHeatmapLod.VeryNear,
            _ => default
        };

        return normalized is "far" or "medium" or "near" or "very_near";
    }

    public static double RadiusMultiplier(LocationAnalysisHeatmapLod lod) => lod switch
    {
        /* Varsayılan 2000 m sunucu tabanıyla sırasıyla
           7000 / 3000 / 1000 / 300 metre. */
        LocationAnalysisHeatmapLod.Far => 3.5,
        LocationAnalysisHeatmapLod.Medium => 1.5,
        LocationAnalysisHeatmapLod.Near => 0.5,
        LocationAnalysisHeatmapLod.VeryNear => 0.15,
        _ => throw new ArgumentOutOfRangeException(nameof(lod), lod, null)
    };

    public static double RadiusMeters(LocationAnalysisHeatmapLod lod, double baseRadiusMeters) =>
        baseRadiusMeters * RadiusMultiplier(lod);
}

/// <summary>
/// Konum analizinin ağırlıklı yoğunluk yüzeyini ve onun PNG'sini üreten
/// <b>saf</b> raster matematiği.
/// </summary>
/// <remarks>
/// <para>
/// <b>Hesaplanan denklem.</b> Her ölçüt <c>c</c> için, seçilen alandaki kendi
/// noktalarından bir yoğunluk yüzeyi kurulur:
/// </para>
/// <code>
///   D_c(x) = Σ_{p ∈ c} K( |x − p| )               // çekirdek toplamı
///   M_c    = max_x D_c(x)                          // ölçütün kendi tepesi
///   N_c(x) = D_c(x) / M_c                          // ÖLÇÜT BAŞINA 0–1'e çekme
///   S(x)   = Σ_c  (ağırlık_c / 100) · N_c(x)      // ağırlıklı bileşim
/// </code>
/// <para>
/// Ağırlıklar toplamı 100 olduğu ve her <c>N_c ≤ 1</c> olduğu için
/// <c>S(x) ∈ [0,1]</c>'dir; renk rampası bu yüzden ikinci bir normalleştirmeye
/// ihtiyaç duymaz.
/// </para>
/// <para>
/// <b>Neden ÖLÇÜT BAŞINA en yükseğe bölünüyor — ve neden POI SAYISINA
/// bölmek yanlıştı.</b> Önceki uygulama her noktaya <c>ağırlık_c / N_c</c>
/// veriyor ve toplamı tek bir yüzeyde topluyordu; bu, <c>D_c</c>'yi TOPLAM
/// KÜTLESİNE göre normalleştirmektir (<c>Σ = 1</c>), yerel yoğunluk
/// ARALIĞINA göre değil. İkisi denk DEĞİLDİR ve fark ölçütün mekânsal
/// dağılımına bağlıdır: aynı noktada toplanmış <c>N</c> kayıt için kütleye
/// bölünmüş tepe değeri <c>K(0)</c> iken, birbirinden uzak <c>N</c> yalıtık
/// kayıt için <c>K(0)/N</c>'dir. Yani kütle normalizasyonu KÜMELENMİŞ
/// kategorileri sistematik olarak yükseltir, DAĞILMIŞ olanları
/// (bir il boyunca dizilmiş demiryolu durakları gibi) <c>N</c> katına varan
/// bir oranda bastırır — kullanıcının verdiği yüzdeden bağımsız olarak.
/// En yüksek değere bölmek, her ölçütü kendi en yoğun yerine göre 0–1'e
/// çeker; yüzeyler ancak o zaman KARŞILAŞTIRILABİLİR olur ve ağırlıklar
/// gerçekten "etki payı" anlamına gelir.
/// </para>
/// <para>
/// <b>Yüzey bir UYGUNLUK SKORU değildir.</b> <c>S</c>, verilen ağırlıklara
/// göre birleşik yoğunluktur; kırmızı "en iyi yer" demek değil, "seçtiğiniz
/// ölçütlerin ağırlıklı yoğunluğunun bu görüntüdeki en yükseğine en yakın
/// yer" demektir.
/// </para>
/// <para>
/// <b>Neden GeoServer'ın <c>vec:Heatmap</c>'i kullanılmıyor.</b> O süreç
/// bütün kayıtlar üzerinde TEK geçiş yapar, her kayda bir ağırlık uygular ve
/// yalnızca SONUÇ yüzeyini kendi en yükseğine göre normalleştirir. Ölçüt
/// başına ayrı bir en yüksek değer ne hesaplanabilir ne de ifade edilebilir;
/// yukarıdaki denklem tek bir WMS isteğiyle KURULAMAZ. Ölçüt başına ayrı
/// raster isteyip birleştirmek mümkündü ama backend'e bir PNG ÇÖZÜCÜ, istek
/// başına 2–5 ağ gidiş dönüşü ve ağırlıklandırmadan önce ölçüt başına 8 bitlik
/// nicemleme eklerdi. Nokta verisi zaten aynı veritabanındadır; yüzeyi burada
/// çift duyarlıkla üretmek hem daha küçük hem daha kesindir.
/// </para>
/// </remarks>
public static class LocationAnalysisHeatmapRenderer
{
    /* --- Çekirdek yarıçapı ----------------------------------------------------

       <b>Yarıçap bir YER ÖLÇÜSÜDÜR, ekran ölçüsü değil.</b> Piksel cinsinden
       sabit bir yarıçap, aynı sayıda pikselle çizilen bir il ile elle çizilmiş
       küçük bir poligonda TAMAMEN farklı iki coğrafi bant anlamına gelirdi:
       Ankara ölçeğinde 30 piksel ≈ 4 km'dir ve şehrin tamamını tek bir lekeye
       çevirir — kullanıcının bildirdiği "boyanmış alan" görüntüsü tam olarak
       budur.

       Bant genişliği bu yüzden metreyle tanımlanır ve rasterin çözünürlüğü
       (metre/piksel) üzerinden piksele çevrilir. Metre/piksel doğrudan
       pencerenin coğrafi genişliğinden ve istenen piksel boyutundan gelir,
       dolayısıyla yarıçapın seçilen ALANLA ilişkisi de kuruludur: aynı
       bant, geniş bir ilde birkaç piksel, dar bir poligonda onlarca piksel
       eder. */

    /// <summary>LOD çarpanlarının varsayılan taban yarıçapı (metre).</summary>
    /// <remarks>
    /// Varsayılan 2000 m taban; FAR, MEDIUM, NEAR ve VERY_NEAR bantlarında
    /// sırasıyla 7000, 3000, 1000 ve 300 metreye çevrilir.
    /// <para>
    /// Değer yapılandırmadan gelir; burada yalnızca varsayılan taban durur.
    /// </para>
    /// </remarks>
    public const double DefaultRadiusMeters = 2000;

    /// <summary>Piksel yarıçapının alt sınırı.</summary>
    /// <remarks>
    /// Bunun altında çekirdek tek tek piksellere düşer ve yüzey bir yoğunluk
    /// haritası değil, benekli bir nokta bulutu gibi görünür.
    /// </remarks>
    public const int MinRadiusPixels = 3;

    /// <summary>Piksel yarıçapının mutlak üst sınırı.</summary>
    /// <remarks>
    /// Maliyet çekirdek alanıyla (yarıçapın KARESİ) büyür; bu tavan, nokta
    /// başına en çok ~16 bin hücre güncellemesi demektir.
    /// </remarks>
    public const int MaxRadiusPixels = 64;

    /// <summary>Piksel yarıçapının, görüntünün uzun kenarına oranla üst sınırı.</summary>
    /// <remarks>
    /// Çok dar bir alan seçildiğinde metre/piksel küçülür ve sabit bir metre
    /// bandı görüntünün yarısını kaplayacak bir yarıçaba dönüşürdü — yani
    /// yakınlaştıkça yeniden "boyanmış alan" görüntüsü. Bu oran, çekirdeğin
    /// hiçbir ölçekte görüntünün küçük bir bölümünden fazlasını kaplamamasını
    /// garanti eder.
    /// </remarks>
    public const double MaxRadiusImageFraction = 0.04;

    /* --- Küre yaklaşıklıkları --------------------------------------------------
       Bant genişliği zaten bir MODELLEME seçimidir (1500 m yerine 1400 m de
       savunulabilir); elipsoit üzerinde tam jeodezik uzunluk hesaplamak,
       yüzde yarımlık bir düzeltme için raster döngüsüne trigonometri
       eklemek olurdu. Değerler WGS84'ün standart yaklaşıklıklarıdır. */

    private const double MetersPerDegreeLatitude = 110_574.0;

    private const double MetersPerDegreeLongitudeAtEquator = 111_320.0;

    /// <summary>
    /// Pencerenin çözünürlüğünden çekirdeğin piksel yarıçapını çözer.
    /// </summary>
    public static LocationAnalysisHeatmapKernel ResolveKernel(ValidatedRender render, double radiusMeters)
    {
        ArgumentNullException.ThrowIfNull(render);

        var centerLatitude = (render.MinY + render.MaxY) / 2.0;
        var longitudeMeters = Math.Cos(centerLatitude * Math.PI / 180.0) * MetersPerDegreeLongitudeAtEquator;

        /* Kutuplara çok yakın bir pencerede kosinüs sıfıra gider ve metre/piksel
           sıfır olurdu; taban değer bölmeyi güvenli kılar ve pratikte hiçbir
           Türkiye penceresinde devreye girmez. */
        longitudeMeters = Math.Max(longitudeMeters, 1.0);

        var metersPerPixelX = (render.MaxX - render.MinX) * longitudeMeters / render.Width;
        var metersPerPixelY = (render.MaxY - render.MinY) * MetersPerDegreeLatitude / render.Height;

        var ceiling = Math.Min(
            MaxRadiusPixels,
            Math.Max(MinRadiusPixels, Math.Max(render.Width, render.Height) * MaxRadiusImageFraction));

        var rawX = radiusMeters / Math.Max(metersPerPixelX, double.Epsilon);
        var rawY = radiusMeters / Math.Max(metersPerPixelY, double.Epsilon);

        var radiusX = Math.Clamp(rawX, MinRadiusPixels, ceiling);
        var radiusY = Math.Clamp(rawY, MinRadiusPixels, ceiling);

        return new LocationAnalysisHeatmapKernel(
            radiusMeters,
            radiusX,
            radiusY,
            Clamped: Math.Abs(radiusX - rawX) > 1e-9 || Math.Abs(radiusY - rawY) > 1e-9);
    }

    /// <summary>
    /// Ağırlıklı yüzeyi üretir: <c>S(x) = Σ w_c · N_c(x)</c>.
    /// </summary>
    /// <param name="weights">
    /// Ölçüt başına 0–1 ağırlık; sırası <see cref="LocationAnalysisHeatmapPoint.CriterionIndex"/>
    /// ile aynıdır. Toplamı 1 olmalıdır (doğrulayıcı zaten 100'ü zorunlu kılar).
    /// </param>
    public static LocationAnalysisHeatmapSurface BuildSurface(
        ValidatedRender render,
        IReadOnlyList<LocationAnalysisHeatmapPoint> points,
        IReadOnlyList<double> weights,
        LocationAnalysisHeatmapKernel kernel)
    {
        ArgumentNullException.ThrowIfNull(render);
        ArgumentNullException.ThrowIfNull(points);
        ArgumentNullException.ThrowIfNull(weights);

        var width = render.Width;
        var height = render.Height;
        var surface = new float[width * height];

        var spanX = render.MaxX - render.MinX;
        var spanY = render.MaxY - render.MinY;

        if (spanX <= 0 || spanY <= 0 || weights.Count == 0)
        {
            return new LocationAnalysisHeatmapSurface(width, height, surface);
        }

        /* <b>Ölçüt başına TEK tampon, ölçüt sayısı kadar tampon DEĞİL.</b>
           Her ölçütün yüzeyi kurulur, kendi en yükseğine bölünür ve hemen
           birleşik yüzeye eklenir; hepsini aynı anda bellekte tutmak, 5
           ölçütlü bir analizde raster boyutunun beş katını gereksizce
           ayırmak olurdu. */
        var scratch = new float[width * height];

        for (var criterion = 0; criterion < weights.Count; criterion++)
        {
            var weight = weights[criterion];

            if (weight <= 0)
            {
                continue;
            }

            Array.Clear(scratch);
            var any = false;

            foreach (var point in points)
            {
                if (point.CriterionIndex != criterion)
                {
                    continue;
                }

                any |= Splat(scratch, width, height, render, spanX, spanY, kernel, point);
            }

            if (!any)
            {
                continue;
            }

            var maximum = scratch.Max();

            if (maximum <= 0f)
            {
                /* Ölçütün bütün noktaları pencerenin dışına düştü: yüzeye
                   katkısı yoktur. Ağırlığı BAŞKA ölçütlere dağıtılmaz —
                   kullanıcının verdiği yüzdeyi sessizce değiştirmek olurdu. */
                continue;
            }

            for (var index = 0; index < surface.Length; index++)
            {
                var value = scratch[index];

                if (value <= 0f) continue;

                surface[index] += (float)(value / maximum * weight);
            }
        }

        return new LocationAnalysisHeatmapSurface(width, height, surface);
    }

    /// <summary>
    /// Tek bir noktanın çekirdeğini tampona ekler; nokta hiçbir hücreye
    /// değmiyorsa <c>false</c>.
    /// </summary>
    /// <remarks>
    /// <b>Çekirdek quartic'tir (biweight): <c>K(d) = (1 − d²)²</c>, <c>d ≤ 1</c>.</b>
    /// Sonlu bir taşıyıcısı vardır — yani bir noktanın etkisi bant genişliğinin
    /// ötesinde TAM OLARAK sıfırdır. Gauss çekirdeği kuyruğu asla sıfırlanmadığı
    /// için, tek bir yoğun küme bütün pencereye ölçülebilir bir taban değer
    /// yayar ve normalleştirmeden sonra "her yer biraz sıcak" görüntüsü verirdi.
    /// Boş alanların gerçekten boş kalması bu seçimle sağlanır.
    /// </remarks>
    private static bool Splat(
        float[] target,
        int width,
        int height,
        ValidatedRender render,
        double spanX,
        double spanY,
        LocationAnalysisHeatmapKernel kernel,
        LocationAnalysisHeatmapPoint point)
    {
        /* Piksel merkezine göre konum: Y AŞAĞI doğru artar (raster satır 0
           pencerenin ÜST kenarıdır), coğrafi enlem ise yukarı. */
        var centerX = (point.Longitude - render.MinX) / spanX * width;
        var centerY = (render.MaxY - point.Latitude) / spanY * height;

        var radiusX = kernel.RadiusPixelsX;
        var radiusY = kernel.RadiusPixelsY;

        var minX = (int)Math.Floor(centerX - radiusX);
        var maxX = (int)Math.Ceiling(centerX + radiusX);
        var minY = (int)Math.Floor(centerY - radiusY);
        var maxY = (int)Math.Ceiling(centerY + radiusY);

        if (maxX < 0 || maxY < 0 || minX >= width || minY >= height)
        {
            return false;
        }

        minX = Math.Max(minX, 0);
        minY = Math.Max(minY, 0);
        maxX = Math.Min(maxX, width - 1);
        maxY = Math.Min(maxY, height - 1);

        var touched = false;

        for (var y = minY; y <= maxY; y++)
        {
            var dy = (y + 0.5 - centerY) / radiusY;
            var dy2 = dy * dy;

            if (dy2 > 1) continue;

            var row = y * width;

            for (var x = minX; x <= maxX; x++)
            {
                var dx = (x + 0.5 - centerX) / radiusX;
                var distance = dx * dx + dy2;

                if (distance > 1) continue;

                var falloff = 1 - distance;
                target[row + x] += (float)(falloff * falloff);
                touched = true;
            }
        }

        return touched;
    }

    /// <summary>
    /// Yüzeyi renk rampasıyla RGBA tamponuna çevirir.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Renk durakları mevcut <c>point_density_heatmap</c> ile AYNIDIR.</b>
    /// Ödev iki farklı ısı haritası için iki farklı renk dili gerektirmiyor;
    /// mavi→camgöbeği→sarı→kırmızı sırası projede zaten okunmuş bir ölçektir.
    /// </para>
    /// <para>
    /// <b>Değişen tek şey ALFA'nın alt ucudur.</b> Eski SLD rampası 0.00'da
    /// saydam, 0.25'te tam opaktı ve arada DOĞRUSAL geçiyordu: yani yalnızca
    /// çekirdeğin uzak kuyruğuna denk gelen 0.05 gibi bir değer bile ekranda
    /// gözle görülür bir mavi bırakıyordu. Analiz zarfının tamamının
    /// boyanmış görünmesinin ikinci nedeni buydu (birincisi yarıçaptı).
    /// Burada alfa çok dar bir bantta (0 → 0.06) yükselir; altındaki her şey
    /// gerçekten saydamdır, dolayısıyla POI'nin bulunmadığı yerler boş kalır.
    /// </para>
    /// </remarks>
    public static byte[] Colorize(LocationAnalysisHeatmapSurface surface)
    {
        ArgumentNullException.ThrowIfNull(surface);

        var rgba = new byte[surface.Values.Length * 4];

        for (var index = 0; index < surface.Values.Length; index++)
        {
            var value = surface.Values[index];

            /* Kritik PNG sözleşmesi rampadan ÖNCE sabitlenir: yoğunluk
               yoksa piksel başlangıçtaki (0,0,0,0) hâlinde kalır. */
            if (!float.IsFinite(value) || value <= 0f)
            {
                continue;
            }

            var (r, g, b, a) = Sample(value);

            var target = index * 4;
            rgba[target] = r;
            rgba[target + 1] = g;
            rgba[target + 2] = b;
            rgba[target + 3] = a;
        }

        return rgba;
    }

    /// <summary>Rampanın durakları: (değer, R, G, B, alfa).</summary>
    private static readonly (double Value, byte R, byte G, byte B, double Alpha)[] Ramp =
    [
        (0.00, 0x2C, 0x7B, 0xB6, 0.00),
        (0.06, 0x2C, 0x7B, 0xB6, 0.55),
        (0.25, 0x2C, 0x7B, 0xB6, 1.00),
        (0.50, 0x00, 0xA6, 0xCA, 1.00),
        (0.75, 0xF9, 0xD0, 0x57, 1.00),
        (1.00, 0xD7, 0x19, 0x1C, 1.00),
    ];

    /// <summary>Boyanmayan pikselin eşiği.</summary>
    /// <remarks>
    /// Kayan nokta toplamı, hiçbir çekirdeğin değmediği bir hücrede tam sıfır
    /// kalır; bu eşik, çekirdeğin en dış halkasındaki neredeyse-sıfır
    /// değerlerin ekranda bir iz bırakmamasını sağlar.
    /// </remarks>
    private const double TransparentBelow = 0.004;

    private static (byte R, byte G, byte B, byte A) Sample(double value)
    {
        if (!double.IsFinite(value) || value <= TransparentBelow)
        {
            return (0, 0, 0, 0);
        }

        if (value >= 1)
        {
            var top = Ramp[^1];
            return (top.R, top.G, top.B, 255);
        }

        for (var index = 1; index < Ramp.Length; index++)
        {
            var upper = Ramp[index];

            if (value > upper.Value) continue;

            var lower = Ramp[index - 1];
            var span = upper.Value - lower.Value;
            var t = span <= 0 ? 0 : (value - lower.Value) / span;

            return (
                Mix(lower.R, upper.R, t),
                Mix(lower.G, upper.G, t),
                Mix(lower.B, upper.B, t),
                (byte)Math.Clamp(Math.Round((lower.Alpha + (upper.Alpha - lower.Alpha) * t) * 255), 0, 255));
        }

        var last = Ramp[^1];
        return (last.R, last.G, last.B, 255);
    }

    private static byte Mix(byte from, byte to, double t) =>
        (byte)Math.Clamp(Math.Round(from + (to - from) * t), 0, 255);

    /// <summary>Yüzeyi doğrudan PNG'ye çevirir.</summary>
    public static byte[] RenderPng(LocationAnalysisHeatmapSurface surface) =>
        PngWriter.WriteRgba(Colorize(surface), surface.Width, surface.Height);
}
