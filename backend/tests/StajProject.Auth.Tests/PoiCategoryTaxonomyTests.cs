using StajProject.Application.Pois;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;

namespace StajProject.Auth.Tests;

/// <summary>
/// Kanonik taksonomi kataloğunun (<see cref="PoiCategoryTaxonomy"/>) kendi
/// iç tutarlılığı.
/// </summary>
/// <remarks>
/// <b>Katalog bir VERİ yapısıdır ve elle yazılır.</b> Derleyici, oradaki bir
/// slug'ın kanonik olup olmadığını, bir simgenin izin listesinde bulunup
/// bulunmadığını ya da bir <c>ParentSlug</c>'ın gerçekten var olan bir kategoriyi
/// gösterip göstermediğini denetleyemez. Bu testler o boşluğu kapatır:
/// tutarsız bir katalog, çalışma zamanında sessizce eksik satır ya da tekillik
/// ihlali üretirdi.
/// </remarks>
public class PoiCategoryTaxonomyTests
{
    [Fact]
    public void The_catalog_has_the_expected_shape()
    {
        Assert.Equal(44, PoiCategoryTaxonomy.All.Count);
        Assert.Equal(27, PoiCategoryTaxonomy.Roots.Count());
        Assert.Equal(17, PoiCategoryTaxonomy.Children.Count());
    }

    [Fact]
    public void Slugs_are_globally_unique()
    {
        /* Tekillik veritabanında bir indeksle GARANTİ edilir; katalogdaki bir
           çift, seeder'ı ikinci satırda o indekse çarptırırdı. */
        var slugs = PoiCategoryTaxonomy.All.Select(item => item.Slug).ToList();

        Assert.Equal(slugs.Count, slugs.Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public void Every_slug_is_canonical_and_within_the_column_limit()
    {
        foreach (var definition in PoiCategoryTaxonomy.All)
        {
            Assert.True(
                PoiCategorySlug.IsCanonical(definition.Slug),
                $"Kanonik olmayan slug: {definition.Slug}");

            Assert.True(definition.Slug.Length <= PoiCategory.MaxSlugLength);
        }
    }

    [Fact]
    public void Every_icon_key_is_approved()
    {
        /* Katalog ile izin listesi ayrışırsa, seeder izin listesinin
           reddedeceği bir simgeyi veritabanına yazardı. */
        foreach (var definition in PoiCategoryTaxonomy.All)
        {
            Assert.True(
                PoiCategoryIcons.IsApproved(definition.IconKey),
                $"{definition.Slug} tanınmayan simge kullanıyor: {definition.IconKey}");
        }
    }

    [Fact]
    public void Every_color_is_canonical_and_from_the_palette()
    {
        foreach (var definition in PoiCategoryTaxonomy.All)
        {
            Assert.True(
                PoiCategoryColor.TryCanonicalize(definition.ColorHex, out var canonical),
                $"{definition.Slug} geçersiz renk taşıyor: {definition.ColorHex}");

            Assert.Equal(definition.ColorHex, canonical);
            Assert.Contains(definition.ColorHex, PoiCategoryPalette.All);
        }
    }

    [Fact]
    public void Every_parent_slug_refers_to_an_existing_root()
    {
        var bySlug = PoiCategoryTaxonomy.All.ToDictionary(item => item.Slug, StringComparer.Ordinal);

        foreach (var child in PoiCategoryTaxonomy.Children)
        {
            Assert.True(
                bySlug.ContainsKey(child.ParentSlug!),
                $"{child.Slug} bilinmeyen bir üste bağlı: {child.ParentSlug}");

            /* Taksonomi iki seviyelidir: bir alt kategorinin üstü KÖK olmalıdır.
               Seeder iki geçişlidir ve üçüncü bir seviye, ikinci geçişte üstü
               henüz eklenmemiş bir satır demek olurdu. */
            Assert.Null(bySlug[child.ParentSlug!].ParentSlug);
        }
    }

    [Fact]
    public void Names_are_present_and_within_the_column_limit()
    {
        foreach (var definition in PoiCategoryTaxonomy.All)
        {
            Assert.False(string.IsNullOrWhiteSpace(definition.Name));
            Assert.True(definition.Name.Length <= PoiCategory.MaxNameLength);
            Assert.Equal(definition.Name.Trim(), definition.Name);
        }
    }

    [Fact]
    public void The_five_pre_existing_categories_are_part_of_the_catalog()
    {
        /* Bu beş slug göç tarafından MEVCUT satırlara yazılır. Katalogda
           bulunmaları zorunludur: bulunmasalardı seeder onları kanonik saymaz,
           metadatalarını tazelemez ve ileride taksonomi dışı kalırlardı. */
        string[] migrated = ["yeme-icme", "kafe", "restoran", "eglence-yerleri", "konser-alani"];

        foreach (var slug in migrated)
        {
            Assert.Contains(PoiCategoryTaxonomy.All, item => item.Slug == slug);
        }
    }

    [Fact]
    public void The_migrated_children_hang_from_the_migrated_roots()
    {
        var bySlug = PoiCategoryTaxonomy.All.ToDictionary(item => item.Slug, StringComparer.Ordinal);

        Assert.Equal("yeme-icme", bySlug["kafe"].ParentSlug);
        Assert.Equal("yeme-icme", bySlug["restoran"].ParentSlug);
        Assert.Equal("eglence-yerleri", bySlug["konser-alani"].ParentSlug);
    }

    [Fact]
    public void The_deliberately_deduplicated_icons_are_in_effect()
    {
        /* Bu dört eşleme, daha önce iki simgenin (landmark / house) iki ayrı
           kategoride tekrar etmesini gidermek için BİLİNÇLİ olarak
           değiştirilmiştir; geri dönmeleri sessiz bir gerileme olurdu. */
        var bySlug = PoiCategoryTaxonomy.All.ToDictionary(item => item.Slug, StringComparer.Ordinal);

        Assert.Equal("badge-dollar-sign", bySlug["finansal-kurumlar"].IconKey);
        Assert.Equal("key-round", bySlug["emlakcilar"].IconKey);
        Assert.Equal("gauge", bySlug["epdk"].IconKey);
        Assert.Equal("armchair", bySlug["mobilyacilar"].IconKey);
        Assert.Equal("shopping-basket", bySlug["ayakkabi-terlik-canta"].IconKey);
        Assert.Equal("utensils-crossed", bySlug["restoran"].IconKey);
    }

    [Fact]
    public void The_catalog_carries_no_database_identifiers()
    {
        /* Tanım kaydında yalnızca slug/ad/üst-slug/simge/renk bulunur. Bir
           `Id` alanı eklenseydi, katalog tek bir veritabanının kopyasına
           bağlanır ve seeder başka ortamlarda yanlış satırları hedeflerdi. */
        var properties = typeof(PoiCategoryTaxonomy.Definition)
            .GetProperties()
            .Select(property => property.Name)
            .ToList();

        Assert.DoesNotContain("Id", properties);
        Assert.DoesNotContain("ParentId", properties);
    }
}
