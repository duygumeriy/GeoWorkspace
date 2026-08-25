using StajProject.Application.Pois;
using StajProject.Domain.Entities;

namespace StajProject.Auth.Tests;

/// <summary>
/// <see cref="PoiCategorySlug"/> sözleşmesi: Türkçe'ye duyarlı katlama, ASCII
/// indirgeme, noktalama daraltması ve boş slug reddi.
/// </summary>
/// <remarks>
/// <b>Türkçe katlama testlerin AĞIRLIK merkezidir.</b> Slug oluşturulduktan
/// sonra DEĞİŞMEZ ve ileride GeoServer stil kuralının eşleştiği anahtar olur;
/// yanlış katlanmış bir harf, düzeltilemeyen kalıcı bir teknik kimlik demektir.
/// Sessiz hata özellikle <c>ı</c> ve <c>ğ</c>'de gizlidir: bunlar Unicode'da
/// birleşik-imli karakterler DEĞİLDİR, dolayısıyla yalnızca NFD ayrıştırmasına
/// güvenen bir uygulama onları tamamen düşürürdü.
/// </remarks>
public class PoiCategorySlugTests
{
    /* --- Türkçe katlama ----------------------------------------------------------- */

    [Theory]
    [InlineData("Yeme-İçme Yerleri", "yeme-icme-yerleri")]
    [InlineData("Eğlence Yerleri", "eglence-yerleri")]
    [InlineData("Sağlık Kurumları", "saglik-kurumlari")]
    [InlineData("Alışveriş", "alisveris")]
    [InlineData("Konser Alanı", "konser-alani")]
    [InlineData("Araç Şarj İstasyonları", "arac-sarj-istasyonlari")]
    [InlineData("Otomotiv Sektörü", "otomotiv-sektoru")]
    [InlineData("Emlakçılar", "emlakcilar")]
    [InlineData("Mobilyacılar", "mobilyacilar")]
    [InlineData("Giyim Mağazaları", "giyim-magazalari")]
    [InlineData("Telekomünikasyon", "telekomunikasyon")]
    public void Turkish_characters_fold_to_their_ascii_equivalents(string name, string expected)
    {
        Assert.True(PoiCategorySlug.TryCreate(name, out var slug));
        Assert.Equal(expected, slug);
    }

    [Fact]
    public void The_dotted_capital_i_folds_without_leaving_a_combining_mark()
    {
        /* char.ToLowerInvariant('İ') "i + U+0307" üretir; birleşik im
           süzgeçten geçmez ama bu testin konusu, açık eşlemenin onu HİÇ
           üretmemesidir. */
        Assert.True(PoiCategorySlug.TryCreate("İzmir", out var slug));
        Assert.Equal("izmir", slug);
    }

    [Fact]
    public void The_dotless_i_is_not_dropped()
    {
        // NFD'ye güvenen bir uygulamada "kırıkkale" -> "krkkale" olurdu.
        Assert.True(PoiCategorySlug.TryCreate("Kırıkkale", out var slug));
        Assert.Equal("kirikkale", slug);
    }

    [Fact]
    public void Remaining_latin_accents_are_reduced_to_their_base_letter()
    {
        // Türkçe eşlemenin kapsamadığı aksanları NFD katmanı kurtarır.
        Assert.True(PoiCategorySlug.TryCreate("Café Ñandú", out var slug));
        Assert.Equal("cafe-nandu", slug);
    }

    /* --- Noktalama ve boşluk ------------------------------------------------------ */

    [Theory]
    [InlineData("Ayakkabı / Terlik / Çanta", "ayakkabi-terlik-canta")]
    [InlineData("Su, Kanalizasyon ve Çöp", "su-kanalizasyon-ve-cop")]
    [InlineData("Banka ve ATM", "banka-ve-atm")]
    [InlineData("A   B", "a-b")]
    [InlineData("A---B", "a-b")]
    [InlineData("  Yeme-İçme  ", "yeme-icme")]
    [InlineData("---Kenar---", "kenar")]
    [InlineData("Nokta.Nokta", "nokta-nokta")]
    [InlineData("%100 Yerli", "100-yerli")]
    public void Unsupported_runs_collapse_to_a_single_hyphen_and_edges_are_trimmed(
        string name,
        string expected)
    {
        Assert.True(PoiCategorySlug.TryCreate(name, out var slug));
        Assert.Equal(expected, slug);
    }

    /* --- Boş slug ----------------------------------------------------------------- */

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("---")]
    [InlineData("!!! ??? ...")]
    [InlineData("日本語")]
    public void A_name_without_usable_characters_does_not_produce_a_slug(string? name)
    {
        /* Boş slug bir kimlik DEĞİLDİR ve küresel tekillik kısıtında ilk
           satırdan sonra her şeyi kilitlerdi. Üretim sessizce boş dönmek yerine
           BAŞARISIZ olur. */
        Assert.False(PoiCategorySlug.TryCreate(name, out var slug));
        Assert.Equal(string.Empty, slug);
    }

    /* --- Uzunluk ------------------------------------------------------------------ */

    [Fact]
    public void A_long_name_is_truncated_to_the_maximum_slug_length()
    {
        // Ad 150 karaktere kadar olabilir; slug 80.
        var name = new string('a', PoiCategory.MaxNameLength);

        Assert.True(PoiCategorySlug.TryCreate(name, out var slug));
        Assert.Equal(PoiCategorySlug.MaxLength, slug.Length);
    }

    [Fact]
    public void Truncation_never_leaves_a_trailing_hyphen()
    {
        /* Kesme tam bir tirenin üzerine denk gelirse slug kanonik biçimi
           bozardı; budama bu yüzden kesmeden SONRA yapılır. */
        var name = new string('a', PoiCategorySlug.MaxLength) + " b";

        Assert.True(PoiCategorySlug.TryCreate(name, out var slug));
        Assert.DoesNotContain("--", slug, StringComparison.Ordinal);
        Assert.False(slug.EndsWith('-'));
        Assert.True(PoiCategorySlug.IsCanonical(slug));
    }

    /* --- Kanonik biçim ------------------------------------------------------------ */

    [Theory]
    [InlineData("yeme-icme")]
    [InlineData("epdk")]
    [InlineData("category-42")]
    [InlineData("a")]
    [InlineData("banka-ve-atm")]
    public void Canonical_slugs_are_recognised(string value) =>
        Assert.True(PoiCategorySlug.IsCanonical(value));

    [Theory]
    [InlineData("")]
    [InlineData("-leading")]
    [InlineData("trailing-")]
    [InlineData("double--hyphen")]
    [InlineData("Upper")]
    [InlineData("with space")]
    [InlineData("türkçe")]
    [InlineData("slash/path")]
    [InlineData("../traversal")]
    public void Non_canonical_values_are_rejected(string value) =>
        Assert.False(PoiCategorySlug.IsCanonical(value));

    [Fact]
    public void A_value_longer_than_the_maximum_is_not_canonical() =>
        Assert.False(PoiCategorySlug.IsCanonical(new string('a', PoiCategorySlug.MaxLength + 1)));

    /* --- Üretim ile doğrulama tutarlılığı ----------------------------------------- */

    [Fact]
    public void Every_generated_slug_is_canonical()
    {
        /* Üretim ve doğrulama iki ayrı koddur; ayrışmaları hâlinde üretilen bir
           slug kendi doğrulamasını geçemezdi. */
        string[] names =
        [
            "Yeme-İçme Yerleri", "Ayakkabı / Terlik / Çanta", "%100 Yerli",
            "Su, Kanalizasyon ve Çöp", "Café Ñandú", "Kırıkkale", "EPDK"
        ];

        foreach (var name in names)
        {
            Assert.True(PoiCategorySlug.TryCreate(name, out var slug));
            Assert.True(PoiCategorySlug.IsCanonical(slug), $"{name} -> {slug}");
        }
    }
}
