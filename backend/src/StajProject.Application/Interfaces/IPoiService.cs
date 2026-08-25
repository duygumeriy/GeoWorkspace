using StajProject.Application.Common;
using StajProject.Application.DTOs;

namespace StajProject.Application.Interfaces;

/// <summary>
/// POI kayıtlarının okunması ve oluşturulması.
/// </summary>
/// <remarks>
/// <para>
/// <b>Yetki kararı burada verilmez.</b> <c>poi.view</c> / <c>poi.create</c> /
/// <c>poi.manage</c> denetimi API katmanının işidir; bu servis "çağıran bunu
/// yapabilir mi" sorusunu değil, "veri nedir" sorusunu yanıtlar. Tek istisna
/// coğrafi sınırdır: o, kaydın NEREYE yazılabileceğine dair bir iş kuralıdır
/// ve kayıt açılmadan önce burada uygulanır.
/// </para>
/// <para>
/// <b>Okuma sahibe göre KISITLANMAZ.</b> Çizimlerin aksine POI ortak bir
/// envanterdir: <c>poi.view</c> taşıyan herkes tüm aktif POI'leri görür.
/// </para>
/// </remarks>
public interface IPoiService
{
    /// <summary>
    /// Haritanın gördüğü POI listesi: aktif, silinmemiş, oluşturan bilgisi
    /// olmadan. Coğrafi filtre UYGULANMAZ — sınır yalnızca oluşturmayı
    /// kısıtlar.
    /// </summary>
    Task<IReadOnlyList<PoiResponse>> GetMapPoisAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Kayıtlı POI'ler arasında ada göre arama.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Görünürlük <see cref="GetMapPoisAsync"/> ile AYNIDIR: sahiplik ve
    /// coğrafi kapsam yüklemi yoktur. Aksi hâlde haritada görünen bir POI
    /// aramada bulunamaz olurdu.
    /// </para>
    /// <para>
    /// Sınırlar <c>PoiSearchContract</c>'tadır; geçersiz sorgu/limit bir
    /// doğrulama hatası döndürür.
    /// </para>
    /// </remarks>
    Task<ServiceResult<IReadOnlyList<PoiSearchResult>>> SearchPoisAsync(
        string? query,
        int? limit,
        CancellationToken cancellationToken = default);


    /// <summary>
    /// Yeni POI oluşturur. Sahiplik doğrulanmış kimlikten gelir; istek
    /// gövdesindeki hiçbir alan sahipliği, tarihleri veya durum bayraklarını
    /// etkileyemez.
    /// </summary>
    Task<ServiceResult<PoiResponse>> CreatePoiAsync(
        CreatePoiRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Çağıranın KENDİ aktif POI'leri ("POI'lerim").
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Kapsam SUNUCUDA daraltılır.</b> Harita listesi ortak envanterdir ve
    /// sahibi taşımaz; "benimkiler" sorusunu istemcinin o listeden süzerek
    /// yanıtlaması, ancak sahibin kimliğini haritaya göndermekle mümkün
    /// olurdu — yani herkesin gördüğü sözleşmeye kim-ne-ekledi bilgisini
    /// koymakla. Sorgu bu yüzden burada <c>UserId == currentUserId</c>
    /// yüklemini taşır.
    /// </para>
    /// <para>
    /// Yanıt gövdesi harita sözleşmesinin AYNISIDIR (<see cref="PoiResponse"/>):
    /// sahiplik zaten sorgunun kendisindedir, ayrıca alan olarak taşınmasına
    /// gerek yoktur.
    /// </para>
    /// </remarks>
    Task<IReadOnlyList<PoiResponse>> GetOwnPoisAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Var olan bir POI'nin adını, kategorisini, mesai saatlerini ve —
    /// istenirse — KONUMUNU günceller.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Yetki + SAHİPLİK burada uygulanır.</b> Bu, servisin "yetki kararı
    /// vermez" kuralının bilinçli istisnasıdır ve coğrafi sınırla aynı
    /// gerekçeye dayanır: kural kayda BAĞLIDIR (kaydın sahibi kim), dolayısıyla
    /// statik bir endpoint attribute'u onu ifade edemez. İzin ölçütü
    /// <c>poi.manage</c> VEYA (sahiplik VE <c>poi.update</c>)'tir.
    /// </para>
    /// <para>
    /// <c>UserId</c> ve <c>CreatedDate</c> KORUNUR; <c>ModifiedDate</c> mevcut
    /// denetim düzeni (AppDbContext.SaveChanges) tarafından damgalanır.
    /// </para>
    /// <para>
    /// <b>Konum opsiyoneldir ve taşımak YAZMAKTIR.</b> Koordinat gönderilmezse
    /// kayıt yerinde kalır; gönderilirse EPSG:4326 sınırlarından ve
    /// oluşturmayla AYNI coğrafi yetki denetiminden geçer. Yetki, coğrafi
    /// sınırın yerine geçmez: <c>poi.manage</c> taşıyan bir çağıran başkasının
    /// kaydını düzenleyebilir ama yine yalnızca kendi alanına taşıyabilir.
    /// Reddedilen bir taşımada HİÇBİR alan yazılmaz.
    /// </para>
    /// </remarks>
    Task<ServiceResult<PoiResponse>> UpdatePoiAsync(
        int id,
        UpdatePoiRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// POI'yi çöp kutusuna gönderir: <c>IsDeleted = true</c>,
    /// <c>IsActive = false</c>. Satır TABLODAN SİLİNMEZ.
    /// </summary>
    /// <remarks>
    /// İzin ölçütü <c>poi.manage</c> VEYA (sahiplik VE <c>poi.delete</c>).
    /// </remarks>
    Task<ServiceResult<int>> DeletePoiAsync(int id, CancellationToken cancellationToken = default);

    /// <summary>
    /// Silinmiş bir POI'yi geri açar: <c>IsDeleted = false</c>,
    /// <c>IsActive = true</c>.
    /// </summary>
    /// <remarks>
    /// Silmeyle AYNI yetkiyi ister. Kaydın kategorisi bu arada kullanımdan
    /// kalkmışsa geri yükleme GÜVENLİ biçimde başarısız olur — POI sessizce
    /// başka bir kategoriye taşınmaz.
    /// </remarks>
    Task<ServiceResult<PoiResponse>> RestorePoiAsync(int id, CancellationToken cancellationToken = default);

    /// <summary>
    /// Çöp Kutusu listesi: çağıranın geri yükleyebileceği silinmiş POI'ler.
    /// </summary>
    /// <remarks>
    /// Kapsam yeteneğe göre daralır — <c>poi.manage</c> herkesin kaydını,
    /// <c>poi.delete</c> yalnızca kendi kayıtlarını görür. Hiçbiri yoksa liste
    /// boştur: geri yükleyemeyeceği kayıtları listelemek, kullanıcıya
    /// dokunamayacağı bir envanteri göstermek olurdu.
    /// </remarks>
    Task<IReadOnlyList<DeletedPoiResponse>> GetDeletedPoisAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Yönetim listesi: pasif ve soft-delete edilmiş kayıtlar DÂHİL, oluşturan
    /// bilgisiyle birlikte.
    /// </summary>
    Task<IReadOnlyList<AdminPoiResponse>> GetAdminPoisAsync(CancellationToken cancellationToken = default);
}
