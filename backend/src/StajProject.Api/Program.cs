using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using StajProject.Application.Common;
using StajProject.Application.Activity;
using StajProject.Application.Interfaces;
using StajProject.Application.Journeys;
using StajProject.Application.Options;
using StajProject.Application.Simulation;
using StajProject.Api.Authorization;
using StajProject.Api.Services;
using StajProject.Api.Hubs;
using StajProject.Api.Simulation;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using Microsoft.AspNetCore.Authorization.Policy;
using StajProject.Api.Activity;
using StajProject.Api.Common;
using StajProject.Infrastructure.Authentication;
using StajProject.Infrastructure.Email;
using StajProject.Infrastructure.GeoServer;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Routing;
using StajProject.Infrastructure.Services;
using StajProject.Infrastructure.Simulation;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.

/* Aktivite geçmişi TEK bir yerden yazılır: her mutasyon ucuna elle kayıt
   eklemek, yeni bir ucun kaydı unutmasına açık kapı bırakırdı. Filtre neyi
   kaydedeceğini bir İZİN LİSTESİNDEN okur (ActivityActionRegistry); listede
   olmayan hiçbir uç — oturum açma, parola sıfırlama, 2FA dâhil — kaydedilemez. */
builder.Services.AddControllers(options => options.Filters.Add<ActivityLogFilter>());

/* Canlı ulaşım simülasyonu kanalı. Yalnızca taşımayı sağlar; yetki kararı
   hub içinde mevcut etkin yetki motoruna sorulur. */
builder.Services.AddSignalR();

// Learn more about configuring Swagger/OpenAPI at https://aka.ms/aspnetcore/swashbuckle
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddInvitationRateLimiting();
builder.Services.AddSwaggerGen(options =>
{
    options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
        Description = "JWT token'ı 'Bearer {token}' formatına gerek kalmadan doğrudan girin."
    });

    options.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference
                {
                    Type = ReferenceType.SecurityScheme,
                    Id = "Bearer"
                }
            },
            Array.Empty<string>()
        }
    });
});

var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? throw new InvalidOperationException("DefaultConnection bağlantı dizesi appsettings içinde tanımlı değil.");

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(connectionString, npgsql => npgsql.UseNetTopologySuite()));

/* Normal harita çizimleri GeoServer WFS üzerinden okunur. Bu ayarlar secret
   değildir; SQL-view katmanları SELECT-only'dir ve hiçbir admin credential'ı
   uygulamaya verilmez. */
var geoServerOptions = builder.Configuration.GetSection(GeoServerOptions.SectionName).Get<GeoServerOptions>()
    ?? new GeoServerOptions();
geoServerOptions.Validate();
builder.Services.AddSingleton(geoServerOptions);
builder.Services.AddHttpClient<IGeoServerDrawingReadService, GeoServerDrawingReadService>();
builder.Services.AddHttpClient<IGeoServerHeatmapService, GeoServerHeatmapService>(client =>
    client.Timeout = TimeSpan.FromSeconds(geoServerOptions.HeatmapTimeoutSeconds));

/* Çizimlerin haritadaki GENEL GÖSTERİMİ WMS üzerinden gelir; etkileşim
   (seçim, düzenleme, taşıma, popup) yukarıdaki WFS okumasıyla sürer. İkisi
   ayrı istemcilerdir çünkü biri kısa ömürlü bir görüntü, diğeri bir veri
   okumasıdır ve zaman aşımı beklentileri aynı değildir. */
/* Konum analizinin NOKTA ÖRTÜSÜ AYRI bir HttpClient'tir: kendi zaman aşımı
   ayarı vardır ve çizim ısı haritasının ayarını paylaşmaz.

   <b>Ağırlıklı ısı haritası buradan GEÇMEZ.</b> O yüzey artık sunucuda
   hesaplanıyor (LocationAnalysisImageService): ödevin istediği
   `S(x) = Σ w_c · normalize(D_c(x))` denklemi ölçüt BAŞINA normalleştirme
   gerektirir ve vec:Heatmap bunu tek bir istekte üretemez. GeoServer'a kalan
   iş bir hesap değil, bir sunumdur. */
builder.Services.AddHttpClient<ILocationAnalysisPointsImageService, GeoServerLocationAnalysisImageService>(client =>
    client.Timeout = TimeSpan.FromSeconds(geoServerOptions.AnalysisTimeoutSeconds));

builder.Services.AddHttpClient<IGeoServerMapPresentationService, GeoServerMapPresentationService>(client =>
    client.Timeout = TimeSpan.FromSeconds(geoServerOptions.PresentationTimeoutSeconds));

/* OSRM yalnızca backend yapılandırmasından çağrılır. Tarayıcı sunucu adresi
   veya profil gönderemez; typed client bağlantı havuzunu yeniden kullanır. */
var osrmOptions = builder.Configuration.GetSection(OsrmOptions.SectionName).Get<OsrmOptions>()
    ?? new OsrmOptions();
osrmOptions.Validate();
builder.Services.AddSingleton(osrmOptions);
builder.Services.AddHttpClient<IOsrmRoutingService, OsrmRoutingService>(client =>
    client.Timeout = TimeSpan.FromSeconds(osrmOptions.TimeoutSeconds));

/* Yolculuk planlamasının profil farkındalıklı yönlendirmesi.

   Mevcut IOsrmRoutingService'e DOKUNULMAZ: o port Akıllı Ulaşım'ın kalıcı
   güzergah üretimine hizmet eder ve manevra adımı taşımaz. Yolculuk
   planlaması adım ister ve profil başına AYRI bir uca gider, bu yüzden kendi
   adaptörünü kullanır.

   Sürüş, ek yapılandırma İSTEMEDEN mevcut Osrm bölümünü kullanır; yürüyüş ve
   bisiklet yalnızca kendi uçları tanımlıysa yönlendirilebilir sayılır.
   Bölümler yoksa uygulama sorunsuz başlar ve o profiller "kullanılamıyor"
   olarak bildirilir — isteğe bağlı servisler başlangıç için ZORUNLU DEĞİLDİR.

   Neden ayrı uç şart: yerel OSRM car.lua ile derlenir ve osrm-routed adresteki
   profil segmentini yok sayar; aynı sunucuya "walking" demek sürüş sonucunu
   yürüyüş diye etiketlemek olurdu. Validate bunu yapılandırma düzeyinde de
   reddeder. */
var journeyRoutingOptions = builder.Configuration
    .GetSection(JourneyRoutingOptions.SectionName)
    .Get<JourneyRoutingOptions>() ?? new JourneyRoutingOptions();
journeyRoutingOptions.Validate(osrmOptions.BaseUrl);
builder.Services.AddSingleton(journeyRoutingOptions);

builder.Services.AddHttpClient(
    OsrmJourneyRoutingService.HttpClientNameOf(JourneyTravelProfile.Driving),
    client => client.Timeout = TimeSpan.FromSeconds(osrmOptions.TimeoutSeconds));

foreach (var (profile, endpoint) in new[]
         {
             (JourneyTravelProfile.Walking, journeyRoutingOptions.Walking),
             (JourneyTravelProfile.Cycling, journeyRoutingOptions.Cycling)
         })
{
    if (endpoint is null)
    {
        continue;
    }

    builder.Services.AddHttpClient(
        OsrmJourneyRoutingService.HttpClientNameOf(profile),
        client => client.Timeout = TimeSpan.FromSeconds(endpoint.TimeoutSeconds));
}

builder.Services.AddSingleton<IJourneyRoutingService, OsrmJourneyRoutingService>();

/* --- Secret'lar --------------------------------------------------------------
   Jwt:Key ve AdminSeed:Password hiçbir appsettings dosyasında TUTULMAZ.
   Kaynakları (öncelik sırasıyla, en sonuncu kazanır):
     1. User Secrets  — dotnet user-secrets set "Jwt:Key" "..."   (yalnız Development)
     2. Ortam değişkeni — Jwt__Key / AdminSeed__Password           (her ortam)
   İkisi de WebApplication.CreateBuilder tarafından varsayılan olarak okunur;
   ek bir configuration provider gerekmez. */

// Section hiç yoksa da boş bir nesneyle devam edilir; asıl hata mesajını
// aşağıdaki alan bazlı kontroller üretir (daha eyleme dönük).
var jwtOptions = builder.Configuration.GetSection("Jwt").Get<JwtOptions>() ?? new JwtOptions();

// Fail-closed: imzalama anahtarı olmadan uygulama başlamaz. Fallback bir
// varsayılan key ÜRETİLMEZ — aksi hâlde herkeste aynı olan, tahmin edilebilir
// bir anahtarla token imzalanırdı.
if (string.IsNullOrWhiteSpace(jwtOptions.Key))
{
    throw new InvalidOperationException(
        "Jwt:Key tanımlı değil. Bu değer bir secret'tır ve appsettings dosyalarında tutulmaz. " +
        "Development için: dotnet user-secrets set \"Jwt:Key\" \"<64+ karakterlik rastgele değer>\" " +
        "--project src/StajProject.Api  |  Diğer ortamlarda: Jwt__Key ortam değişkeni. " +
        "Ayrıntı için README-SECRETS.md.");
}

// HMAC-SHA256 en az 256 bit (32 bayt) anahtar ister; kısa anahtar imzalamada
// runtime hatası verirdi. Hatayı isteği beklemeden, başlangıçta yakalıyoruz.
if (Encoding.UTF8.GetByteCount(jwtOptions.Key) < 32)
{
    throw new InvalidOperationException(
        "Jwt:Key çok kısa. HMAC-SHA256 için en az 32 bayt (≈32 karakter) gerekir.");
}

// Secret değiller ama eksiklerse token doğrulaması ancak ilk istekte,
// anlaşılması zor bir şekilde patlardı.
if (string.IsNullOrWhiteSpace(jwtOptions.Issuer) || string.IsNullOrWhiteSpace(jwtOptions.Audience))
{
    throw new InvalidOperationException(
        "Jwt:Issuer ve Jwt:Audience tanımlı olmalıdır (secret değildir, appsettings içinde tutulur).");
}

builder.Services.AddSingleton(jwtOptions);

// İlk yönetici hesabının seed bilgisi. Şifre yoksa uygulama yine ayağa kalkar,
// ancak seeder hesap OLUŞTURMAZ ve açık bir diagnostic loglar
// (bkz. IdentityDataSeeder) — böylece mevcut kurulumlar etkilenmez, eksik
// yapılandırma da sessizce geçilmez.
var adminSeedOptions = builder.Configuration.GetSection("AdminSeed").Get<AdminSeedOptions>()
    ?? new AdminSeedOptions();
builder.Services.AddSingleton(adminSeedOptions);

/* --- ASP.NET Core Identity -------------------------------------------------
   AddIdentity() değil AddIdentityCore() kullanılır: AddIdentity() cookie
   authentication handler'larını ekleyip DefaultScheme'i "Identity.Application"
   yapardı ve mevcut JWT tabanlı akış bozulurdu. AddIdentityCore ise yalnızca
   UserManager/PasswordHasher/validator altyapısını kurar; kimlik doğrulama
   şeması JwtBearer olarak kalır.
   Şifre doğrulaması UserManager üzerinden yapılır; cookie handler veya
   cookie tabanlı bir oturum hiçbir noktada eklenmez. */
builder.Services
    .AddIdentityCore<User>(options =>
    {
        // Development için makul, aşırı katı olmayan policy.
        options.Password.RequiredLength = 8;
        options.Password.RequireDigit = true;
        options.Password.RequireLowercase = true;
        options.Password.RequireUppercase = true;
        options.Password.RequireNonAlphanumeric = false;
        options.Password.RequiredUniqueChars = 1;

        options.User.RequireUniqueEmail = true;

        // Lockout altyapısı etkin: 5 hatalı denemeden sonra 5 dakika kilit.
        options.Lockout.AllowedForNewUsers = true;
        options.Lockout.MaxFailedAccessAttempts = 5;
        options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(5);

        /* E-posta doğrulama zorunluluğu BURADA kapalı bırakılır ama akış
           zorunludur: Identity bu bayrağı PreSignInCheck içinde, yani şifre hiç
           doğrulanmadan uygular ve bu, şifreyi bilmeyen birine hesabın var olup
           doğrulanmadığını sızdırırdı. Kontrol bunun yerine AuthService içinde,
           şifre doğrulandıktan SONRA yapılır (bkz. AuthService.LoginAsync). */
        options.SignIn.RequireConfirmedEmail = false;
        options.SignIn.RequireConfirmedPhoneNumber = false;
    })
    .AddRoles<IdentityRole<int>>()
    .AddEntityFrameworkStores<AppDbContext>()
    .AddDefaultTokenProviders();

// CreatedBy audit alanının JWT'den okunabilmesi için.
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUserService, CurrentUserService>();
builder.Services.AddScoped<TransportActivityContext>();

// Doğrulama/sıfırlama bağlantılarının işaret edeceği frontend adresi.
var clientAppOptions = builder.Configuration.GetSection("ClientApp").Get<ClientAppOptions>()
    ?? new ClientAppOptions();
builder.Services.AddSingleton(clientAppOptions);

/* Tek e-posta portu, yapılandırmaya göre tek taşıma:
   Email:Smtp:Enabled=false → yerel development sink'i
   Email:Smtp:Enabled=true  → TLS zorunlu gerçek SMTP
   SMTP açıkken eksik ayar varsa startup burada fail-fast olur; sessiz fallback yoktur. */
builder.Services.AddEmailDelivery(builder.Configuration, builder.Environment.ContentRootPath);

/* --- İki faktörlü doğrulama (AUTH-5) ---------------------------------------
   Challenge bileti Data Protection ile korunur. Anahtar halkası ASP.NET Core
   tarafından sağlanır (Identity'nin e-posta/şifre token'ları da aynı altyapıyı
   kullanır); burada açıkça kaydedilmesi bağımlılığın nereden geldiğini görünür
   kılar. AddDataProtection idempotenttir.

   PRODUCTION NOTU: birden fazla instance çalıştığında anahtar halkası
   paylaşılmalıdır (PersistKeysToDbContext/Redis vb.); aksi hâlde bir
   instance'ın ürettiği bileti diğeri çözemez. Tek instance'lık development
   kurulumunda varsayılan yerel halka yeterlidir. */
builder.Services.AddDataProtection();
builder.Services.AddScoped<ITwoFactorChallengeService, TwoFactorChallengeService>();
builder.Services.AddScoped<ITwoFactorService, TwoFactorService>();

builder.Services.AddScoped<ITokenService, JwtTokenService>();
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<IAccountService, AccountService>();
builder.Services.AddScoped<IUserManagementService, UserManagementService>();

/* Rol ve rol-yetki yönetimi. Kullanıcı yönetiminden ayrı bir servistir:
   sorumlulukları farklıdır ve ikisini tek bir "AdminService" altında
   birleştirmek, rol kurallarını kullanıcı iş kurallarıyla karıştırırdı.

   UserManagementService bu servise BAĞLIDIR: atanabilir rol kuralının tek
   sahibi burasıdır, onay ve rol değiştirme akışları kendi doğrulamalarını
   yazmaz. */
builder.Services.AddScoped<IRoleManagementService, RoleManagementService>();

/* Kullanıcıya DOĞRUDAN verilen yetkiler ayrı bir servistedir: rol yetkisi
   düzenlemek ile bir kişiye istisna tanımak farklı kararlardır ve tek kod
   yolundan geçerlerse yanlışlıkla birbirini etkileyebilirler. Etkinliği
   yeniden hesaplamaz; IEffectivePermissionService'i olduğu gibi kullanır. */
builder.Services.AddScoped<IUserPermissionManagementService, UserPermissionManagementService>();

/* Resource-based authorization: "Admin OR owner" kuralı tek bir handler'da
   tanımlıdır. Servis katmanı kuralı kopyalamaz, IDrawingAuthorizationService
   üzerinden sorar; ileride eklenecek geometry edit işlemleri de aynı
   requirement'ı yeniden kullanabilir. */
builder.Services.AddSingleton<IAuthorizationHandler, DrawingAuthorizationHandler>();
builder.Services.AddScoped<IDrawingAuthorizationService, DrawingAuthorizationService>();
/* Coğrafi yetki alanı: hem yönetim uçlarının hem çizim servisinin sorduğu
   soru burada yanıtlanır. Scoped'dır çünkü AppDbContext'e bağlıdır — kapsam
   her istekte CANLI okunur, hiçbir yerde önbelleğe alınmaz ve JWT'ye yazılmaz. */
builder.Services.AddScoped<IGeographicAuthorizationService, GeographicAuthorizationService>();

/* Aktivite geçmişi. Yazıcı her istekte çalışabilir, sorgu yalnızca yönetim
   ekranından; ikisi ayrı arayüzlerdir ki her mutasyon isteği bir sorgulama
   bağımlılığı taşımak zorunda kalmasın. İkisi de AppDbContext'e bağlı olduğu
   için scoped'dır. */
builder.Services.AddScoped<IActivityLogWriter, ActivityLogWriter>();

/* Yolculuk yaşam döngüsü kaydı: İKİNCİ bir günlük sistemi değil, aynı yazıcının
   önüne konmuş ince bir eşleme. Scoped'dır çünkü yazıcı DbContext taşır; arka
   plan runner'ı onu kendi kapsamında (scope factory) çözer. */
builder.Services.AddScoped<IJourneyActivityRecorder, JourneyActivityRecorder>();
builder.Services.AddScoped<IActivityLogQueryService, ActivityLogQueryService>();

/* Yetki reddiyle biten mutasyon denemeleri de kaydedilir. Yetkilendirme MVC
   filtrelerinden ÖNCE çalıştığı için reddedilen bir istek ActivityLogFilter'a
   hiç ulaşmaz; bu handler o boşluğu AYNI izin listesiyle kapatır ve
   yetkilendirme kararına hiçbir şekilde karışmaz. */
builder.Services.AddSingleton<IAuthorizationMiddlewareResultHandler, ActivityAuthorizationResultHandler>();
builder.Services.AddScoped<IDrawingService, DrawingService>();
builder.Services.AddScoped<ISpatialAnalysisService, SpatialAnalysisService>();

/* Konum analizi envanter analizinden AYRI bir servistir: ortak açık veri
   kümesini okur, sahiplik yüklemi taşımaz ve kendi yetkisiyle korunur.
   Lifetime aynı gerekçeyle scoped'dır — AppDbContext scoped'dır. */
builder.Services.AddScoped<ILocationAnalysisAreaGuard, LocationAnalysisAreaGuard>();
builder.Services.AddScoped<ILocationAnalysisTargetCatalogService, LocationAnalysisTargetCatalogService>();
builder.Services.AddScoped<ILocationAnalysisService, LocationAnalysisService>();

/* Ağırlıklı yoğunluk yüzeyi: veritabanından okunan noktalardan sunucuda
   üretilir; nokta örtüsü isteğini yukarıdaki GeoServer istemcisine devreder. */
builder.Services.AddScoped<ILocationAnalysisImageService, LocationAnalysisImageService>();

/* POI servisleri. Çizim servisiyle aynı lifetime ve aynı gerekçe: AppDbContext
   scoped'dır ve her istek kendi transaction sınırını görmelidir. */
builder.Services.AddScoped<IPoiService, PoiService>();
builder.Services.AddScoped<IPoiCategoryService, PoiCategoryService>();

/* Akıllı ulaşım CRUD ve sıralama servisi. Coğrafi yazma sınırını mevcut
   IGeographicAuthorizationService üzerinden uygular; okumalara alan filtresi eklemez. */
builder.Services.AddScoped<ITransportService, TransportService>();

/* Ulaşım simülasyonu. Aktif çalıştırmalar SÜREÇ İÇİ bir durumdur ve istek
   ömrünü aşar; depo bu yüzden singleton'dır — scoped olsaydı her istek boş bir
   dünya görür, "rota başına tek simülasyon" kuralı hiçbir zaman tetiklenmezdi.
   Depoya yalnızca değişmez veri girer: takip edilen bir EF varlığı burada
   kapanmış bir istek kapsamını süresiz canlı tutardı.

   Servisin kendisi AppDbContext'e bağlı olduğu için scoped'dır ve durumu
   kendisi TUTMAZ; kalıcı güzergahı okur, durumu depoya yazar. OSRM'e hiç
   dokunmaz — yol üretimi ITransportService'in işidir ve orada kalır. */
builder.Services.AddSingleton<ITransportSimulationStateStore, InMemoryTransportSimulationStateStore>();
builder.Services.AddScoped<ITransportSimulationService, TransportSimulationService>();

/* Genel yolculuk planlaması. AYRI bir servistir: hiçbir şey yazmaz, hiçbir
   çalıştırma başlatmaz ve girdisi bir hat olmak ZORUNDA değildir — farklı
   hatlardaki duraklar ve POI'ler aynı planda buluşabilir. Bu yüzden ne
   ITransportService'in (kalıcı CRUD) ne de ITransportSimulationService'in
   (çalışma zamanı durumu) sorumluluğuna eklenir.

   AppDbContext'e bağlı olduğu için scoped'dır. Yapılandırılmış OSRM profilini
   yalnızca OKUR (profil politikası kararı için); yönlendirme motoruna bu fazda
   hiç istek göndermez. */
builder.Services.AddScoped<IJourneyPlanningService, JourneyPlanningService>();

/* --- Kişisel yolculuk simülasyonu (Faz 5D) ----------------------------------
   Mevcut PAYLAŞILAN hat simülasyonu aynen yerinde kalır; bu ürün ONUN YERİNE
   GEÇMEZ, yanına eklenir. İkisinin yetkilendirme anlamı farklıdır: hat
   simülasyonu transport.simulation.start ile başlar ve transport.view taşıyan
   herkes izler; kişisel yolculuk transport.view ile başlar ve YALNIZCA sahibi
   görür.

   Aktif durum SÜREÇ İÇİ ve istek ömrünü aşar, bu yüzden depo singleton'dır ve
   yalnızca değişmez veri alır. Anahtarı KULLANICIDIR (rota değil): iki kişi
   aynı A → B yolculuğunu bağımsız oynatabilmelidir.

   Servisin kendisi scoped'dır: planlama servisine ve doğrulanmış kimliğe
   bağlıdır. Başlatmada planlamayı SÜREÇ İÇİNDE yeniden çalıştırır — kendi
   API'sine HTTP ile dönmez ve algoritmayı ikinci kez yazmaz. */
builder.Services.AddSingleton<IJourneySimulationStateStore, InMemoryJourneySimulationStateStore>();
builder.Services.AddScoped<IJourneySimulationService, JourneySimulationService>();

var journeySimulationOptions = builder.Configuration
    .GetSection(JourneySimulationOptions.SectionName)
    .Get<JourneySimulationOptions>() ?? new JourneySimulationOptions();
journeySimulationOptions.Validate();
builder.Services.AddSingleton(journeySimulationOptions);

/* Yayın portunun SignalR uygulaması Api'dedir; runner (Infrastructure) yalnızca
   Application'daki arayüzü tanır. Ayrı bir port olması, hat yayınının kişisel
   yolculuk gruplarına sızmasını yapısal olarak engeller. */
builder.Services.AddSingleton<IJourneySimulationBroadcaster, SignalRJourneySimulationBroadcaster>();

/* Runner singleton'dır: aktif durum gibi o da istek ömrünü aşar ve hiçbir
   DbContext tutmaz. Hareket, mevcut ve kanıtlanmış TransportSimulationTrack
   ilkeli üzerinden otoriter yol geometrisinde hesaplanır. */
builder.Services.AddSingleton<JourneySimulationRunner>();
builder.Services.AddHostedService<JourneySimulationBackgroundService>();

/* Runner ayarları OSRM ile aynı kalıptadır: yapılandırmadan okunur, başlangıçta
   DOĞRULANIR (fail-fast) ve singleton olarak paylaşılır. Hız çarpanı bir SUNUCU
   ayarıdır; tarayıcıdan gelmez ve arayüzde seçici yoktur. */
var transportSimulationOptions = builder.Configuration
    .GetSection(TransportSimulationOptions.SectionName)
    .Get<TransportSimulationOptions>() ?? new TransportSimulationOptions();
transportSimulationOptions.Validate();
builder.Services.AddSingleton(transportSimulationOptions);

/* Yayın portunun SignalR uygulaması Api'dedir; runner (Infrastructure) yalnızca
   Application'daki arayüzü tanır. IHubContext singleton'dır, adaptör de öyle. */
builder.Services.AddSingleton<ITransportSimulationBroadcaster, SignalRTransportSimulationBroadcaster>();

/* Runner singleton'dır: aktif durum gibi o da istek ömrünü aşar ve hiçbir
   DbContext tutmaz. Aynı örnek İKİ rolü üstlenir — arka plan ilerletici ve
   güzergah geçersizleştiğinde çağrılan iptal portu; "durdur + yayınla"
   mantığının iki kopyası olmasın diye tek sahiptir. */
builder.Services.AddSingleton<TransportSimulationRunner>();
builder.Services.AddSingleton<ITransportSimulationCanceller>(
    provider => provider.GetRequiredService<TransportSimulationRunner>());
builder.Services.AddHostedService<TransportSimulationBackgroundService>();

/* POI sahiplik/yetki kararının TEK yeri. Çizim tarafındaki
   IDrawingAuthorizationService ile aynı gerekçe: servis katmanı kuralı
   kopyalamaz, sorar. Farkı, kararın rol adına değil etkin yetki KODLARINA
   (poi.update / poi.delete / poi.manage) ve kaydın sahibine bakmasıdır. */
builder.Services.AddScoped<IPoiAuthorizationService, PoiAuthorizationService>();

/* Etkin yetki motoru. AppDbContext scoped olduğu ve servis her çağrıda canlı
   veritabanı durumunu okuduğu için lifetime da scoped'tır.

   Bu fazda hiçbir uç bu servisi ÇAĞIRMAZ; yetkilendirme hâlâ [Authorize],
   AdminOnly ve AdminMfaRequired ile yapılır. Servis, uç denetimini kuracak
   sonraki fazın enjekte edeceği bağımsız bir port olarak durur. */
builder.Services.AddScoped<IEffectivePermissionService, EffectivePermissionService>();

/* Yetki tabanlı authorization. Policy sağlayıcı singleton'dır (ASP.NET Core
   onu bir kez çözer) ve yalnızca "Permission:" ön ekini tanır; AdminOnly,
   AdminMfaRequired ve MfaRequired varsayılan sağlayıcıya düşerek çalışmaya
   devam eder.

   Handler SCOPED'tır: kararı, scoped AppDbContext üzerinden okuyan
   IEffectivePermissionService'e devreder. Her istek canlı veritabanı
   durumunu görür — yetki değişikliği ve hesap askıya alma anında etkilidir. */
builder.Services.AddSingleton<IAuthorizationPolicyProvider, PermissionPolicyProvider>();
builder.Services.AddScoped<IAuthorizationHandler, PermissionAuthorizationHandler>();

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwtOptions.Issuer,
            ValidateAudience = true,
            ValidAudience = jwtOptions.Audience,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtOptions.Key)),
            ClockSkew = TimeSpan.Zero
        };

        /* WebSocket el sıkışması Authorization BAŞLIĞI taşıyamaz; SignalR
           istemcisi token'ı sorgu dizesinde gönderir. Bu okuma YALNIZCA hub
           yoluyla sınırlıdır — REST uçları için sorgu dizesinden token kabul
           etmek, token'ın sunucu loglarına ve tarayıcı geçmişine sızması
           demekti. Doğrulama kuralları aynı kalır; değişen tek şey token'ın
           NEREDEN okunduğudur. */
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];

                /* İki hub yolu da aynı kuralı paylaşır: WebSocket el sıkışması
                   Authorization başlığı taşıyamaz, bu yüzden token YALNIZCA
                   hub yollarında sorgu dizesinden okunur. Yeni bir kural
                   yazılmaz; liste genişletilir. */
                var path = context.HttpContext.Request.Path;

                if (!string.IsNullOrEmpty(accessToken)
                    && (path.StartsWithSegments(TransportSimulationHubContract.Path, StringComparison.Ordinal)
                        || path.StartsWithSegments(JourneySimulationHubContract.Path, StringComparison.Ordinal)))
                {
                    context.Token = accessToken;
                }

                return Task.CompletedTask;
            }
        };
    });

/* Yetkilendirme politikaları tek yerde tanımlanır; controller'lar yalnızca
   AuthorizationPolicies sabitlerini kullanır, koda "Admin" string'i yayılmaz.
   Role claim'i JwtTokenService tarafından ClaimTypes.Role olarak yazıldığı için
   RequireRole doğrudan çalışır. */
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy(AuthorizationPolicies.AuthenticatedUser, policy =>
        policy.RequireAuthenticatedUser());

    options.AddPolicy(AuthorizationPolicies.AdminOnly, policy =>
    {
        policy.RequireAuthenticatedUser();
        policy.RequireRole(AdministrativeRoleSemantics.RoleNames);
    });

    /* Administrator rolü + tamamlanmış ikinci faktör.
       Token üretimi zaten password-only bir Administrator token'ı vermiyor; bu policy
       aynı kuralı authorization tarafında bir kez daha uygular. İki bağımsız
       katman: birinde bir regresyon olsa bile güçlü admin uçları korunur.

       amr claim'i iki adla okunur çünkü JwtSecurityTokenHandler'ın varsayılan
       inbound mapping'i kısa adı uzun WS-Federation adına çevirebilir; policy
       bu ayara bağlı kalmasın. */
    options.AddPolicy(AuthorizationPolicies.AdminMfaRequired, policy =>
    {
        policy.RequireAuthenticatedUser();
        policy.RequireRole(AdministrativeRoleSemantics.RoleNames);
        policy.RequireAssertion(context => AuthenticationMethods.IsMultiFactor(context.User));
    });

    /* Yalnızca ikinci faktör kanıtı; rol şartı YOK. AdminMfaRequired ile
       BİREBİR aynı kanıta bakar (AuthenticationMethods.IsMultiFactor) —
       MFA şartı gevşetilmez, yalnızca rol adı bağı kaldırılır.

       Yönetim uçları bunu "gerekli yetki" ile birlikte kullanır. Böylece
       erişim, rol adına değil, kullanıcının gerçekten o
       yetkiye sahip olmasına bağlanır; gerekli yetkilere sahip özel roller de
       geçebilir. */
    options.AddPolicy(AuthorizationPolicies.MfaRequired, policy =>
    {
        policy.RequireAuthenticatedUser();
        policy.RequireAssertion(context => AuthenticationMethods.IsMultiFactor(context.User));
    });
});

const string DevCorsPolicy = "DevCorsPolicy";
builder.Services.AddCors(options =>
{
    options.AddPolicy(DevCorsPolicy, policy =>
    {
        policy.WithOrigins("http://localhost:5173")
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

var app = builder.Build();

// Mevcut yönetici hesabı Identity tarafında yoksa oluşturulur. Var olan bir
// hesaba dokunmaz; veri kaybı riski taşımaz.
using (var scope = app.Services.CreateScope())
{
    var userManager = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
    var roleManager = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();
    var effectivePermissions = scope.ServiceProvider.GetRequiredService<IEffectivePermissionService>();
    var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("IdentitySeed");

    /* Yetki kataloğu, hedef GIS rolleri ve rollerin başlangıç yetkileri.
       Identity seed'inden ÖNCE çalışır; böylece bootstrap ve rolsüz hesap
       recovery yollarının atadığı kanonik roller önceden vardır. */
    var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var authzLogger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("AuthorizationSeed");

    await AuthorizationDataSeeder.SeedAsync(dbContext, roleManager, authzLogger);

    /* Yalnızca bootstrap/first-run provisioning ve dar recovery davranışını
       uygular. Rol oluşturmaz; mevcut hesaplardaki legacy üyelikleri migrate etmez. */
    await IdentityDataSeeder.SeedAsync(
        userManager,
        effectivePermissions,
        adminSeedOptions,
        logger);

    /* Kanonik POI kategori taksonomisi. Güvenlik seeder'larından SONRA çalışır:
       kategoriler hiçbir kimlik/yetki kararını beslemez, dolayısıyla onların
       önüne geçmesi için bir neden yoktur ve sıranın değişmesi bootstrap
       yollarını etkileyebilirdi.

       DİKKAT: bu seeder slug/icon_key/color_hex kolonlarını okur. Proje
       göçleri ELLE uygular (uygulamada Database.Migrate() çağrısı yoktur ve
       burada da eklenmez), dolayısıyla göç uygulanmamış bir veritabanında
       kolonlar bulunamaz. Bu durumda hata yutulmaz: startup, ne yapılması
       gerektiğini söyleyen açık bir mesajla durur — yarı seed edilmiş bir
       taksonomi ile devam etmek, sonraki her hatayı açıklanamaz kılardı. */
    var taxonomyLogger = scope.ServiceProvider
        .GetRequiredService<ILoggerFactory>()
        .CreateLogger("PoiCategoryTaxonomySeed");

    try
    {
        await PoiCategoryTaxonomySeeder.SeedAsync(dbContext, taxonomyLogger);
    }
    catch (Exception exception)
    {
        taxonomyLogger.LogCritical(
            exception,
            "POI kategori taksonomisi seed edilemedi. Veritabanı göçlerinin uygulandığından emin olun "
            + "(dotnet ef database update).");

        throw;
    }
}

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();

app.UseRouting();
app.UseCors(DevCorsPolicy);

app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

app.MapControllers();

/* Hub, controller'larla aynı kimlik doğrulama/yetkilendirme hattının
   ARKASINDADIR: MapHub yalnızca yolu bağlar, kararı hub'ın kendisi verir. */
app.MapHub<TransportSimulationHub>(TransportSimulationHubContract.Path);

/* Kişisel yolculuk kanalı AYRI bir yoldadır ve ayrı bir hub'a bağlanır: hat
   yayınıyla aynı gruplara girmemesi, bir yolculuğun kazara paylaşılan bir hat
   grubuna katılmasını yapısal olarak imkânsız kılar. */
app.MapHub<JourneySimulationHub>(JourneySimulationHubContract.Path);

app.Run();
