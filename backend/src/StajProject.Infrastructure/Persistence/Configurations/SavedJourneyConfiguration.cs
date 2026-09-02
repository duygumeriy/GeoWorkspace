using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using StajProject.Domain.Entities;

namespace StajProject.Infrastructure.Persistence.Configurations;

/// <summary>
/// Kaydedilmiş kişisel yolculuk tanımının eşlemesi.
/// </summary>
/// <remarks>
/// <para>
/// <b>Global sorgu filtresi YOKTUR.</b> Kayıt yumuşak silinmez; sahiplik
/// süzgeci servis katmanındadır ve her okuma/yazma <c>UserId</c> ile
/// sınırlanır. Bir filtre kurmak, sahipliği sessizce iki yerde tanımlamak
/// olurdu.
/// </para>
/// <para>
/// <b>Kip/profil metinleri CHECK ile kapatılır.</b> Uygulama zaten
/// <c>JourneyContractNames</c> ile ayrıştırır; kısıt, tabloya doğrudan yazan
/// bir yolun (göç, betik) sözleşme dışı bir değer bırakmasını engeller.
/// </para>
/// </remarks>
public class SavedJourneyConfiguration : IEntityTypeConfiguration<SavedJourney>
{
    public void Configure(EntityTypeBuilder<SavedJourney> builder)
    {
        builder.ToTable("saved_journey", table =>
        {
            table.HasCheckConstraint(
                "ck_saved_journey_name_not_blank",
                "length(btrim(name)) > 0");

            table.HasCheckConstraint(
                "ck_saved_journey_mode_supported",
                "mode IN ('routeFull', 'routeSegment', 'waypoints')");

            table.HasCheckConstraint(
                "ck_saved_journey_profile_supported",
                "profile IN ('driving', 'walking', 'cycling')");

            /* Hat kimliği KİPE bağlıdır: rota tabanlı kipler onsuz anlamsızdır,
               serbest kip ise bir hatta ait değildir. İkisini de kabul eden bir
               kolon, hangi kipin geçerli olduğunu belirsiz bırakırdı. */
            table.HasCheckConstraint(
                "ck_saved_journey_route_matches_mode",
                "(mode = 'waypoints' AND route_id IS NULL) OR (mode <> 'waypoints' AND route_id IS NOT NULL)");

            table.HasCheckConstraint(
                "ck_saved_journey_route_id_positive",
                "route_id IS NULL OR route_id > 0");
        });

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id).HasColumnName("id");

        /* POI sahipliğiyle AYNI ad ve silme davranışı: kullanıcı kaydı
           silinmeye çalışıldığında yolculuk korunur. */
        builder.Property(x => x.UserId)
            .HasColumnName("user_id")
            .IsRequired();

        builder.HasOne(x => x.User)
            .WithMany()
            .HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Property(x => x.Name)
            .HasColumnName("name")
            .IsRequired()
            .HasMaxLength(SavedJourney.MaxNameLength);

        builder.Property(x => x.Mode)
            .HasColumnName("mode")
            .IsRequired()
            .HasMaxLength(SavedJourney.MaxContractLength);

        builder.Property(x => x.Profile)
            .HasColumnName("profile")
            .IsRequired()
            .HasMaxLength(SavedJourney.MaxContractLength);

        /* Hat kimliği bir FK DEĞİLDİR: kişisel bir kayıt, paylaşılan ulaşım
           verisinin yaşam döngüsünü kısıtlamamalıdır. Referans her yeniden
           kullanımda uygulama katmanında çözülür. */
        builder.Property(x => x.RouteId)
            .HasColumnName("route_id");

        builder.Property(x => x.RouteDisplayName)
            .HasColumnName("route_display_name")
            .HasMaxLength(SavedJourney.MaxDisplayNameLength);

        builder.Property(x => x.IsFavorite)
            .HasColumnName("is_favorite")
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

        /* Listenin kendisi bu indeksten okunur: sahibin yolculukları, önce
           favoriler, sonra en son değiştirilen. */
        builder.HasIndex(x => new { x.UserId, x.IsFavorite, x.ModifiedDate });

        builder.HasMany(x => x.Points)
            .WithOne(x => x.SavedJourney)
            .HasForeignKey(x => x.SavedJourneyId)
            /* CASCADE: nokta yolculuğun PARÇASIDIR. Yolculuk silinip noktaları
               kalsaydı, hiçbir tanıma ait olmayan referanslar birikirdi. */
            .OnDelete(DeleteBehavior.Cascade);
    }
}

/// <summary>Kaydedilmiş yolculuğun sıralı geçiş noktasının eşlemesi.</summary>
public class SavedJourneyPointConfiguration : IEntityTypeConfiguration<SavedJourneyPoint>
{
    public void Configure(EntityTypeBuilder<SavedJourneyPoint> builder)
    {
        builder.ToTable("saved_journey_point", table =>
        {
            table.HasCheckConstraint(
                "ck_saved_journey_point_sequence_nonnegative",
                "sequence >= 0");

            table.HasCheckConstraint(
                "ck_saved_journey_point_source_supported",
                "source IN ('transportStop', 'poi')");

            table.HasCheckConstraint(
                "ck_saved_journey_point_reference_positive",
                "reference_id > 0");
        });

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id).HasColumnName("id");

        builder.Property(x => x.SavedJourneyId)
            .HasColumnName("saved_journey_id")
            .IsRequired();

        builder.Property(x => x.Sequence)
            .HasColumnName("sequence")
            .IsRequired();

        builder.Property(x => x.Source)
            .HasColumnName("source")
            .IsRequired()
            .HasMaxLength(SavedJourney.MaxContractLength);

        /* Çok biçimli referans: durak ya da POI. Tek kolondan iki tabloya FK
           kurulamaz; doğrulama uygulama katmanındadır. */
        builder.Property(x => x.ReferenceId)
            .HasColumnName("reference_id")
            .IsRequired();

        builder.Property(x => x.DisplayName)
            .HasColumnName("display_name")
            .HasMaxLength(SavedJourney.MaxDisplayNameLength);

        /* Sıra YOLCULUK BAŞINA tekildir: aynı numarayı taşıyan iki nokta,
           "2. nokta" sorusuna iki cevap verirdi. */
        builder.HasIndex(x => new { x.SavedJourneyId, x.Sequence }).IsUnique();
    }
}
