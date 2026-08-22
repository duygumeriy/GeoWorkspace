namespace StajProject.Application.Pois;

/// <summary>
/// Kategori hiyerarşisinin saf (veritabanısız) mantığı: yol üretimi, derinlik
/// ve döngü tespiti.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden ayrı ve saf bir sınıf.</b> Aynı kurallar üç yerde gerekir — harita
/// kategori listesi, yönetim listesi ve kategori yazma yolu. EF sorgusunun
/// içine gömülselerdi her biri kendi kopyasını taşır ve döngü koruması yalnızca
/// bazı yollarda bulunurdu.
/// </para>
/// <para>
/// <b>Her traversal SINIRLIDIR.</b> Veritabanı, geçişli bir döngüyü tek satıra
/// bakan bir kısıtla engelleyemez; elle atılmış bir UPDATE (ya da bu servisten
/// önce yazılmış eski veri) A → B → A zinciri bırakabilir. Buradaki her döngü
/// hem ziyaret edilen kimlikleri izler hem de <see cref="MaxDepth"/> ile
/// sınırlıdır, dolayısıyla bozuk veri sonsuz döngüye DEĞİL, kesilmiş bir yola
/// yol açar.
/// </para>
/// </remarks>
public static class PoiCategoryHierarchy
{
    /// <summary>
    /// Azami hiyerarşi derinliği. Gerçek bir taksonomi için fazlasıyla geniş,
    /// bozuk veride ise kesin bir durak noktasıdır.
    /// </summary>
    public const int MaxDepth = 32;

    /// <summary>Yol ayıracı.</summary>
    public const string Separator = " / ";

    /// <param name="Id">Kategori kimliği.</param>
    /// <param name="Name">Kategori adı.</param>
    /// <param name="ParentId">Üst kategori; kökte <c>null</c>.</param>
    public sealed record Node(int Id, string Name, int? ParentId);

    /// <summary>
    /// Kökten itibaren tam yol (<c>Yeme-İçme / Restoran</c>).
    /// </summary>
    /// <remarks>
    /// Üst kategori haritada bulunamazsa (ör. yönetim listesinde görünmeyen
    /// pasif bir üst) yürüyüş orada durur ve bilinen kısım döner: eksik bir yol,
    /// hiç yol olmamasından iyidir.
    /// </remarks>
    public static string BuildPath(IReadOnlyDictionary<int, Node> nodes, int id)
    {
        var segments = Ancestry(nodes, id).Select(node => node.Name).Reverse();

        return string.Join(Separator, segments);
    }

    /// <summary>Kök = 0. Yol kesilirse bilinen derinlik döner.</summary>
    public static int DepthOf(IReadOnlyDictionary<int, Node> nodes, int id) =>
        Math.Max(0, Ancestry(nodes, id).Count() - 1);

    /// <summary>
    /// <paramref name="proposedParentId"/> üst kategori olarak atanırsa bir
    /// döngü oluşur mu.
    /// </summary>
    /// <remarks>
    /// Kural iki durumu birden kapsar: kategorinin kendisinin üstü olması ve
    /// kendi alt ağacındaki bir düğümün üstü olması. İkisi de aynı soruya
    /// indirgenir — "aday üstün ata zincirinde bu kategori var mı".
    /// </remarks>
    public static bool WouldCreateCycle(
        IReadOnlyDictionary<int, Node> nodes,
        int categoryId,
        int? proposedParentId)
    {
        if (proposedParentId is null)
        {
            // Kök yapmak hiçbir zaman döngü üretmez.
            return false;
        }

        if (proposedParentId.Value == categoryId)
        {
            return true;
        }

        return Ancestry(nodes, proposedParentId.Value).Any(node => node.Id == categoryId);
    }

    /// <summary>
    /// Sıralama anahtarı: önce hiyerarşi yolu, sonra ad. Aynı üst altındaki
    /// kardeşler alfabetik gelir ve her alt ağaç kendi üstünün hemen ardında
    /// durur.
    /// </summary>
    public static (string Path, string Name) SortKey(IReadOnlyDictionary<int, Node> nodes, int id) =>
        (BuildPath(nodes, id), nodes.TryGetValue(id, out var node) ? node.Name : string.Empty);

    /// <summary>
    /// Düğümün kendisinden köke doğru ata zinciri. Ziyaret edilen kimlikler
    /// izlenir ve derinlik sınırlanır; bozuk veride zincir kesilir.
    /// </summary>
    private static IEnumerable<Node> Ancestry(IReadOnlyDictionary<int, Node> nodes, int id)
    {
        var visited = new HashSet<int>();
        var currentId = (int?)id;

        for (var depth = 0; depth < MaxDepth && currentId is not null; depth++)
        {
            if (!visited.Add(currentId.Value) || !nodes.TryGetValue(currentId.Value, out var node))
            {
                // Döngü ya da eksik üst: yürüyüş burada durur.
                yield break;
            }

            yield return node;
            currentId = node.ParentId;
        }
    }
}
