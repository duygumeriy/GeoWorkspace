using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;

namespace StajProject.Infrastructure.Persistence.Configurations;

/* Dinamik yetkilendirmenin üç tablosu. Tablo ve kolon adları projenin kendi
   sözleşmesini sürdürür: küçük harfli tablo adları (users, roles, user_roles)
   ve snake_case kolonlar. Identity'nin PascalCase kolonları bu tabloları
   ilgilendirmez — bunlar Identity tablosu değil, projeye ait tablolardır. */

/// <summary>
/// Yetki tanım kataloğu. Satırlar seed ile gelir; kullanıcı verisi değildir.
/// </summary>
public class PermissionConfiguration : IEntityTypeConfiguration<Permission>
{
    public void Configure(EntityTypeBuilder<Permission> builder)
    {
        builder.ToTable("permissions");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Code)
            .HasColumnName("code")
            .IsRequired()
            .HasMaxLength(PermissionCodes.MaxLength);

        /* Yetkilendirmenin tek kimliği koddur; benzersizlik veritabanı
           seviyesinde zorlanır. Uygulama katmanındaki bir kontrol, eşzamanlı
           iki seed çalışmasında (ya da elle atılan bir INSERT'te) çift satır
           oluşmasını engelleyemezdi. */
        builder.HasIndex(x => x.Code)
            .IsUnique();

        builder.Property(x => x.Name)
            .HasColumnName("name")
            .IsRequired()
            .HasMaxLength(200);

        builder.Property(x => x.Description)
            .HasColumnName("description")
            .HasMaxLength(500);

        builder.Property(x => x.Category)
            .HasColumnName("category")
            .IsRequired()
            .HasMaxLength(PermissionCategories.MaxLength);

        builder.Property(x => x.IsActive)
            .HasColumnName("is_active")
            .IsRequired()
            .HasDefaultValue(true);

        builder.Property(x => x.SortOrder)
            .HasColumnName("sort_order")
            .IsRequired()
            .HasDefaultValue(0);

        // Yetki yönetimi ekranı kataloğu kategoriye göre gruplayarak okur.
        builder.HasIndex(x => x.Category);
    }
}

/// <summary>
/// Rol → yetki bağı. Kullanıcı yetkilerinin ana kaynağı.
/// </summary>
public class RolePermissionConfiguration : IEntityTypeConfiguration<RolePermission>
{
    public void Configure(EntityTypeBuilder<RolePermission> builder)
    {
        builder.ToTable("role_permissions");

        /* Bileşik birincil anahtar aynı anda benzersizlik kısıtıdır: bir yetki
           bir role iki kez verilemez. Ayrı bir Id kolonu + unique index
           eklemek, aynı garantiyi iki nesneyle sağlamak olurdu. */
        builder.HasKey(x => new { x.RoleId, x.PermissionId });

        builder.Property(x => x.RoleId)
            .HasColumnName("role_id");

        builder.Property(x => x.PermissionId)
            .HasColumnName("permission_id");

        /* Rol silinirse bağları da gider (Cascade). Identity'nin kendi
           tabloları (role_claims, user_roles) rol silmede zaten aynı şekilde
           davranır; farklı davranmak, rol silindikten sonra hiçbir role ait
           olmayan yetim satırlar bırakırdı. */
        builder.HasOne(x => x.Role)
            .WithMany()
            .HasForeignKey(x => x.RoleId)
            .OnDelete(DeleteBehavior.Cascade);

        /* Yetki tanımı silinirse HATA verilir (Restrict). Katalog satırı bir
           sistem tanımıdır ve normal işleyişte silinmez; Cascade olsaydı tek
           bir katalog satırının kaldırılması, o yetkiye sahip her rolün
           yetkisini sessizce düşürürdü. Kullanımdan kaldırma yolu silme değil,
           permissions.is_active = false'tur. */
        builder.HasOne(x => x.Permission)
            .WithMany()
            .HasForeignKey(x => x.PermissionId)
            .OnDelete(DeleteBehavior.Restrict);

        // "Bu yetki hangi rollerde?" sorgusu için; bileşik PK'nın soldan
        // indekslemesi PermissionId'yi tek başına kapsamaz.
        builder.HasIndex(x => x.PermissionId);
    }
}

/// <summary>
/// Kullanıcıya doğrudan verilmiş EK yetki. Rolden gelenleri geri almaz.
/// </summary>
public class UserPermissionConfiguration : IEntityTypeConfiguration<UserPermission>
{
    public void Configure(EntityTypeBuilder<UserPermission> builder)
    {
        builder.ToTable("user_permissions");

        builder.HasKey(x => new { x.UserId, x.PermissionId });

        builder.Property(x => x.UserId)
            .HasColumnName("user_id");

        builder.Property(x => x.PermissionId)
            .HasColumnName("permission_id");

        /* Kullanıcı satırı gerçekten silinirse kişisel yetkileri de gider
           (Cascade) — Identity'nin user_claims/user_roles davranışıyla aynı.
           Projede kullanıcılar soft delete edildiği için bu yol normal
           işleyişte hiç çalışmaz; yine de yetim satır bırakmamak için tanımlıdır. */
        builder.HasOne(x => x.User)
            .WithMany()
            .HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Katalog satırı korunur; gerekçe RolePermission ile aynıdır.
        builder.HasOne(x => x.Permission)
            .WithMany()
            .HasForeignKey(x => x.PermissionId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(x => x.PermissionId);
    }
}
