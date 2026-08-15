using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using StajProject.Domain.Entities;

namespace StajProject.Infrastructure.Persistence.Configurations;

public class PointFeatureConfiguration : IEntityTypeConfiguration<PointFeature>
{
    public void Configure(EntityTypeBuilder<PointFeature> builder)
    {
        builder.ToTable("tbl_point");

        builder.HasKey(x => x.Id);

        DrawingFeatureConfiguration.ConfigureNameStyleAndAudit(builder);

        /* Soft-delete edilen kayıtlar TÜM sorgulardan otomatik olarak düşer:
           listeleme, tekil okuma, toplu işlemler ve spatial analiz (analiz de
           EF üzerinden çalıştığı için filtre oraya da uygulanır). Filtreyi
           bilerek atlamak gerektiğinde — yalnızca restore yolunda —
           IgnoreQueryFilters() kullanılır. */
        builder.HasQueryFilter(x => !x.IsDeleted);

        // PointRadius yalnızca bu tabloda vardır (IPointStyledFeature).
        builder.Property(x => x.PointRadius);

        builder.Property(x => x.Geometry)
            .IsRequired()
            .HasColumnType("geometry(Point,4326)");

        // Kesişim analizi ST_Intersects ile sorgular; GiST bu predicate'in
        // indeksten yararlanabilmesi için gereklidir.
        builder.HasIndex(x => x.Geometry)
            .HasMethod("gist");
    }
}
