using Microsoft.EntityFrameworkCore;
using StajProject.Domain.Common;

namespace StajProject.Infrastructure.Persistence;

/// <summary>
/// Çizim tablolarının okuma kapsamı. Tek bir sahiplik yüklemi burada tanımlanır
/// ve kullanıcıya veri gösteren her yol onu kullanır.
/// <para>
/// Proje kuralı tektir: <b>her kullanıcı yalnızca kendi çizimlerine erişir</b> —
/// görüntüleme, düzenleme, silme ve <b>analiz</b> dahil. Harita, "Çizimlerim" ve
/// envanter/kesişim analizi bu yüzden aynı veri kümesine bakar.
/// </para>
/// <para>
/// <b>Önceki davranış ve neden değişti.</b> Analiz bir dönem sahiplikten bağımsız
/// "paylaşılan envanter" kümesini sayıyordu. Bu, ekranda 1 çizgi ve 1 poligonu
/// olan bir kullanıcıya "2 çizgi, 3 poligon" gibi bir sonuç gösteriyordu:
/// sayıların karşılığı haritada yoktu ve fark başka kullanıcıların kayıtlarından
/// geliyordu. Sayı da bir bilgidir — kullanıcı, başkalarının kaç kaydının o
/// alana değdiğini öğrenmemelidir. Kapsam artık görünürlükle aynı sınırdadır.
/// </para>
/// </summary>
public static class DrawingScopes
{
    /// <summary>
    /// Sahiplik yüklemi. Projedeki <b>tek</b> tanımı budur; kopyalanmaz.
    /// </summary>
    /// <remarks>
    /// Filtre role bakmaz — Admin de bu kapsamda yalnızca kendi kayıtlarını görür
    /// ve yalnızca kendi envanterini analiz eder; yönetim yetkisi mutation
    /// tarafında (<c>DrawingAuthorization</c>) korunur, görünürlükte değil.
    /// Predicate LINQ üzerinden SQL'e iner; tablo belleğe çekilip sonra
    /// süzülmez. Silinmiş/pasif kayıtları global query filter
    /// (<c>!IsDeleted &amp;&amp; IsActive</c>) düşürdüğü için burada tekrarlanmaz.
    /// </remarks>
    public static IQueryable<TEntity> OwnedBy<TEntity>(this IQueryable<TEntity> query, int userId)
        where TEntity : class, IStyledDrawingFeature =>
        query.Where(entity =>
            EF.Property<int>(entity, nameof(IStyledDrawingFeature.CreatedByUserId)) == userId);

    /// <summary>
    /// Harita + "Çizimlerim" veri kümesi: yalnızca çağıran kullanıcının çizimleri.
    /// </summary>
    public static IQueryable<TEntity> UserMapScope<TEntity>(this IQueryable<TEntity> query, int currentUserId)
        where TEntity : class, IStyledDrawingFeature => query.OwnedBy(currentUserId);

    /// <summary>
    /// Envanter analizi veri kümesi: çağıran kullanıcının kendi envanteri.
    /// </summary>
    /// <remarks>
    /// <see cref="UserMapScope"/> ile <b>aynı</b> kümedir ve ayrı bir isim taşıması
    /// niyeti okunur kılmak içindir: analiz sorgusunun sahiplik filtresi taşıdığı
    /// çağrı yerinde görünür. Parametre zorunludur — kimliksiz çağrı derlenmez,
    /// böylece kapsam "unutularak" tüm tabloya genişleyemez.
    /// </remarks>
    public static IQueryable<TEntity> InventoryScope<TEntity>(this IQueryable<TEntity> query, int currentUserId)
        where TEntity : class, IStyledDrawingFeature => query.OwnedBy(currentUserId);

    /// <summary>
    /// Çöp Kutusu veri kümesi: çağıran kullanıcının <b>silinmiş</b> çizimleri.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Çağıranın sorguya <c>IgnoreQueryFilters()</c> eklemesi ZORUNLUDUR — global
    /// query filter (<c>!IsDeleted &amp;&amp; IsActive</c>) aksi hâlde aranan
    /// kayıtların tamamını daha en baştan düşürür ve liste her zaman boş döner.
    /// </para>
    /// <para>
    /// Filtre atlandığı için sahiplik yüklemi burada <b>açıkça</b> tekrar
    /// uygulanır: silinmiş kayıtlar üzerinde çalışan tek yol budur ve
    /// <see cref="OwnedBy"/> ile aynı tanımı kullanır, böylece bir kullanıcı
    /// başkasının sildiği çizimi göremez. Kapsam role bakmaz —
    /// <see cref="UserMapScope"/> ile aynı sınırdadır, Admin de yalnızca kendi
    /// çöp kutusunu görür.
    /// </para>
    /// </remarks>
    public static IQueryable<TEntity> DeletedScope<TEntity>(this IQueryable<TEntity> query, int currentUserId)
        where TEntity : class, IStyledDrawingFeature =>
        query
            .Where(entity => EF.Property<bool>(entity, nameof(IStyledDrawingFeature.IsDeleted)))
            .OwnedBy(currentUserId);
}
