using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using StajProject.Domain.Entities;

namespace StajProject.Infrastructure.Persistence.Configurations;

/// <summary>
/// POI kategori tablosu. Adlandırma projenin kendi sözleşmesini sürdürür:
/// küçük harfli tablo adı, snake_case kolonlar.
/// </summary>
public class PoiCategoryConfiguration : IEntityTypeConfiguration<PoiCategory>
{
    public void Configure(EntityTypeBuilder<PoiCategory> builder)
    {
        builder.ToTable("poi_category");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("id");

        builder.Property(x => x.Name)
            .HasColumnName("name")
            .IsRequired()
            .HasMaxLength(PoiCategory.MaxNameLength);

        builder.Property(x => x.ParentId)
            .HasColumnName("parent_id");

        /* Self-reference. Restrict bilinçlidir: cascade olsaydı tek bir üst
           kategorinin silinmesi tüm alt ağacı sessizce yok ederdi. Kategoriler
           zaten soft-delete edilir, hard delete normal işleyişin parçası
           değildir. */
        builder
            .HasOne(x => x.Parent)
            .WithMany(x => x.Children)
            .HasForeignKey(x => x.ParentId)
            .OnDelete(DeleteBehavior.Restrict);

        // Bir üstün alt kategorilerini getiren sorgu (ağaç kurulumu) için.
        builder.HasIndex(x => x.ParentId);

        builder.Property(x => x.CreatedDate)
            .HasColumnName("created_date")
            .IsRequired()
            .HasColumnType("timestamp with time zone");

        builder.Property(x => x.ModifiedDate)
            .HasColumnName("modified_date")
            .IsRequired()
            .HasColumnType("timestamp with time zone");

        builder.Property(x => x.IsActive)
            .HasColumnName("is_active")
            .IsRequired()
            .HasDefaultValue(true);

        builder.Property(x => x.IsDeleted)
            .HasColumnName("is_deleted")
            .IsRequired()
            .HasDefaultValue(false);

        /* Çizim tablolarıyla AYNI soft-delete sözleşmesi: silinen veya
           pasifleştirilen kategori tüm sorgulardan düşer. Filtreyi bilerek
           atlamak gerektiğinde IgnoreQueryFilters() kullanılır.

           DİKKAT (servis fazı): filtre navigation include'larına da uygulanır,
           dolayısıyla soft-delete edilmiş bir ÜST kategorinin altları ağaçta
           erişilemez görünür. Ağaç, Include yerine düz bir listeden kurulmalıdır. */
        builder.HasQueryFilter(x => !x.IsDeleted && x.IsActive);
    }
}
