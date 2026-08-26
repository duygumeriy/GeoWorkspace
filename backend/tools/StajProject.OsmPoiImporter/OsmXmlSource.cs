using System.Globalization;
using System.Xml;
using NetTopologySuite.Geometries;

namespace StajProject.OsmPoiImporter;

/// <summary>
/// Yerel bir <b>OSM XML</b> (<c>.osm</c>) dosyasını akış hâlinde okuyup
/// normalleştirilmiş özelliklere çeviren kaynak bağdaştırıcısı.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden OSM XML, neden PBF değil.</b> PBF nihai hedeftir ama bu fazda
/// GÜVENLE doğrulanamaz: gerçek bir çıkarımı indirmek yasaktır ve elle geçerli
/// bir PBF üretmek (protobuf + zlib blob çerçeveleme) testlerle
/// desteklenemeyecek bir varsayım yığını demek olurdu. OSM XML ise OSM'in
/// KENDİ değişim biçimidir — JOSM ve Overpass bunu üretir, <c>osmium</c> tek
/// komutla PBF'ten dönüştürür — ve BCL'deki <see cref="XmlReader"/> ile hiçbir
/// bağımlılık eklemeden akış hâlinde okunur. Eksik olan tek şey PBF
/// bağdaştırıcısıdır; çekirdek onu takmaya hazırdır.
/// </para>
/// <para>
/// <b>Akış korunur.</b> Dosya baştan sona <see cref="XmlReader"/> ile okunur;
/// belge belleğe yüklenmez. Bellekte tutulan tek şey, ADAY yolların başvurduğu
/// düğümlerin koordinatlarıdır — tüm düğümler değil.
/// </para>
/// <para>
/// <b>İki geçiş.</b> Birinci geçiş aday yolların/ilişkilerin gerektirdiği düğüm
/// ve yol kimliklerini toplar; ikinci geçiş yalnızca o kimliklerin
/// koordinatlarını okur ve özellikleri üretir. Tek geçişte çözmek, dosyadaki
/// TÜM düğümleri bellekte tutmayı gerektirirdi.
/// </para>
/// </remarks>
public sealed class OsmXmlSource
{
    private const string TypeKey = "type";
    private const string MultipolygonValue = "multipolygon";

    private static readonly GeometryFactory Factory = new(new PrecisionModel(), 4326);

    private readonly string _path;

    public OsmXmlSource(string path)
    {
        _path = path;
    }

    /// <summary>
    /// Dosyadaki içe aktarılabilir özellikleri sırayla üretir.
    /// </summary>
    /// <param name="isCandidate">
    /// Etiketlere bakarak nesnenin ADAY olup olmadığını söyler. Aday olmayanlar
    /// için geometri hiç kurulmaz — eşlenmeyecek bir nesnenin düğümlerini
    /// toplamak, belleği boşuna büyütürdü.
    /// </param>
    /// <param name="onSkipped">Geometri kurulamayan aday nesnenin sebebi.</param>
    /// <param name="onTaggedElement">
    /// Görülen her ETİKETLİ eleman için çağrılır. Etiketsiz düğümler (yolların
    /// köşe noktaları) sayılmaz: bir çıkarımda milyonlarca tanedirler ve
    /// "eleman" olarak raporlanmaları sayıyı anlamsız kılardı. Bu sayaç,
    /// üretilen özellik ile atlanan arasındaki farkı açıklayan ÜST KÜMEDİR.
    /// </param>
    public IEnumerable<OsmSourceFeature> Read(
        Func<IReadOnlyDictionary<string, string>, bool> isCandidate,
        Action<OsmElementType, long, ImportSkipReason> onSkipped,
        Action<OsmElementType, long>? onTaggedElement = null)
    {
        var plan = ScanCandidates(isCandidate);
        var coordinates = ReadNodeCoordinates(plan.NeededNodeIds);
        var wayRings = new Dictionary<long, LinearRing>();

        foreach (var feature in ReadFeatures(plan, coordinates, wayRings, isCandidate, onSkipped, onTaggedElement))
        {
            yield return feature;
        }
    }

    /* --- Birinci geçiş: hangi düğümler gerekli ---------------------------------- */

    private ScanResult ScanCandidates(Func<IReadOnlyDictionary<string, string>, bool> isCandidate)
    {
        var neededNodeIds = new HashSet<long>();
        var neededWayIds = new HashSet<long>();
        var relationMemberWays = new Dictionary<long, List<long>>();

        using var reader = CreateReader();

        while (reader.Read())
        {
            if (reader.NodeType != XmlNodeType.Element)
            {
                continue;
            }

            switch (reader.Name)
            {
                case "way":
                {
                    var element = ReadWay(reader);

                    if (isCandidate(element.Tags))
                    {
                        foreach (var nodeId in element.NodeIds)
                        {
                            neededNodeIds.Add(nodeId);
                        }
                    }

                    break;
                }

                case "relation":
                {
                    var element = ReadRelation(reader);

                    if (isCandidate(element.Tags))
                    {
                        relationMemberWays[element.Id] = element.OuterWayIds;

                        foreach (var wayId in element.OuterWayIds)
                        {
                            neededWayIds.Add(wayId);
                        }
                    }

                    break;
                }
            }
        }

        /* İlişki üyesi yollar da düğüm gerektirir; ikinci bir tarama yerine
           üye yolların düğümleri üçüncü geçişte değil, aşağıdaki ikinci
           taramada toplanır. */
        if (neededWayIds.Count > 0)
        {
            using var memberReader = CreateReader();

            while (memberReader.Read())
            {
                if (memberReader.NodeType != XmlNodeType.Element || memberReader.Name != "way")
                {
                    continue;
                }

                var element = ReadWay(memberReader);

                if (!neededWayIds.Contains(element.Id))
                {
                    continue;
                }

                foreach (var nodeId in element.NodeIds)
                {
                    neededNodeIds.Add(nodeId);
                }
            }
        }

        return new ScanResult(neededNodeIds, neededWayIds, relationMemberWays);
    }

    /* --- İkinci geçiş: yalnızca gereken düğümlerin koordinatları ---------------- */

    private Dictionary<long, Coordinate> ReadNodeCoordinates(IReadOnlySet<long> neededNodeIds)
    {
        var coordinates = new Dictionary<long, Coordinate>(neededNodeIds.Count);

        if (neededNodeIds.Count == 0)
        {
            return coordinates;
        }

        using var reader = CreateReader();

        while (reader.Read())
        {
            if (reader.NodeType != XmlNodeType.Element || reader.Name != "node")
            {
                continue;
            }

            var id = ReadLong(reader, "id");

            if (id is null || !neededNodeIds.Contains(id.Value))
            {
                continue;
            }

            var coordinate = ReadCoordinate(reader);

            if (coordinate is not null)
            {
                coordinates[id.Value] = coordinate;
            }
        }

        return coordinates;
    }

    /* --- Üçüncü geçiş: özellikleri üret ----------------------------------------- */

    private IEnumerable<OsmSourceFeature> ReadFeatures(
        ScanResult plan,
        IReadOnlyDictionary<long, Coordinate> coordinates,
        Dictionary<long, LinearRing> wayRings,
        Func<IReadOnlyDictionary<string, string>, bool> isCandidate,
        Action<OsmElementType, long, ImportSkipReason> onSkipped,
        Action<OsmElementType, long>? onTaggedElement)
    {
        var pendingRelations = new List<RelationElement>();

        using var reader = CreateReader();

        while (reader.Read())
        {
            if (reader.NodeType != XmlNodeType.Element)
            {
                continue;
            }

            switch (reader.Name)
            {
                case "node":
                {
                    var id = ReadLong(reader, "id");
                    var coordinate = ReadCoordinate(reader);
                    var tags = ReadTags(reader, "node");

                    if (id is null)
                    {
                        break;
                    }

                    if (tags.Count > 0)
                    {
                        onTaggedElement?.Invoke(OsmElementType.Node, id.Value);
                    }

                    if (!isCandidate(tags))
                    {
                        ReportUnmapped(OsmElementType.Node, id.Value, tags, onSkipped);
                        break;
                    }

                    if (coordinate is null)
                    {
                        onSkipped(OsmElementType.Node, id.Value, ImportSkipReason.InvalidCoordinate);
                        break;
                    }

                    yield return new OsmSourceFeature(
                        OsmElementType.Node,
                        id.Value,
                        tags,
                        Factory.CreatePoint(coordinate));

                    break;
                }

                case "way":
                {
                    var element = ReadWay(reader);

                    // İlişki üyesi olabilecek her yolun halkası saklanır.
                    if (plan.NeededWayIds.Contains(element.Id))
                    {
                        var memberRing = BuildRing(element.NodeIds, coordinates);

                        if (memberRing is not null)
                        {
                            wayRings[element.Id] = memberRing;
                        }
                    }

                    if (element.Tags.Count > 0)
                    {
                        onTaggedElement?.Invoke(OsmElementType.Way, element.Id);
                    }

                    if (!isCandidate(element.Tags))
                    {
                        ReportUnmapped(OsmElementType.Way, element.Id, element.Tags, onSkipped);
                        break;
                    }


                    var ring = BuildRing(element.NodeIds, coordinates);

                    if (ring is null)
                    {
                        /* Kapalı olmayan bir yol bir ALAN değildir (cadde,
                           akarsu, sınır çizgisi) ve bir tesis noktasına
                           indirgenmesi anlamsız olurdu. Eksik düğüm başvurusu
                           da aynı sebeple buraya düşer — kısmi çıkarımlarda
                           sıradandır. */
                        onSkipped(OsmElementType.Way, element.Id, ImportSkipReason.IncompleteGeometry);
                        break;
                    }

                    yield return new OsmSourceFeature(
                        OsmElementType.Way,
                        element.Id,
                        element.Tags,
                        Factory.CreatePolygon(ring));

                    break;
                }

                case "relation":
                {
                    var element = ReadRelation(reader);

                    if (element.Tags.Count > 0)
                    {
                        onTaggedElement?.Invoke(OsmElementType.Relation, element.Id);
                    }

                    if (isCandidate(element.Tags))
                    {
                        // Üye yollar dosyada ilişkiden SONRA da gelebilir;
                        // ilişkiler sona bırakılır.
                        pendingRelations.Add(element);
                    }
                    else
                    {
                        ReportUnmapped(OsmElementType.Relation, element.Id, element.Tags, onSkipped);
                    }

                    break;
                }
            }
        }

        foreach (var relation in pendingRelations)
        {
            var geometry = BuildRelationGeometry(relation, wayRings, out var reason);

            if (geometry is null)
            {
                onSkipped(OsmElementType.Relation, relation.Id, reason);
                continue;
            }

            yield return new OsmSourceFeature(
                OsmElementType.Relation,
                relation.Id,
                relation.Tags,
                geometry);
        }
    }

    /// <summary>
    /// Hiçbir kurala uymayan bir nesneyi istatistiğe bildirir.
    /// </summary>
    /// <remarks>
    /// <b>ETİKETSİZ nesneler sayılmaz.</b> Gerçek bir çıkarımdaki düğümlerin
    /// ezici çoğunluğu yolların köşe noktalarıdır; onları "eşlenemedi" diye
    /// saymak, milyonluk ve tamamen yanıltıcı bir sayı üretirdi. Sayılan şey,
    /// etiketi OLAN ama eşleme tablosunda karşılığı BULUNMAYAN nesnelerdir —
    /// tabloyu genişletmek için bakılacak sayı budur.
    /// </remarks>
    private static void ReportUnmapped(
        OsmElementType type,
        long id,
        IReadOnlyDictionary<string, string> tags,
        Action<OsmElementType, long, ImportSkipReason> onSkipped)
    {
        if (tags.Count > 0)
        {
            onSkipped(type, id, ImportSkipReason.UnmappedTag);
        }
    }

    /* --- Geometri kurulumu ------------------------------------------------------- */

    /// <summary>
    /// Kapalı bir yoldan halka kurar. Kapalı değilse ya da düğümler eksikse
    /// <c>null</c>.
    /// </summary>
    /// <remarks>
    /// <b>Kapanmayan halka ZORLANMAZ.</b> İlk noktayı sona eklemek, kaynakta
    /// olmayan bir kenar uydurmak olurdu; açık bir yol zaten bir alan değildir.
    /// </remarks>
    private static LinearRing? BuildRing(
        IReadOnlyList<long> nodeIds,
        IReadOnlyDictionary<long, Coordinate> coordinates)
    {
        if (nodeIds.Count < 4 || nodeIds[0] != nodeIds[^1])
        {
            return null;
        }

        var ring = new Coordinate[nodeIds.Count];

        for (var index = 0; index < nodeIds.Count; index++)
        {
            if (!coordinates.TryGetValue(nodeIds[index], out var coordinate))
            {
                // Kısmi çıkarımda düğüm dosyada olmayabilir.
                return null;
            }

            ring[index] = coordinate;
        }

        try
        {
            return Factory.CreateLinearRing(ring);
        }
        catch (ArgumentException)
        {
            return null;
        }
    }

    /// <summary>
    /// <c>type=multipolygon</c> ilişkisinden alan kurar — <b>yalnızca dış
    /// üyelerin her biri KENDİ BAŞINA kapalı bir yol olduğunda</b>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Halka birleştirme UYGULANMAZ ve uydurulmaz.</b> OSM'de bir dış halka
    /// birden çok AÇIK yola bölünmüş olabilir ve bunları doğru sırayla/yönle
    /// dikmek başlı başına bir algoritmadır; burada yaklaşık bir sonuç
    /// üretmek, sessizce yanlış bir alan (ve yanlış bir temsilî nokta) demek
    /// olurdu. O durum <see cref="ImportSkipReason.IncompleteGeometry"/> ile
    /// atlanır ve istatistikte görünür.
    /// </para>
    /// <para>
    /// İç halkalar (delikler) bu fazda okunmaz: temsilî nokta üretimi için dış
    /// sınır yeterlidir ve bir deliği yok saymak noktayı yalnızca poligonun
    /// içinde tutar, dışına taşımaz.
    /// </para>
    /// </remarks>
    private static Geometry? BuildRelationGeometry(
        RelationElement relation,
        IReadOnlyDictionary<long, LinearRing> wayRings,
        out ImportSkipReason reason)
    {
        if (!relation.Tags.TryGetValue(TypeKey, out var type)
            || !string.Equals(type, MultipolygonValue, StringComparison.Ordinal))
        {
            /* Çok parçalı olmayan ilişkiler (route, site, associatedStreet) bir
               ALAN değildir ve bu fazda desteklenmez. */
            reason = ImportSkipReason.UnsupportedGeometry;
            return null;
        }

        var polygons = new List<Polygon>();

        foreach (var wayId in relation.OuterWayIds)
        {
            if (wayRings.TryGetValue(wayId, out var ring))
            {
                polygons.Add(Factory.CreatePolygon(ring));
            }
        }

        if (polygons.Count == 0)
        {
            reason = ImportSkipReason.IncompleteGeometry;
            return null;
        }

        reason = ImportSkipReason.IncompleteGeometry;

        return polygons.Count == 1
            ? polygons[0]
            : Factory.CreateMultiPolygon([.. polygons]);
    }

    /* --- XML okuma yardımcıları --------------------------------------------------- */

    private XmlReader CreateReader() =>
        XmlReader.Create(_path, new XmlReaderSettings
        {
            IgnoreComments = true,
            IgnoreWhitespace = true,
            /* Dış varlık çözümü KAPALI: içe aktarıcı yerel bir dosyayı okur ve
               o dosyanın ağ ya da başka bir yerel dosya açmasına izin
               verilmez (XXE). */
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null
        });

    private static WayElement ReadWay(XmlReader reader)
    {
        var id = ReadLong(reader, "id") ?? 0;
        var nodeIds = new List<long>();
        var tags = new Dictionary<string, string>(StringComparer.Ordinal);

        if (reader.IsEmptyElement)
        {
            return new WayElement(id, nodeIds, tags);
        }

        using var subtree = reader.ReadSubtree();
        subtree.Read();

        while (subtree.Read())
        {
            if (subtree.NodeType != XmlNodeType.Element)
            {
                continue;
            }

            if (subtree.Name == "nd" && ReadLong(subtree, "ref") is { } nodeRef)
            {
                nodeIds.Add(nodeRef);
            }
            else if (subtree.Name == "tag")
            {
                AddTag(subtree, tags);
            }
        }

        return new WayElement(id, nodeIds, tags);
    }

    private static RelationElement ReadRelation(XmlReader reader)
    {
        var id = ReadLong(reader, "id") ?? 0;
        var outerWayIds = new List<long>();
        var tags = new Dictionary<string, string>(StringComparer.Ordinal);

        if (reader.IsEmptyElement)
        {
            return new RelationElement(id, outerWayIds, tags);
        }

        using var subtree = reader.ReadSubtree();
        subtree.Read();

        while (subtree.Read())
        {
            if (subtree.NodeType != XmlNodeType.Element)
            {
                continue;
            }

            if (subtree.Name == "member")
            {
                var memberType = subtree.GetAttribute("type");
                var role = subtree.GetAttribute("role");

                // Yalnızca DIŞ halka üyeleri; iç halkalar okunmaz (bkz. yukarıda).
                if (memberType == "way"
                    && (string.IsNullOrEmpty(role) || role == "outer")
                    && ReadLong(subtree, "ref") is { } wayRef)
                {
                    outerWayIds.Add(wayRef);
                }
            }
            else if (subtree.Name == "tag")
            {
                AddTag(subtree, tags);
            }
        }

        return new RelationElement(id, outerWayIds, tags);
    }

    private static IReadOnlyDictionary<string, string> ReadTags(XmlReader reader, string elementName)
    {
        var tags = new Dictionary<string, string>(StringComparer.Ordinal);

        if (reader.IsEmptyElement)
        {
            return tags;
        }

        using var subtree = reader.ReadSubtree();
        subtree.Read();

        while (subtree.Read())
        {
            if (subtree.NodeType == XmlNodeType.Element && subtree.Name == "tag")
            {
                AddTag(subtree, tags);
            }
        }

        _ = elementName;

        return tags;
    }

    private static void AddTag(XmlReader reader, Dictionary<string, string> tags)
    {
        var key = reader.GetAttribute("k");
        var value = reader.GetAttribute("v");

        if (!string.IsNullOrEmpty(key) && value is not null)
        {
            tags[key] = value;
        }
    }

    private static long? ReadLong(XmlReader reader, string attribute) =>
        long.TryParse(reader.GetAttribute(attribute), NumberStyles.Integer, CultureInfo.InvariantCulture, out var value)
            ? value
            : null;

    /// <summary>
    /// Düğümün koordinatı. <b>lon = X, lat = Y</b> — sıra karıştırılmaz.
    /// </summary>
    /// <remarks>
    /// Aralık denetimi burada yapılır: EPSG:4326 dışındaki bir değer geometriye
    /// hiç girmez ve nesne <see cref="ImportSkipReason.InvalidCoordinate"/> ile
    /// atlanır.
    /// </remarks>
    private static Coordinate? ReadCoordinate(XmlReader reader)
    {
        var latText = reader.GetAttribute("lat");
        var lonText = reader.GetAttribute("lon");

        if (!double.TryParse(latText, NumberStyles.Float, CultureInfo.InvariantCulture, out var latitude)
            || !double.TryParse(lonText, NumberStyles.Float, CultureInfo.InvariantCulture, out var longitude))
        {
            return null;
        }

        if (double.IsNaN(latitude) || double.IsNaN(longitude)
            || latitude is < -90 or > 90
            || longitude is < -180 or > 180)
        {
            return null;
        }

        return new Coordinate(longitude, latitude);
    }

    private sealed record WayElement(long Id, List<long> NodeIds, IReadOnlyDictionary<string, string> Tags);

    private sealed record RelationElement(long Id, List<long> OuterWayIds, IReadOnlyDictionary<string, string> Tags);

    private sealed record ScanResult(
        IReadOnlySet<long> NeededNodeIds,
        IReadOnlySet<long> NeededWayIds,
        IReadOnlyDictionary<long, List<long>> RelationOuterWays);
}
