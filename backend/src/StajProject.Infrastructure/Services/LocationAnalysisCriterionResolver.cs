using Microsoft.EntityFrameworkCore;
using StajProject.Application.Analysis;
using StajProject.Application.Common;
using StajProject.Application.Pois;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Infrastructure.Services;

/// <summary>
/// Ölçüt slug'larını kanonik kategorilere çevirir, alt ağaçları genişletir ve
/// çakışan ölçütleri reddeder — <b>TEK</b> kategori sorgusuyla.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden ayrı bir sınıf.</b> Konum analizinin İKİ tüketicisi vardır: JSON
/// özeti (<see cref="LocationAnalysisService"/>) ve ağırlıklı ısı haritası
/// (<c>GeoServerLocationAnalysisImageService</c>). İkisi de "bu ölçütler hangi
/// kategori kimliklerini, hangi ağırlıkla kapsıyor" sorusunu sorar. Mantığın
/// ikinci bir kopyasını yazmak, özetin "382 POI" dediği bir alanda ısı
/// haritasının başka bir kümeyi çizmesine yol açardı — ve bu sessizce olurdu.
/// </para>
/// <para>
/// Taksonomi küçüktür (bugün 44 satır): tablo bir kez okunur, hiyerarşi
/// bellekte çözülür. Ölçüt başına ya da ağaç seviyesi başına sorgu AÇILMAZ.
/// </para>
/// <para>
/// Pasif/silinmiş kategoriler <see cref="PoiCategory"/>'nin global query
/// filter'ı sayesinde okunan kümeye hiç girmez: emekliye ayrılmış bir kategori
/// ÖLÇÜT olarak "bulunamadı" döner, TORUN olarak da alt ağaca katılmaz.
/// </para>
/// </remarks>
internal sealed class LocationAnalysisCriterionResolver
{
    private readonly AppDbContext _dbContext;

    internal LocationAnalysisCriterionResolver(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    internal async Task<ServiceResult<ResolvedLocationAnalysisCriteria>> ResolveAsync(
        IReadOnlyList<ValidatedLocationCriterion> criteria,
        CancellationToken cancellationToken)
    {
        var taxonomy = await _dbContext.PoiCategories
            .AsNoTracking()
            .Select(category => new CategoryRow(category.Id, category.Slug, category.Name, category.ParentId))
            .ToListAsync(cancellationToken);

        var bySlug = taxonomy.ToDictionary(row => row.Slug, StringComparer.Ordinal);

        var missing = criteria
            .Select(criterion => criterion.CategorySlug)
            .Where(slug => !bySlug.ContainsKey(slug))
            .ToArray();

        if (missing.Length > 0)
        {
            /* Eksik bir slug 400'dür, sessiz bir atlama DEĞİL: kullanıcı beş
               kategori seçtiyse dördünün sonucunu tam cevap gibi göstermek,
               ağırlıkların toplamını da anlamsız kılardı. Kategori de
               OLUŞTURULMAZ. */
            return ServiceResult<ResolvedLocationAnalysisCriteria>.Failure(
                $"Bilinmeyen veya kullanımda olmayan kategori: {string.Join(", ", missing)}.");
        }

        var nodes = taxonomy.ToDictionary(
            row => row.Id,
            row => new PoiCategoryHierarchy.Node(row.Id, row.Name, row.ParentId));

        var selected = criteria.ToDictionary(
            criterion => criterion.CategorySlug,
            criterion => bySlug[criterion.CategorySlug],
            StringComparer.Ordinal);

        var selectedIds = selected.Values.Select(row => row.Id).ToHashSet();

        /* --- Çakışma: ata + torun aynı anda seçilemez --------------------------
           Biri diğerinin kapsamındadır; ikisini birlikte ağırlıklandırmak aynı
           kaydı iki ölçüte birden saymak olurdu. Denetim DERİNLİKTEN
           bağımsızdır: torunun torunu da yakalanır. */
        foreach (var criterion in criteria)
        {
            var category = selected[criterion.CategorySlug];
            var ancestorId = PoiCategoryHierarchy.SelectedAncestorOf(nodes, category.Id, selectedIds);

            if (ancestorId is null)
            {
                continue;
            }

            var ancestor = taxonomy.First(row => row.Id == ancestorId.Value);

            return ServiceResult<ResolvedLocationAnalysisCriteria>.Failure(
                $"'{category.Slug}' zaten '{ancestor.Slug}' kapsamındadır; "
                + "üst kategori ile alt kategorisi aynı analizde birlikte seçilemez.");
        }

        /* --- Alt ağaç genişletmesi ---------------------------------------------
           Her kategori için "hangi seçili ölçüt beni kapsıyor" sorulur. Ata
           zinciri bir zincir olduğu ve EN YAKIN seçili ata döndüğü için sonuç
           tektir: bir kategori iki ölçüte birden ait OLAMAZ. */
        var criterionByCategoryId = new Dictionary<int, string>();
        var coverage = criteria.ToDictionary(
            criterion => criterion.CategorySlug,
            _ => 0,
            StringComparer.Ordinal);

        foreach (var row in taxonomy)
        {
            var ownerId = PoiCategoryHierarchy.SelectionCovering(nodes, row.Id, selectedIds);

            if (ownerId is null)
            {
                continue;
            }

            var ownerSlug = taxonomy.First(candidate => candidate.Id == ownerId.Value).Slug;

            criterionByCategoryId[row.Id] = ownerSlug;
            coverage[ownerSlug]++;
        }

        return ServiceResult<ResolvedLocationAnalysisCriteria>.Success(
            new ResolvedLocationAnalysisCriteria(
                criteria,
                selected,
                criterionByCategoryId,
                coverage,
                nodes,
                taxonomy.ToDictionary(row => row.Id, row => row.Slug)));
    }

    /// <summary>Hiyerarşi çözümü için gereken en küçük kategori projeksiyonu.</summary>
    internal sealed record CategoryRow(int Id, string Slug, string Name, int? ParentId);
}

/// <summary>
/// Çözülmüş ölçüt kapsamı: seçili kategoriler, kategori → ölçüt eşlemesi ve
/// ölçüt başına kapsanan kategori sayısı.
/// </summary>
/// <param name="CriterionByCategoryId">
/// SAKLANABİLİR her kategori kimliğinin sahibi olan ölçüt. Sorgu bu sözlüğün
/// anahtarlarını ister; sonuç da onunla toplanır.
/// </param>
/// <param name="Nodes">
/// Taksonominin TAMAMI, hiyerarşi düğümü olarak.
/// <para>
/// Kapsanan bir kategorinin tam yolunu (<c>Sağlık Kurumları / Eczane</c>)
/// kurabilmek için gerekir ve <b>ikinci bir sorgu açılmaması</b> için burada
/// taşınır: çözücü taksonomiyi zaten okumuştur. Yolu çağıranın kendi
/// başına birleştirmesi, kategori uçlarıyla farklı bir gösterim üretme riski
/// olurdu — <see cref="PoiCategoryHierarchy.BuildPath"/> tek kaynaktır.
/// </para>
/// </param>
internal sealed record ResolvedLocationAnalysisCriteria(
    IReadOnlyList<ValidatedLocationCriterion> Criteria,
    IReadOnlyDictionary<string, LocationAnalysisCriterionResolver.CategoryRow> Selected,
    IReadOnlyDictionary<int, string> CriterionByCategoryId,
    IReadOnlyDictionary<string, int> Coverage,
    IReadOnlyDictionary<int, PoiCategoryHierarchy.Node> Nodes,
    IReadOnlyDictionary<int, string> SlugsById)
{
    /// <summary>Kapsanan bir kategorinin kökten itibaren tam yolu.</summary>
    public string PathOf(int categoryId) => PoiCategoryHierarchy.BuildPath(Nodes, categoryId);

    /// <summary>Kapsanan bir kategorinin yalın adı.</summary>
    public string NameOf(int categoryId) =>
        Nodes.TryGetValue(categoryId, out var node) ? node.Name : string.Empty;

    /// <summary>
    /// Kapsanan bir kategorinin KENDİ slug'ı.
    /// </summary>
    /// <remarks>
    /// <b><see cref="CriterionOf"/> ile karıştırılmamalıdır.</b> O, kaydı
    /// hangi ÖLÇÜTÜN kapsadığını söyler ("Sağlık Kurumları"); bu ise kaydın
    /// kendi kategorisidir ("eczane"). Tıklanan noktanın kartında gösterilmesi
    /// gereken, kaydın kendi kategorisidir.
    /// </remarks>
    public string SlugOf(int categoryId) => SlugsById.GetValueOrDefault(categoryId, string.Empty);

    /// <summary>Sorgunun süzeceği kimlikler: tüm seçili alt ağaçların birleşimi.</summary>
    public IReadOnlyCollection<int> MatchedCategoryIds => (IReadOnlyCollection<int>)CriterionByCategoryId.Keys;

    public string? CriterionOf(int categoryId) => CriterionByCategoryId.GetValueOrDefault(categoryId);

    public int CoverageOf(string slug) => Coverage.GetValueOrDefault(slug);

    /* --- Ağırlık yuvaları KALDIRILDI ------------------------------------------

       Ağırlıklar artık GeoServer'a `env` yuvalarıyla taşınmıyor; ağırlıklı
       yüzey sunucuda hesaplanıyor (LocationAnalysisHeatmapRenderer) ve orada
       ağırlık, ölçütün İSTEKTEKİ SIRASINA bağlı bir dizi elemanıdır.

       Buradaki iki üretim de bilinçli olarak silindi:

       - `WeightSlots()` ham `ağırlık/100` çiftleri üretiyordu; vec:Heatmap
         onları kayıt başına toplayınca bir ölçütün etkisi `sayı × ağırlık`
         oluyor ve kullanıcının verdiği yüzde, kategori sayıları büyüklük
         mertebesinde ayrıştığında (Alışveriş 345, Demiryolu 52) etkisiz
         kalıyordu.
       - `WeightSlots(countsByCriterion)` bunu `ağırlık/sayı` ile düzeltmeye
         çalışıyordu; ama bu, yoğunluk yüzeyini TOPLAM KÜTLESİNE göre
         normalleştirmektir, yerel yoğunluk ARALIĞINA göre değil. İkisi denk
         değildir: kütle normalizasyonu kümelenmiş kategorileri yükseltir ve
         dağılmış olanları N katına varan bir oranda bastırır.

       Doğru denklem ve ölçülen fark LocationAnalysisHeatmapRenderer
       belgesindedir. */
}
