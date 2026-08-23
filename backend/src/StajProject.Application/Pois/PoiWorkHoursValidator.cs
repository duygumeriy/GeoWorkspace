using System.Text.Json;
using StajProject.Application.Common;
using StajProject.Application.DTOs;

namespace StajProject.Application.Pois;

/// <summary>
/// Haftalık mesai programının doğrulaması ve <c>jsonb</c> kolonuna yazılan
/// metne dönüşümü.
/// </summary>
/// <remarks>
/// <para>
/// <b>Tek bir JSON yapısı vardır</b> ve o da <see cref="PoiWorkHoursDto"/>'nun
/// kendisidir: yazma ve okuma aynı tipi kullanır, dolayısıyla saklanan biçimle
/// API sözleşmesi ayrışamaz. Ayrı bir "storage model" tanımlamak, iki şemayı
/// elle senkron tutmak demekti.
/// </para>
/// <para>
/// <b>Okuma asla patlamaz.</b> Kolonda elle yazılmış ya da eski biçimde bir
/// değer bulunabilir; bozuk JSON tüm POI listesini 500'e çevirmemelidir.
/// <see cref="Deserialize"/> bu yüzden başarısızlıkta <c>null</c> döner — POI
/// mesai bilgisi olmadan görünür, kaybolmaz.
/// </para>
/// </remarks>
public static class PoiWorkHoursValidator
{
    /// <summary>Gün adları ve o günün programına erişim.</summary>
    private static readonly (string Name, Func<PoiWorkHoursDto, PoiWorkHoursDayDto?> Read)[] Days =
    [
        ("monday", w => w.Monday),
        ("tuesday", w => w.Tuesday),
        ("wednesday", w => w.Wednesday),
        ("thursday", w => w.Thursday),
        ("friday", w => w.Friday),
        ("saturday", w => w.Saturday),
        ("sunday", w => w.Sunday)
    ];

    /* Kolonda saklanan JSON, API'de görünen gövdeyle aynı camelCase
       adlandırmayı kullanır; böylece bir satırı elle okumak da sözleşmeyi
       okumakla aynı şeydir. */
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
    };

    /// <summary>
    /// Programı doğrular ve saklanacak JSON metnini üretir.
    /// </summary>
    /// <returns>
    /// Mesai gönderilmemişse (veya hiçbir gün bildirilmemişse) <c>null</c> —
    /// kolon boş kalır. "Boş program" ile "program yok" veritabanında tek
    /// biçimde temsil edilir.
    /// </returns>
    public static ServiceResult<string?> ValidateAndSerialize(PoiWorkHoursDto? workHours)
    {
        if (workHours is null)
        {
            return ServiceResult<string?>.Success(null);
        }

        var normalized = new PoiWorkHoursDto();
        var declared = 0;

        foreach (var (name, read) in Days)
        {
            var day = read(workHours);

            if (day is null)
            {
                // Gün gönderilmedi: "bilinmiyor" durumu korunur, kapalı SAYILMAZ.
                continue;
            }

            var validated = ValidateDay(name, day);

            if (!validated.IsSuccess)
            {
                return ServiceResult<string?>.Failure(validated.Error!);
            }

            Write(normalized, name, validated.Value!);
            declared++;
        }

        return declared == 0
            ? ServiceResult<string?>.Success(null)
            : ServiceResult<string?>.Success(JsonSerializer.Serialize(normalized, SerializerOptions));
    }

    /// <summary>
    /// Saklanan JSON'u sözleşme tipine çevirir. Boş veya bozuk değerde
    /// <c>null</c> döner ve hata fırlatmaz.
    /// </summary>
    public static PoiWorkHoursDto? Deserialize(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<PoiWorkHoursDto>(json, SerializerOptions);
        }
        catch (JsonException)
        {
            /* Bozuk satır tek bir POI'yi mesaisiz gösterir; listenin tamamını
               düşürmez. Sessiz yutma bilinçlidir çünkü buradaki alternatif —
               istisna fırlatmak — okuma ucunun tamamını bir tek kötü satıra
               bağımlı kılardı. */
            return null;
        }
    }

    private static ServiceResult<PoiWorkHoursDayDto> ValidateDay(string dayName, PoiWorkHoursDayDto day)
    {
        if (day.Closed)
        {
            /* Kapalı bir günde saat bilgisi anlamsızdır ve SAKLANMAZ: gönderilse
               bile temizlenir, böylece "kapalı ama 09:00-18:00" gibi kendi
               içinde çelişen bir satır hiç oluşmaz. */
            return ServiceResult<PoiWorkHoursDayDto>.Success(new PoiWorkHoursDayDto { Closed = true });
        }

        var open = ParseTime(day.Open);
        var close = ParseTime(day.Close);

        if (open is null)
        {
            return ServiceResult<PoiWorkHoursDayDto>.Failure(
                $"{dayName}: açılış saati zorunludur ve HH:mm biçiminde olmalıdır.");
        }

        if (close is null)
        {
            return ServiceResult<PoiWorkHoursDayDto>.Failure(
                $"{dayName}: kapanış saati zorunludur ve HH:mm biçiminde olmalıdır.");
        }

        if (open.Value >= close.Value)
        {
            return ServiceResult<PoiWorkHoursDayDto>.Failure(
                $"{dayName}: açılış saati kapanış saatinden önce olmalıdır.");
        }

        /* Değerler GELDİĞİ GİBİ saklanır. Girdi zaten tam olarak HH:mm
           olduğu için kanonikleştirecek bir şey yoktur; "9:00"u "09:00"a
           çevirmek, sözleşmenin reddettiği bir girdiyi sessizce kabul etmek
           olurdu. */
        return ServiceResult<PoiWorkHoursDayDto>.Success(new PoiWorkHoursDayDto
        {
            Closed = false,
            Open = day.Open,
            Close = day.Close
        });
    }

    /// <summary>
    /// KATI <c>HH:mm</c> ayrıştırması. Gece yarısından itibaren geçen dakika
    /// döner; biçim tam olarak uymuyorsa <c>null</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Kabul edilen tek biçim beş karakterlik <c>HH:mm</c>'dir</b>: iki
    /// haneli saat, iki nokta üst üste, iki haneli dakika. <c>9:00</c>,
    /// <c>09:5</c> ve baştaki/sondaki boşluklu değerler reddedilir —
    /// düzeltilmez. Esnek kabul edip kanonikleştirmek, sözleşmenin geçersiz
    /// saydığı bir girdiyi sessizce geçerli kılardı ve istemciler biçimi
    /// yalnızca kısmen uygulamaya başlardı.
    /// </para>
    /// <para>
    /// Aralık da AÇIKÇA sınanır: saat 00-23, dakika 00-59. <c>24:00</c> ve
    /// <c>12:60</c> geçerli bir günün saati değildir.
    /// </para>
    /// <para>
    /// Ayrıştırma elle yapılır ve kültüre bağlı bir API kullanılmaz: sunucunun
    /// yerel ayarına göre değişen bir saat okuması, aynı gövdenin iki kurulumda
    /// farklı sonuç vermesi demek olurdu.
    /// </para>
    /// </remarks>
    private static int? ParseTime(string? value)
    {
        if (value is not { Length: 5 } time
            || time[2] != ':'
            || !IsDigit(time[0]) || !IsDigit(time[1])
            || !IsDigit(time[3]) || !IsDigit(time[4]))
        {
            return null;
        }

        var hours = ((time[0] - '0') * 10) + (time[1] - '0');
        var minutes = ((time[3] - '0') * 10) + (time[4] - '0');

        return hours > 23 || minutes > 59 ? null : (hours * 60) + minutes;
    }

    private static bool IsDigit(char value) => value is >= '0' and <= '9';

    private static void Write(PoiWorkHoursDto target, string dayName, PoiWorkHoursDayDto day)
    {
        switch (dayName)
        {
            case "monday": target.Monday = day; break;
            case "tuesday": target.Tuesday = day; break;
            case "wednesday": target.Wednesday = day; break;
            case "thursday": target.Thursday = day; break;
            case "friday": target.Friday = day; break;
            case "saturday": target.Saturday = day; break;
            default: target.Sunday = day; break;
        }
    }
}
