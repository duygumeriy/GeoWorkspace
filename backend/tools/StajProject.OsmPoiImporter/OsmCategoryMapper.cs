using StajProject.Application.Pois;

namespace StajProject.OsmPoiImporter;

/// <summary>Bir nesnenin neden içe aktarılmadığı — istatistikteki kırılım.</summary>
public enum ImportSkipReason
{
    /// <summary>Hiçbir eşleme kuralı tutmadı.</summary>
    UnmappedTag,

    /// <summary>Birden çok İLGİSİZ kategori aynı özgüllükte eşleşti; tahmin edilmedi.</summary>
    AmbiguousMapping,

    /// <summary>Eşleşen kural alan geometrisi için uygun değil (ağ/nokta tesisi).</summary>
    UnsupportedAreaFeature,

    /// <summary>Geometri kurulamadı (kapanmayan halka, eksik düğüm başvurusu).</summary>
    IncompleteGeometry,

    /// <summary>Geometri geçersiz (kendisiyle kesişen halka) ya da temsilî nokta üretilemedi.</summary>
    InvalidGeometry,

    /// <summary>Koordinat EPSG:4326 aralığının dışında.</summary>
    InvalidCoordinate,

    /// <summary>Desteklenmeyen eleman/geometri türü (ör. çok parçalı olmayan ilişki).</summary>
    UnsupportedGeometry
}

/// <summary>Birden çok kategori eşleştiğinde kararı NE verdi.</summary>
public enum AmbiguityResolutionReason
{
    /// <summary>Aday, diğerinin TORUNU olduğu için kazandı (en özel kategori).</summary>
    DescendantBeatsAncestor,

    /// <summary>İlgisiz adaylar arasında kesin olarak daha ÖZGÜL kural kazandı.</summary>
    HigherSpecificityWins
}

/// <summary>
/// Çözülmüş bir belirsizliğin kaydı: kim kazandı, kime karşı, hangi kurala göre.
/// </summary>
/// <remarks>
/// <b>Kararı DEĞİŞTİRMEZ, yalnızca ANLATIR.</b> Eşleme semantiği bu tip
/// eklendiğinde de aynıdır; amaç, "belirsiz (çözülen): 874" satırının arkasında
/// hangi kategori çiftlerinin durduğunu görünür kılmaktır. Görünmeyen bir
/// otomatik karar, eşleme tablosundaki bir hatayı sessizce taşırdı.
/// </remarks>
/// <param name="LosingSlugs">Elenen adaylar; sıralı ve tekrarsızdır.</param>
public sealed record AmbiguityResolution(
    AmbiguityResolutionReason Reason,
    string WinningSlug,
    IReadOnlyList<string> LosingSlugs)
{
    /// <summary>Toplama anahtarı: <c>eczane &lt;- saglik-kurumlari</c>.</summary>
    public string Signature => $"{WinningSlug} <- {string.Join(", ", LosingSlugs)}";
}

/// <summary>Bir nesnenin eşleme sonucu: ya bir slug, ya bir atlama sebebi.</summary>
/// <param name="Slug">Kazanan kanonik slug; atlandıysa <c>null</c>.</param>
/// <param name="SkipReason">Atlama sebebi; eşleştiyse <c>null</c>.</param>
/// <param name="Resolution">
/// Birden çok kategori eşleşip karar verildiyse o kararın kaydı; tek aday
/// varsa <c>null</c>. Çözülmüş bile olsa bir belirsizlik, eşleme tablosunun
/// gözden geçirilmesi gerektiğinin işaretidir.
/// </param>
public sealed record CategoryMatch(
    string? Slug,
    ImportSkipReason? SkipReason,
    AmbiguityResolution? Resolution = null,
    IReadOnlyList<string>? TiedCandidates = null)
{
    public bool IsMatch => Slug is not null;

    /// <summary>Karar birden çok aday arasından mı verildi.</summary>
    public bool WasAmbiguous => Resolution is not null;

    /// <summary>
    /// Çözülemeyen belirsizlikte BERABERE kalan adaylar; sıralı ve tekrarsız.
    /// </summary>
    /// <remarks>
    /// Yalnızca örnek kimlik saklamak, "10 nesne atlandı" demekten biraz daha
    /// iyiydi: hangi KATEGORİ ÇİFTLERİNİN çarpıştığını söylemiyordu. Beraber
    /// kalan adayları taşımak, çakışma TÜRLERİNİ sayılabilir kılar ve hangi
    /// kuralın gözden geçirileceğini gösterir.
    /// </remarks>
    public string TiedSignature => string.Join(" <> ", TiedCandidates ?? []);

    public static CategoryMatch Matched(string slug, AmbiguityResolution? resolution = null) =>
        new(slug, null, resolution);

    public static CategoryMatch Skipped(ImportSkipReason reason) => new(null, reason);

    /// <summary>Eşit öncelikli, ilgisiz adaylar arasında karar verilemedi.</summary>
    public static CategoryMatch Ambiguous(IEnumerable<string> tiedCandidates) =>
        new(
            null,
            ImportSkipReason.AmbiguousMapping,
            null,
            [.. tiedCandidates.Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal)]);
}

/// <summary>
/// Bir OSM nesnesinin hangi kanonik kategoriye ait olduğuna karar verir.
/// </summary>
/// <remarks>
/// <para>
/// <b>Bir nesne → EN FAZLA BİR kategori.</b> Phase 2B'nin değişmezi budur: üst
/// kategori toplaması analiz sırasında alt ağaç genişletmesiyle yapılır,
/// içe aktarımda satır çoğaltarak DEĞİL. Bu sınıf hiçbir koşulda iki slug
/// döndürmez.
/// </para>
/// <para>
/// <b>Çözüm sırası:</b>
/// <list type="number">
/// <item>Hiç kural tutmadıysa → atla (<see cref="ImportSkipReason.UnmappedTag"/>).</item>
/// <item>Tek slug → o.</item>
/// <item>Adaylardan biri diğerinin TORUNU ise → torun kazanır (en özel kategori).</item>
/// <item>İlgisiz adaylarda özgüllüğü kesin olarak yüksek olan kazanır.</item>
/// <item>Özgüllük de eşitse → atla (<see cref="ImportSkipReason.AmbiguousMapping"/>); tahmin edilmez.</item>
/// </list>
/// </para>
/// <para>
/// Hiyerarşi kararı taksonominin KENDİSİNDEN okunur
/// (<see cref="PoiCategoryHierarchy"/>), eşleme tablosuna elle yazılmış bir
/// üst/alt bilgisinden değil: ikisi ayrışabilirdi.
/// </para>
/// </remarks>
public sealed class OsmCategoryMapper
{
    private readonly IReadOnlyList<OsmCategoryRule> _rules;
    private readonly IReadOnlyDictionary<string, int> _categoryIdBySlug;
    private readonly IReadOnlyDictionary<int, PoiCategoryHierarchy.Node> _nodes;

    public OsmCategoryMapper(
        IReadOnlyDictionary<string, int> categoryIdBySlug,
        IReadOnlyDictionary<int, PoiCategoryHierarchy.Node> nodes,
        IReadOnlyList<OsmCategoryRule>? rules = null)
    {
        _categoryIdBySlug = categoryIdBySlug;
        _nodes = nodes;
        _rules = rules ?? OsmCategoryMap.Rules;
    }

    /// <summary>Eşleme tablosunda geçen tüm slug'lar (tekrarsız).</summary>
    public IReadOnlyList<string> ConfiguredSlugs =>
        [.. _rules.Select(rule => rule.Slug).Distinct(StringComparer.Ordinal)];

    /// <summary>
    /// Eşleme tablosunun hedeflediği ama VERİTABANINDA bulunmayan slug'lar.
    /// </summary>
    /// <remarks>
    /// Bir yapılandırma hatasıdır ve içe aktarım BAŞLAMADAN önce raporlanır:
    /// eksik bir hedef, o kategoriye ait binlerce nesnenin sessizce atlanması
    /// demek olurdu.
    /// </remarks>
    public IReadOnlyList<string> MissingSlugs =>
        [.. ConfiguredSlugs.Where(slug => !_categoryIdBySlug.ContainsKey(slug)).Order(StringComparer.Ordinal)];

    public int CategoryIdOf(string slug) => _categoryIdBySlug[slug];

    /// <summary>Nesnenin kanonik kategorisini belirler.</summary>
    /// <param name="tags">Ham OSM etiketleri.</param>
    /// <param name="isArea">
    /// Nesne bir ALAN mı (kapalı yol / ilişki). Alan olan bir nesne yalnızca
    /// <see cref="OsmCategoryRule.AreaEligible"/> kurallarla eşleşebilir:
    /// bir ATM ya da şarj direği alan olarak çizilmez, bir hastane çizilir.
    /// </param>
    public CategoryMatch Resolve(IReadOnlyDictionary<string, string> tags, bool isArea)
    {
        var all = _rules.Where(rule => rule.Matches(tags)).ToArray();

        if (all.Length == 0)
        {
            return CategoryMatch.Skipped(ImportSkipReason.UnmappedTag);
        }

        var usable = isArea ? all.Where(rule => rule.AreaEligible).ToArray() : all;

        if (usable.Length == 0)
        {
            /* Etiket tanınıyor ama bu geometriyle anlamlı değil: kaydı bir
               noktaymış gibi zorlamak yerine sebebiyle atlanır. */
            return CategoryMatch.Skipped(ImportSkipReason.UnsupportedAreaFeature);
        }

        // Slug başına EN ÖZEL kuralın puanı.
        var candidates = usable
            .GroupBy(rule => rule.Slug, StringComparer.Ordinal)
            .Select(group => new { Slug = group.Key, Specificity = group.Max(rule => rule.Specificity) })
            .ToArray();

        if (candidates.Length == 1)
        {
            return CategoryMatch.Matched(candidates[0].Slug);
        }

        /* --- Hiyerarşi: torun atayı YENER -------------------------------------
           `amenity=pharmacy` + `healthcare=*` gibi bir çift, taksonomide
           eczane → saglik-kurumlari ilişkisiyle çözülür. Karar, eşleme
           tablosuna elle yazılmış bir sıralamadan değil taksonominin
           kendisinden gelir. */
        var candidateIds = candidates
            .Where(candidate => _categoryIdBySlug.ContainsKey(candidate.Slug))
            .ToDictionary(candidate => _categoryIdBySlug[candidate.Slug], candidate => candidate.Slug);

        /* Bir aday, BAŞKA bir adayın ATASI ise elenir — geriye en özel olan(lar)
           kalır. Yön önemlidir: eczane'nin atası saglik-kurumlari olduğu için
           elenmesi gereken KÖKtür, çocuk değil. */
        var deepest = candidateIds
            .Where(pair => !candidateIds.Keys.Any(other =>
                other != pair.Key
                && PoiCategoryHierarchy.SelectedAncestorOf(_nodes, other, Single(pair.Key)) is not null))
            .ToArray();

        if (deepest.Length == 1)
        {
            // Tek bir "en derin" aday kaldı: ya gerçekten tekti ya da diğerleri
            // onun ataları olduğu için elendi.
            var winner = deepest[0].Value;

            if (candidates.Length == 1)
            {
                return CategoryMatch.Matched(winner);
            }

            return CategoryMatch.Matched(
                winner,
                new AmbiguityResolution(
                    AmbiguityResolutionReason.DescendantBeatsAncestor,
                    winner,
                    Losers(candidates.Select(candidate => candidate.Slug), winner)));
        }

        /* --- İlgisiz adaylar: özgüllük ---------------------------------------
           Örnek: `amenity=fuel` + `shop=car_repair` ikisi de otomotiv-sektoru
           olduğu için buraya düşmez; gerçekten farklı iki kategori kaldıysa
           kesin olarak daha özgül olan kazanır. */
        var remaining = deepest.Length > 0
            ? candidates.Where(candidate => deepest.Any(pair => pair.Value == candidate.Slug)).ToArray()
            : candidates;

        var best = remaining.Max(candidate => candidate.Specificity);
        var winners = remaining.Where(candidate => candidate.Specificity == best).ToArray();

        if (winners.Length == 1)
        {
            return CategoryMatch.Matched(
                winners[0].Slug,
                new AmbiguityResolution(
                    AmbiguityResolutionReason.HigherSpecificityWins,
                    winners[0].Slug,
                    Losers(candidates.Select(candidate => candidate.Slug), winners[0].Slug)));
        }

        /* Eşit öncelikte iki ilgisiz kategori: TAHMİN EDİLMEZ. Yanlış bir
           kategori, yoğunluk haritasında sessizce yanlış bir sonuç üretirdi;
           atlanan nesne ise istatistikte görünür ve eşleme tablosu
           düzeltilebilir.

           Berabere kalan adaylar TAŞINIR: çakışma türünü saymak, hangi kural
           çiftinin gözden geçirileceğini söyler. */
        return CategoryMatch.Ambiguous(winners.Select(candidate => candidate.Slug));
    }

    private static IReadOnlySet<int> Single(int id) => new HashSet<int> { id };

    /// <summary>
    /// Kazanan dışındaki adaylar — sıralı ve tekrarsız.
    /// </summary>
    /// <remarks>
    /// Sıra SABİTLENİR: toplama anahtarı bu listeden üretildiği için, aynı
    /// çakışmanın iki farklı sırada gelmesi iki ayrı satır olarak sayılmamalıdır.
    /// </remarks>
    private static IReadOnlyList<string> Losers(IEnumerable<string> candidates, string winner) =>
    [
        .. candidates
            .Where(slug => !string.Equals(slug, winner, StringComparison.Ordinal))
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
    ];
}
