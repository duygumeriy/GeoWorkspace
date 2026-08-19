using System.Collections.Concurrent;
using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace StajProject.Api.Activity;

/// <summary>
/// Aktivite kaydının "ayrıntılar" alanını üretir.
/// </summary>
/// <remarks>
/// <para>
/// <b>Buradaki kural bir söz değil, YAPISAL bir kısıttır:</b> istek
/// gövdesinden hiçbir METİN ayrıntılara giremez. Gövdeden yalnızca
/// <c>enum</c> tipli alanlar okunur — <c>string</c>, <c>byte[]</c> ve benzeri
/// serbest içerikli tipler tip düzeyinde elenir. Parolanın, token'ın, kurtarma
/// kodunun ya da bir poligonun tüm WKT'sinin buraya sızabileceği bir yol
/// yoktur; "şu alanı hariç tut" listesi tutulmadığı için yeni eklenen bir
/// gövde alanı da bu kısıttan kaçamaz.
/// </para>
/// <para>
/// <b>Rota değerleri güvenlidir</b> ama yine de biçim denetiminden geçirilir:
/// yalnızca kısa, alfanümerik değerler alınır. Rotaların tamamı bugün tamsayı
/// kısıtlıdır; denetim, ileride eklenecek serbest bir rota parçasının kayda
/// keyfi metin taşımasını engeller.
/// </para>
/// </remarks>
public static class ActivityDetails
{
    /// <summary>Rota değerlerinde kabul edilen biçim: kısa ve alfanümerik.</summary>
    private static readonly Regex SafeRouteValue = new("^[A-Za-z0-9_-]{1,64}$", RegexOptions.Compiled);

    /// <summary>Rota anahtarı olarak taşınan ama ayrıntı OLMAYAN değerler.</summary>
    private static readonly HashSet<string> RouteNoise =
        new(StringComparer.OrdinalIgnoreCase) { "controller", "action", "area", "page" };

    /// <summary>Tip başına enum özellik listesi; her istekte reflection yapılmaz.</summary>
    private static readonly ConcurrentDictionary<Type, PropertyInfo[]> EnumProperties = new();

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>
    /// Ayrıntı JSON'u; yazılacak bir şey yoksa <c>null</c> (boş bir <c>{}</c>
    /// saklamanın anlamı yoktur).
    /// </summary>
    public static string? Build(
        IEnumerable<KeyValuePair<string, object?>> routeValues,
        IEnumerable<KeyValuePair<string, object?>> actionArguments)
    {
        var details = new SortedDictionary<string, object?>(StringComparer.Ordinal);

        foreach (var (key, value) in routeValues)
        {
            if (RouteNoise.Contains(key) || value is null)
            {
                continue;
            }

            var text = value.ToString();
            if (text is not null && SafeRouteValue.IsMatch(text))
            {
                details[key] = text;
            }
        }

        foreach (var (_, argument) in actionArguments)
        {
            CollectEnums(argument, details);
        }

        return details.Count == 0 ? null : JsonSerializer.Serialize(details, Json);
    }

    /// <summary>
    /// Model-bind edilmiş bir argümanın enum tipli alanlarını toplar.
    /// </summary>
    /// <remarks>
    /// Yalnızca BİR seviye derine inilir ve yalnızca enum'lar alınır. Derine
    /// inen genel bir serileştirme, kaydı istek gövdesinin kopyasına
    /// çevirirdi — tam olarak kaçınılan şey.
    /// </remarks>
    private static void CollectEnums(object? argument, IDictionary<string, object?> details)
    {
        if (argument is null)
        {
            return;
        }

        var type = argument.GetType();

        if (type.IsEnum)
        {
            details[type.Name] = argument.ToString();
            return;
        }

        // Skalerler ve koleksiyonlar ilgilenilen şey değildir.
        if (type.IsPrimitive || argument is string || argument is System.Collections.IEnumerable)
        {
            return;
        }

        foreach (var property in EnumProperties.GetOrAdd(type, ReadEnumProperties))
        {
            var value = property.GetValue(argument);
            if (value is not null)
            {
                details[property.Name] = value.ToString();
            }
        }
    }

    private static PropertyInfo[] ReadEnumProperties(Type type) =>
        [.. type.GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Where(p => p.CanRead && p.GetIndexParameters().Length == 0)
            .Where(p => IsEnum(p.PropertyType))];

    private static bool IsEnum(Type type) =>
        type.IsEnum || (Nullable.GetUnderlyingType(type)?.IsEnum ?? false);
}
