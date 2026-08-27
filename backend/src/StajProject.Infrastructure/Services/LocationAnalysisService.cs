using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;
using StajProject.Application.Analysis;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Pois;
using StajProject.Application.Spatial;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Infrastructure.Services;

/// <summary>
/// Konum analizini PostGIS üzerinde çalıştırır.
/// </summary>
/// <remarks>
/// <para>
/// <b>Veri kümesi: açık veri + uygulama envanteri, TEK bir view üzerinden.</b>
/// Analizin bütün yolları <c>analysis_poi_union</c>'dan okur
/// (<see cref="AnalysisPoiFeature"/>): dış kaynaklı <c>analysis_poi</c>
/// satırları ile aktif ve silinmemiş <c>poi</c> satırlarının birleşimi.
/// Kullanıcının uygulamada oluşturduğu bir POI, aktifse ve seçilen alan +
/// kategori kapsamına giriyorsa bir sonraki analizde ANINDA sayılır, listelenir
/// ve rasterde ısı üretir; birleşimi her yolda ayrı kurmak, bunun yalnızca
/// bazılarında olması demekti.
/// <para>
/// Sahiplik yüklemi YOKTUR ve uydurulmaz: POI ortak bir envanterdir
/// (<c>GET /api/poi</c> ve <c>poi_read</c> WMS'i onu <c>poi.view</c> taşıyan
/// herkese gösterir), <c>analysis_poi</c> ise sahipsizdir. Erişimi kapatan
/// şeyler uçtaki yetki denetimi ve coğrafi alan koruyucusudur.
/// </para>
/// </para>
/// <para>
/// <b>Ölçüt bir ALT AĞACI temsil eder.</b> Taksonomi hiyerarşiktir ve bir POI
/// her zaman EN ÖZEL kategorisine yazılır; bu yüzden bir üst kategori seçmek,
/// o kategoriye doğrudan bağlı kayıtları VE tüm aktif torunlarını kapsar.
/// Aksi hâlde "Sağlık Kurumları" seçen bir kullanıcı, eczaneler
/// <c>eczane</c> altında saklandığı için hiçbir eczaneyi göremezdi.
/// Genişletme ANALİZ sırasında yapılır — içe aktarıcı asla aynı dış nesne için
/// hem alt hem üst kategoriye satır yazmaz.
/// </para>
/// <para>
/// <b>Coğrafi yetki alanı BURADA okunur</b> (<see cref="ILocationAnalysisAreaGuard"/>)
/// ve bu, konum analizine ÖZGÜ bir kuraldır: kullanıcının coğrafi yetki alanı
/// varsa analiz yalnızca o geometrinin içinde çalışabilir. Kural analizin
/// BÜTÜN uçlarında aynıdır — özet, ağırlıklı raster, nokta listesi, isabet
/// testi ve örtü rasteri — ve alan seçimi biçiminden (il, bölge, elle çizilmiş
/// poligon) ve veri kaynağından bağımsızdır: sınır kaynağa değil ALANA konur.
/// Arayüzün il listesini süzmesi bir kolaylıktır; doğrudan API çağrısı 403
/// alır.
/// <para>
/// Projenin GERİ KALANINDA coğrafi yetki bir YAZMA sınırıdır (POI
/// oluşturma/taşıma <c>Covers</c> ile denetlenir) ve o okuma yolları
/// — <c>GET /api/poi</c>, POI araması, <c>poi_read</c> WMS'i, envanter
/// analizinin POI kırılımı — DEĞİŞMEDİ.
/// </para>
/// </para>
/// <para>
/// <b>Sayım VERİTABANINDA yapılır.</b> Hiçbir POI belleğe çekilmez: yüklemler
/// ve gruplama <c>ToListAsync</c>'ten önce uygulanır, dolayısıyla veritabanı
/// yalnızca kategori başına birer satır döndürür. Tablo ileride yüz binlerce
/// satıra çıktığında da taşınan veri kategori sayısı kadardır.
/// </para>
/// </remarks>
public class LocationAnalysisService : ILocationAnalysisService
{
    /// <summary>
    /// Vektör listesinin üst sınırı.
    /// </summary>
    /// <remarks>
    /// <b>Bir GÜVENLİK tavanıdır, bir sayfa boyu değil.</b> Alan istemciden
    /// gelir ve bir istemci Türkiye'nin tamamını hedef gösterebilir; sınırsız
    /// bir liste o durumda tüm tabloyu tarayıcıya indirirdi. Bugünkü veri
    /// kümesi 7853 satırdır ve Ankara + iki kök ölçüt 1533 döndürür,
    /// dolayısıyla sınır gerçek kullanımın çok üstündedir ve normal bir
    /// analizde hiç devreye girmez.
    /// </remarks>
    internal const int MaxPoints = 5_000;

    private readonly AppDbContext _dbContext;
    private readonly LocationAnalysisCriterionResolver _resolver;
    private readonly ILocationAnalysisAreaGuard _areaGuard;

    public LocationAnalysisService(AppDbContext dbContext, ILocationAnalysisAreaGuard areaGuard)
    {
        _dbContext = dbContext;
        _areaGuard = areaGuard;

        /* Hiyerarşi çözümü ORTAKtır: ağırlıklı ısı haritası servisi de aynı
           çözücüyü kullanır, böylece özet ile raster asla farklı bir kategori
           kümesi üzerinde çalışmaz. */
        _resolver = new LocationAnalysisCriterionResolver(dbContext);
    }

    public async Task<ServiceResult<LocationAnalysisResponse>> AnalyzeAsync(
        LocationAnalysisRequest request,
        CancellationToken cancellationToken = default)
    {
        /* Saf doğrulama ÖNCE: geçersiz bir istek veritabanına hiç gitmez ve
           400 ile döner. */
        var validated = LocationAnalysisValidator.Validate(request);

        if (!validated.IsSuccess)
        {
            return ServiceResult<LocationAnalysisResponse>.Failure(validated.Error!);
        }

        var analysis = validated.Value!;

        /* Coğrafi yetki, kategori çözümünden ÖNCE denetlenir: yetkisiz bir
           alan için taksonomi okumaya gerek yoktur. */
        var authorized = await _areaGuard.AuthorizeAsync(
            analysis.Target,
            analysis.AdministrativeTargetType,
            analysis.AdministrativeTargetKey,
            cancellationToken);

        if (!authorized.IsSuccess)
        {
            return ServiceResult<LocationAnalysisResponse>.Forbidden(authorized.Error!);
        }

        var resolution = await _resolver.ResolveAsync(analysis.Criteria, cancellationToken);

        if (!resolution.IsSuccess)
        {
            return ServiceResult<LocationAnalysisResponse>.Failure(resolution.Error!);
        }

        var scope = resolution.Value!;

        /* Tek bir toplama sorgusu: SAKLANAN kategori başına sayı. Ölçüt başına
           ayrı sorgu açmak (N+1) aynı cevabı ölçüt sayısı kadar gidiş dönüşle
           üretirdi ve her biri aynı mekânsal yüklemi yeniden çalıştırırdı.
           Alt ağaç genişletmesi de sorguyu çoğaltmaz: tüm alt ağaçların
           kimlikleri TEK bir kümede birleşir. */
        var counts = await Matching(_dbContext, analysis.Target, scope.MatchedCategoryIds)
            .GroupBy(poi => poi.CategoryId)
            .Select(group => new { CategoryId = group.Key, Count = group.Count() })
            .ToListAsync(cancellationToken);

        /* Gruplanmış satırlar ölçütlere burada toplanır. Bellekte dönülen şey
           POI'ler DEĞİL, en fazla kanonik kategori sayısı kadar sayaç
           satırıdır. */
        var countsByCriterion = new Dictionary<string, int>(StringComparer.Ordinal);

        foreach (var row in counts)
        {
            var slug = scope.CriterionOf(row.CategoryId);

            if (slug is null)
            {
                // Sorgu yalnızca sahiplenilmiş kimlikleri istedi; buraya
                // düşmek beklenmez ve sessizce yok sayılır.
                continue;
            }

            countsByCriterion[slug] = countsByCriterion.GetValueOrDefault(slug) + row.Count;
        }

        var criteria = new List<LocationAnalysisCriterionResponse>(analysis.Criteria.Count);

        foreach (var criterion in analysis.Criteria)
        {
            var category = scope.Selected[criterion.CategorySlug];
            var count = countsByCriterion.GetValueOrDefault(criterion.CategorySlug, 0);

            /* Normalleştirme ONDALIK (decimal) yapılır, double DEĞİL: 40/100
               ikili gösterimde tam değildir ve toplamlar 0.9999999… gibi
               değerler üretirdi. Ağırlık aritmetiğinin ekranda birebir
               doğrulanabilir olması isteniyor. */
            var normalized = criterion.Weight / (decimal)LocationAnalysisValidator.RequiredWeightTotal;

            criteria.Add(new LocationAnalysisCriterionResponse
            {
                CategorySlug = criterion.CategorySlug,
                CategoryName = category.Name,
                Weight = criterion.Weight,
                NormalizedWeight = normalized,
                MatchingPoiCount = count,
                /* Alt ağaçtaki HER kayıt, ölçütün kendi ağırlığını alır: üst
                   kategori seçmek, torunlarına farklı bir ağırlık uygulamak
                   değil, hepsini tek bir ölçüt olarak ele almaktır. */
                WeightedContribution = count * normalized,
                CoveredCategoryCount = scope.CoverageOf(criterion.CategorySlug)
            });
        }

        var envelope = analysis.Target.EnvelopeInternal;

        return ServiceResult<LocationAnalysisResponse>.Success(new LocationAnalysisResponse
        {
            Target = new LocationAnalysisTargetResponse
            {
                PartCount = analysis.PartCount,
                MinLongitude = envelope.MinX,
                MinLatitude = envelope.MinY,
                MaxLongitude = envelope.MaxX,
                MaxLatitude = envelope.MaxY
            },
            /* Toplam kırılımlardan TÜRETİLİR, ayrıca sorgulanmaz. Ölçüt alt
               ağaçları çakışamadığı için (bkz. LocationAnalysisCriterionResolver) bir POI en fazla
               bir ölçüte sayılır ve toplam gerçekten eşleşen kayıt sayısıdır. */
            TotalMatchingPoiCount = criteria.Sum(item => item.MatchingPoiCount),
            TotalWeightedContribution = criteria.Sum(item => item.WeightedContribution),
            Criteria = criteria
        });
    }

    /// <summary>
    /// Analize giren POI'lerin sorgusu: <b>kategori kümesi</b> ve <b>hedef
    /// alan</b> yüklemleri.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Tek tanım, iki tüketici.</b> Bugün yalnızca özet sayımı bu sorgudan
    /// beslenir; ağırlıklı gösterim fazı aynı yüklem çiftine ihtiyaç duyacak ve
    /// onu yeniden yazmak yerine buradan okuyabilir. Sorgu
    /// <see cref="IQueryable{T}"/> döndürür — hiçbir satır çekilmez, çağıran
    /// üzerine kendi projeksiyonunu (sayım, geometri + ağırlık) ekler.
    /// </para>
    /// <para>
    /// <b>Kategori kümesi ZATEN genişletilmiştir.</b> Buraya gelen kimlikler
    /// seçili ölçütlerin alt ağaçlarının birleşimidir; hiyerarşi sorgunun
    /// içinde çözülmez. Özyinelemeli bir SQL (recursive CTE) yazmak, 44
    /// satırlık bir taksonomi için veritabanına gereksiz iş yaptırmak ve
    /// hiyerarşi kuralının ikinci bir kopyasını üretmek olurdu.
    /// </para>
    /// <para>
    /// <b>Yüklem <c>Intersects</c>'tir.</b> Envanter analiziyle aynı ölçüt
    /// (<see cref="SpatialAnalysisService"/>) ve nokta geometrisi için en
    /// sezgisel olanı: sınıra denk düşen bir nokta alanın İÇİNDE sayılır.
    /// <c>Contains</c> onu dışarıda bırakırdı — kullanıcının çizdiği alanın
    /// kenarı, alanının dışı değildir. Nokta için <c>Covers</c> ile aynı
    /// sonucu verir; tercih, projede zaten yazılı olan ölçütü tekrarlamaktır.
    /// </para>
    /// <para>
    /// Npgsql her iki yüklemi de SQL'e çevirir (<c>category_id = ANY(...)</c>
    /// ve <c>ST_Intersects</c>), dolayısıyla <c>IX_analysis_poi_category_id</c>
    /// ve <c>coordinate</c> üzerindeki GiST indeksi kullanılabilir.
    /// </para>
    /// </remarks>
    /// <summary>
    /// Aktif analize giren POI'lerin listesi.
    /// </summary>
    /// <remarks>
    /// <b>Sayfalama YOKTUR, üst sınır VARDIR.</b> Analiz alanı kullanıcının
    /// kendi seçimidir ve sonuç haritaya bir kerede çizilir; sayfalamak,
    /// haritanın yarısını göstermek olurdu. Sınır bir güvenlik tavanıdır
    /// (bir istemci Türkiye'nin tamamını alan seçebilir) ve aşıldığında
    /// SÖYLENİR.
    /// </remarks>
    public async Task<ServiceResult<LocationAnalysisPointsResponse>> ListPointsAsync(
        LocationAnalysisRequest request,
        CancellationToken cancellationToken = default)
    {
        if (request is null)
        {
            return ServiceResult<LocationAnalysisPointsResponse>.Failure("İstek gövdesi zorunludur.");
        }

        var validated = LocationAnalysisValidator.Validate(request);

        if (!validated.IsSuccess)
        {
            return ServiceResult<LocationAnalysisPointsResponse>.Failure(validated.Error!);
        }

        var analysis = validated.Value!;

        var authorized = await _areaGuard.AuthorizeAsync(
            analysis.Target,
            analysis.AdministrativeTargetType,
            analysis.AdministrativeTargetKey,
            cancellationToken);

        if (!authorized.IsSuccess)
        {
            return ServiceResult<LocationAnalysisPointsResponse>.Forbidden(authorized.Error!);
        }

        var resolution = await _resolver.ResolveAsync(analysis.Criteria, cancellationToken);

        if (!resolution.IsSuccess)
        {
            return ServiceResult<LocationAnalysisPointsResponse>.Failure(resolution.Error!);
        }

        var scope = resolution.Value!;
        var matching = Matching(_dbContext, analysis.Target, scope.MatchedCategoryIds);

        /* Sayım ve liste AYRI sorgulardır çünkü sayım KESİLMEMİŞ toplamı
           söylemelidir: kesilmiş bir listeden sayı üretmek, kullanıcıya
           eksik sonucu tam diye göstermek olurdu. */
        var totalCount = await matching.CountAsync(cancellationToken);

        /* Yalnızca gereken kolonlar taşınır. Geometrinin tamamını çekip
           bellekte X/Y okumak, satır başına bir NetTopologySuite nesnesi
           kurmak olurdu. */
        var rows = await matching
            /* Sıralama BİRLEŞİK kimliğe göredir. Ham `source_id` iki kaynakta
               da 1'den başlar; ona göre sıralamak, kesme sınırına dayanıldığında
               hangi kaynağın kesileceğini belirsiz bırakırdı. */
            .OrderBy(poi => poi.FeatureId)
            .Take(MaxPoints)
            .Select(poi => new
            {
                poi.FeatureId,
                poi.SourceId,
                poi.Name,
                poi.CategoryId,
                Longitude = poi.Coordinate.X,
                Latitude = poi.Coordinate.Y,
                poi.Source
            })
            .ToListAsync(cancellationToken);

        return ServiceResult<LocationAnalysisPointsResponse>.Success(new LocationAnalysisPointsResponse
        {
            TotalCount = totalCount,
            Limit = MaxPoints,
            Truncated = totalCount > MaxPoints,
            Pois = [.. rows.Select(row => new LocationAnalysisPointResponse
            {
                FeatureId = row.FeatureId,
                Id = row.SourceId,
                Name = row.Name,
                CategoryId = row.CategoryId,
                CategorySlug = scope.SlugOf(row.CategoryId),
                CategoryName = scope.NameOf(row.CategoryId),
                CategoryPath = scope.PathOf(row.CategoryId),
                Longitude = row.Longitude,
                Latitude = row.Latitude,
                Source = DisplaySource(row.Source)
            })]
        });
    }

    /// <summary>
    /// Tıklanan noktaya en yakın eşleşen analiz POI'si.
    /// </summary>
    /// <remarks>
    /// <b>Boş sonuç bir HATA DEĞİLDİR.</b> Boşluğa tıklamak sıradan bir
    /// kullanıcı davranışıdır; <c>Poi = null</c> ile 200 döner ve arayüz
    /// hiçbir şey açmaz. 404 döndürmek, kullanıcının yaptığı normal bir şeyi
    /// hataya çevirirdi.
    /// </remarks>
    public async Task<ServiceResult<LocationAnalysisHitTestResponse>> HitTestAsync(
        LocationAnalysisHitTestRequest request,
        CancellationToken cancellationToken = default)
    {
        if (request is null)
        {
            return ServiceResult<LocationAnalysisHitTestResponse>.Failure("İstek gövdesi zorunludur.");
        }

        /* Analiz kuralları ÖZET ucuyla AYNI doğrulayıcıdan geçer; ikinci bir
           kopya yazılmaz. */
        var validated = LocationAnalysisValidator.Validate(request);

        if (!validated.IsSuccess)
        {
            return ServiceResult<LocationAnalysisHitTestResponse>.Failure(validated.Error!);
        }

        var coordinate = LocationAnalysisHitTest.ValidateCoordinate(request.Longitude, request.Latitude);

        if (!coordinate.IsSuccess)
        {
            return ServiceResult<LocationAnalysisHitTestResponse>.Failure(coordinate.Error!);
        }

        /* Yarıçap KIRPILIR: istemciden gelen bir sayı sorgunun kapsamını
           belirleyemez. */
        var tolerance = LocationAnalysisHitTest.ClampTolerance(request.ToleranceMeters);

        var analysis = validated.Value!;

        var authorized = await _areaGuard.AuthorizeAsync(
            analysis.Target,
            analysis.AdministrativeTargetType,
            analysis.AdministrativeTargetKey,
            cancellationToken);

        if (!authorized.IsSuccess)
        {
            return ServiceResult<LocationAnalysisHitTestResponse>.Forbidden(authorized.Error!);
        }

        var resolution = await _resolver.ResolveAsync(analysis.Criteria, cancellationToken);

        if (!resolution.IsSuccess)
        {
            return ServiceResult<LocationAnalysisHitTestResponse>.Failure(resolution.Error!);
        }

        var scope = resolution.Value!;

        /* Nokta KANONİK sırayla kurulur: X = boylam, Y = enlem. */
        var click = new Point(request.Longitude, request.Latitude) { SRID = WktGeometryParser.Srid4326 };

        var nearest = await NearestMatching(
                _dbContext,
                analysis.Target,
                scope.MatchedCategoryIds,
                click,
                tolerance,
                take: 1)
            .Select(poi => new
            {
                poi.FeatureId,
                poi.SourceId,
                poi.Name,
                poi.CategoryId,
                Longitude = poi.Coordinate.X,
                Latitude = poi.Coordinate.Y,
                poi.Source
            })
            .FirstOrDefaultAsync(cancellationToken);

        if (nearest is null)
        {
            return ServiceResult<LocationAnalysisHitTestResponse>.Success(
                new LocationAnalysisHitTestResponse { Poi = null });
        }

        return ServiceResult<LocationAnalysisHitTestResponse>.Success(new LocationAnalysisHitTestResponse
        {
            Poi = new LocationAnalysisPointResponse
            {
                FeatureId = nearest.FeatureId,
                Id = nearest.SourceId,
                Name = nearest.Name,
                CategoryId = nearest.CategoryId,
                CategorySlug = scope.SlugOf(nearest.CategoryId),
                CategoryName = scope.NameOf(nearest.CategoryId),
                /* Yol, panelin ölçüt seçicisiyle AYNI gösterimdir; çözücünün
                   zaten okuduğu taksonomiden kurulur, ikinci sorgu açılmaz. */
                CategoryPath = scope.PathOf(nearest.CategoryId),
                Longitude = nearest.Longitude,
                Latitude = nearest.Latitude,
                Source = DisplaySource(nearest.Source)
            }
        });
    }

    /// <summary>Kaynak kolonunun kullanıcıya gösterilebilir adı.</summary>
    /// <remarks>
    /// <c>"osm"</c> bir uygulama ayrıntısıdır. Bilinmeyen bir kaynak OLDUĞU
    /// GİBİ geçer: uydurulmuş bir etiket, verinin nereden geldiği sorusunu
    /// yanlış yanıtlardı.
    /// </remarks>
    internal static string DisplaySource(string? source) =>
        source switch
        {
            not null when string.Equals(source, "osm", StringComparison.OrdinalIgnoreCase) => "OpenStreetMap",
            /* Birleşimin ikinci kolu: uygulamada oluşturulmuş POI. Kullanıcı,
               haritada gördüğü bir noktanın kendi envanterinden mi yoksa açık
               veriden mi geldiğini ayırt edebilmelidir. */
            not null when string.Equals(source, "app", StringComparison.OrdinalIgnoreCase) => "Uygulama",
            _ => source ?? string.Empty
        };

    internal static IQueryable<AnalysisPoiFeature> Matching(
        AppDbContext dbContext,
        Geometry target,
        IReadOnlyCollection<int> categoryIds) =>
        Union(dbContext, target, categoryIds, click: null, toleranceMeters: 0);

    /// <summary>
    /// Konum analizinin <b>TEK</b> veri kümesi: açık veri <c>analysis_poi</c>
    /// UNION ALL aktif + silinmemiş uygulama <c>poi</c>'si.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Yüklemler birleşimden ÖNCE, her kola AYRI uygulanır.</b> İki neden:
    /// (1) her kol kendi indeksinden yararlanır — <c>ST_Intersects</c> için
    /// <c>IX_analysis_poi_coordinate</c> ve <c>IX_poi_coordinate</c> GiST
    /// indeksleri, kategori için kendi indeksleri; (2) süzme birleşimin
    /// ÜSTÜNDE yapılsaydı veritabanı önce iki tabloyu tam olarak birleştirip
    /// sonra süzmek zorunda kalabilirdi.
    /// </para>
    /// <para>
    /// <b>Uygulama POI'sinin süzgeci taban sözleşmenin AYNISIDIR:</b>
    /// <c>is_deleted = false</c> (global query filter'dan gelir) <b>ve</b>
    /// <c>is_active = true</c> — <c>poi_read</c> SQL View'ı ile birebir. Bir
    /// POI çöp kutusuna atıldığında ya da pasifleştirildiğinde bir sonraki
    /// analizde SAYILMAZ, listelenmez ve ısı üretmez.
    /// </para>
    /// <para>
    /// <b>Sahiplik yüklemi YOKTUR ve uydurulmaz.</b> POI ortak bir
    /// envanterdir: <c>GET /api/poi</c> ve <c>poi_read</c> WMS'i onu
    /// <c>poi.view</c> taşıyan herkese gösterir. Analizi kullanıcının kendi
    /// kayıtlarıyla sınırlamak, projenin hiçbir okuma yolunda bulunmayan bir
    /// kuralı yalnızca burada icat etmek olurdu.
    /// </para>
    /// <para>
    /// <b>Kimlik KAYNAKLA birlikte kurulur.</b> <c>poi.id</c> ile
    /// <c>analysis_poi.id</c> ayrı identity dizileridir ve çakışırlar;
    /// <c>FeatureId</c> birleşimdeki tek tekil kimliktir. GeoServer'ın okuduğu
    /// <c>analysis_poi_union</c> VIEW'ı da aynı şemayı üretir
    /// (bkz. <c>AddAnalysisPoiUnionView</c> migration'ı) — ikisinin
    /// ayrışmadığını <c>LocationAnalysisUnionSourceTests</c> sabitler.
    /// </para>
    /// <para>
    /// <b>TEKİLLEŞTİRME YAPILMAZ (UNION ALL).</b> İki kaynak arasında
    /// paylaşılan güvenilir bir dış kimlik yoktur: <c>analysis_poi</c>
    /// <c>source</c> + <c>external_id</c> taşır, <c>poi</c> hiç taşımaz.
    /// Bulanık bir ad/konum eşleştirmesi, gerçekte ayrı olan iki komşu
    /// işletmeyi sessizce tek kayda indirebilirdi; bunun bedeli, aynı gerçek
    /// yerin her iki kaynakta da bulunması hâlinde iki kez sayılmasıdır ve bu
    /// bedel BİLİNÇLİ olarak seçilmiştir (bkz. docs/location-analysis-heatmap.md).
    /// </para>
    /// </remarks>
    private static IQueryable<AnalysisPoiFeature> Union(
        AppDbContext dbContext,
        Geometry target,
        IReadOnlyCollection<int> categoryIds,
        Point? click,
        double toleranceMeters)
    {
        var external = dbContext.AnalysisPois
            .AsNoTracking()
            .Where(poi => categoryIds.Contains(poi.CategoryId))
            .Where(poi => poi.Coordinate.Intersects(target));

        /* Global query filter zaten `is_deleted = false` uygular; `is_active`
           AÇIKÇA yazılır çünkü o filtreye dâhil değildir ve pasif bir kayıt
           analize girmemelidir. */
        var owned = dbContext.Pois
            .AsNoTracking()
            .Where(poi => poi.IsActive)
            .Where(poi => categoryIds.Contains(poi.CategoryId))
            .Where(poi => poi.Coordinate.Intersects(target));

        if (click is not null)
        {
            external = external.Where(poi =>
                EF.Functions.IsWithinDistance(poi.Coordinate, click, toleranceMeters, true));

            owned = owned.Where(poi =>
                EF.Functions.IsWithinDistance(poi.Coordinate, click, toleranceMeters, true));
        }

        return external
            .Select(poi => new AnalysisPoiFeature
            {
                FeatureId = ExternalPrefix + poi.Id,
                SourceKind = ExternalSourceKind,
                SourceId = poi.Id,
                Name = poi.Name,
                CategoryId = poi.CategoryId,
                Coordinate = poi.Coordinate,
                Source = poi.Source
            })
            .Concat(owned.Select(poi => new AnalysisPoiFeature
            {
                FeatureId = OwnedPrefix + poi.Id,
                SourceKind = OwnedSourceKind,
                SourceId = poi.Id,
                Name = poi.Name,
                CategoryId = poi.CategoryId,
                Coordinate = poi.Coordinate,
                Source = OwnedSource
            }));
    }

    /* --- Birleşik kimliğin sözleşmesi -------------------------------------------
       Bu dört sabit, GeoServer'ın okuduğu `analysis_poi_union` VIEW'ı ile
       birebir aynı değerleri üretmek zorundadır; drift testi ikisini
       karşılaştırır. */

    internal const string ExternalPrefix = "osm:";

    internal const string OwnedPrefix = "app:";

    internal const string ExternalSourceKind = "analysis";

    internal const string OwnedSourceKind = "app";

    /// <summary>Uygulama POI'sinin kaynak adı.</summary>
    /// <remarks>
    /// <c>analysis_poi.source</c> gibi bir kolondan gelmez — normal POI
    /// tablosunda böyle bir kolon yoktur ve EKLENMEZ: bu bir okuma sunumudur,
    /// envanterin şeması değil.
    /// </remarks>
    internal const string OwnedSource = "app";

    /// <summary>
    /// Tıklanan noktaya en yakın <b>eşleşen</b> analiz POI'si.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b><see cref="Matching"/> ÜZERİNE kurulur ve bu kasıtlıdır.</b> Alan ve
    /// kategori yüklemleri özet, ağırlıklı raster ve nokta örtüsüyle AYNI
    /// koddan gelir; isabet testi bu yüzden ekranda görünen kümenin dışına
    /// çıkamaz. İkinci bir yüklem yazmak, kullanıcının analizine girmeyen bir
    /// noktayı analizin sonucu diye göstermenin en kolay yolu olurdu.
    /// </para>
    /// <para>
    /// <b>Mesafe METREDİR, derece DEĞİL.</b> <c>coordinate</c> EPSG:4326'dır ve
    /// o kolonda <c>ST_Distance</c> DERECE döndürür; bir derece boylam
    /// Ankara enleminde bir derece enlemin ~%77'si kadardır, dolayısıyla
    /// derece cinsinden "en yakın", metre cinsinden en yakın DEĞİLDİR.
    /// <c>useSpheroid: true</c> her iki tarafı da <c>geography</c>'ye çevirir;
    /// üretilen SQL <c>ST_DWithin(geography, geography, metre)</c> ve
    /// <c>ST_Distance(geography, geography)</c> olur.
    /// </para>
    /// <para>
    /// <b>Sıralama ve sınırlama VERİTABANINDA yapılır.</b> Eşleşen satırlar
    /// belleğe çekilip C# tarafında sıralanmaz: alan yüklemi GiST indeksinden
    /// (<c>IX_analysis_poi_coordinate</c>) yararlanarak kümeyi daraltır,
    /// mesafe sıralaması ve <c>LIMIT</c> aynı sorguda kalır. Tablo yüz
    /// binlerce satıra çıktığında da taşınan şey EN FAZLA istenen kadar
    /// satırdır.
    /// </para>
    /// </remarks>
    internal static IQueryable<AnalysisPoiFeature> NearestMatching(
        AppDbContext dbContext,
        Geometry target,
        IReadOnlyCollection<int> categoryIds,
        Point click,
        double toleranceMeters,
        int take) =>
        /* Mesafe SÜZGECİ birleşimin her koluna ayrı uygulanır (bkz.
           <see cref="Union"/>); sıralama ve LIMIT birleşimin üstünde kalır ve
           veritabanı tarafından yapılır. */
        Union(dbContext, target, categoryIds, click, toleranceMeters)
            .OrderBy(poi => EF.Functions.Distance(poi.Coordinate, click, true))
            .Take(take);
}
