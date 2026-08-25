using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Pois;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Infrastructure.Services;

/// <summary>
/// POI kayıtlarını EF Core üzerinden <c>poi</c> tablosuna yazar ve okur. Elle
/// SQL kullanılmaz.
/// </summary>
/// <remarks>
/// <para>
/// <b>Okuma sahibe göre KISITLANMAZ.</b> Çizim servisiyle arasındaki en önemli
/// fark budur ve bilinçlidir: çizimler kişinin kendi çalışma alanıdır, POI ise
/// <c>poi.view</c> taşıyan herkesin gördüğü ortak envanterdir. Burada sahiplik
/// yüklemi aramak, ödevin "Kullanıcı POI'leri görebilir" gereksinimini
/// karşılamayan bir liste üretirdi.
/// </para>
/// <para>
/// <b>Coğrafi sınır yalnızca YAZMAYA uygulanır.</b> Bir kullanıcının alanının
/// dışındaki POI'leri görebilmesi doğrudur — sınır, nerede veri
/// ÜRETEBİLECEĞİNİ belirler, ne görebileceğini değil. Bir kaydı TAŞIMAK da
/// yazmaktır: yeni konum, oluşturmayla aynı denetimden geçer.
/// </para>
/// </remarks>
public class PoiService : IPoiService
{
    /// <summary>
    /// Coğrafi yetki alanı dışına POI ekleme denemesinde dönen mesaj.
    /// </summary>
    /// <remarks>
    /// İzin verilen alanın kendisi paylaşılmaz: hata mesajı, yetkisi olmayan
    /// bir çağırana sınırı ikili aramayla haritalama imkânı vermemelidir. Çizim
    /// servisi de aynı kuralı izler.
    /// </remarks>
    private const string OutsideAreaMessage = "Bu alanda POI ekleme yetkiniz bulunmuyor.";

    /// <summary>
    /// POI'yi coğrafi yetki alanı DIŞINA taşıma denemesinde dönen mesaj.
    /// </summary>
    /// <remarks>
    /// Ekleme mesajıyla aynı ilke: izin verilen alanın kendisi paylaşılmaz.
    /// Bir POI'yi sürükleyerek ikili arama yapmak, sınırı haritalamanın en
    /// kolay yolu olurdu.
    /// </remarks>
    private const string OutsideMoveAreaMessage = "Bu alana POI taşıma yetkiniz bulunmuyor.";

    private const string CategoryNotFoundMessage = "Seçilen kategori bulunamadı veya kullanımda değil.";

    /// <summary>Geometrinin ve mekânsal kısıtın SRID'si.</summary>
    private const int Srid = 4326;

    /// <summary>
    /// İki koordinatı "aynı" sayan eşik: 1e-9 derece, milimetrenin çok altında.
    /// </summary>
    /// <remarks>
    /// <b>Neden ham eşitlik değil.</b> İstemci, taşımadığı bir kaydın
    /// koordinatını da gövdede taşır (form konumu bir alan olarak sunar); değer
    /// JSON'a yazılıp geri okunurken son bitlerde oynayabilir. Ham eşitlik,
    /// yalnızca adını değiştiren bir kullanıcının isteğini "taşıma" sayıp
    /// coğrafi denetime sokardı — alanı sonradan daraltılmış biri kendi kaydının
    /// adını bir daha düzeltemezdi. Eşik, gerçek bir taşımanın (metreler)
    /// yanında ölçülemeyecek kadar küçüktür.
    /// </remarks>
    private const double CoordinateEpsilon = 1e-9;

    private const string NotFoundMessage = "POI kaydı bulunamadı.";

    /// <summary>
    /// Yetki/sahiplik reddinde dönen mesaj.
    /// </summary>
    /// <remarks>
    /// Kaydın SAHİBİ açıklanmaz: "Ali'nin kaydını düzenleyemezsiniz" demek,
    /// harita sözleşmesinin bilinçle dışarıda bıraktığı bilgiyi hata mesajıyla
    /// sızdırmak olurdu. Coğrafi ret mesajıyla aynı ilke.
    /// </remarks>
    private const string MutationForbiddenMessage = "Bu POI kaydı üzerinde işlem yapma yetkiniz bulunmuyor.";

    private const string CategoryUnusableMessage =
        "Bu POI'nin kategorisi artık kullanımda değil; geri yüklemeden önce kategoriyi yeniden etkinleştirin.";

    private readonly AppDbContext _dbContext;
    private readonly ICurrentUserService _currentUser;
    private readonly IGeographicAuthorizationService _geographicAuthorization;
    private readonly IPoiAuthorizationService _poiAuthorization;

    public PoiService(
        AppDbContext dbContext,
        ICurrentUserService currentUser,
        IGeographicAuthorizationService geographicAuthorization,
        IPoiAuthorizationService poiAuthorization)
    {
        _dbContext = dbContext;
        _currentUser = currentUser;
        _geographicAuthorization = geographicAuthorization;
        _poiAuthorization = poiAuthorization;
    }

    /* --- Arama ------------------------------------------------------------------ */

    /// <summary>
    /// Kayıtlı POI'ler arasında ada göre arama.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Görünürlük harita okumasıyla AYNIDIR.</b> Sahiplik, çağıran kimliği
    /// ve coğrafi kapsam yüklemi YOKTUR — POI ortak envanterdir ve coğrafi
    /// kapsam bir YAZMA kuralıdır (create/move). Buraya bir okuma filtresi
    /// eklemek, haritada ve listede görünen bir POI'nin aramada bulunamadığı
    /// tutarsız bir durum üretirdi.
    /// </para>
    /// <para>
    /// <b>Süzme, sıralama ve sınır VERİTABANINDA yapılır.</b> Tüm POI'leri
    /// belleğe çekip orada sıralamak, envanter büyüdükçe her tuş vuruşunda
    /// tabloyu taramak demek olurdu.
    /// </para>
    /// <para>
    /// <b>Joker karakterler METİNDİR.</b> Kullanıcının yazdığı <c>%</c> ve
    /// <c>_</c> arama operatörüne dönüşmez; kaçış karakteriyle birlikte
    /// <c>ILIKE ... ESCAPE</c>'e verilir. Aksi hâlde tek bir <c>%</c> bütün
    /// envanteri döndürürdü.
    /// </para>
    /// </remarks>
    public async Task<ServiceResult<IReadOnlyList<PoiSearchResult>>> SearchPoisAsync(
        string? query,
        int? limit,
        CancellationToken cancellationToken = default)
    {
        var term = (query ?? string.Empty).Trim();

        if (term.Length < PoiSearchContract.MinimumQueryLength)
        {
            return ServiceResult<IReadOnlyList<PoiSearchResult>>.Failure(
                $"Arama metni en az {PoiSearchContract.MinimumQueryLength} karakter olmalıdır.");
        }

        if (term.Length > PoiSearchContract.MaximumQueryLength)
        {
            return ServiceResult<IReadOnlyList<PoiSearchResult>>.Failure(
                $"Arama metni en fazla {PoiSearchContract.MaximumQueryLength} karakter olabilir.");
        }

        var take = limit ?? PoiSearchContract.DefaultLimit;

        if (take < PoiSearchContract.MinimumLimit || take > PoiSearchContract.MaximumLimit)
        {
            return ServiceResult<IReadOnlyList<PoiSearchResult>>.Failure(
                $"limit {PoiSearchContract.MinimumLimit} ile {PoiSearchContract.MaximumLimit} arasında olmalıdır.");
        }

        return ServiceResult<IReadOnlyList<PoiSearchResult>>.Success(
            await BuildSearchQuery(term, take).ToListAsync(cancellationToken));
    }

    /// <summary>
    /// Arama sorgusunun kendisi — süzme, sıralama, sınır ve projeksiyon.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Ayrı bir metot olması testler içindir ve gerçek bir kazanç sağlar:</b>
    /// PostgreSQL sağlayıcısı bir sorguyu veritabanına BAĞLANMADAN SQL'e
    /// çevirebilir (<c>ToQueryString</c>), dolayısıyla süzmenin, sıralamanın ve
    /// sınırın gerçekten veritabanında yapıldığı — belleğe çekilmediği —
    /// canlı bir veritabanı olmadan doğrulanabilir.
    /// </para>
    /// <para>
    /// <b>Her şey TEK sorguda ve SQL tarafında olur.</b> <c>Take</c>
    /// projeksiyondan önce gelir; sıralama ölçütü de SQL'e çevrilen bir
    /// <c>CASE</c> ifadesidir. Sonuçları belleğe çekip orada sıralamak,
    /// envanter büyüdükçe her tuş vuruşunda tabloyu taramak olurdu.
    /// </para>
    /// </remarks>
    internal IQueryable<PoiSearchResult> BuildSearchQuery(string term, int take)
    {
        var escaped = PoiSearchContract.EscapeLikePattern(term);
        var exact = escaped;
        var prefix = $"{escaped}%";
        var contains = $"%{escaped}%";
        const string escapeCharacter = PoiSearchContract.LikeEscapeCharacter;

        /* Global query filter POI ve kategorinin silinmiş/pasif satırlarını
           zaten düşürür — iki tablo için de. Join, kategori alanlarını satır
           başına ikinci bir sorgu doğurmadan getirir (Include ile gelen
           N+1 riski yoktur). */
        return _dbContext.Pois
            .AsNoTracking()
            .Join(
                _dbContext.PoiCategories,
                poi => poi.CategoryId,
                category => category.Id,
                (poi, category) => new { Poi = poi, Category = category })
            .Where(row =>
                EF.Functions.ILike(row.Poi.Name, contains, escapeCharacter)
                || EF.Functions.ILike(row.Category.Name, contains, escapeCharacter))
            /* Deterministik sıralama: tam eşleşme → ile başlayan → içeren →
               yalnızca kategori adından eşleşen. Eşitlikte ad, en sonda kimlik;
               böylece aynı sorgu her zaman aynı listeyi verir. */
            .OrderBy(row =>
                EF.Functions.ILike(row.Poi.Name, exact, escapeCharacter) ? 0
                : EF.Functions.ILike(row.Poi.Name, prefix, escapeCharacter) ? 1
                : EF.Functions.ILike(row.Poi.Name, contains, escapeCharacter) ? 2
                : 3)
            .ThenBy(row => row.Poi.Name)
            .ThenBy(row => row.Poi.Id)
            .Take(take)
            .Select(row => new PoiSearchResult
            {
                Id = row.Poi.Id,
                Name = row.Poi.Name,
                CategoryId = row.Category.Id,
                CategoryName = row.Category.Name,
                CategorySlug = row.Category.Slug,
                IconKey = row.Category.IconKey,
                ColorHex = row.Category.ColorHex,
                /* Coordinate.X boylam, Coordinate.Y enlemdir. Ters çevrilmesi
                   POI'yi dünyanın başka bir yerine taşırdı. */
                Longitude = row.Poi.Coordinate.X,
                Latitude = row.Poi.Coordinate.Y
            });
    }

    /* --- Harita okuması --------------------------------------------------------- */

    public async Task<IReadOnlyList<PoiResponse>> GetMapPoisAsync(CancellationToken cancellationToken = default)
    {
        /* Global query filter pasif/silinmiş POI'leri düşürür; burada
           IgnoreQueryFilters BİLİNÇLİ olarak kullanılmaz. Sahiplik yüklemi de
           yoktur — POI ortak envanterdir. */
        var rows = await _dbContext.Pois
            .AsNoTracking()
            .Select(p => new
            {
                p.Id,
                p.Name,
                p.CategoryId,
                p.WorkHoursJson,
                Longitude = p.Coordinate.X,
                Latitude = p.Coordinate.Y,
                /* Sahip kimliği YALNIZCA yetenek bayrağını hesaplamak için
                   okunur ve yanıta hiç girmez: harita sözleşmesi kimin neyi
                   eklediğini taşımaz. */
                p.UserId
            })
            .ToListAsync(cancellationToken);

        var authority = await _poiAuthorization.GetAuthorityAsync(cancellationToken);

        /* Kategori adları TEK sorguda okunur ve bellekte eşlenir: satır başına
           kategori sorgulamak (ya da yolu satır başına yürütmek) klasik N+1
           olurdu. Filtre burada da açıktır — sıradan istemci pasif bir
           kategorinin adını görmez; kategorisi kullanımdan kaldırılmış bir POI
           haritada kategori etiketi olmadan görünür, kaybolmaz. */
        var categories = await ReadCategoryNodesAsync(includeHidden: false, cancellationToken);

        return
        [
            .. rows
                .Select(row => new PoiResponse
                {
                    Id = row.Id,
                    Name = row.Name,
                    CategoryId = row.CategoryId,
                    CategoryName = categories.TryGetValue(row.CategoryId, out var category) ? category.Name : string.Empty,
                    CategoryPath = PoiCategoryHierarchy.BuildPath(categories, row.CategoryId),
                    WorkHours = PoiWorkHoursValidator.Deserialize(row.WorkHoursJson),
                    Longitude = row.Longitude,
                    Latitude = row.Latitude,
                    CanUpdate = authority.CanUpdate(row.UserId),
                    CanDelete = authority.CanDelete(row.UserId)
                })
                // Deterministik sıra: ada göre, eşitlikte kimliğe göre.
                .OrderBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
                .ThenBy(item => item.Id)
        ];
    }

    /* --- "POI'lerim" ------------------------------------------------------------- */

    public async Task<IReadOnlyList<PoiResponse>> GetOwnPoisAsync(CancellationToken cancellationToken = default)
    {
        var userId = _currentUser.UserId;

        if (userId is null)
        {
            // Kimliksiz çağıranın "kendi" kaydı yoktur; boş liste döner.
            return [];
        }

        /* Sahiplik yüklemi SQL'e iner ve global query filter aktif/silinmemiş
           kuralını zaten uygular: liste, haritada görünen kendi kayıtlarıdır.
           IgnoreQueryFilters BİLİNÇLİ olarak kullanılmaz — silinmiş kendi
           kayıtları Çöp Kutusu'nun konusudur, bu listenin değil. */
        var rows = await _dbContext.Pois
            .AsNoTracking()
            .Where(p => p.UserId == userId.Value)
            .Select(p => new
            {
                p.Id,
                p.Name,
                p.CategoryId,
                p.WorkHoursJson,
                Longitude = p.Coordinate.X,
                Latitude = p.Coordinate.Y,
                p.UserId
            })
            .ToListAsync(cancellationToken);

        /* Yetenek bayrakları burada da SUNUCUDA hesaplanır ve haritayla aynı
           kuralı kullanır: kendi kaydı olması tek başına düzenleyebilmek
           demek değildir — poi.update / poi.delete de gerekir. */
        var authority = await _poiAuthorization.GetAuthorityAsync(cancellationToken);
        var categories = await ReadCategoryNodesAsync(includeHidden: false, cancellationToken);

        return
        [
            .. rows
                .Select(row => new PoiResponse
                {
                    Id = row.Id,
                    Name = row.Name,
                    CategoryId = row.CategoryId,
                    CategoryName = categories.TryGetValue(row.CategoryId, out var category) ? category.Name : string.Empty,
                    CategoryPath = PoiCategoryHierarchy.BuildPath(categories, row.CategoryId),
                    WorkHours = PoiWorkHoursValidator.Deserialize(row.WorkHoursJson),
                    Longitude = row.Longitude,
                    Latitude = row.Latitude,
                    CanUpdate = authority.CanUpdate(row.UserId),
                    CanDelete = authority.CanDelete(row.UserId)
                })
                // Harita listesiyle aynı deterministik sıra.
                .OrderBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
                .ThenBy(item => item.Id)
        ];
    }

    /* --- Yönetim okuması -------------------------------------------------------- */

    public async Task<IReadOnlyList<AdminPoiResponse>> GetAdminPoisAsync(CancellationToken cancellationToken = default)
    {
        /* IgnoreQueryFilters BİLİNÇLİDİR: yönetim ekranı pasifleştirilmiş ve
           soft-delete edilmiş kayıtları da görmek zorundadır — aksi hâlde
           "POI Yönetimi" envanterin yalnızca bir bölümünü gösterir ve bir
           kaydın neden haritada olmadığı hiçbir yerden anlaşılamazdı. */
        var rows = await _dbContext.Pois
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Select(p => new
            {
                p.Id,
                p.Name,
                p.CategoryId,
                p.WorkHoursJson,
                Longitude = p.Coordinate.X,
                Latitude = p.Coordinate.Y,
                p.UserId,
                // Sahiplik atfı için YALNIZCA kullanıcı adı okunur; e-posta,
                // hash, stamp ve rol bilgisi projeksiyona hiç girmez.
                CreatorUsername = p.User != null ? p.User.UserName : null,
                p.CreatedDate,
                p.ModifiedDate,
                p.IsActive,
                p.IsDeleted
            })
            .ToListAsync(cancellationToken);

        // Yönetim tarafında kategori adı pasif satırlar için de çözülmelidir.
        var categories = await ReadCategoryNodesAsync(includeHidden: true, cancellationToken);

        return
        [
            .. rows
                .Select(row => new AdminPoiResponse
                {
                    Id = row.Id,
                    Name = row.Name,
                    CategoryId = row.CategoryId,
                    CategoryName = categories.TryGetValue(row.CategoryId, out var category) ? category.Name : string.Empty,
                    CategoryPath = PoiCategoryHierarchy.BuildPath(categories, row.CategoryId),
                    WorkHours = PoiWorkHoursValidator.Deserialize(row.WorkHoursJson),
                    Longitude = row.Longitude,
                    Latitude = row.Latitude,
                    CreatorUserId = row.UserId,
                    CreatorUsername = row.CreatorUsername ?? string.Empty,
                    CreatedDate = row.CreatedDate,
                    ModifiedDate = row.ModifiedDate,
                    IsActive = row.IsActive,
                    IsDeleted = row.IsDeleted
                })
                // En yeni kayıt başta; eşitlikte kimlik sırayı deterministik yapar.
                .OrderByDescending(item => item.CreatedDate)
                .ThenByDescending(item => item.Id)
        ];
    }

    /* --- Oluşturma -------------------------------------------------------------- */

    public async Task<ServiceResult<PoiResponse>> CreatePoiAsync(
        CreatePoiRequest request,
        CancellationToken cancellationToken = default)
    {
        var name = PoiAttributeValidator.ValidateName(request.Name);

        if (!name.IsSuccess)
        {
            return ServiceResult<PoiResponse>.Failure(name.Error!);
        }

        var coordinate = PoiAttributeValidator.ValidateCoordinate(request.Longitude, request.Latitude);

        if (!coordinate.IsSuccess)
        {
            return ServiceResult<PoiResponse>.Failure(coordinate.Error!);
        }

        var workHours = PoiWorkHoursValidator.ValidateAndSerialize(request.WorkHours);

        if (!workHours.IsSuccess)
        {
            return ServiceResult<PoiResponse>.Failure(workHours.Error!);
        }

        /* Kategori doğrulaması global filtre ÜZERİNDEN yapılır: sorgu pasif ve
           silinmiş kategorileri zaten görmez, dolayısıyla "var ama kullanımda
           değil" durumu ayrı bir kontrol gerektirmez. */
        if (!await CategoryIsUsableAsync(request.CategoryId, cancellationToken))
        {
            return ServiceResult<PoiResponse>.Failure(CategoryNotFoundMessage);
        }

        var owner = RequireOwnerId();

        if (!owner.IsSuccess)
        {
            return ServiceResult<PoiResponse>.Forbidden(owner.Error!);
        }

        // İstemci SRID göndermez; geometri sunucuda 4326 olarak kurulur.
        var point = new Point(coordinate.Value.Longitude, coordinate.Value.Latitude) { SRID = Srid };

        /* Coğrafi yetki, koordinat DOĞRULANDIKTAN sonra ve kayıt açılmadan ÖNCE
           sınanır. Sıra önemlidir: geçersiz bir koordinat "yanlış yerdesin"
           (403) diye raporlanmamalıdır — o 400'dür ve yukarıda çoktan dönmüştür.
           Kısıtı olmayan kullanıcı için Unrestricted her yeri kabul eder. */
        var area = await _geographicAuthorization.GetEffectiveAuthorizationAsync(owner.Value, cancellationToken);

        if (!area.Allows(point))
        {
            return ServiceResult<PoiResponse>.Forbidden(OutsideAreaMessage);
        }

        var poi = new Poi
        {
            Name = name.Value!,
            CategoryId = request.CategoryId,
            WorkHoursJson = workHours.Value,
            Coordinate = point,
            /* Sahiplik client'tan DEĞİL, doğrulanmış JWT kimliğinden gelir.
               İstek gövdesindeki userId/creator alanları DTO'da tanımlı olmadığı
               için zaten bind edilmez, edilse de burada kullanılmazdı. */
            UserId = owner.Value,
            IsActive = true,
            IsDeleted = false,
            /* CreatedDate AÇIKÇA damgalanır: AppDbContext yalnızca ModifiedDate'i
               IAuditableEntity üzerinden yazar; CreatedDate otomatiği çizim
               arayüzüne bağlıdır ve POI onu uygulamaz. */
            CreatedDate = DateTime.UtcNow
        };

        _dbContext.Pois.Add(poi);
        // ModifiedDate AppDbContext.SaveChanges içinde UTC damgalanır.
        await _dbContext.SaveChangesAsync(cancellationToken);

        return ServiceResult<PoiResponse>.Success(await ToMapResponseAsync(poi, cancellationToken));
    }

    /* --- Güncelleme ------------------------------------------------------------- */

    public async Task<ServiceResult<PoiResponse>> UpdatePoiAsync(
        int id,
        UpdatePoiRequest request,
        CancellationToken cancellationToken = default)
    {
        /* Global query filter AÇIK: silinmiş ya da pasif bir kayıt bu uçtan
           düzenlenemez. Onu geri getirmenin yolu düzenleme değil, geri
           yüklemedir. */
        var poi = await _dbContext.Pois.FirstOrDefaultAsync(p => p.Id == id, cancellationToken);

        if (poi is null)
        {
            return ServiceResult<PoiResponse>.NotFound(NotFoundMessage);
        }

        /* SIRA ÖNEMLİDİR: yetki, doğrulamadan ÖNCE sınanır. Aksi hâlde yetkisiz
           bir çağıran, aldığı 400/200 farkından kaydın hangi kategorilere
           bağlanabildiğini öğrenebilirdi. */
        var authority = await _poiAuthorization.GetAuthorityAsync(cancellationToken);

        if (!authority.CanUpdate(poi.UserId))
        {
            return ServiceResult<PoiResponse>.Forbidden(MutationForbiddenMessage);
        }

        var name = PoiAttributeValidator.ValidateName(request?.Name);

        if (!name.IsSuccess)
        {
            return ServiceResult<PoiResponse>.Failure(name.Error!);
        }

        var workHours = PoiWorkHoursValidator.ValidateAndSerialize(request!.WorkHours);

        if (!workHours.IsSuccess)
        {
            return ServiceResult<PoiResponse>.Failure(workHours.Error!);
        }

        if (!await CategoryIsUsableAsync(request.CategoryId, cancellationToken))
        {
            return ServiceResult<PoiResponse>.Failure(CategoryNotFoundMessage);
        }

        /* --- Konum ---------------------------------------------------------
           Koordinat OPSİYONEL bir çifttir: gönderilmezse kayıt yerinde kalır,
           gönderilirse doğrulanır ve coğrafi yetkiden geçer. */
        var requested = PoiAttributeValidator.ValidateOptionalCoordinate(request.Longitude, request.Latitude);

        if (!requested.IsSuccess)
        {
            return ServiceResult<PoiResponse>.Failure(requested.Error!);
        }

        Point? movedTo = null;

        if (requested.Value is { } target && HasMoved(poi.Coordinate, target))
        {
            /* Coğrafi yetki, koordinat DOĞRULANDIKTAN sonra ve yazma yapılmadan
               ÖNCE sınanır — oluşturmadaki sırayla birebir aynı gerekçe:
               geçersiz bir koordinat "yanlış yerdesin" (403) diye
               raporlanmamalıdır, o 400'dür ve yukarıda dönmüştür.

               Sınanan kişi KAYDI TAŞIYANDIR, kaydın sahibi değil: veriyi oraya
               yazan odur. `poi.manage` taşıyan bir çağıran başkasının kaydını
               düzenleyebilir ama yine yalnızca KENDİ alanına taşıyabilir —
               yetki, coğrafi sınırın yerine geçmez.

               İstemci tarafındaki harita kısıtı bir güvenlik sınırı değildir;
               karar burada verilir. */
            var actorId = _currentUser.UserId;

            if (actorId is null)
            {
                return ServiceResult<PoiResponse>.Forbidden("Kimlik doğrulanamadı; POI taşınamaz.");
            }

            // İstemci SRID göndermez; geometri sunucuda 4326 olarak kurulur.
            var point = new Point(target.Longitude, target.Latitude) { SRID = Srid };
            var area = await _geographicAuthorization.GetEffectiveAuthorizationAsync(actorId.Value, cancellationToken);

            if (!area.Allows(point))
            {
                /* Hiçbir şey yazılmadan dönülür: reddedilen bir taşımadan sonra
                   kaydın adı da kategorisi de değişmemiş olmalıdır — kısmen
                   uygulanmış bir güncelleme, kullanıcının göremediği bir
                   duruma yol açardı. Eski geometri olduğu gibi durur. */
                return ServiceResult<PoiResponse>.Forbidden(OutsideMoveAreaMessage);
            }

            movedTo = point;
        }

        /* Öznitelikler ve — istendiyse — konum yazılır. UserId, CreatedDate,
           IsActive ve IsDeleted'a DOKUNULMAZ: düzenleme sahipliği devretmez ve
           silinme durumunu değiştirmez. ModifiedDate AppDbContext.SaveChanges
           içinde UTC damgalanır. */
        poi.Name = name.Value!;
        poi.CategoryId = request.CategoryId;
        poi.WorkHoursJson = workHours.Value;

        if (movedTo is not null)
        {
            poi.Coordinate = movedTo;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        return ServiceResult<PoiResponse>.Success(await ToMapResponseAsync(poi, cancellationToken));
    }

    /* --- Soft delete ------------------------------------------------------------ */

    public async Task<ServiceResult<int>> DeletePoiAsync(int id, CancellationToken cancellationToken = default)
    {
        var poi = await _dbContext.Pois.FirstOrDefaultAsync(p => p.Id == id, cancellationToken);

        if (poi is null)
        {
            // Zaten silinmiş bir kayıt da buraya düşer: filtre onu görmez ve
            // "yok" cevabı, silinmişliğini ayrıca duyurmaktan iyidir.
            return ServiceResult<int>.NotFound(NotFoundMessage);
        }

        var authority = await _poiAuthorization.GetAuthorityAsync(cancellationToken);

        if (!authority.CanDelete(poi.UserId))
        {
            return ServiceResult<int>.Forbidden(MutationForbiddenMessage);
        }

        /* Satır TABLODAN KALDIRILMAZ: geri yükleme aynı satırı — aynı Id, aynı
           sahip, aynı koordinat — geri açabilsin diye yalnızca işaretlenir.
           Çizim tarafındaki MarkDeleted ile aynı ilke; POI'de ayrı bir
           deleted_at kolonu olmadığı için silinme zamanı ModifiedDate'tir. */
        poi.IsDeleted = true;
        poi.IsActive = false;

        await _dbContext.SaveChangesAsync(cancellationToken);

        return ServiceResult<int>.Success(id);
    }

    /* --- Geri yükleme ----------------------------------------------------------- */

    public async Task<ServiceResult<PoiResponse>> RestorePoiAsync(int id, CancellationToken cancellationToken = default)
    {
        /* IgnoreQueryFilters ZORUNLUDUR: geri yüklenecek kayıt tanım gereği
           silinmiş işaretlidir ve normal sorgularda görünmez. */
        var poi = await _dbContext.Pois
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(p => p.Id == id, cancellationToken);

        if (poi is null)
        {
            return ServiceResult<PoiResponse>.NotFound(NotFoundMessage);
        }

        var authority = await _poiAuthorization.GetAuthorityAsync(cancellationToken);

        if (!authority.CanDelete(poi.UserId))
        {
            return ServiceResult<PoiResponse>.Forbidden(MutationForbiddenMessage);
        }

        if (!poi.IsDeleted)
        {
            return ServiceResult<PoiResponse>.Conflict("Bu POI kaydı zaten silinmemiş.");
        }

        /* Kategori geçerliliği geri yüklemeden ÖNCE sınanır. Kategori bu arada
           kullanımdan kalkmışsa işlem GÜVENLİ biçimde başarısız olur: kaydı
           sessizce başka bir kategoriye taşımak, kullanıcının hiç vermediği bir
           kararı onun adına vermek olurdu. */
        if (!await CategoryIsUsableAsync(poi.CategoryId, cancellationToken))
        {
            return ServiceResult<PoiResponse>.Failure(CategoryUnusableMessage);
        }

        poi.IsDeleted = false;
        // Silme iki işareti birden düşürdüğü için geri açma da ikisini birden
        // geri getirir; aksi hâlde kayıt "silinmemiş ama pasif" kalır ve query
        // filter onu yine gizlerdi.
        poi.IsActive = true;
        // ModifiedDate AppDbContext.SaveChanges içinde UTC damgalanır.

        await _dbContext.SaveChangesAsync(cancellationToken);

        return ServiceResult<PoiResponse>.Success(await ToMapResponseAsync(poi, cancellationToken));
    }

    /* --- Çöp kutusu okuması ----------------------------------------------------- */

    public async Task<IReadOnlyList<DeletedPoiResponse>> GetDeletedPoisAsync(
        CancellationToken cancellationToken = default)
    {
        var authority = await _poiAuthorization.GetAuthorityAsync(cancellationToken);

        // Geri yükleyemeyecek birine silinmiş kayıt listelenmez.
        if (!authority.CanManage && !(authority.CanDeleteOwn && authority.UserId is not null))
        {
            return [];
        }

        var query = _dbContext.Pois
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(p => p.IsDeleted);

        /* Kapsam SQL'e iner: yalnızca kendi kayıtlarını geri yükleyebilen biri
           için sorgu başkalarının satırlarını hiç getirmez — bellekte süzmek,
           yetkisiz veriyi önce çekmek olurdu. */
        if (!authority.CanManage)
        {
            var ownerId = authority.UserId!.Value;
            query = query.Where(p => p.UserId == ownerId);
        }

        var rows = await query
            .Select(p => new
            {
                p.Id,
                p.Name,
                p.CategoryId,
                p.WorkHoursJson,
                Longitude = p.Coordinate.X,
                Latitude = p.Coordinate.Y,
                p.UserId,
                CreatorUsername = p.User != null ? p.User.UserName : null,
                p.ModifiedDate
            })
            .ToListAsync(cancellationToken);

        // Silinmiş kaydın kategorisi de kullanımdan kalkmış olabilir; yolu
        // gösterebilmek için gizli satırlar da okunur.
        var categories = await ReadCategoryNodesAsync(includeHidden: true, cancellationToken);

        return
        [
            .. rows
                .Select(row => new DeletedPoiResponse
                {
                    Type = "poi",
                    DeletedAt = row.ModifiedDate,
                    /* Oluşturan YALNIZCA yönetim yetkisiyle döner. poi.delete
                       ile listeyi açan biri zaten yalnızca kendi kayıtlarını
                       görür; ona kullanıcı adı göndermek yeni bir bilgi
                       değildir, ama alanı koşulsuz doldurmak yönetim
                       sözleşmesini haritaya sızdırma alışkanlığı yaratırdı. */
                    CreatorUsername = authority.CanManage ? row.CreatorUsername ?? string.Empty : string.Empty,
                    Poi = new PoiResponse
                    {
                        Id = row.Id,
                        Name = row.Name,
                        CategoryId = row.CategoryId,
                        CategoryName = categories.TryGetValue(row.CategoryId, out var category) ? category.Name : string.Empty,
                        CategoryPath = PoiCategoryHierarchy.BuildPath(categories, row.CategoryId),
                        WorkHours = PoiWorkHoursValidator.Deserialize(row.WorkHoursJson),
                        Longitude = row.Longitude,
                        Latitude = row.Latitude,
                        CanUpdate = authority.CanUpdate(row.UserId),
                        CanDelete = authority.CanDelete(row.UserId)
                    }
                })
                // En son silinen başta; eşitlikte kimlik sırayı deterministik yapar.
                .OrderByDescending(item => item.DeletedAt)
                .ThenByDescending(item => item.Poi.Id)
        ];
    }

    /* --- Yardımcılar ------------------------------------------------------------ */

    /// <summary>
    /// Kategori POI'ye bağlanabilir mi: var, aktif ve silinmemiş.
    /// </summary>
    /// <remarks>
    /// Sorgu global query filter ÜZERİNDEN yürür, dolayısıyla "var ama
    /// kullanımda değil" durumu ayrı bir kontrol gerektirmez. Oluşturma,
    /// düzenleme ve geri yükleme aynı kuralı buradan okur; üç yerde üç kopya
    /// tutmak, birinin diğerinden sapmasına açık kapı bırakırdı.
    /// </remarks>
    private async Task<bool> CategoryIsUsableAsync(int categoryId, CancellationToken cancellationToken) =>
        categoryId > 0
        && await _dbContext.PoiCategories.AsNoTracking()
            .AnyAsync(c => c.Id == categoryId, cancellationToken);

    /// <summary>
    /// İstenen konum, kaydın bulunduğu yerden farklı mı
    /// (bkz. <see cref="CoordinateEpsilon"/>).
    /// </summary>
    private static bool HasMoved(Point? current, (double Longitude, double Latitude) target) =>
        current is null
        || Math.Abs(current.X - target.Longitude) > CoordinateEpsilon
        || Math.Abs(current.Y - target.Latitude) > CoordinateEpsilon;

    /// <summary>
    /// Yeni kaydın sahibi: doğrulanmış JWT'deki kullanıcı kimliği. Uçlar
    /// <c>[Authorize]</c> olduğu için normalde daima doludur; boş gelmesi
    /// yapılandırma hatasıdır ve kayıt oluşturulmaz.
    /// </summary>
    private ServiceResult<int> RequireOwnerId()
    {
        var userId = _currentUser.UserId;

        return userId is null
            ? ServiceResult<int>.Forbidden("Kimlik doğrulanamadı; POI oluşturulamaz.")
            : ServiceResult<int>.Success(userId.Value);
    }

    private async Task<IReadOnlyDictionary<int, PoiCategoryHierarchy.Node>> ReadCategoryNodesAsync(
        bool includeHidden,
        CancellationToken cancellationToken)
    {
        var query = _dbContext.PoiCategories.AsNoTracking();

        if (includeHidden)
        {
            query = query.IgnoreQueryFilters();
        }

        var nodes = await query
            .Select(c => new { c.Id, c.Name, c.ParentId })
            .ToListAsync(cancellationToken);

        return nodes.ToDictionary(
            n => n.Id,
            n => new PoiCategoryHierarchy.Node(n.Id, n.Name, n.ParentId));
    }

    private async Task<PoiResponse> ToMapResponseAsync(Poi poi, CancellationToken cancellationToken)
    {
        var categories = await ReadCategoryNodesAsync(includeHidden: false, cancellationToken);
        var authority = await _poiAuthorization.GetAuthorityAsync(cancellationToken);

        return new PoiResponse
        {
            Id = poi.Id,
            Name = poi.Name,
            CategoryId = poi.CategoryId,
            CategoryName = categories.TryGetValue(poi.CategoryId, out var category) ? category.Name : string.Empty,
            CategoryPath = PoiCategoryHierarchy.BuildPath(categories, poi.CategoryId),
            WorkHours = PoiWorkHoursValidator.Deserialize(poi.WorkHoursJson),
            Longitude = poi.Coordinate.X,
            Latitude = poi.Coordinate.Y,
            CanUpdate = authority.CanUpdate(poi.UserId),
            CanDelete = authority.CanDelete(poi.UserId)
        };
    }
}
