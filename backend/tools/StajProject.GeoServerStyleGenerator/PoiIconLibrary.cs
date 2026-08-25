namespace StajProject.GeoServerStyleGenerator;

/// <summary>
/// Kanonik <c>icon_key</c> değerlerinin vektör karşılıkları.
/// </summary>
/// <remarks>
/// <para>
/// <b>Bunlar Lucide dosyaları DEĞİLDİR.</b> Anahtar adları taksonomiyle
/// ortaktır ve semantik olarak aynı şeyi anlatırlar, ama geometri bu depoda
/// elle yazılmıştır: GeoServer'a bir simge kütüphanesi bağımlılığı sokmak,
/// sunucu tarafında çalışma zamanı bağımlılığı demek olurdu ve zaten Batik bir
/// React bileşenini çizemez.
/// </para>
/// <para>
/// <b>Her parça 24x24 koordinat uzayında yazılır.</b> Ölçeklenen parçalar
/// rozetin içine sığacak şekilde <see cref="PoiStyleTemplates"/> tarafından
/// sarılır; <see cref="Glyph.Scaled"/> <c>false</c> olanlar kendi boyalarını
/// taşır ve olduğu gibi yazılır.
/// </para>
/// <para>
/// <b>Yalnızca güvenli ilkeller.</b> <c>path</c>, <c>circle</c>, <c>rect</c>,
/// <c>line</c>, <c>polyline</c>, <c>polygon</c>, <c>g</c>. Betik, dış kaynak,
/// gömülü stil bloğu ya da uzak adres yoktur — bir SVG'nin dışarıdan kaynak
/// çekmesi, sunucu tarafında bir istek kanalı açardı.
/// </para>
/// </remarks>
internal static class PoiIconLibrary
{
    /// <param name="Body">24x24 uzayındaki SVG gövdesi.</param>
    /// <param name="Scaled">
    /// <c>true</c> ise ortak beyaz konturlu sarmalayıcıya alınır; <c>false</c>
    /// ise gövde kendi dolgu/kontur değerlerini taşır ve <c>{COLOR}</c> yer
    /// tutucusu kategori rengiyle değiştirilir.
    /// </param>
    internal sealed record Glyph(string Body, bool Scaled = true);

    /// <summary>
    /// <c>icon_key</c> → geometri. Anahtar kümesi
    /// <c>PoiCategoryIcons.All</c> ile aynı olmak zorundadır; eksik bir anahtar
    /// üretim sırasında AÇIK hata verir, sessizce genel bir simgeye düşmez.
    /// </summary>
    internal static readonly IReadOnlyDictionary<string, Glyph> All = new Dictionary<string, Glyph>(StringComparer.Ordinal)
    {
        /* pill — Faz 3A'da canlı doğrulanmış geometri. Değiştirilmez:
           kanıtlanmış görsel sözleşme budur. */
        ["pill"] = new(
            """
            <g transform="rotate(-45 12 12)">
                <rect x="7.4" y="10.2" width="9.2" height="3.6" rx="1.8" fill="#FFFFFF"/>
                <line x1="12" y1="10.2" x2="12" y2="13.8" stroke="{COLOR}" stroke-width="1.1" stroke-linecap="round"/>
              </g>
            """,
            Scaled: false),

        ["hospital"] = new("""<rect x="4" y="5.5" width="16" height="14" rx="2"/><path d="M12 9.5v6M9 12.5h6"/>"""),

        ["graduation-cap"] = new("""<path d="M2.5 9.5 12 5.5l9.5 4L12 13.5z"/><path d="M6.5 11.6V16c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5v-4.4"/><path d="M20.8 10.2v4.6"/>"""),

        ["school"] = new("""<path d="M4 20V10l8-4.5 8 4.5v10z"/><path d="M12 5.5V2.6"/><path d="M12 2.6h3.6v2.2H12"/><rect x="10" y="14" width="4" height="6"/>"""),

        ["train"] = new("""<rect x="6" y="4" width="12" height="12" rx="2.5"/><path d="M6 11h12"/><path d="M9 13.6h.01M15 13.6h.01"/><path d="M8.5 16 6 20M15.5 16l2.5 4"/>"""),

        ["plane"] = new("""<path d="M10.5 5.2a1.5 1.5 0 0 1 3 0V10l7 4v1.9l-7-2.1v3.7l2 1.4v1.6l-3.5-1-3.5 1v-1.6l2-1.4v-3.7L3.5 15.9V14l7-4z"/>"""),

        ["ship"] = new("""<path d="M4.5 15 6 10h12l1.5 5"/><path d="M12 10V6M9.6 6h4.8"/><path d="M3 16.6c1.8 0 1.8 2 3.6 2s1.8-2 3.6-2 1.8 2 3.6 2 1.8-2 3.6-2 1.8 2 3.6 2"/>"""),

        ["car"] = new("""<path d="M4.2 14.5 5.6 10a2 2 0 0 1 1.9-1.4h9a2 2 0 0 1 1.9 1.4l1.4 4.5"/><path d="M4 14.5h16v4H4z"/><path d="M7.4 18.5v1.6M16.6 18.5v1.6"/>"""),

        ["car-front"] = new("""<path d="M4.2 13.5 5.6 9.4A2 2 0 0 1 7.5 8h9a2 2 0 0 1 1.9 1.4l1.4 4.1"/><rect x="3.6" y="13.5" width="16.8" height="5" rx="1.4"/><path d="M7 18.5v1.5M17 18.5v1.5"/><path d="M6.8 16h1.8M15.4 16h1.8"/>"""),

        ["shopping-cart"] = new("""<path d="M3 4.6h2.6l2.4 10.4h9.6L20 8H7.2"/><path d="M9.6 19.2h.01M17 19.2h.01"/><circle cx="9.6" cy="19.2" r="1.5"/><circle cx="17" cy="19.2" r="1.5"/>"""),

        ["shopping-bag"] = new("""<path d="M5.4 8h13.2l-1.1 12H6.5z"/><path d="M9 10.2V7a3 3 0 0 1 6 0v3.2"/>"""),

        ["shopping-basket"] = new("""<path d="M3.6 10h16.8l-1.6 8.6H5.2z"/><path d="M8.6 10 11 4.6M15.4 10 13 4.6"/><path d="M10 13.4v2.4M14 13.4v2.4"/>"""),

        ["monitor"] = new("""<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M12 17v3M9 20h6"/>"""),

        ["shirt"] = new("""<path d="M8.6 4.4 5 6.4 3.6 10l3 1.5V20h10.8v-8.5l3-1.5L19 6.4l-3.6-2a3.4 3.4 0 0 1-6.8 0z"/>"""),

        ["armchair"] = new("""<path d="M6.4 11V8.2a2 2 0 0 1 2-2h7.2a2 2 0 0 1 2 2V11"/><path d="M5 11h14v6.4H5z"/><path d="M7.4 17.4V20M16.6 17.4V20"/>"""),

        ["banknote"] = new("""<rect x="3" y="7" width="18" height="10" rx="1.8"/><circle cx="12" cy="12" r="2.3"/><path d="M6.4 10v4M17.6 10v4"/>"""),

        ["badge-dollar-sign"] = new("""<circle cx="12" cy="12" r="7.6"/><path d="M12 7v10"/><path d="M14.4 9.6c-.6-.8-1.4-1.2-2.4-1.2-1.3 0-2.3.8-2.3 1.9s.9 1.6 2.3 1.8 2.5.7 2.5 1.9-1.1 1.9-2.5 1.9c-1.1 0-2-.4-2.5-1.3"/>"""),

        ["building-2"] = new("""<rect x="3.6" y="6" width="7.2" height="14"/><rect x="10.8" y="10" width="9.6" height="10"/><path d="M6 9.2h2.4M6 13h2.4M6 16.6h2.4M13.6 13.4h3.6M13.6 17h3.6"/>"""),

        ["shield"] = new("""<path d="M12 3.4 5 6.4v5.2c0 4.5 3 7.8 7 9.2 4-1.4 7-4.7 7-9.2V6.4z"/>"""),

        ["castle"] = new("""<path d="M4 20V9h3V6l2.5 2L12 5l2.5 3L17 6v3h3v11z"/><path d="M10.2 20v-4.4h3.6V20"/>"""),

        ["church"] = new("""<path d="M12 3.4v5.4M9.4 6h5.2"/><path d="M6 20v-8.2l6-3.4 6 3.4V20z"/><path d="M10.2 20v-4.4h3.6V20"/>"""),

        ["landmark"] = new("""<path d="M3.4 20h17.2"/><path d="M5.4 20v-8M9.8 20v-8M14.2 20v-8M18.6 20v-8"/><path d="M12 4 20.4 8.8H3.6z"/>"""),

        ["dumbbell"] = new("""<path d="M4.4 9.2v5.6M7.6 7.4v9.2M16.4 7.4v9.2M19.6 9.2v5.6"/><path d="M7.6 12h8.8"/>"""),

        ["users"] = new("""<circle cx="9.2" cy="8.8" r="3.4"/><path d="M3.4 19.4a5.8 5.8 0 0 1 11.6 0"/><path d="M16.4 6a3.4 3.4 0 0 1 0 5.6"/><path d="M17.8 14.2a5.8 5.8 0 0 1 3 5.2"/>"""),

        ["heart-handshake"] = new("""<path d="M12 19.6S5 15.2 5 10.6A3.9 3.9 0 0 1 12 8.2a3.9 3.9 0 0 1 7 2.4c0 4.6-7 9-7 9z"/><path d="M9.4 12.2 11 13.8a1.4 1.4 0 0 0 2 0l1.6-1.6"/>"""),

        ["party-popper"] = new("""<path d="M3.6 20.4 8.8 7.6l7.6 7.6z"/><path d="M15 4.4v2.4M18.4 8.6h2.4M17.6 5.6 19.4 3.8M13.2 10.4h.01M17.4 13h.01"/>"""),

        ["music"] = new("""<path d="M9.2 17.4V6.6l9.6-2v10.8"/><circle cx="6.6" cy="17.4" r="2.6"/><circle cx="16.2" cy="15.4" r="2.6"/>"""),

        ["coffee"] = new("""<path d="M4.6 8.4h12.8v5.8a4.2 4.2 0 0 1-4.2 4.2H8.8a4.2 4.2 0 0 1-4.2-4.2z"/><path d="M17.4 10.2h1.4a2.4 2.4 0 0 1 0 4.8h-1.4"/><path d="M8.4 4v2.2M12.4 3.6v2.6"/>"""),

        ["utensils"] = new("""<path d="M6.4 4v4.4a2.4 2.4 0 0 0 4.8 0V4"/><path d="M8.8 8.8V20"/><path d="M17.4 4c-1.5 0-2.6 2.1-2.6 4.7s1.1 3.7 2.6 3.7V20"/>"""),

        ["utensils-crossed"] = new("""<path d="M5.4 4.6 14.6 19"/><path d="M18.6 4.6 9.4 19"/><path d="M5.4 4.6h2.2v2.6M18.6 4.6h-2.2v2.6"/>"""),

        ["wheat"] = new("""<path d="M12 20.4V8.2"/><path d="M12 12.4c-2.2 0-3.8-1.7-3.8-3.9 2.2 0 3.8 1.7 3.8 3.9z"/><path d="M12 12.4c2.2 0 3.8-1.7 3.8-3.9-2.2 0-3.8 1.7-3.8 3.9z"/><path d="M12 8c-2.2 0-3.8-1.7-3.8-3.9C10.4 4.1 12 5.8 12 8z"/><path d="M12 8c2.2 0 3.8-1.7 3.8-3.9C13.6 4.1 12 5.8 12 8z"/>"""),

        ["trees"] = new("""<path d="M8.4 4.4 12.6 11H4.2z"/><path d="M8.4 8.6 13 15.4H3.8z"/><path d="M8.4 15.4V20.2"/><path d="M16.6 8 20.4 13.8h-7.6z"/><path d="M16.6 13.8V20.2"/>"""),

        ["factory"] = new("""<path d="M3 20v-9.4l5 3.2v-3.2l5 3.2V7.6h5.2L20 20z"/><path d="M7 16.4v2M11.4 16.4v2M15.8 16.4v2"/>"""),

        ["recycle"] = new("""<path d="M12 4.6 15.8 11H8.2z"/><path d="M6.4 13.2 10.2 19.6H2.6z"/><path d="M17.6 13.2 21.4 19.6h-7.6z"/>"""),

        ["route"] = new("""<circle cx="6.4" cy="18.4" r="2.4"/><circle cx="17.6" cy="5.6" r="2.4"/><path d="M15.2 5.6H9.6a3.6 3.6 0 0 0 0 7.2h4.8a3.6 3.6 0 0 1 0 7.2H8.8"/>"""),

        ["radio-tower"] = new("""<path d="M12 11.8V20.4M8.8 20.4h6.4"/><circle cx="12" cy="9" r="1.9"/><path d="M8.8 5.6a4.8 4.8 0 0 0 0 6.8M15.2 5.6a4.8 4.8 0 0 1 0 6.8"/><path d="M6.2 3.2a8.4 8.4 0 0 0 0 11.6M17.8 3.2a8.4 8.4 0 0 1 0 11.6"/>"""),

        ["zap"] = new("""<path d="M13.2 2.8 5.2 13.6h6.4l-1 7.6 8-10.8h-6.4z"/>"""),

        ["battery-charging"] = new("""<path d="M8.4 7H5a2.2 2.2 0 0 0-2.2 2.2v5.6A2.2 2.2 0 0 0 5 17h3"/><path d="M15.6 7H19a2.2 2.2 0 0 1 2.2 2.2v5.6A2.2 2.2 0 0 1 19 17h-3.4"/><path d="M12.8 5.8 9.4 12.4h4.4l-3 5.8"/>"""),

        ["gauge"] = new("""<path d="M4.2 17.4a8.6 8.6 0 1 1 15.6 0"/><path d="M12 14.2 16.2 9"/><circle cx="12" cy="14.6" r="1.5"/>"""),

        ["hammer"] = new("""<path d="M13.8 4.4 19.6 10.2 17 12.8 11.2 7z"/><path d="M12.4 8 5.2 15.2a1.9 1.9 0 0 0 2.6 2.6L15 10.6"/>"""),

        ["key-round"] = new("""<circle cx="8.8" cy="9.4" r="3.8"/><path d="m11.4 12.2 8 8"/><path d="m16.8 17.6 2-2"/>"""),

        ["house"] = new("""<path d="M3.6 11 12 4.6l8.4 6.4v9.4H3.6z"/><path d="M9.8 20.4v-5.6h4.4v5.6"/>"""),

        ["store"] = new("""<path d="M3.4 9.2 5.2 4.6h13.6l1.8 4.6"/><path d="M5 9.2v11.2h14V9.2"/><path d="M9.6 20.4v-6h4.8v6"/>"""),

        ["map-pin"] = new("""<path d="M12 21.4s6.8-5.6 6.8-11a6.8 6.8 0 1 0-13.6 0c0 5.4 6.8 11 6.8 11z"/><circle cx="12" cy="10.2" r="2.6"/>"""),
    };
}
