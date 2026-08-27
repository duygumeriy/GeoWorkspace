using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using StajProject.Domain.Entities;

namespace StajProject.Infrastructure.Persistence.Configurations;

public class TransportStopConfiguration : IEntityTypeConfiguration<TransportStop>
{
    public void Configure(EntityTypeBuilder<TransportStop> builder)
    {
        builder.ToTable("transport_stop", table =>
            table.HasCheckConstraint(
                "ck_transport_stop_sequence_order_positive",
                "sequence_order > 0"));

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id).HasColumnName("id");

        builder.Property(x => x.RouteId)
            .HasColumnName("route_id")
            .IsRequired();

        builder.HasOne(x => x.Route)
            .WithMany(x => x.Stops)
            .HasForeignKey(x => x.RouteId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(x => x.RouteId);
        builder.HasIndex(x => new { x.RouteId, x.SequenceOrder });

        /* POI sahipliğiyle aynı ad ve silme davranışı. Kolon nullable'dır:
           migration öncesi duraklara keyfî bir kullanıcı atamak yerine onları
           geçerli, sahipsiz ortak ulaşım verisi olarak korur. */
        builder.Property(x => x.UserId)
            .HasColumnName("user_id");

        builder.HasOne(x => x.User)
            .WithMany()
            .HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(x => x.UserId);

        builder.Property(x => x.Name)
            .HasColumnName("name")
            .IsRequired()
            .HasMaxLength(TransportStop.MaxNameLength);

        builder.Property(x => x.Coordinate)
            .HasColumnName("coordinate")
            .IsRequired()
            .HasColumnType("geometry(Point,4326)");

        builder.HasIndex(x => x.Coordinate).HasMethod("gist");

        builder.Property(x => x.SequenceOrder)
            .HasColumnName("sequence_order")
            .IsRequired();

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
