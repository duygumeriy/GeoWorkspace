using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
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
    }
}
