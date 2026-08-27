using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;

namespace StajProject.Infrastructure.Persistence;

/// <summary>
/// Tek DbContext: PostGIS çizim tabloları ve ASP.NET Core Identity şeması aynı
/// context üzerinden yönetilir. Identity için ayrı bir context açmak, tek
/// veritabanı üzerinde iki ayrı migration geçmişi ve iki ayrı transaction
/// sınırı demek olurdu; mevcut spatial yapı bölünmeden korunuyor.
/// <c>Users</c>, <c>Roles</c>, <c>UserRoles</c> gibi DbSet'ler
/// <see cref="IdentityDbContext{TUser,TRole,TKey}"/> tarafından sağlanır.
/// </summary>
public class AppDbContext : IdentityDbContext<User, IdentityRole<int>, int>
{
    public AppDbContext(DbContextOptions<AppDbContext> options)
        : base(options)
    {
    }

    public DbSet<Location> Locations => Set<Location>();

    public DbSet<PointFeature> Points => Set<PointFeature>();

    public DbSet<LineFeature> Lines => Set<LineFeature>();

    public DbSet<PolygonFeature> Polygons => Set<PolygonFeature>();

    /* --- POI ----------------------------------------------------------------
       POI, çizim tablolarından AYRI bir envanterdir: stil taşımaz, çöp kutusu
       akışına girmez ve sahibine göre gizlenmez. Aynı context'te durur çünkü
       kategori, sahiplik ve coğrafi doğrulama aynı transaction sınırını
       paylaşmalıdır. */

    public DbSet<Poi> Pois => Set<Poi>();

    public DbSet<PoiCategory> PoiCategories => Set<PoiCategory>();

    /* --- Konum analizi veri kümesi ------------------------------------------
       Dış kaynaklı (açık veri) POI'ler. Normal POI envanterinden AYRI bir
       tablodur — sahiplik, çöp kutusu ve CRUD akışlarına girmez — ama aynı
       kategori taksonomisini kullanır, bu yüzden aynı context'te durur:
       kategori FK'sı ile analiz sorgusu tek bir bağlantıyı paylaşmalıdır. */

    public DbSet<AnalysisPoi> AnalysisPois => Set<AnalysisPoi>();

    /* --- Akıllı ulaşım ------------------------------------------------------ */

    public DbSet<TransportRoute> TransportRoutes => Set<TransportRoute>();

    public DbSet<TransportStop> TransportStops => Set<TransportStop>();

    /* --- Dinamik yetkilendirme ---------------------------------------------
       Yetki kataloğu ve grant tabloları. Identity'nin rol/kullanıcı tabloları
       ile aynı context'te durur: bir rolün yetkilendirilmesi ile o rolün
       kendisi tek transaction sınırı içinde kalsın diye. */

    public DbSet<Permission> Permissions => Set<Permission>();

    public DbSet<RolePermission> RolePermissions => Set<RolePermission>();

    public DbSet<UserPermission> UserPermissions => Set<UserPermission>();

    /// <summary>Kullanıcı/rol coğrafi yetki alanları (hedef başına en fazla bir satır).</summary>
    public DbSet<GeographicAuthorization> GeographicAuthorizations => Set<GeographicAuthorization>();

    /// <summary>
    /// Aktivite geçmişi. Yalnızca durum DEĞİŞTİREN işlemler yazılır; okuma
    /// istekleri buraya girmez (bkz. <see cref="ActivityLog"/>).
    /// </summary>
    public DbSet<ActivityLog> ActivityLogs => Set<ActivityLog>();

    public override int SaveChanges()
    {
        StampAuditDates();
        return base.SaveChanges();
    }

    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        StampAuditDates();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Identity'nin kendi mapping'i ÖNCE uygulanır; projeye özgü
        // configuration'lar (tablo adları, kolon adları) sonra gelerek onu
        // ezebilsin diye sıra bu şekildedir.
        base.OnModelCreating(modelBuilder);

        modelBuilder.HasPostgresExtension("postgis");

        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
    }

    /// <summary>
    /// CreatedDate / ModifiedDate her zaman UTC olarak backend tarafından
    /// yazılır; client'tan gelen değer dikkate alınmaz.
    /// </summary>
    private void StampAuditDates()
    {
        var utcNow = DateTime.UtcNow;

        foreach (var entry in ChangeTracker.Entries<IAuditableEntity>())
        {
            if (entry.State is EntityState.Added or EntityState.Modified)
            {
                entry.Entity.ModifiedDate = utcNow;
            }
        }

        foreach (var entry in ChangeTracker.Entries<IStyledDrawingFeature>())
        {
            if (entry.State is EntityState.Added)
            {
                entry.Entity.CreatedDate = utcNow;
                entry.Entity.ModifiedDate = utcNow;
            }
            else if (entry.State is EntityState.Modified)
            {
                entry.Entity.ModifiedDate = utcNow;
                // CreatedDate ilk kayıttan sonra değiştirilemez.
                entry.Property(nameof(IStyledDrawingFeature.CreatedDate)).IsModified = false;
            }
        }
    }
}
