using StajProject.Application.Pois;
using StajProject.Domain.Common;

namespace StajProject.Auth.Tests;

/// <summary>
/// Simge izin listesi (<see cref="PoiCategoryIcons"/>) ve renk sözleşmesi
/// (<see cref="PoiCategoryColor"/>).
/// </summary>
/// <remarks>
/// <b>Simge anahtarı, projedeki en fazla saldırı yüzeyi olan sunum alanıdır.</b>
/// İleride hem bir bileşen aramasına hem de bir GeoServer <c>ExternalGraphic</c>
/// dosya yoluna girecektir; bu yüzden testler yalnızca "bilinmeyen anahtar
/// reddedilir"i değil, dizin geçişi / URL / işaretleme gövdesi gibi somut
/// kötüye kullanım biçimlerini de AÇIKÇA sınar.
/// </remarks>
public class PoiCategoryPresentationContractTests
{
    /* --- Simge: kabul ------------------------------------------------------------- */

    [Theory]
    [InlineData("pill")]
    [InlineData("map-pin")]
    [InlineData("badge-dollar-sign")]
    [InlineData("utensils-crossed")]
    [InlineData("shopping-basket")]
    [InlineData("key-round")]
    [InlineData("gauge")]
    [InlineData("armchair")]
    [InlineData("music")]
    [InlineData("coffee")]
    public void Approved_icon_keys_are_accepted(string iconKey) =>
        Assert.True(PoiCategoryIcons.IsApproved(iconKey));

    /* --- Simge: ret --------------------------------------------------------------- */

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("definitely-not-an-icon")]
    [InlineData("Pill")]     // harfe duyarlı: aynı simgenin ikinci yazımı olurdu
    [InlineData("PILL")]
    [InlineData("pill ")]    // kırpma çağıranın işi; izin listesi tam eşleşir
    public void Unknown_icon_keys_are_rejected(string? iconKey) =>
        Assert.False(PoiCategoryIcons.IsApproved(iconKey));

    [Theory]
    [InlineData("../../../etc/passwd")]
    [InlineData("../pill")]
    [InlineData("pill/../../secret")]
    [InlineData("..%2Fpill")]
    [InlineData("/etc/passwd")]
    [InlineData("C:\\Windows\\system32")]
    public void Path_traversal_attempts_are_rejected(string iconKey) =>
        Assert.False(PoiCategoryIcons.IsApproved(iconKey));

    [Theory]
    [InlineData("http://evil.example/icon.svg")]
    [InlineData("https://cdn.example/pill.png")]
    [InlineData("//cdn.example/pill.svg")]
    [InlineData("data:image/svg+xml;base64,PHN2Zz4=")]
    [InlineData("file:///etc/passwd")]
    public void Urls_are_rejected(string iconKey) =>
        Assert.False(PoiCategoryIcons.IsApproved(iconKey));

    [Theory]
    [InlineData("<svg onload=alert(1)>")]
    [InlineData("<script>alert(1)</script>")]
    [InlineData("pill\"/><Rule>")]
    [InlineData("]]><!--")]
    [InlineData("pill' or '1'='1")]
    public void Markup_and_injection_shaped_input_is_rejected(string iconKey) =>
        Assert.False(PoiCategoryIcons.IsApproved(iconKey));

    /* --- Simge: kayıt defterinin kendi tutarlılığı -------------------------------- */

    [Fact]
    public void The_icon_registry_has_no_duplicates() =>
        Assert.Equal(PoiCategoryIcons.All.Count, PoiCategoryIcons.All.Distinct(StringComparer.Ordinal).Count());

    [Fact]
    public void Every_icon_key_is_lowercase_kebab_case()
    {
        /* Anahtarlar aynı zamanda dosya adı olacaktır; kanonik biçimden sapan
           bir anahtar, dosya sisteminde harfe duyarlılık farklarına yakalanırdı. */
        foreach (var key in PoiCategoryIcons.All)
        {
            Assert.Matches("^[a-z0-9]+(?:-[a-z0-9]+)*$", key);
        }
    }

    [Fact]
    public void The_fallback_icon_is_itself_approved() =>
        Assert.True(PoiCategoryIcons.IsApproved(PoiCategoryIcons.Fallback));

    /* --- Renk: kabul ve kanonikleştirme ------------------------------------------- */

    [Theory]
    [InlineData("#ef4444", "#EF4444")]
    [InlineData("#EF4444", "#EF4444")]
    [InlineData("#eF4444", "#EF4444")]
    [InlineData("  #f97316  ", "#F97316")]
    [InlineData("#000000", "#000000")]
    [InlineData("#ffffff", "#FFFFFF")]
    public void Valid_colors_are_canonicalised_to_uppercase(string input, string expected)
    {
        Assert.True(PoiCategoryColor.TryCanonicalize(input, out var canonical));
        Assert.Equal(expected, canonical);
    }

    [Fact]
    public void Canonicalisation_is_idempotent()
    {
        Assert.True(PoiCategoryColor.TryCanonicalize("#ef4444", out var once));
        Assert.True(PoiCategoryColor.TryCanonicalize(once, out var twice));
        Assert.Equal(once, twice);
    }

    /* --- Renk: ret ---------------------------------------------------------------- */

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("EF4444")]        // diyez yok
    [InlineData("#EF444")]        // beş basamak
    [InlineData("#EF44444")]      // yedi basamak
    [InlineData("#GGGGGG")]       // onaltılık değil
    [InlineData("#EF44 4")]
    [InlineData("red")]
    [InlineData("rgb(239,68,68)")]
    public void Malformed_colors_are_rejected(string? value) =>
        Assert.False(PoiCategoryColor.TryCanonicalize(value, out _));

    [Theory]
    [InlineData("#FFF")]
    [InlineData("#abc")]
    public void Shorthand_rgb_is_rejected_rather_than_expanded(string value)
    {
        /* Kısa yazımı açmak, kullanıcının yazdığından FARKLI bir değerin
           saklanması demektir; reddetmek ne olduğunu açıkça söyler. */
        Assert.False(PoiCategoryColor.TryCanonicalize(value, out _));
    }

    [Theory]
    [InlineData("#EF4444FF")]
    [InlineData("#EF444480")]
    public void An_alpha_channel_is_rejected(string value)
    {
        /* Kategori rengi bir KİMLİK rengidir; saydamlık ayrı bir sunum
           kararıdır ve buraya eklenmesi ikinci bir saydamlık kaynağı
           yaratırdı. */
        Assert.False(PoiCategoryColor.TryCanonicalize(value, out _));
    }

    /* --- Palet -------------------------------------------------------------------- */

    [Fact]
    public void Every_palette_color_is_already_canonical()
    {
        foreach (var color in PoiCategoryPalette.All)
        {
            Assert.True(PoiCategoryColor.TryCanonicalize(color, out var canonical));
            Assert.Equal(color, canonical);
        }
    }

    [Fact]
    public void The_fallback_color_is_canonical_but_outside_the_palette()
    {
        Assert.True(PoiCategoryColor.TryCanonicalize(PoiCategoryPalette.Fallback, out var canonical));
        Assert.Equal(PoiCategoryPalette.Fallback, canonical);

        // Nötr yedek, hiçbir sektör rengiyle karıştırılmamalıdır.
        Assert.DoesNotContain(PoiCategoryPalette.Fallback, PoiCategoryPalette.All);
    }
}
