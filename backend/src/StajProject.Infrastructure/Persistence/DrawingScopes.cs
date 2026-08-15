using Microsoft.EntityFrameworkCore;
using StajProject.Domain.Common;

namespace StajProject.Infrastructure.Persistence;

/// <summary>
/// Çizim tablolarının <b>iki ayrı okuma kapsamı</b>. Bu dosyanın tek amacı bu
/// ayrımı isimlendirmek ve tek bir yerde tutmaktır.
/// <para>
/// AUTH-4 ile harita ve "Çizimlerim" yalnızca çağıran kullanıcının kayıtlarını
/// göstermeye başladı. Bu doğru davranıştır ve korunur. Ancak envanter/kesişim
/// analizi <b>aynı sorguyu kullanmaz</b>: analiz, ödevin baştan beri tanımladığı
/// paylaşılan envanter kümesi üzerinde çalışır. İki kavram şudur:
/// </para>
/// <list type="table">
/// <item>
///   <term><see cref="UserMapScope"/></term>
///   <description>Harita + Çizimlerim. <c>inserted_user_id == currentUserId</c>,
///   silinmemiş ve aktif. Kullanıcıya <b>satır</b> döndüren her yol bunu kullanır.</description>
/// </item>
/// <item>
///   <term><see cref="InventoryScope"/></term>
///   <description>Mekânsal analiz. Sahiplikten <b>bağımsız</b>, silinmemiş ve
///   aktif paylaşılan envanter kümesi. Yalnızca <b>toplam/sayı</b> üretir;
///   hiçbir çağrı yolu buradan client'a ham çizim satırı döndürmez.</description>
/// </item>
/// </list>
/// <para>
/// <b>Neden ayrı bir uzantı metodu?</b> Bugün <see cref="InventoryScope"/> ek bir
/// predicate eklemez — silinmiş/pasif kayıtları zaten global query filter düşürür.
/// Ayrım bu hâliyle bile gerçektir, ama <i>isimsiz</i> olduğu sürece kazayla
/// bozulabilir: ownership filtresi ileride global query filter'a taşınırsa analiz
/// sessizce kullanıcı bazlı hâle gelir ve önceki ödevin anlamı kaybolurdu. Kapsam
/// burada adlandırıldığı için hangi sorgunun hangi veri kümesine baktığı okunur,
/// aranabilir ve test edilebilir durumdadır (bkz.
/// <c>InventoryAnalysisScopeTests</c>).
/// </para>
/// </summary>
public static class DrawingScopes
{
    /// <summary>
    /// Harita veri kümesi: yalnızca verilen kullanıcının kendi çizimleri.
    /// </summary>
    /// <remarks>
    /// Filtre role bakmaz — Admin de bu kapsamda yalnızca kendi kayıtlarını görür;
    /// yönetim yetkisi mutation tarafında (<c>DrawingAuthorization</c>) korunur,
    /// görünürlükte değil. Predicate LINQ üzerinden SQL'e iner; tablo belleğe
    /// çekilip sonra süzülmez.
    /// </remarks>
    public static IQueryable<TEntity> UserMapScope<TEntity>(this IQueryable<TEntity> query, int currentUserId)
        where TEntity : class, IStyledDrawingFeature =>
        query.Where(entity =>
            EF.Property<int>(entity, nameof(IStyledDrawingFeature.CreatedByUserId)) == currentUserId);

    /// <summary>
    /// Envanter analizi veri kümesi: sahiplikten bağımsız paylaşılan envanter.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Bilinçli olarak <see cref="UserMapScope"/> uygulanmaz. Kesişim analizi
    /// "bu alan kaç envanter kaydına değiyor" sorusunu yanıtlar; cevabın yalnızca
    /// çağıranın kendi çizimlerini sayması ödevin önceki davranışını bozardı.
    /// </para>
    /// <para>
    /// Silinmiş ve pasif kayıtlar burada da düşer: bunu entity configuration'daki
    /// global query filter (<c>!IsDeleted &amp;&amp; IsActive</c>) sağlar, bu yüzden
    /// burada tekrar edilmez.
    /// </para>
    /// <para>
    /// <b>Güvenlik sınırı:</b> bu kapsam yalnızca <c>Count</c> gibi toplam üreten
    /// ifadelerle kullanılır. Buradan dönen <c>IQueryable</c> asla
    /// <c>DrawingResponse</c>'a çevrilip client'a verilmez — aksi hâlde kullanıcı
    /// başkalarının çizim listesini görürdü.
    /// </para>
    /// </remarks>
    public static IQueryable<TEntity> InventoryScope<TEntity>(this IQueryable<TEntity> query)
        where TEntity : class, IStyledDrawingFeature => query;
}
