using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;

namespace StajProject.Infrastructure.Persistence.Configurations;

/// <summary>
/// Identity'nin <c>AspNetUsers</c> varsayılanı yerine projenin mevcut
/// <c>users</c> tablosu ve kolon adları korunur; böylece hâlihazırdaki tablo
/// yeniden oluşturulmadan Identity şemasına genişletilir.
/// </summary>
public class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> builder)
    {
        builder.ToTable("users");

        builder.HasKey(x => x.Id);

        // Identity'de property adı UserName; kolon adı mevcut şemadaki gibi kalır.
        builder.Property(x => x.UserName)
            .HasColumnName("Username")
            .IsRequired()
            .HasMaxLength(100);

        builder.Property(x => x.NormalizedUserName)
            .HasMaxLength(100);

        builder.HasIndex(x => x.UserName)
            .IsUnique();

        // Identity PasswordHasher (PBKDF2) çıktısı ~84 karakter; 256 yeterli.
        builder.Property(x => x.PasswordHash)
            .HasMaxLength(256);

        builder.Property(x => x.Email)
            .HasMaxLength(256);

        builder.Property(x => x.NormalizedEmail)
            .HasMaxLength(256);

        /* Identity'nin RequireUniqueEmail doğrulaması uygulama yarışlarını tek
           başına kapatmaz. Aynı normalize e-posta için son güvenlik sınırı
           veritabanındaki bu unique index'tir; PostgreSQL unique index içinde
           birden fazla NULL değere doğal olarak izin verir. */
        builder.HasIndex(x => x.NormalizedEmail)
            .HasDatabaseName("EmailIndex")
            .IsUnique();

        builder.Property(x => x.PhoneNumber)
            .HasMaxLength(32);

        // Ödevde istenen kolon isimleri birebir korunur.
        builder.Property(x => x.IsDeleted)
            .HasColumnName("is_deleted")
            .IsRequired()
            .HasDefaultValue(false);

        builder.Property(x => x.IsActive)
            .HasColumnName("is_active")
            .IsRequired()
            .HasDefaultValue(true);

        builder.Property(x => x.ModifiedDate)
            .HasColumnName("modified_date")
            .IsRequired()
            .HasColumnType("timestamp with time zone")
            .HasDefaultValueSql("now() at time zone 'utc'");

        /* --- Onay yaşam döngüsü ------------------------------------------------
           Kolon adları mevcut projeye özgü alanların (is_active, is_deleted,
           modified_date) snake_case sözleşmesini sürdürür; Identity'nin kendi
           kolonları PascalCase kalır. */

        // Enum int olarak saklanır: metin saklamak, ileride bir değerin adı
        // değiştiğinde veriyi sessizce anlamsızlaştırırdı.
        builder.Property(x => x.AccountStatus)
            .HasColumnName("account_status")
            .IsRequired()
            .HasConversion<int>()
            .HasDefaultValue(AccountStatus.PendingEmailVerification);

        builder.Property(x => x.ApprovedAt)
            .HasColumnName("approved_at")
            .HasColumnType("timestamp with time zone");

        builder.Property(x => x.ApprovedByUserId)
            .HasColumnName("approved_by_user_id");

        builder.Property(x => x.RejectedAt)
            .HasColumnName("rejected_at")
            .HasColumnType("timestamp with time zone");

        builder.Property(x => x.RejectedByUserId)
            .HasColumnName("rejected_by_user_id");

        builder.Property(x => x.RejectionReason)
            .HasColumnName("rejection_reason")
            .HasMaxLength(500);

        /* Onaylayan/reddeden yönetici gerçek bir foreign key'dir: audit alanının
           var olmayan bir kullanıcıyı göstermesi anlamsız olurdu. Navigation
           property tanımlanmaz (bkz. User) ve silme davranışı Restrict'tir —
           bir yöneticinin satırı, verdiği onay kayıtlarını sessizce
           boşaltarak kaybolamaz. Projede kullanıcılar zaten soft delete
           edildiği için bu kısıt normal akışta hiç devreye girmez. */
        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(x => x.ApprovedByUserId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(x => x.RejectedByUserId)
            .OnDelete(DeleteBehavior.Restrict);

        // Admin ekranındaki "Onay Bekleyen" filtresi bu kolona göre sorgular.
        builder.HasIndex(x => x.AccountStatus);
    }
}
