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

    /* --- Dinamik yetkilendirme ---------------------------------------------
       Yetki kataloğu ve grant tabloları. Identity'nin rol/kullanıcı tabloları
       ile aynı context'te durur: bir rolün yetkilendirilmesi ile o rolün
       kendisi tek transaction sınırı içinde kalsın diye. */

    public DbSet<Permission> Permissions => Set<Permission>();

    public DbSet<RolePermission> RolePermissions => Set<RolePermission>();

    public DbSet<UserPermission> UserPermissions => Set<UserPermission>();

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
