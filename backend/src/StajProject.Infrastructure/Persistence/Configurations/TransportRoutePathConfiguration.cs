using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using StajProject.Domain.Entities;

namespace StajProject.Infrastructure.Persistence.Configurations;

public sealed class TransportRoutePathConfiguration : IEntityTypeConfiguration<TransportRoutePath>
{
    public void Configure(EntityTypeBuilder<TransportRoutePath> builder)
    {
        builder.ToTable("transport_route_path", table =>
        {
            table.HasCheckConstraint("ck_transport_route_path_distance_nonnegative", "distance_meters >= 0");
            table.HasCheckConstraint("ck_transport_route_path_duration_nonnegative", "duration_seconds >= 0");
        });

        builder.HasKey(path => path.Id);

        builder.Property(path => path.Id).HasColumnName("id");

        builder.Property(path => path.RouteId)
            .HasColumnName("route_id")
            .IsRequired();

        builder.HasOne(path => path.Route)
            .WithOne(route => route.Path)
            .HasForeignKey<TransportRoutePath>(path => path.RouteId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(path => path.RouteId).IsUnique();

        builder.Property(path => path.Geometry)
            .HasColumnName("geometry")
            .HasColumnType("geometry(LineString,4326)")
            .IsRequired();

        builder.Property(path => path.DistanceMeters)
            .HasColumnName("distance_meters")
            .IsRequired();

        builder.Property(path => path.DurationSeconds)
            .HasColumnName("duration_seconds")
            .IsRequired();

        builder.Property(path => path.Profile)
            .HasColumnName("profile")
            .HasMaxLength(TransportRoutePath.MaxProfileLength)
            .IsRequired();

        builder.Property(path => path.GeneratedAt)
            .HasColumnName("generated_at")
            .HasColumnType("timestamp with time zone")
            .IsRequired();

        builder.Property(path => path.IsStale)
            .HasColumnName("is_stale")
            .HasDefaultValue(false)
            .IsRequired();

        builder.Property(path => path.LastFailureReason)
            .HasColumnName("last_failure_reason")
            .HasMaxLength(TransportRoutePath.MaxFailureReasonLength);

        builder.Property(path => path.ModifiedDate)
            .HasColumnName("modified_date")
            .HasColumnType("timestamp with time zone")
            .IsRequired();

        /* TransportRoute required principal'dır ve kendi normal sorgularında
           soft-delete/pasiflik filtresi taşır. Bağımlı path aynı görünürlük
           sınırını izler; IsStale ise silme durumu değildir ve filtrelenmez. */
        builder.HasQueryFilter(path =>
            path.Route != null
            && !path.Route.IsDeleted
            && path.Route.IsActive);
    }
}
