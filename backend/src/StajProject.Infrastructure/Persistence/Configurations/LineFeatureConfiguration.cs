using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using StajProject.Domain.Entities;

namespace StajProject.Infrastructure.Persistence.Configurations;

public class LineFeatureConfiguration : IEntityTypeConfiguration<LineFeature>
{
    public void Configure(EntityTypeBuilder<LineFeature> builder)
    {
        builder.ToTable("tbl_line");

        builder.HasKey(x => x.Id);

        DrawingFeatureConfiguration.ConfigureNameStyleAndAudit(builder);

        /* Soft-delete edilen VEYA pasifleştirilen kayıtlar TÜM sorgulardan
           otomatik olarak düşer: listeleme, tekil okuma, toplu işlemler ve
           spatial analiz (analiz de EF üzerinden çalıştığı için filtre oraya
           da uygulanır). Filtreyi bilerek atlamak gerektiğinde — yalnızca
           restore yolunda — IgnoreQueryFilters() kullanılır. */
        builder.HasQueryFilter(x => !x.IsDeleted && x.IsActive);

        builder.Property(x => x.Geometry)
            .IsRequired()
            .HasColumnType("geometry(LineString,4326)");

        // Kesişim analizi ST_Intersects ile sorgular; GiST bu predicate'in
        // indeksten yararlanabilmesi için gereklidir.
        builder.HasIndex(x => x.Geometry)
            .HasMethod("gist");
    }
}
