using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;

namespace StajProject.Infrastructure.Persistence.Configurations;

/// <summary>
/// tbl_point / tbl_line / tbl_polygon için ortak kolon mapping'i. Üç tablonun
/// stil ve audit kolonları birebir aynı tanıma sahip olduğu için tek yerde
/// tutulur; tablo adı ve geometry kolonu her configuration'da ayrı kalır.
/// </summary>
internal static class DrawingFeatureConfiguration
{
    public static void ConfigureNameStyleAndAudit<TEntity>(EntityTypeBuilder<TEntity> builder)
        where TEntity : class, IStyledDrawingFeature
    {
        builder.Property(x => x.Name)
            .IsRequired()
            .HasMaxLength(200);

        builder.Property(x => x.StrokeColor)
            .IsRequired()
            .HasMaxLength(7);

        builder.Property(x => x.StrokeWidth)
            .IsRequired();

        builder.Property(x => x.FillColor)
            .HasMaxLength(7);

        builder.Property(x => x.FillOpacity);

        builder.Property(x => x.LineStyle)
            .HasMaxLength(16);

        builder.Property(x => x.CreatedDate)
            .IsRequired()
            .HasColumnType("timestamp with time zone");

        builder.Property(x => x.ModifiedDate)
            .IsRequired()
            .HasColumnType("timestamp with time zone");

        builder.Property(x => x.CreatedBy)
            .IsRequired()
            .HasMaxLength(100);

        /* Ownership: gerçek foreign key ile users tablosuna bağlanır.

           DeleteBehavior.Restrict bilinçlidir — kullanıcı silinmesi çizimleri
           SİLMEZ. Pasifleştirilen (veya ileride soft-delete edilen) bir
           kullanıcının çizimleri haritada kalmaya devam etmeli ve Admin
           tarafından yönetilebilmelidir. Cascade olsaydı tek bir kullanıcı
           kaydının silinmesi envanterin bir kısmını sessizce yok ederdi.

           Interface üzerinden yapılandırma yapıldığı için string tabanlı API
           kullanılır: lambda ifadesi interface member'ına çözülürdü ve EF
           entity'nin CLR property'sini bekler. */
        builder.Property(nameof(IStyledDrawingFeature.CreatedByUserId))
            .IsRequired();

        builder
            .HasOne(typeof(User), nameof(IStyledDrawingFeature.CreatedByUser))
            .WithMany()
            .HasForeignKey(nameof(IStyledDrawingFeature.CreatedByUserId))
            .OnDelete(DeleteBehavior.Restrict);

        // Sahibe göre sorgular (ve FK doğrulaması) için; EF bu index'i
        // otomatik oluşturmaz, o yüzden açıkça tanımlanır.
        builder.HasIndex(nameof(IStyledDrawingFeature.CreatedByUserId));

        /* Soft delete alanları. DeletedByUserId yalnızca denetim izidir ve
           sahiplikle karıştırılmamalıdır; navigation property tanımlanmaz,
           yalnızca foreign key kısıtı kurulur. Restrict: silme işlemini yapmış
           bir kullanıcının hesabı silinmeye çalışıldığında kayıt korunur. */
        builder.Property(nameof(IStyledDrawingFeature.IsDeleted))
            .IsRequired()
            .HasDefaultValue(false);

        builder.Property(nameof(IStyledDrawingFeature.DeletedAt))
            .HasColumnType("timestamp with time zone");

        builder
            .HasOne<User>()
            .WithMany()
            .HasForeignKey(nameof(IStyledDrawingFeature.DeletedByUserId))
            .OnDelete(DeleteBehavior.Restrict);
    }
}
