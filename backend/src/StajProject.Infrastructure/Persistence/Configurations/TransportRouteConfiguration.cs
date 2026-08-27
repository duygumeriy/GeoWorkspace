using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using StajProject.Domain.Entities;

namespace StajProject.Infrastructure.Persistence.Configurations;

public class TransportRouteConfiguration : IEntityTypeConfiguration<TransportRoute>
{
    public void Configure(EntityTypeBuilder<TransportRoute> builder)
    {
        builder.ToTable("transport_route", table =>
            table.HasCheckConstraint(
                "ck_transport_route_color_hex",
                "color_hex ~ '^#[0-9A-F]{6}$'"));

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id).HasColumnName("id");

        builder.Property(x => x.Name)
            .HasColumnName("name")
            .IsRequired()
            .HasMaxLength(TransportRoute.MaxNameLength);

        builder.Property(x => x.ColorHex)
            .HasColumnName("color_hex")
            .IsRequired()
            .HasMaxLength(TransportRoute.ColorHexLength);

        builder.Property(x => x.IsActive)
            .HasColumnName("is_active")
            .IsRequired()
            .HasDefaultValue(true);

        builder.Property(x => x.IsDeleted)
            .HasColumnName("is_deleted")
            .IsRequired()
            .HasDefaultValue(false);

        builder.Property(x => x.CreatedDate)
            .HasColumnName("created_date")
            .IsRequired()
            .HasColumnType("timestamp with time zone");

        builder.Property(x => x.ModifiedDate)
            .HasColumnName("modified_date")
            .IsRequired()
            .HasColumnType("timestamp with time zone");

        builder.HasQueryFilter(x => !x.IsDeleted && x.IsActive);
    }
}
