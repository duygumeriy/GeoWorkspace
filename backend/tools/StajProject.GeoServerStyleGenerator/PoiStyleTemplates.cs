using System.Globalization;
using System.Text;
using StajProject.Domain.Common;

namespace StajProject.GeoServerStyleGenerator;

/// <summary>
/// Üretilen GeoServer yapıtlarının TEK şablonu: kategori SLD'leri, bileşik
/// <c>poi_all</c> stili ve simge SVG'leri.
/// </summary>
/// <remarks>
/// <para>
/// <b>Kaynak yalnızca <see cref="PoiCategoryTaxonomy.All"/>'dur.</b> Burada
/// ikinci bir kategori matrisi, ikinci bir renk tablosu ya da ikinci bir
/// slug listesi YOKTUR. Bir kategori eklendiğinde tek yapılacak şey
/// taksonomiye satır eklemek ve üreteci çalıştırmaktır.
/// </para>
/// <para>
/// <b>Çıktı deterministiktir.</b> Sıra taksonomi sırasıdır, sayı biçimlemesi
/// invariant kültürdedir, satır sonu daima <c>\n</c>'dir ve hiçbir yere zaman
/// damgası ya da makineye özgü değer yazılmaz — aksi hâlde <c>check</c> komutu
/// her çalıştırmada sahte fark üretirdi.
/// </para>
/// <para>
/// <b>Davranış sözleşmesi Faz 3A'da CANLI doğrulanmıştır</b> ve buradaki
/// sabitlerin çoğu o kanıtlanmış davranışı taşır: 150000'de işaretçi boyutu
/// değişimi, 25000'de etiket eşiği, <c>isim</c> alanı, halo ve çarpışma
/// seçenekleri. Faz 5B'de eklenen tek şey İKİNCİ bir işaretçi bandıdır
/// (1:1000000) — mevcut eşik kaldırılmaz, üzerine bir bant eklenir.
/// </para>
/// </remarks>
internal static class PoiStyleTemplates
{
    /// <summary>Üretilmiş dosyaların sahiplik işareti; temizlik bunu arar.</summary>
    internal const string GeneratedMarker = "GENERATED FILE — DO NOT EDIT MANUALLY";

    private const string GeneratorName = "StajProject.GeoServerStyleGenerator";
    private const string TaxonomySource = "PoiCategoryTaxonomy.All";

    /* --- İşaretçi ölçek bantları ------------------------------------------------

       ÜÇ bant vardır, iki değil. Faz 5A'dan sonra yapılan canlı denemede iki
       bandın iki ayrı eksiği görüldü: ülke ölçeğindeki 16 piksellik rozet
       okunamayacak kadar küçüktü ve yakınlaşıldığında simge pratikte AYNI
       boyutta kalıyordu — harita yaklaştıkça POI'nin belirginleşmemesi,
       kullanıcıya "bir şey olmuyor" hissi veriyordu.

       Bantların sınırları bilinçlidir:

       - 1:150000 zaten Faz 3A'da CANLI doğrulanmış eşiktir ve KORUNUR; üzerine
         ikinci bir sınır (1:1000000) eklenir, mevcut olan kaldırılmaz.
       - GeoServer varsayılan ölçek hesabı EPSG:3857 metrelerini kullanır ve
         enleme göre düzeltme YAPMAZ, dolayısıyla sınırlar zoom seviyelerine
         kararlı biçimde oturur: ≥1000000 ≈ z9 ve dışı, 150000–1000000 ≈ z10-z11,
         &lt;150000 ≈ z12 ve içi.

       Boyutlar 20 / 24 / 30'dur. Ortadaki değer 24'te BIRAKILIR çünkü canlı
       doğrulanmış tek boyut odur; değişen yalnızca uçlardır — uzak okunur hâle
       gelir, yakın belirginleşir. 30 piksel bilinçli bir üst sınırdır: daha
       büyüğü, yan yana duran POI'lerde etiketten önce rozetlerin çakışmasına
       yol açardı. */

    /// <summary>Orta banttan uzak banda geçilen ölçek.</summary>
    internal const int VeryFarScaleThreshold = 1000000;

    /// <summary>
    /// Orta banttan yakın banda geçilen ölçek. Faz 3A'da canlı doğrulanmıştır
    /// ve DEĞİŞMEZ.
    /// </summary>
    internal const int MarkerScaleSplit = 150000;

    /// <summary>Etiketin görünmeye başladığı ölçek.</summary>
    internal const int LabelMaxScale = 25000;

    /// <summary>1:1000000 ve dışı — ülke/bölge ölçeği.</summary>
    internal const int VeryFarMarkerSize = 20;

    /// <summary>1:150000 – 1:1000000 — il/bölge ölçeği.</summary>
    internal const int MediumMarkerSize = 24;

    /// <summary>1:150000 içi — şehir/POI inceleme ölçeği.</summary>
    internal const int NearMarkerSize = 30;

    /// <summary>Kategori başına üretilen kural sayısı: üç işaretçi + bir etiket.</summary>
    internal const int RulesPerCategory = 4;

    internal const string LabelProperty = "isim";
    internal const string FilterProperty = "kategori_slug";

    /// <summary>
    /// Etiketin işaretçinin üstüne bırakıldığı dikey pay (piksel).
    /// </summary>
    /// <remarks>
    /// Etiket yalnızca YAKIN bantta (1:25000 içi) görünür, dolayısıyla payı
    /// belirleyen işaretçi <see cref="NearMarkerSize"/>'dır. Rozet merkezinden
    /// çizilir; yarısı 15 pikseldir ve üzerine 4 piksel nefes payı eklenir.
    /// Faz 3A'daki 16 piksellik değer 24 piksellik rozet içindi (12 + 4); rozet
    /// büyüdüğü için pay da deterministik olarak büyür, elle seçilmez.
    /// </remarks>
    internal const int LabelDisplacementY = (NearMarkerSize / 2) + 4;

    /// <summary>Etiket metni için kanonik renkten türetilen koyulaştırma çarpanı.</summary>
    private const double LabelDarkenFactor = 0.45;

    /* --- Dosya adları ----------------------------------------------------------- */

    internal static string StyleName(PoiCategoryTaxonomy.Definition category) => $"poi_{category.Slug}";

    internal static string StyleFileName(PoiCategoryTaxonomy.Definition category) => $"{StyleName(category)}.sld";

    internal static string IconFileName(string iconKey) => $"{iconKey}.svg";

    internal const string CompositeStyleName = "poi_all";

    internal const string CompositeFileName = "poi_all.sld";

    /* --- Simge ------------------------------------------------------------------ */

    /// <summary>
    /// Bir <c>icon_key</c> için rozet SVG'si.
    /// </summary>
    /// <remarks>
    /// Rozet üç katmandır: beyaz kılıf halkası (açık ve koyu altlıkların
    /// İKİSİNDE de kontrast), kategori renginde disk ve beyaz sembol. Kılıf
    /// simgenin KENDİSİNDEDİR — SLD'ye bırakılsaydı her ölçekte yeniden
    /// ayarlanması gerekirdi.
    /// </remarks>
    internal static string RenderIcon(string iconKey, string colorHex)
    {
        if (!PoiIconLibrary.All.TryGetValue(iconKey, out var glyph))
        {
            throw new InvalidOperationException(
                $"'{iconKey}' için simge geometrisi tanımlı değil. "
                + $"PoiIconLibrary.All içine ekleyin — üreteç genel bir simgeye SESSİZCE düşmez.");
        }

        var body = glyph.Scaled
            ? $"""
               <g transform="translate(12 12) scale(0.55) translate(-12 -12)"
                     fill="none" stroke="#FFFFFF" stroke-width="2.4"
                     stroke-linecap="round" stroke-linejoin="round">
                   {glyph.Body}
                 </g>
               """
            : glyph.Body.Replace("{COLOR}", colorHex, StringComparison.Ordinal);

        var svg = $"""
            <?xml version="1.0" encoding="UTF-8"?>
            <!-- {GeneratedMarker}
                 Source: {TaxonomySource}
                 Generator: {GeneratorName}

                 icon_key = {iconKey}

                 GeoServer bir React/Lucide bileşeni ÇİZEMEZ; ExternalGraphic'in
                 ihtiyacı olan şey dosya sisteminden okunabilen durağan bir vektördür.
                 Kasıtlı olarak yoktur: uzak adres, CDN, base64, betik, gömülü stil.
                 Batik'in çizeceği tek şey saf geometridir. -->
            <svg xmlns="http://www.w3.org/2000/svg"
                 width="24" height="24" viewBox="0 0 24 24">

              <circle cx="12" cy="12" r="11" fill="#FFFFFF"/>
              <circle cx="12" cy="12" r="9.5" fill="{colorHex}"/>

              {body}
            </svg>
            """;

        return Normalize(svg);
    }

    /* --- Kategori stili --------------------------------------------------------- */

    internal static string RenderCategoryStyle(PoiCategoryTaxonomy.Definition category)
    {
        var name = StyleName(category);

        var sld = $"""
            <?xml version="1.0" encoding="UTF-8"?>
            <!-- {GeneratedMarker}
                 Source: {TaxonomySource}
                 Generator: {GeneratorName}

                 Kategori : {category.Name}
                 Slug     : {category.Slug}
                 Simge    : {category.IconKey}
                 Renk     : {category.ColorHex}

                 ÖDEV ŞARTI: "Her bir POI kategorisi için GeoServer'da ayrı bir
                 Style (SLD)". Bu dosya o şartın {category.Slug} karşılığıdır.

                 EŞLEŞME SLUG İLEDİR, kimlik ya da ad ile DEĞİL: kategori kimliği
                 ortama özgüdür ve başka bir veritabanında başka bir kategoriyi
                 gösterirdi; görünen ad ise yönetim ekranından düzenlenebilir ve bir
                 yeniden adlandırma bu kuralı sessizce sahipsiz bırakırdı. -->
            <StyledLayerDescriptor version="1.0.0"
              xmlns="http://www.opengis.net/sld"
              xmlns:ogc="http://www.opengis.net/ogc"
              xmlns:xlink="http://www.w3.org/1999/xlink"
              xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
              xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd">
              <NamedLayer>
                <Name>{name}</Name>
                <UserStyle>
                  <Title>POI — {Escape(category.Name)}</Title>
                  <Abstract>kategori_slug = '{category.Slug}' POI'leri; yakın ölçekte isim etiketi.</Abstract>
                  <FeatureTypeStyle>
            {RenderRules(category, indent: "        ")}
                  </FeatureTypeStyle>
                </UserStyle>
              </NamedLayer>
            </StyledLayerDescriptor>
            """;

        return Normalize(sld);
    }

    /* --- Bileşik stil ----------------------------------------------------------- */

    /// <summary>
    /// Tek bir WMS isteğiyle bütün kategorileri çizen bileşik stil.
    /// </summary>
    /// <remarks>
    /// <b>44 ayrı stilin YERİNE GEÇMEZ.</b> Ödev, kategori başına ayrı adlı bir
    /// stil ister ve o şart 44 dosyayla karşılanır; ancak tek bir WMS isteği 44
    /// stil adı taşıyamaz, dolayısıyla gerçek harita sunumunun ihtiyacı olan
    /// pratik yol budur. İkisi de AYNI şablondan üretilir — ikinci bir kural
    /// bloğu elle yazılmaz.
    /// </remarks>
    internal static string RenderCompositeStyle(IReadOnlyList<PoiCategoryTaxonomy.Definition> categories)
    {
        var builder = new StringBuilder();

        foreach (var category in categories)
        {
            builder.Append(RenderRules(category, indent: "        "));
            builder.Append('\n');
        }

        var sld = $"""
            <?xml version="1.0" encoding="UTF-8"?>
            <!-- {GeneratedMarker}
                 Source: {TaxonomySource}
                 Generator: {GeneratorName}

                 Bileşik POI sunum stili: {categories.Count} kanonik kategorinin tamamı.

                 Bu stil, kategori başına ayrı stil şartının YERİNE GEÇMEZ — o şart
                 poi_<slug>.sld dosyalarıyla karşılanır. Buradaki amaç pratiktir: tek
                 bir WMS GetMap isteği 44 stil adı taşıyamaz, dolayısıyla gerçek
                 harita sunumu bu stili kullanır. Kurallar kategori stilleriyle AYNI
                 şablondan üretilir.

                 Kural sırası taksonomi sırasıdır ve deterministiktir. -->
            <StyledLayerDescriptor version="1.0.0"
              xmlns="http://www.opengis.net/sld"
              xmlns:ogc="http://www.opengis.net/ogc"
              xmlns:xlink="http://www.w3.org/1999/xlink"
              xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
              xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd">
              <NamedLayer>
                <Name>{CompositeStyleName}</Name>
                <UserStyle>
                  <Title>POI — tüm kategoriler</Title>
                  <Abstract>Kanonik taksonomideki {categories.Count} kategorinin tamamı; her biri kendi simgesi, rengi ve etiketiyle.</Abstract>
                  <FeatureTypeStyle>
            {builder.ToString().TrimEnd('\n')}
                  </FeatureTypeStyle>
                </UserStyle>
              </NamedLayer>
            </StyledLayerDescriptor>
            """;

        return Normalize(sld);
    }

    /* --- Ortak kural üçlüsü ----------------------------------------------------- */

    /// <summary>
    /// Bir kategorinin dört kuralı: çok uzak / orta / yakın işaretçi ve yakın
    /// etiket. Hem kategori stili hem bileşik stil bunu kullanır.
    /// </summary>
    /// <remarks>
    /// İşaretçi bantları ÖRTÜŞMEZ ve BOŞLUK BIRAKMAZ: orta bant iki sınırı da
    /// taşır (<c>MinScaleDenominator</c> 150000 ve <c>MaxScaleDenominator</c>
    /// 1000000), dolayısıyla her ölçekte tam bir işaretçi kuralı eşleşir. Tek
    /// taraflı bırakılsaydı bir bantta POI iki kez, komşusunda hiç çizilmezdi.
    /// </remarks>
    private static string RenderRules(PoiCategoryTaxonomy.Definition category, string indent)
    {
        var slug = category.Slug;
        var color = category.ColorHex;
        var icon = $"./icons/{IconFileName(category.IconKey)}";
        var labelColor = Darken(color, LabelDarkenFactor);

        /* Kategori süzgeci DÖRT kuralın hepsinde tekrarlanır. Ortak bir üst
           süzgeç yoktur: bileşik stilde kurallar yan yana durur ve süzgeci
           eksik bir kural, o kategorinin çizimini bütün POI'lere uygularadı. */
        var filter = $"""
            <ogc:Filter>
                <ogc:PropertyIsEqualTo>
                  <ogc:PropertyName>{FilterProperty}</ogc:PropertyName>
                  <ogc:Literal>{slug}</ogc:Literal>
                </ogc:PropertyIsEqualTo>
              </ogc:Filter>
            """;

        /* ExternalGraphic'ten SONRA gelen <Mark>, SLD 1.0'da dış kaynak
           YÜKLENEMEDİĞİNDE devreye girer: simge dosyası eksik ya da yanlış
           adlandırılmışsa POI haritadan kaybolmaz, kategori renginde sade bir
           daire olarak çizilir. */
        string Graphic(int size) => $"""
            <Graphic>
                  <ExternalGraphic>
                    <OnlineResource xlink:type="simple" xlink:href="{icon}"/>
                    <Format>image/svg+xml</Format>
                  </ExternalGraphic>
                  <Mark>
                    <WellKnownName>circle</WellKnownName>
                    <Fill>
                      <CssParameter name="fill">{color}</CssParameter>
                    </Fill>
                    <Stroke>
                      <CssParameter name="stroke">#FFFFFF</CssParameter>
                      <CssParameter name="stroke-width">1.5</CssParameter>
                    </Stroke>
                  </Mark>
                  <Size>{size.ToString(CultureInfo.InvariantCulture)}</Size>
                </Graphic>
            """;

        var veryFarScale = VeryFarScaleThreshold.ToString(CultureInfo.InvariantCulture);
        var nearScale = MarkerScaleSplit.ToString(CultureInfo.InvariantCulture);

        var rules = $"""
            <Rule>
              <Name>{slug}-marker-very-far</Name>
              <Title>{Escape(category.Name)} (çok uzak)</Title>
              {filter}
              <MinScaleDenominator>{veryFarScale}</MinScaleDenominator>
              <PointSymbolizer>
                {Graphic(VeryFarMarkerSize)}
              </PointSymbolizer>
            </Rule>

            <Rule>
              <Name>{slug}-marker-medium</Name>
              <Title>{Escape(category.Name)} (orta)</Title>
              {filter}
              <MinScaleDenominator>{nearScale}</MinScaleDenominator>
              <MaxScaleDenominator>{veryFarScale}</MaxScaleDenominator>
              <PointSymbolizer>
                {Graphic(MediumMarkerSize)}
              </PointSymbolizer>
            </Rule>

            <Rule>
              <Name>{slug}-marker-near</Name>
              <Title>{Escape(category.Name)} (yakın)</Title>
              {filter}
              <MaxScaleDenominator>{nearScale}</MaxScaleDenominator>
              <PointSymbolizer>
                {Graphic(NearMarkerSize)}
              </PointSymbolizer>
            </Rule>

            <Rule>
              <Name>{slug}-label</Name>
              <Title>{Escape(category.Name)} ismi</Title>
              {filter}
              <MaxScaleDenominator>{LabelMaxScale.ToString(CultureInfo.InvariantCulture)}</MaxScaleDenominator>
              <TextSymbolizer>
                <Label>
                  <ogc:PropertyName>{LabelProperty}</ogc:PropertyName>
                </Label>
                <Font>
                  <CssParameter name="font-family">Noto Sans</CssParameter>
                  <CssParameter name="font-family">DejaVu Sans</CssParameter>
                  <CssParameter name="font-family">SansSerif</CssParameter>
                  <CssParameter name="font-size">12</CssParameter>
                  <CssParameter name="font-weight">bold</CssParameter>
                </Font>
                <LabelPlacement>
                  <PointPlacement>
                    <AnchorPoint>
                      <AnchorPointX>0.5</AnchorPointX>
                      <AnchorPointY>0.0</AnchorPointY>
                    </AnchorPoint>
                    <Displacement>
                      <DisplacementX>0</DisplacementX>
                      <DisplacementY>{LabelDisplacementY.ToString(CultureInfo.InvariantCulture)}</DisplacementY>
                    </Displacement>
                    <Rotation>0</Rotation>
                  </PointPlacement>
                </LabelPlacement>
                <Halo>
                  <Radius>2</Radius>
                  <Fill>
                    <CssParameter name="fill">#FFFFFF</CssParameter>
                    <CssParameter name="fill-opacity">0.85</CssParameter>
                  </Fill>
                </Halo>
                <Fill>
                  <CssParameter name="fill">{labelColor}</CssParameter>
                </Fill>
                <VendorOption name="conflictResolution">true</VendorOption>
                <VendorOption name="spaceAround">6</VendorOption>
                <VendorOption name="maxDisplacement">40</VendorOption>
                <VendorOption name="goodnessOfFit">0.5</VendorOption>
              </TextSymbolizer>
            </Rule>
            """;

        return Indent(rules, indent);
    }

    /* --- Yardımcılar ------------------------------------------------------------ */

    /// <summary>
    /// Kanonik renkten okunabilir bir koyu ton türetir.
    /// </summary>
    /// <remarks>
    /// <b>İkinci bir metin-rengi tablosu TUTULMAZ.</b> İnce metin, dolgu
    /// renginden daha koyu bir tona ihtiyaç duyar; kategori başına elle renk
    /// seçmek, taksonomiye paralel ve kaçınılmaz olarak ayrışacak ikinci bir
    /// eşleme demek olurdu. Türetme deterministiktir ve kanonik rengin kendisine
    /// bağlıdır.
    /// </remarks>
    internal static string Darken(string colorHex, double factor)
    {
        var r = Convert.ToInt32(colorHex.Substring(1, 2), 16);
        var g = Convert.ToInt32(colorHex.Substring(3, 2), 16);
        var b = Convert.ToInt32(colorHex.Substring(5, 2), 16);

        static int Scale(int channel, double f) =>
            Math.Clamp((int)Math.Round(channel * f, MidpointRounding.AwayFromZero), 0, 255);

        return string.Create(
            CultureInfo.InvariantCulture,
            $"#{Scale(r, factor):X2}{Scale(g, factor):X2}{Scale(b, factor):X2}");
    }

    /// <summary>XML metin düğümü kaçışı; kategori adları Türkçe ve serbesttir.</summary>
    private static string Escape(string value) => value
        .Replace("&", "&amp;", StringComparison.Ordinal)
        .Replace("<", "&lt;", StringComparison.Ordinal)
        .Replace(">", "&gt;", StringComparison.Ordinal);

    private static string Indent(string block, string indent) =>
        string.Join(
            '\n',
            block.Replace("\r\n", "\n", StringComparison.Ordinal)
                .Split('\n')
                .Select(line => line.Length == 0 ? line : indent + line));

    /// <summary>
    /// Satır sonlarını <c>\n</c>'e sabitler ve dosyayı tek satır sonuyla
    /// bitirir. Determinizmin en sıradan ama en sık kırılan parçası budur:
    /// Windows'ta üretilen bir dosya aksi hâlde <c>check</c>'i düşürürdü.
    /// </summary>
    private static string Normalize(string content) =>
        content.Replace("\r\n", "\n", StringComparison.Ordinal).TrimEnd('\n') + "\n";
}
