using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using StajProject.Domain.Entities;

namespace StajProject.Infrastructure.Persistence.Configurations;

public sealed class TransportRoutePathStepConfiguration : IEntityTypeConfiguration<TransportRoutePathStep>
{
    public void Configure(EntityTypeBuilder<TransportRoutePathStep> builder)
    {
        builder.ToTable("transport_route_path_step", table =>
        {
            table.HasCheckConstraint("ck_transport_route_path_step_sequence_nonnegative", "sequence >= 0");
            table.HasCheckConstraint("ck_transport_route_path_step_distance_nonnegative", "distance_meters >= 0");
            table.HasCheckConstraint("ck_transport_route_path_step_duration_nonnegative", "duration_seconds >= 0");

            /* Sınırlar GERİYE GİDEMEZ. Bitişi başlangıcından küçük bir adım,
               "araç şu anda hangi manevrada" sorusunu cevaplanamaz kılardı. */
            table.HasCheckConstraint(
                "ck_transport_route_path_step_bounds_ordered",
                "end_distance_meters >= start_distance_meters");
        });

        builder.HasKey(step => step.Id);

        builder.Property(step => step.Id).HasColumnName("id");

        builder.Property(step => step.PathId)
            .HasColumnName("path_id")
            .IsRequired();

        /* CASCADE bilinçlidir ve yoldaki RESTRICT ile çelişmez: yol rotanın
           türetilmiş verisidir ve korunur, adım ise YOLUN türetilmiş
           verisidir. Yol silinip adımları kalsaydı, hiçbir geometriye ait
           olmayan manevralar birikirdi. */
        builder.HasOne(step => step.Path)
            .WithMany(path => path.Steps)
            .HasForeignKey(step => step.PathId)
            .OnDelete(DeleteBehavior.Cascade);

        /* Sıra YOL BAŞINA tekildir: aynı numarayı taşıyan iki adım, çözümlemeyi
           belirsiz kılar ve "3 numaralı adım" sorusunun iki cevabı olurdu. */
        builder.HasIndex(step => new { step.PathId, step.Sequence }).IsUnique();

        builder.Property(step => step.Sequence)
            .HasColumnName("sequence")
            .IsRequired();

        builder.Property(step => step.ManeuverType)
            .HasColumnName("maneuver_type")
            .HasMaxLength(TransportRoutePathStep.MaxManeuverTypeLength)
            .IsRequired();

        builder.Property(step => step.ManeuverModifier)
            .HasColumnName("maneuver_modifier")
            .HasMaxLength(TransportRoutePathStep.MaxManeuverModifierLength);

        builder.Property(step => step.Name)
            .HasColumnName("name")
            .HasMaxLength(TransportRoutePathStep.MaxNameLength);

        builder.Property(step => step.DistanceMeters)
            .HasColumnName("distance_meters")
            .IsRequired();

        builder.Property(step => step.DurationSeconds)
            .HasColumnName("duration_seconds")
            .IsRequired();

        builder.Property(step => step.StartDistanceMeters)
            .HasColumnName("start_distance_meters")
            .IsRequired();

        builder.Property(step => step.EndDistanceMeters)
            .HasColumnName("end_distance_meters")
            .IsRequired();

        /* Adım, yolun görünürlük sınırını AYNEN izler: yol filtrelenmişse
           adımları da görünmez. İkinci bir görünürlük tanımı yazılmaz. */
        builder.HasQueryFilter(step =>
            step.Path != null
            && step.Path.Route != null
            && !step.Path.Route.IsDeleted
            && step.Path.Route.IsActive);
    }
}
