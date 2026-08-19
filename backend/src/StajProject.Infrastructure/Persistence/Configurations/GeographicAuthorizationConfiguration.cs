using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using StajProject.Domain.Entities;

namespace StajProject.Infrastructure.Persistence.Configurations;

/// <summary>
/// Coğrafi yetki alanı tablosu. Adlandırma projenin kendi sözleşmesini
/// sürdürür: küçük harfli tablo adı, snake_case kolonlar.
/// </summary>
public class GeographicAuthorizationConfiguration : IEntityTypeConfiguration<GeographicAuthorization>
{
    /// <summary>Hedefin tekliğini zorlayan CHECK kısıtının adı.</summary>
    public const string SingleTargetConstraint = "ck_geographic_authorizations_single_target";

    public void Configure(EntityTypeBuilder<GeographicAuthorization> builder)
    {
        builder.ToTable("geographic_authorizations", table =>
            /* Hedef XOR kuralı son çare olarak VERİTABANINDA durur. Servis
               katmanı da doğrular, ama uygulama doğrulaması yalnızca kendi kod
               yolunu bağlar; kısıt, elle atılan bir INSERT'ü de bağlar. */
            table.HasCheckConstraint(
                SingleTargetConstraint,
                "(user_id IS NOT NULL AND role_id IS NULL) OR (user_id IS NULL AND role_id IS NOT NULL)"));

        builder.HasKey(x => x.Id);

        builder.Property(x => x.UserId).HasColumnName("user_id");
        builder.Property(x => x.RoleId).HasColumnName("role_id");

        builder.Property(x => x.Area)
            .HasColumnName("area")
            .IsRequired()
            /* Yetkilendirmenin kaynağı PostGIS geometry'sidir. WKT/GeoJSON
               yalnızca API sözleşmesinde görünür; metin olarak saklamak
               ST_Covers'ı ve mekânsal indeksi imkânsız kılardı. */
            .HasColumnType("geometry(Polygon,4326)");

        builder.Property(x => x.CreatedDate)
            .HasColumnName("created_date")
            .IsRequired()
            .HasColumnType("timestamp with time zone");

        builder.Property(x => x.ModifiedDate)
            .HasColumnName("modified_date")
            .IsRequired()
            .HasColumnType("timestamp with time zone");

        /* Hedef başına EN FAZLA BİR satır. Kısmi (filtered) unique index
           kullanılır çünkü kolonlardan biri her satırda NULL'dur ve PostgreSQL
           NULL'ları benzersizlik açısından birbirinden farklı sayar — filtresiz
           bir unique index rol satırlarının hepsini "user_id = NULL" ile
           çakıştırmaz, dolayısıyla hiçbir şey garanti etmezdi. */
        builder.HasIndex(x => x.UserId)
            .IsUnique()
            .HasFilter("user_id IS NOT NULL");

        builder.HasIndex(x => x.RoleId)
            .IsUnique()
            .HasFilter("role_id IS NOT NULL");

        // Kapsam çözümü ve olası mekânsal sorgular için; çizim tablolarındaki
        // GiST kullanımının aynısı.
        builder.HasIndex(x => x.Area)
            .HasMethod("gist");

        /* Kullanıcı satırı gerçekten silinirse alanı da gider (Cascade) —
           user_permissions ile aynı davranış. Projede kullanıcılar soft delete
           edildiği için bu yol normal işleyişte hiç çalışmaz; yine de yetim
           satır bırakmamak için tanımlıdır. Soft delete edilen bir kullanıcının
           alanı KORUNUR: hesap yeniden açılırsa kısıtı da geri gelir. */
        builder.HasOne(x => x.User)
            .WithMany()
            .HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        /* Rol silinirse alanı da gider (Cascade) — role_permissions ile aynı.
           Yalnızca özel roller silinebilir; korunan roller RoleCatalog
           tarafından zaten engellenir. */
        builder.HasOne(x => x.Role)
            .WithMany()
            .HasForeignKey(x => x.RoleId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
