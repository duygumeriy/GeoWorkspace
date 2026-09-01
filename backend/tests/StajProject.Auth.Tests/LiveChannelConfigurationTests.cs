using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Http;
using StajProject.Application.Simulation;

namespace StajProject.Auth.Tests;

/// <summary>
/// Canlı kanalların YAPILANDIRMA sözleşmesi.
/// </summary>
/// <remarks>
/// Manuel kabul testinde her iki SignalR ürünü de pazarlık aşamasında
/// düşüyordu. Buradaki iddialar, o sınıftaki arızaların sessizce geri
/// dönmesini engeller: yol uyuşmazlığı, eksik token okuması, kayıp hub
/// eşlemesi ve köken listesinin kaybolması.
/// </remarks>
public sealed class LiveChannelConfigurationTests
{
    private static string Program()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !Directory.Exists(Path.Combine(directory.FullName, "src")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        return File.ReadAllText(Path.Combine(directory!.FullName, "src/StajProject.Api/Program.cs"));
    }

    [Fact]
    public void The_two_hub_paths_are_canonical_and_distinct()
    {
        Assert.Equal("/hubs/transport-simulation", TransportSimulationHubContract.Path);
        Assert.Equal("/hubs/journey-simulation", JourneySimulationHubContract.Path);

        /* İki ÜRÜN, iki yol, iki grup. Aynı yolu paylaşmak, farklı yetki
           anlamına sahip iki ürünü aynı yayına sokardı. */
        Assert.NotEqual(TransportSimulationHubContract.Path, JourneySimulationHubContract.Path);
        Assert.NotEqual(TransportSimulationHubContract.UpdateMethod, JourneySimulationHubContract.UpdateMethod);
    }

    [Fact]
    public void Both_hubs_are_mapped_from_the_shared_contract_not_from_a_literal()
    {
        var program = Program();

        /* Yol bir DİZİ olarak yazılsaydı, istemcinin okuduğu sabitle sessizce
           ayrışabilirdi. */
        Assert.Contains("MapHub<TransportSimulationHub>(TransportSimulationHubContract.Path)", program, StringComparison.Ordinal);
        Assert.Contains("MapHub<JourneySimulationHub>(JourneySimulationHubContract.Path)", program, StringComparison.Ordinal);
    }

    /// <summary>
    /// Adı verilen lambda/blok gövdesini SÜSLÜ PARANTEZ sayarak ayıklar.
    /// </summary>
    /// <remarks>
    /// Kaynağı "şu metinden şu metne kadar" diye kesmek kırılgandır: aranan
    /// bitiş işareti kaynakta hiç bulunmayabilir ve <c>IndexOf</c> -1 döner.
    /// Sınır burada gerçek blok yapısından okunur.
    /// </remarks>
    private static string BlockAfter(string source, string marker)
    {
        var start = source.IndexOf(marker, StringComparison.Ordinal);
        Assert.True(start >= 0, $"{marker} bulunamadı");

        var open = source.IndexOf('{', start);
        Assert.True(open >= 0, $"{marker} gövdesi bulunamadı");

        var depth = 0;

        for (var index = open; index < source.Length; index++)
        {
            if (source[index] == '{')
            {
                depth++;
            }
            else if (source[index] == '}')
            {
                depth--;

                if (depth == 0)
                {
                    return source[open..(index + 1)];
                }
            }
        }

        Assert.Fail($"{marker} gövdesinin kapanışı bulunamadı");
        return string.Empty;
    }

    [Fact]
    public void The_query_string_token_is_read_for_both_hub_paths_and_only_for_them()
    {
        var handler = BlockAfter(Program(), "OnMessageReceived = context =>");

        /* WebSocket el sıkışması Authorization başlığı taşıyamaz; token
           yalnızca HUB yollarında sorgu dizesinden okunur. */
        Assert.Contains("Query[\"access_token\"]", handler, StringComparison.Ordinal);
        Assert.Contains("context.Token = accessToken;", handler, StringComparison.Ordinal);

        // Kapı İKİ kanonik sabitle kurulur; yol dizesi elle yazılmaz.
        Assert.Contains("TransportSimulationHubContract.Path", handler, StringComparison.Ordinal);
        Assert.Contains("JourneySimulationHubContract.Path", handler, StringComparison.Ordinal);
        Assert.Contains("StartsWithSegments", handler, StringComparison.Ordinal);

        /* Ve BAŞKA bir yol kabul edilmez: koşulda yalnızca bu iki sabit geçer.
           Üçüncü bir yol eklenirse bu sayım kırılır. */
        Assert.Equal(2, Regex.Matches(handler, @"StartsWithSegments\(").Count);
        Assert.DoesNotContain("\"/api", handler, StringComparison.Ordinal);
    }

    [Fact]
    public void Only_the_two_hub_paths_satisfy_the_query_token_gate()
    {
        /* Kuralın KENDİSİ çalıştırılır: üretimdeki koşulun aynısı, üretimdeki
           sabitlerle. Böylece iddia bir metin değil, bir davranıştır. */
        static bool AcceptsQueryToken(string requestPath)
        {
            var path = new PathString(requestPath);

            return path.StartsWithSegments(TransportSimulationHubContract.Path, StringComparison.Ordinal)
                || path.StartsWithSegments(JourneySimulationHubContract.Path, StringComparison.Ordinal);
        }

        // Hub yolları ve alt segmentleri (negotiate) kabul edilir.
        Assert.True(AcceptsQueryToken(TransportSimulationHubContract.Path));
        Assert.True(AcceptsQueryToken(JourneySimulationHubContract.Path));
        Assert.True(AcceptsQueryToken($"{TransportSimulationHubContract.Path}/negotiate"));
        Assert.True(AcceptsQueryToken($"{JourneySimulationHubContract.Path}/negotiate"));

        /* REST uçları KABUL EDİLMEZ: sorgu dizesindeki token sunucu loglarına
           ve tarayıcı geçmişine sızardı. */
        foreach (var rest in (string[])
                 [
                     "/api/transport/journeys/simulations",
                     "/api/auth/login",
                     "/api/transport/routes/7",
                     "/hubs",
                     "/hubs/other-simulation",
                     "/hubs/transport-simulationX"
                 ])
        {
            Assert.False(AcceptsQueryToken(rest), $"{rest} sorgu dizesinden token kabul ediyor");
        }
    }

    [Fact]
    public void Header_based_bearer_authentication_is_extended_not_replaced()
    {
        var events = BlockAfter(Program(), "options.Events = new JwtBearerEvents");

        /* Tek olay eklenir ve o da YALNIZCA token'ın NEREDEN okunacağını
           değiştirir: doğrulama kuralları, imza denetimi ve başlıktan gelen
           bearer akışı olduğu gibi kalır. */
        Assert.Contains("OnMessageReceived", events, StringComparison.Ordinal);
        Assert.Equal(1, Regex.Matches(events, @"On\w+ =").Count);

        var program = Program();
        Assert.Contains("AddJwtBearer", program, StringComparison.Ordinal);
        Assert.Contains("TokenValidationParameters", program, StringComparison.Ordinal);
        // Token yalnızca kapıdan geçen istekte atanır; ikinci bir atama yoktur.
        Assert.Equal(1, Regex.Matches(program, @"context\.Token = ").Count);
    }

    [Fact]
    public void The_development_origin_is_explicit_so_the_negotiation_is_not_blocked()
    {
        var program = Program();
        var cors = program[program.IndexOf("AddCors", StringComparison.Ordinal)..];
        cors = cors[..cors.IndexOf("var app = builder.Build();", StringComparison.Ordinal)];

        // Vite kökeni AÇIKÇA listelenir.
        Assert.Contains("http://localhost:5173", cors, StringComparison.Ordinal);
        Assert.Contains("AllowAnyHeader", cors, StringComparison.Ordinal);
        Assert.Contains("AllowAnyMethod", cors, StringComparison.Ordinal);

        /* `AllowAnyOrigin` ile çerez birlikte KULLANILAMAZ ve zaten gerekmez:
           istemci çerez göndermez (bkz. frontend `withCredentials: false`),
           oturum bir bearer token'dır. Köken listesi bu yüzden dar kalır. */
        Assert.DoesNotContain("AllowAnyOrigin", cors, StringComparison.Ordinal);
        Assert.DoesNotContain("AllowCredentials", cors, StringComparison.Ordinal);
    }

    [Fact]
    public void Cors_runs_before_authentication_so_the_negotiate_preflight_is_answered()
    {
        var program = Program();

        var routing = program.IndexOf("app.UseRouting();", StringComparison.Ordinal);
        var cors = program.IndexOf("app.UseCors(", StringComparison.Ordinal);
        var authentication = program.IndexOf("app.UseAuthentication();", StringComparison.Ordinal);
        var authorization = program.IndexOf("app.UseAuthorization();", StringComparison.Ordinal);

        Assert.True(routing < cors, "UseCors, UseRouting'den sonra gelmelidir");
        Assert.True(cors < authentication, "UseCors, kimlik doğrulamadan ÖNCE gelmelidir");
        Assert.True(authentication < authorization);
    }

    [Fact]
    public void Both_simulation_runtimes_are_registered_as_hosted_services()
    {
        var program = Program();

        /* Hareketin sunucu tarafındaki üreticileri: kayıtlı değillerse hiçbir
           simülasyon ilerlemez ve arayüz sonsuza dek %0'da kalırdı. */
        Assert.Contains("AddHostedService<TransportSimulationBackgroundService>()", program, StringComparison.Ordinal);
        Assert.Contains("AddHostedService<JourneySimulationBackgroundService>()", program, StringComparison.Ordinal);
        Assert.Contains("AddSingleton<TransportSimulationRunner>()", program, StringComparison.Ordinal);
        Assert.Contains("AddSingleton<JourneySimulationRunner>()", program, StringComparison.Ordinal);
    }

    [Fact]
    public void Exactly_two_live_products_are_mapped_and_they_stay_separate()
    {
        var program = Program();
        var hubs = Regex.Matches(program, @"MapHub<(\w+)>").Select(match => match.Groups[1].Value).ToArray();

        Assert.Equal(["TransportSimulationHub", "JourneySimulationHub"], hubs);
    }
}
