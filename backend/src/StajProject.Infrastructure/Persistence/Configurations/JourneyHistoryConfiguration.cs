using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using StajProject.Domain.Entities;

namespace StajProject.Infrastructure.Persistence.Configurations;

/// <summary>
/// Sona ermiş kişisel yolculuk kaydının eşlemesi.
/// </summary>
/// <remarks>
/// <para>
/// <b>Tekil <c>simulation_id</c> bir MİKRO-OPTİMİZASYON DEĞİL, doğruluk
/// kuralıdır.</b> Terminal geçiş kodu yeniden denenebilir, bir tick gecikebilir
/// ya da bir iptal isteği tamamlanmayla yarışabilir. Uygulama katmanı zaten tek
/// kazananı garanti eder; bu indeks, o garantinin bir gün gevşemesi hâlinde
/// aynı çalıştırmanın ikinci kez — hatta çelişkili bir durumla — kayda
/// geçmesini VERİTABANI düzeyinde imkânsız kılar.
/// </para>
/// <para>
/// <b>Canlı veriye yabancı anahtar YOKTUR.</b> <c>route_id</c> ve nokta
/// satırlarındaki <c>reference_id</c> birer tarihsel işarettir: geçmiş, işaret
/// ettiği hattın/durağın/POI'nin silinmesini engellememeli ve onlar silindikten
/// sonra da okunabilir kalmalıdır.
/// </para>
/// <para>
/// <b>Global sorgu filtresi YOKTUR.</b> Kayıt yumuşak silinmez ve sahiplik
/// süzgeci servis katmanındadır; bir filtre kurmak, sahipliği sessizce iki
/// yerde tanımlamak olurdu.
/// </para>
/// </remarks>
public class JourneyHistoryConfiguration : IEntityTypeConfiguration<JourneyHistory>
{
    public void Configure(EntityTypeBuilder<JourneyHistory> builder)
    {
        builder.ToTable("journey_history", table =>
        {
            table.HasCheckConstraint(
                "ck_journey_history_mode_supported",
                "mode IN ('routeFull', 'routeSegment', 'waypoints')");

            table.HasCheckConstraint(
                "ck_journey_history_profile_supported",
                "profile IN ('driving', 'walking', 'cycling')");

            /* YALNIZCA terminal durumlar. `Running` bilinçli olarak yoktur:
               çalışan bir yolculuk geçmiş değildir ve bu tabloda satırı olamaz. */
            table.HasCheckConstraint(
                "ck_journey_history_terminal_status_supported",
                "terminal_status IN ('Completed', 'Cancelled')");

            table.HasCheckConstraint(
                "ck_journey_history_ends_after_it_starts",
                "ended_at >= started_at");

            table.HasCheckConstraint(
                "ck_journey_history_distance_nonnegative",
                "distance_meters >= 0");

            table.HasCheckConstraint(
                "ck_journey_history_duration_nonnegative",
                "duration_seconds >= 0");

            table.HasCheckConstraint(
                "ck_journey_history_covered_distance_nonnegative",
                "covered_distance_meters >= 0");

            table.HasCheckConstraint(
                "ck_journey_history_route_id_positive",
                "route_id IS NULL OR route_id > 0");
        });

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id).HasColumnName("id");

        /* POI ve kaydedilmiş yolculuk sahipliğiyle AYNI davranış: kullanıcı
           kaydı silinmeye çalışıldığında geçmiş korunur. */
        builder.Property(x => x.UserId)
            .HasColumnName("user_id")
            .IsRequired();

        builder.HasOne(x => x.User)
            .WithMany()
            .HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Property(x => x.SimulationId)
            .HasColumnName("simulation_id")
            .IsRequired();

        /* Bir çalıştırma, bir kayıt. Mükerrer terminal geçiş denemesi burada
           durur. */
        builder.HasIndex(x => x.SimulationId).IsUnique();

        builder.Property(x => x.Mode)
            .HasColumnName("mode")
            .IsRequired()
            .HasMaxLength(JourneyHistory.MaxContractLength);

        builder.Property(x => x.Profile)
            .HasColumnName("profile")
            .IsRequired()
            .HasMaxLength(JourneyHistory.MaxContractLength);

        builder.Property(x => x.TerminalStatus)
            .HasColumnName("terminal_status")
            .IsRequired()
            .HasMaxLength(JourneyHistory.MaxContractLength);

        builder.Property(x => x.StartedAt)
            .HasColumnName("started_at")
            .IsRequired()
            .HasColumnType("timestamp with time zone");

        builder.Property(x => x.EndedAt)
            .HasColumnName("ended_at")
            .IsRequired()
            .HasColumnType("timestamp with time zone");

        builder.Property(x => x.DistanceMeters)
            .HasColumnName("distance_meters")
            .IsRequired();

        builder.Property(x => x.DurationSeconds)
            .HasColumnName("duration_seconds")
            .IsRequired();

        builder.Property(x => x.CoveredDistanceMeters)
            .HasColumnName("covered_distance_meters")
            .IsRequired();

        /* Hat kimliği bir FK DEĞİLDİR: tarihsel bir işarettir ve ortak ulaşım
           verisinin yaşam döngüsünü kısıtlamamalıdır. */
        builder.Property(x => x.RouteId)
            .HasColumnName("route_id");

        builder.Property(x => x.RouteDisplayName)
            .HasColumnName("route_display_name")
            .HasMaxLength(JourneyHistory.MaxDisplayNameLength);

        builder.Property(x => x.CreatedDate)
            .HasColumnName("created_date")
            .IsRequired()
            .HasColumnType("timestamp with time zone");

        /* Listenin okunduğu indeks: sahibin kayıtları, en son biten en üstte. */
        builder.HasIndex(x => new { x.UserId, x.EndedAt });

        builder.HasMany(x => x.Points)
            .WithOne(x => x.JourneyHistory)
            .HasForeignKey(x => x.JourneyHistoryId)
            /* CASCADE: nokta kaydın PARÇASIDIR. Kayıt gidince onunla gider. */
            .OnDelete(DeleteBehavior.Cascade);
    }
}

/// <summary>Sona ermiş yolculuğun tek, sıralı noktasının eşlemesi.</summary>
public class JourneyHistoryPointConfiguration : IEntityTypeConfiguration<JourneyHistoryPoint>
{
    public void Configure(EntityTypeBuilder<JourneyHistoryPoint> builder)
    {
        builder.ToTable("journey_history_point", table =>
        {
            table.HasCheckConstraint(
                "ck_journey_history_point_sequence_nonnegative",
                "sequence >= 0");

            table.HasCheckConstraint(
                "ck_journey_history_point_source_supported",
                "source IN ('transportStop', 'poi')");

            table.HasCheckConstraint(
                "ck_journey_history_point_reference_positive",
                "reference_id > 0");
        });

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id).HasColumnName("id");

        builder.Property(x => x.JourneyHistoryId)
            .HasColumnName("journey_history_id")
            .IsRequired();

        builder.Property(x => x.Sequence)
            .HasColumnName("sequence")
            .IsRequired();

        builder.Property(x => x.Source)
            .HasColumnName("source")
            .IsRequired()
            .HasMaxLength(JourneyHistory.MaxContractLength);

        /* Çok biçimli referans (durak ya da POI): tek kolondan iki tabloya FK
           kurulamaz — ve geçmiş zaten canlı kayıtları kilitlememelidir. */
        builder.Property(x => x.ReferenceId)
            .HasColumnName("reference_id")
            .IsRequired();

        builder.Property(x => x.DisplayName)
            .HasColumnName("display_name")
            .IsRequired()
            .HasMaxLength(JourneyHistory.MaxDisplayNameLength);

        /* Sıra KAYIT BAŞINA tekildir: aynı numarayı taşıyan iki nokta,
           "2. nokta" sorusuna iki cevap verirdi. */
        builder.HasIndex(x => new { x.JourneyHistoryId, x.Sequence }).IsUnique();
    }
}
