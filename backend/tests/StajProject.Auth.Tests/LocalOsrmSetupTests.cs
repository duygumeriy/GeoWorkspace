using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using StajProject.Application.Interfaces;
using StajProject.Application.Journeys;
using StajProject.Application.Options;
using StajProject.Infrastructure.Routing;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

/// <summary>
/// Faz 5E-A: yerel OSRM kurulumunun ÜÇ profili gerçekten çalıştırabilmesi.
/// </summary>
/// <remarks>
/// <para>
/// Bunlar KAYNAK/YAPILANDIRMA sözleşmesi testleridir. Gerçek yönlendirmeyi
/// sınamak çalışan üç OSRM konteyneri ve çok gigabaytlık bir harita çıkarımı
/// gerektirirdi; korunması gereken asıl şey ise bir hesap değil, bir
/// KURULUM İDDİASIDIR: her profilin kendi ön işlenmiş veri kümesi ve kendi
/// sunucusu vardır. Bu, dosyaların kendisinden doğrulanabilir ve Docker/ağ
/// istemez.
/// </para>
/// </remarks>
public sealed class LocalOsrmSetupTests
{
    private static readonly string OsrmRoot = FindOsrmToolsDirectory();
    private static readonly string Compose = ReadTool("docker-compose.osrm.yml");
    private static readonly string EnvExample = ReadTool(".env.example");
    private static readonly string Readme = ReadTool("README.md");
    private static readonly string PrepareScript = ReadTool("prepare-osrm.sh");
    private static readonly string DevelopmentSettings = ReadDevelopmentSettings();

    /// <summary>Yayın satırının deseni: değişken adı ve VARSAYILAN port.</summary>
    private const string PublishedPortPattern =
        @"-\s*""\$\{(?<name>[A-Z_]+):-(?<port>\d+)\}:\d+""";

    private const string EnvPortPattern = @"^(?<name>OSRM[A-Z_]*HOST_PORT)=(?<port>\d+)\s*$";

    /// <summary>
    /// Compose'da yayınlanan portlar: değişken adı → VARSAYILAN değer.
    /// </summary>
    /// <remarks>
    /// Kullanıcının gitignore'lanmış <c>.env</c>'i BİLİNÇLİ olarak okunmaz —
    /// test izlenen sözleşmeyi korur, bir geliştiricinin makinesini değil.
    /// Çözülmüş ortamın doğrulaması <c>docker compose config</c>'in işidir.
    /// </remarks>
    private static readonly IReadOnlyDictionary<string, int> PublishedPorts = ParsePublishedPorts(Compose);

    /* --- Profil kümesi ----------------------------------------------------------- */

    [Fact]
    public void The_product_profiles_stay_exactly_driving_walking_and_cycling()
    {
        Assert.Equal(
            [JourneyTravelProfile.Driving, JourneyTravelProfile.Walking, JourneyTravelProfile.Cycling],
            Enum.GetValues<JourneyTravelProfile>());

        // Yerel kurulum da tam olarak bu üçü için veri kümesi hazırlar.
        foreach (var lua in (string[])["car.lua", "foot.lua", "bicycle.lua"])
        {
            Assert.Contains(lua, Compose, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void Bus_and_transit_stay_absent_from_the_local_setup()
    {
        foreach (var artifact in (string[])[Compose, EnvExample, PrepareScript])
        {
            foreach (var forbidden in (string[])["bus.lua", "gtfs", "transit"])
            {
                Assert.DoesNotContain(forbidden, artifact, StringComparison.OrdinalIgnoreCase);
            }
        }
    }

    /* --- Profil başına AYRI veri kümesi ------------------------------------------ */

    [Fact]
    public void Each_profile_is_extracted_with_its_own_lua_profile()
    {
        /* ASIL İDDİA: profil veri kümesine GÖMÜLÜR. Üç ayrı extract komutu
           olmadan, üç sunucu aynı sürüş verisini farklı adlarla sunardı. */
        Assert.Contains("osrm-extract -p /opt/car.lua", Compose, StringComparison.Ordinal);
        Assert.Contains("osrm-extract -p /opt/foot.lua", Compose, StringComparison.Ordinal);
        Assert.Contains("osrm-extract -p /opt/bicycle.lua", Compose, StringComparison.Ordinal);
    }

    [Fact]
    public void Walking_and_cycling_write_their_artifacts_outside_the_driving_directory()
    {
        /* osrm-extract çıktısını GİRDİSİNİN yanına yazar; yürüyüş çıkarımı
           sürüş dizinine bakarsa sürüş veri kümesini yerinde EZER. */
        Assert.Contains("OSRM_WALKING_DATA_DIR:-./data/walking", Compose, StringComparison.Ordinal);
        Assert.Contains("OSRM_CYCLING_DATA_DIR:-./data/cycling", Compose, StringComparison.Ordinal);

        Assert.NotEqual("./data/walking", "./data");
        Assert.NotEqual("./data/cycling", "./data/walking");

        // Ve hazırlama betiği bunu çalışma anında da reddeder.
        Assert.Contains("assert_distinct_output", PrepareScript, StringComparison.Ordinal);
        Assert.Contains("would overwrite the driving dataset", PrepareScript, StringComparison.Ordinal);
    }

    [Fact]
    public void Every_engine_publishes_through_its_own_overridable_variable()
    {
        // Hiçbir port SABİT yazılmaz; üçü de ortamdan geçersiz kılınabilir.
        Assert.Equal(3, PublishedPorts.Count);
        Assert.Equal(
            ["OSRM_CYCLING_HOST_PORT", "OSRM_HOST_PORT", "OSRM_WALKING_HOST_PORT"],
            PublishedPorts.Keys.OrderBy(name => name, StringComparer.Ordinal));
    }

    [Fact]
    public void The_optional_profile_defaults_cannot_collide_with_driving()
    {
        /* ESKİ TESTİN KAÇIRDIĞI HATA. Önceki sürüm yalnızca dizgelerin var
           olduğunu doğruluyordu: varsayılanlar 5000/5001/5002 iken "hepsi
           yazılmış" diyordu ve ÇAKIŞMAYI göremiyordu. Sürüş portu ise
           bilinçle geçersiz kılınabilir (bu kurulumda 5001), dolayısıyla
           yürüyüş/bisiklet varsayılanları sürüşün HER İKİ makul değeri
           altında da boşta kalmalıdır.

           Compose çözümleme sırasında yinelenen portu REDDETMEZ; hata ancak
           ikinci konteyner başlatılırken görülür. Bu yüzden koruma buradadır. */
        var driving = PublishedPorts["OSRM_HOST_PORT"];
        var walking = PublishedPorts["OSRM_WALKING_HOST_PORT"];
        var cycling = PublishedPorts["OSRM_CYCLING_HOST_PORT"];

        Assert.NotEqual(walking, cycling);
        Assert.NotEqual(driving, walking);
        Assert.NotEqual(driving, cycling);

        /* Sürüşün yaygın geçersiz kılmaları da güvenli olmalıdır: compose
           varsayılanı 5000, bu projenin yerel kurulumu 5001. */
        foreach (var overridden in (int[])[5000, 5001])
        {
            Assert.NotEqual(overridden, walking);
            Assert.NotEqual(overridden, cycling);
        }
    }

    [Fact]
    public void The_env_template_stays_collision_free_and_matches_the_documented_ports()
    {
        var template = EnvPorts(EnvExample);

        Assert.Equal(3, template.Values.Distinct().Count());
        Assert.Equal(PublishedPorts["OSRM_WALKING_HOST_PORT"], template["OSRM_WALKING_HOST_PORT"]);
        Assert.Equal(PublishedPorts["OSRM_CYCLING_HOST_PORT"], template["OSRM_CYCLING_HOST_PORT"]);

        /* Şablonun sürüş portu compose VARSAYILANINDAN farklı olabilir — bu
           kurulumda öyledir — ama isteğe bağlı profillerle çakışamaz. */
        Assert.NotEqual(template["OSRM_HOST_PORT"], template["OSRM_WALKING_HOST_PORT"]);
        Assert.NotEqual(template["OSRM_HOST_PORT"], template["OSRM_CYCLING_HOST_PORT"]);
    }

    [Fact]
    public void The_tracked_development_endpoints_are_the_three_local_engines()
    {
        /* İZLENEN yerel geliştirme sözleşmesi. Daha önce sürüş 5000'i
           gösteriyordu ama konteyner 5001'deydi ve HİÇBİR normal geliştirme
           kaynağı (appsettings.json, launchSettings, user secrets, ortam
           değişkeni) bunu düzeltmiyordu — yani `dotnet run` sessizce hiçbir
           yere bağlanmayan bir sürüş yönlendiricisiyle açılıyordu. Adresler
           artık burada AÇIKÇA sabitlenir. */
        var endpoints = DevelopmentEndpoints();

        Assert.Equal("http://localhost:5001", endpoints["Osrm"]);
        Assert.Equal("http://localhost:5002", endpoints["Walking"]);
        Assert.Equal("http://localhost:5003", endpoints["Cycling"]);

        // Üçü de AYRI olmalıdır; aynı adres iki profil adı demek olurdu.
        Assert.Equal(3, endpoints.Values.Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public void Development_endpoints_match_the_ports_compose_actually_publishes()
    {
        /* Uygulama yapılandırması ile compose AYRI dosyalardır; birini
           değiştirip diğerini unutmak, arayüzün "kullanılabilir" dediği bir
           profilin hiçbir sunucuya ulaşamaması demekti. */
        var endpoints = DevelopmentEndpoints();

        Assert.Equal($"http://localhost:{EnvPorts(EnvExample)["OSRM_HOST_PORT"]}", endpoints["Osrm"]);
        Assert.Equal($"http://localhost:{PublishedPorts["OSRM_WALKING_HOST_PORT"]}", endpoints["Walking"]);
        Assert.Equal($"http://localhost:{PublishedPorts["OSRM_CYCLING_HOST_PORT"]}", endpoints["Cycling"]);
    }

    [Fact]
    public void Journey_driving_reuses_the_one_genuine_driving_endpoint()
    {
        /* Sürüş için AYRI bir JourneyRouting bölümü YOKTUR ve olmamalıdır:
           yolculuk planlaması mevcut Osrm bölümünü kullanır, böylece Akıllı
           Ulaşım ile aynı motora gider ve ikinci bir adres ayrışamaz. */
        Assert.Null(typeof(JourneyRoutingOptions).GetProperty("Driving"));

        var configured = new JourneyRoutingOptions
        {
            Walking = new JourneyRouterOptions { BaseUrl = "http://localhost:5002", Profile = "walking" },
            Cycling = new JourneyRouterOptions { BaseUrl = "http://localhost:5003", Profile = "cycling" },
        };

        // Ve gerçek sürüş adresiyle birlikte doğrulamayı geçer.
        configured.Validate("http://localhost:5001");
    }

    [Fact]
    public void The_readme_verification_commands_use_the_same_optional_ports()
    {
        // Belgelenmiş curl örnekleri gerçek portlara denk gelmelidir.
        foreach (var (variable, profile) in ((string, string)[])
                 [("OSRM_WALKING_HOST_PORT", "walking"), ("OSRM_CYCLING_HOST_PORT", "cycling")])
        {
            Assert.Contains(
                $"http://localhost:{PublishedPorts[variable]}/route/v1/{profile}/",
                Readme,
                StringComparison.Ordinal);
        }
    }

    [Fact]
    public void Every_profile_uses_the_projects_existing_mld_pipeline()
    {
        // Üç sunucu da aynı algoritma modunda çalışır; ikinci bir boru hattı yok.
        Assert.Equal(3, Occurrences(Compose, "osrm-routed --algorithm mld"));
        Assert.Equal(3, Occurrences(Compose, "osrm-partition /data/"));
        Assert.Equal(3, Occurrences(Compose, "osrm-customize /data/"));
    }

    [Fact]
    public void One_shared_source_extract_feeds_all_three_profiles()
    {
        /* Kaynak PBF tek dosya olarak salt okunur bind edilir: üç kez indirmek
           ya da kopyalamak gigabaytları üçe katlardı. */
        Assert.Equal(2, Occurrences(Compose, ".osm.pbf:ro"));
        Assert.Contains("download map data", PrepareScript, StringComparison.OrdinalIgnoreCase);
    }

    /* --- Sürüş geriye dönük uyumlu ------------------------------------------------ */

    [Fact]
    public void The_driving_service_keeps_its_identity_data_layout_and_port_variable()
    {
        /* Sürüşü yeniden adlandırmak ya da taşımak, hazır bir veri kümesinin
           yeniden çıkarılmasını gerektirirdi — pahalı ve gereksiz. Korunan şey
           SERVİS KİMLİĞİ, veri düzeni ve port DEĞİŞKENİDİR. */
        Assert.Contains("  osrm-routed:", Compose, StringComparison.Ordinal);
        Assert.Contains("${OSRM_DATA_DIR:-./data}:/data:ro", Compose, StringComparison.Ordinal);
        Assert.Contains("OSRM_DATA_DIR=./data", EnvExample, StringComparison.Ordinal);

        /* Sürüş portu ORTAMDAN gelmeye devam eder ve compose varsayılanı
           değişmemiştir — geriye dönük uyumluluk budur.

           Şablondaki SAYI burada sabitlenmez: o değer kurulumun yerel
           tercihidir (bu projede 5001) ve zaten
           `The_tracked_development_endpoints_are_the_three_local_engines` ile
           `The_env_template_stays_collision_free_...` tarafından korunur. Onu
           burada bir de "eski varsayılan" olarak çakmak, uyumluluğu değil bir
           tarihi dondururdu. */
        Assert.Equal(5000, PublishedPorts["OSRM_HOST_PORT"]);
        Assert.Contains("OSRM_HOST_PORT", EnvPorts(EnvExample).Keys);
    }

    [Fact]
    public void Smart_transport_route_generation_still_uses_the_unchanged_driving_port()
    {
        // Eski tüketici hâlâ eski portu ister; yolculuk portu ona hiç girmez.
        var dependencies = typeof(TransportService).GetConstructors().Single()
            .GetParameters().Select(parameter => parameter.ParameterType).ToArray();

        Assert.Contains(typeof(IOsrmRoutingService), dependencies);
        Assert.DoesNotContain(typeof(IJourneyRoutingService), dependencies);
    }

    /* --- Yapılandırma sınırı ----------------------------------------------------- */

    [Fact]
    public void Endpoints_live_only_in_configuration_never_in_application_code()
    {
        /* İş kuralında gömülü bir adres, ortam değiştiğinde sessizce yanlış
           sunucuya gitmek demekti. */
        var adapterDependencies = typeof(OsrmJourneyRoutingService).GetConstructors().Single()
            .GetParameters().Select(parameter => parameter.ParameterType).ToArray();

        // Adres YALNIZCA seçeneklerden gelir.
        Assert.Contains(typeof(OsrmOptions), adapterDependencies);
        Assert.Contains(typeof(JourneyRoutingOptions), adapterDependencies);
    }

    [Fact]
    public void A_profile_pointed_at_the_driving_server_is_refused_at_startup()
    {
        // Yerel kurulumu kolaylaştırmak için bu koruma GEVŞETİLMEDİ.
        var sharedWithDriving = new JourneyRoutingOptions
        {
            Walking = new JourneyRouterOptions
            {
                BaseUrl = "http://localhost:5000", Profile = "walking", TimeoutSeconds = 30,
            },
        };
        Assert.Throws<InvalidOperationException>(() => sharedWithDriving.Validate("http://localhost:5000"));

        // İki isteğe bağlı profil de aynı sunucuyu paylaşamaz.
        var sharedWithEachOther = new JourneyRoutingOptions
        {
            Walking = new JourneyRouterOptions { BaseUrl = "http://localhost:5001", Profile = "walking" },
            Cycling = new JourneyRouterOptions { BaseUrl = "http://localhost:5001", Profile = "cycling" },
        };
        Assert.Throws<InvalidOperationException>(() => sharedWithEachOther.Validate("http://localhost:5000"));
    }

    [Fact]
    public void The_documented_local_ports_satisfy_that_validation()
    {
        // README/.env.example'daki değerler gerçekten başlangıç doğrulamasını geçer.
        var documented = new JourneyRoutingOptions
        {
            Walking = new JourneyRouterOptions
            {
                BaseUrl = "http://localhost:5001", Profile = "walking", TimeoutSeconds = 30,
            },
            Cycling = new JourneyRouterOptions
            {
                BaseUrl = "http://localhost:5002", Profile = "cycling", TimeoutSeconds = 30,
            },
        };

        documented.Validate("http://localhost:5000");
    }

    /* --- İsteğe bağlılık --------------------------------------------------------- */

    [Fact]
    public void Startup_never_requires_the_optional_engines_to_be_configured_or_healthy()
    {
        /* Yürüyüş/bisiklet DIŞ ÇALIŞMA ZAMANI servisleridir. Bölüm yoksa
           doğrulama sessizce geçer; konteyner kapalıysa bu bir başlangıç
           sorunu değil, istek anında güvenli bir yukarı-akış hatasıdır. */
        new JourneyRoutingOptions().Validate("http://localhost:5000");

        var walkingOnly = new JourneyRoutingOptions
        {
            Walking = new JourneyRouterOptions { BaseUrl = "http://localhost:5001", Profile = "walking" },
        };
        walkingOnly.Validate("http://localhost:5000");

        // Yapılandırılmamış profil "kullanılamıyor"dur; sürüşe DÜŞMEZ.
        Assert.Equal(
            JourneyProfileSupport.Unavailable,
            JourneyProfilePolicy.Decide(JourneyTravelProfile.Cycling, isRoutable: false).Support);
    }

    [Fact]
    public void Nothing_in_the_local_setup_fakes_a_profile_with_speed_or_duration()
    {
        /* Taranan şey YAPILANDIRMA eserleridir. README bilinçli olarak
           DIŞARIDADIR: orada "sahte süre üretilmez" diye YAZMAK, onu
           uygulamakla aynı şey değildir ve bu politikanın belgelenmesi
           istenir. */
        foreach (var artifact in (string[])[Compose, EnvExample, PrepareScript])
        {
            foreach (var forbidden in (string[])["multiplier", "speedFactor", "fake"])
            {
                Assert.DoesNotContain(forbidden, artifact, StringComparison.OrdinalIgnoreCase);
            }
        }

        // Ve destek sözleşmesinde bir "yaklaşık" durumu YOKTUR.
        Assert.Equal(
            [JourneyProfileSupport.Routed, JourneyProfileSupport.Unavailable],
            Enum.GetValues<JourneyProfileSupport>());
    }

    /* --- Belgeler ---------------------------------------------------------------- */

    [Fact]
    public void The_readme_explains_why_a_url_change_cannot_switch_profiles()
    {
        Assert.Contains("Why three servers", Readme, StringComparison.Ordinal);
        Assert.Contains("ignored", Readme, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("osrm-extract", Readme, StringComparison.Ordinal);

        // Her profilin lua dosyası, dizini ve portu belgelenmiştir.
        foreach (var value in (string[])
                 ["foot.lua", "bicycle.lua", "./data/walking", "./data/cycling", "5001", "5002"])
        {
            Assert.Contains(value, Readme, StringComparison.Ordinal);
        }
    }

    /* --- Yardımcılar ------------------------------------------------------------- */

    private static int Occurrences(string haystack, string needle)
    {
        var count = 0;
        var index = haystack.IndexOf(needle, StringComparison.Ordinal);
        while (index >= 0)
        {
            count++;
            index = haystack.IndexOf(needle, index + needle.Length, StringComparison.Ordinal);
        }

        return count;
    }

    private static string ReadTool(string fileName) =>
        File.ReadAllText(Path.Combine(OsrmRoot, fileName));

    /// <summary>
    /// İzlenen geliştirme yapılandırmasındaki üç motor adresi.
    /// </summary>
    /// <remarks>
    /// JSON, sıra bağımsız olsun diye bölüm bölüm okunur: alanların dosyadaki
    /// yeri değiştiğinde test kırılmamalı, ama DEĞERLER değiştiğinde kırılmalı.
    /// </remarks>
    private static IReadOnlyDictionary<string, string> DevelopmentEndpoints()
    {
        using var document = JsonDocument.Parse(DevelopmentSettings);
        var root = document.RootElement;

        var journey = root.GetProperty("JourneyRouting");

        return new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["Osrm"] = root.GetProperty("Osrm").GetProperty("BaseUrl").GetString()!,
            ["Walking"] = journey.GetProperty("Walking").GetProperty("BaseUrl").GetString()!,
            ["Cycling"] = journey.GetProperty("Cycling").GetProperty("BaseUrl").GetString()!,
        };
    }

    private static string ReadDevelopmentSettings() =>
        File.ReadAllText(Path.Combine(
            Directory.GetParent(OsrmRoot)!.Parent!.FullName,
            "backend", "src", "StajProject.Api", "appsettings.Development.json"));

    /// <summary>
    /// <c>- "${VAR:-1234}:5000"</c> biçimindeki yayın satırlarını çözer.
    /// </summary>
    private static IReadOnlyDictionary<string, int> ParsePublishedPorts(string compose)
    {
        var ports = new Dictionary<string, int>(StringComparer.Ordinal);

        foreach (Match match in Regex.Matches(compose, PublishedPortPattern))
        {
            ports[match.Groups["name"].Value] = int.Parse(
                match.Groups["port"].Value,
                CultureInfo.InvariantCulture);
        }

        return ports;
    }

    /// <summary>Şablondaki <c>NAME=1234</c> port atamaları.</summary>
    private static IReadOnlyDictionary<string, int> EnvPorts(string envTemplate)
    {
        var ports = new Dictionary<string, int>(StringComparer.Ordinal);

        foreach (Match match in Regex.Matches(envTemplate, EnvPortPattern, RegexOptions.Multiline))
        {
            ports[match.Groups["name"].Value] = int.Parse(
                match.Groups["port"].Value,
                CultureInfo.InvariantCulture);
        }

        return ports;
    }

    /// <summary>
    /// Depo kökündeki <c>tools/osrm</c> dizinini bulur.
    /// </summary>
    /// <remarks>
    /// Test çalışırken çalışma dizini derleme çıktısıdır; sabit bir göreli yol
    /// hedef çatı ya da yapılandırma değiştiğinde sessizce kırılırdı.
    /// </remarks>
    private static string FindOsrmToolsDirectory()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null)
        {
            var candidate = Path.Combine(directory.FullName, "tools", "osrm");
            if (Directory.Exists(candidate)) return candidate;
            directory = directory.Parent;
        }

        throw new InvalidOperationException("tools/osrm dizini bulunamadı.");
    }
}
