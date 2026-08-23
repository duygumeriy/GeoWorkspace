using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using StajProject.Domain.Entities;

namespace StajProject.Infrastructure.Persistence.Configurations;

/// <summary>
/// POI tablosu. Fiziksel kolon adları ödev şartnamesindeki adlardır
/// (<c>isim</c>, <c>kategori_id</c>, <c>mesai_saatleri</c>); C# property adları
/// projenin geri kalanıyla tutarlı kalır. Eşleştirme tek yerde, burada durur —
/// <see cref="DrawingFeatureConfiguration"/> ile aynı yaklaşım.
/// </summary>
public class PoiConfiguration : IEntityTypeConfiguration<Poi>
{
    public void Configure(EntityTypeBuilder<Poi> builder)
    {
        builder.ToTable("poi");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("id");

        builder.Property(x => x.Name)
            .HasColumnName("isim")
            .IsRequired()
            .HasMaxLength(Poi.MaxNameLength);

        builder.Property(x => x.CategoryId)
            .HasColumnName("kategori_id")
            .IsRequired();

        /* Kategori silinmesi POI'yi SİLMEZ. Kategoriler zaten soft-delete
           edilir; cascade, elle atılan tek bir DELETE'in envanterin bir kısmını
           sessizce yok etmesi demek olurdu. */
        builder
            .HasOne(x => x.Category)
            .WithMany()
            .HasForeignKey(x => x.CategoryId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(x => x.CategoryId);

        /* Haftalık mesai programı jsonb olarak saklanır. Metin property'si
           Npgsql tarafından doğrudan jsonb'ye eşlenir; POCO eşlemesi için
           gereken dinamik JSON desteğine (ve dolayısıyla veri kaynağı
           yapılandırmasının değişmesine) gerek kalmaz.

           Kolon NULL kabul eder: mesai bildirilmemiş bir POI geçerlidir ve bu,
           "boş program" ile karıştırılmamalıdır. */
        builder.Property(x => x.WorkHoursJson)
            .HasColumnName("mesai_saatleri")
            .HasColumnType("jsonb");

        builder.Property(x => x.Coordinate)
            .HasColumnName("coordinate")
            .IsRequired()
            .HasColumnType("geometry(Point,4326)");

        /* Mekânsal sorgular (kapsam denetimi, alan içi arama) indeksten
           yararlanabilsin diye GiST — tbl_point ile aynı gerekçe. */
        builder.HasIndex(x => x.Coordinate)
            .HasMethod("gist");

        /* Sahiplik: gerçek foreign key ile users tablosuna bağlanır.
           Restrict, çizimlerdekiyle aynı gerekçeyle seçilmiştir — pasifleşen
           bir kullanıcının POI'leri haritada kalmaya devam etmelidir. */
        builder.Property(x => x.UserId)
            .HasColumnName("user_id")
            .IsRequired();

        builder
            .HasOne(x => x.User)
            .WithMany()
            .HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Restrict);

        // Sahibe göre sorgular (ve FK doğrulaması) için; EF bunu otomatik
        // oluşturmaz, o yüzden açıkça tanımlanır.
        builder.HasIndex(x => x.UserId);

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

        // Çizim tablolarıyla AYNI soft-delete sözleşmesi.
        builder.HasQueryFilter(x => !x.IsDeleted && x.IsActive);
    }
}
