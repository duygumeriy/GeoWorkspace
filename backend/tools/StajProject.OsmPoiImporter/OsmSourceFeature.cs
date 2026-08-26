using NetTopologySuite.Geometries;

namespace StajProject.OsmPoiImporter;

/// <summary>OSM eleman türü; dış kimliğin ön eki de budur.</summary>
public enum OsmElementType
{
    Node,
    Way,
    Relation
}

/// <summary>
/// Kaynak biçiminden ARINDIRILMIŞ tek bir dış özellik.
/// </summary>
/// <remarks>
/// <para>
/// <b>Ayrımın sebebi.</b> Eşleme kuralları OSM'in dosya biçimini bilmemelidir:
/// bilseydi, kategori eşlemesini sınamak için her testin bir OSM dosyası
/// ayrıştırması gerekirdi. Kaynak bağdaştırıcısı (XML, ileride PBF) bu tipi
/// üretir; eşleyici ve içe aktarıcı yalnızca bu tipi görür.
/// </para>
/// <para>
/// <b>Etiketler VERİTABANINA GİTMEZ.</b> <see cref="Tags"/> yalnızca içe
/// aktarma kararı içindir; <c>analysis_poi</c> tablosunda ham etiket kolonu
/// yoktur ve bu fazda eklenmez.
/// </para>
/// </remarks>
/// <param name="ElementType">Düğüm, yol ya da ilişki.</param>
/// <param name="ElementId">OSM'deki kimlik.</param>
/// <param name="Tags">Ham etiketler; karar verirken okunur, saklanmaz.</param>
/// <param name="Geometry">
/// Kaynağın geometrisi: düğüm için <see cref="Point"/>, alan için
/// <see cref="Polygon"/>. Temsilî noktaya indirgeme içe aktarıcının işidir.
/// </param>
public sealed record OsmSourceFeature(
    OsmElementType ElementType,
    long ElementId,
    IReadOnlyDictionary<string, string> Tags,
    Geometry Geometry)
{
    /// <summary>
    /// <c>node/123456</c> — <c>analysis_poi.external_id</c> değeri.
    /// </summary>
    /// <remarks>
    /// Tür ön eki ZORUNLUDUR: OSM'de düğüm, yol ve ilişki kimlik uzayları
    /// ayrıdır ve <c>123</c> numaralı bir düğüm ile <c>123</c> numaralı bir yol
    /// aynı anda var olabilir. Ön ek olmasaydı tekillik kısıtı iki farklı
    /// nesneyi aynı sanardı.
    /// </remarks>
    public string ExternalId => $"{Prefix(ElementType)}/{ElementId.ToString(System.Globalization.CultureInfo.InvariantCulture)}";

    /// <summary>
    /// OSM <c>name</c> etiketi; yoksa <c>null</c>.
    /// </summary>
    /// <remarks>
    /// <b>Ad UYDURULMAZ.</b> "İsimsiz Eczane #123" gibi bir değer, kaynakta
    /// olmayan bir bilgiyi varmış gibi gösterirdi; şema bu yüzden null kabul
    /// eder (bkz. <c>AnalysisPoi.Name</c>). Boş/boşluk-only bir ad da yok
    /// sayılır.
    /// </remarks>
    public string? Name =>
        Tags.TryGetValue("name", out var name) && !string.IsNullOrWhiteSpace(name)
            ? name.Trim()
            : null;

    private static string Prefix(OsmElementType type) => type switch
    {
        OsmElementType.Node => "node",
        OsmElementType.Way => "way",
        _ => "relation"
    };
}
