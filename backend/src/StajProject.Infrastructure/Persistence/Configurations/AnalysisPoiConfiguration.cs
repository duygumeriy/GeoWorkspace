using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using StajProject.Domain.Entities;

namespace StajProject.Infrastructure.Persistence.Configurations;

/// <summary>
/// Konum analizi için açık veri POI tablosu.
/// </summary>
/// <remarks>
/// <para>
/// <b>Kolon adları İngilizce snake_case'tir.</b> <see cref="PoiConfiguration"/>
/// Türkçe fiziksel adlar (<c>isim</c>, <c>kategori_id</c>) kullanır çünkü ödev
/// şartnamesi o tabloyu öyle tanımlar; bu tablo şartnamede geçmez ve projenin
/// GENEL sözleşmesini sürdürür — <c>poi_category</c>, <c>permissions</c> ve
/// <c>geographic_authorizations</c> ile aynı biçim.
/// </para>
/// <para>
/// <b>Global query filter YOKTUR</b> ve bu bilinçlidir: filtrenin dayandığı
/// <c>is_deleted</c>/<c>is_active</c> ikilisi bu tabloda yoktur (bkz.
/// <see cref="AnalysisPoi"/>). Filtresiz kalması, okuyucunun "acaba gizlenmiş
/// satır var mı" diye düşünmesini gerektirmez: tabloda ne varsa analize girer.
/// </para>
/// </remarks>
public class AnalysisPoiConfiguration : IEntityTypeConfiguration<AnalysisPoi>
{
    public void Configure(EntityTypeBuilder<AnalysisPoi> builder)
    {
        builder.ToTable("analysis_poi");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasColumnName("id");

        /* Ad ZORUNLU DEĞİLDİR — normal POI'den ayrıldığı tek alan sözleşmesi
           budur. Gerekçe entity'de yazılıdır: adsız bir dış kayıt geçerlidir ve
           içe aktarıcı ad UYDURMAMALIDIR. */
        builder.Property(x => x.Name)
            .HasColumnName("name")
            .HasMaxLength(AnalysisPoi.MaxNameLength);

        builder.Property(x => x.CategoryId)
            .HasColumnName("category_id")
            .IsRequired();

        /* Restrict, PoiConfiguration ile AYNI gerekçeyle seçilir: kategoriler
           zaten soft-delete edilir ve cascade, elle atılan tek bir DELETE'in
           analiz veri kümesinin bir bölümünü sessizce yok etmesi demek olurdu. */
        builder
            .HasOne(x => x.Category)
            .WithMany()
            .HasForeignKey(x => x.CategoryId)
            .OnDelete(DeleteBehavior.Restrict);

        /* Analiz sorgusunun İKİ yükleminden biri kategori kümesidir; ikincisi
           mekânsaldır. İkisi de indekslenir. */
        builder.HasIndex(x => x.CategoryId);

        builder.Property(x => x.Coordinate)
            .HasColumnName("coordinate")
            .IsRequired()
            .HasColumnType("geometry(Point,4326)");

        /* GiST — poi.coordinate ile aynı yapılandırma. Analiz sorgusu bir alan
           yüklemiyle başlar; indekssiz bir ST_Intersects, veri kümesi
           büyüdüğünde tüm tabloyu tarardı. */
        builder.HasIndex(x => x.Coordinate)
            .HasMethod("gist");

        builder.Property(x => x.Source)
            .HasColumnName("source")
            .IsRequired()
            .HasMaxLength(AnalysisPoi.MaxSourceLength);

        builder.Property(x => x.ExternalId)
            .HasColumnName("external_id")
            .IsRequired()
            .HasMaxLength(AnalysisPoi.MaxExternalIdLength);

        /* İçe aktarımın FİKİR BİRLİĞİ anahtarı: aynı dış nesne iki kez
           yazılamaz. Kısıt veritabanındadır, yalnızca içe aktarıcının kodunda
           değil — yarım kalıp yeniden çalıştırılan bir içe aktarım, uygulama
           katmanındaki bir kontrolü atlayabilir ama bu indeksi atlayamaz. */
        builder.HasIndex(x => new { x.Source, x.ExternalId })
            .IsUnique();

        builder.Property(x => x.ImportedAt)
            .HasColumnName("imported_at")
            .IsRequired()
            .HasColumnType("timestamp with time zone");
    }
}
