using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using StajProject.Application.Common;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;
using StajProject.Api.Authorization;
using StajProject.Api.Services;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Authentication;
using StajProject.Infrastructure.Email;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.

builder.Services.AddControllers();

// Learn more about configuring Swagger/OpenAPI at https://aka.ms/aspnetcore/swashbuckle
builder.Services.AddEndpointsApiExplorer();
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

// Doğrulama/sıfırlama bağlantılarının işaret edeceği frontend adresi ve
// development e-posta sink'i. İkisi de secret değildir.
var clientAppOptions = builder.Configuration.GetSection("ClientApp").Get<ClientAppOptions>()
    ?? new ClientAppOptions();
builder.Services.AddSingleton(clientAppOptions);

var devEmailOptions = builder.Configuration.GetSection("DevEmail").Get<DevEmailOptions>()
    ?? new DevEmailOptions();
// Göreli yol content root'a göre çözülür ki çalışma dizininden bağımsız olsun.
devEmailOptions.SinkPath = Path.IsPathRooted(devEmailOptions.SinkPath)
    ? devEmailOptions.SinkPath
    : Path.Combine(builder.Environment.ContentRootPath, devEmailOptions.SinkPath);
builder.Services.AddSingleton(devEmailOptions);

/* E-posta gönderimi. Gerçek bir sağlayıcı credential'ı bulunmadığı için
   development'ta iletiler yerel bir sink'e yazılır — gerçek e-posta
   gönderilmez. Production implementasyonu eklendiğinde yalnızca bu kayıt
   değişir; çağıran kod IEmailSender'ı görür. */
builder.Services.AddScoped<IEmailSender, DevelopmentEmailSender>();

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

/* Resource-based authorization: "Admin OR owner" kuralı tek bir handler'da
   tanımlıdır. Servis katmanı kuralı kopyalamaz, IDrawingAuthorizationService
   üzerinden sorar; ileride eklenecek geometry edit işlemleri de aynı
   requirement'ı yeniden kullanabilir. */
builder.Services.AddSingleton<IAuthorizationHandler, DrawingAuthorizationHandler>();
builder.Services.AddScoped<IDrawingAuthorizationService, DrawingAuthorizationService>();
builder.Services.AddScoped<IDrawingService, DrawingService>();
builder.Services.AddScoped<ISpatialAnalysisService, SpatialAnalysisService>();

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
        policy.RequireRole(ApplicationRoles.Admin);
    });

    /* AUTH-5: Admin rolü + tamamlanmış ikinci faktör.
       Token üretimi zaten password-only bir Admin token'ı vermiyor; bu policy
       aynı kuralı authorization tarafında bir kez daha uygular. İki bağımsız
       katman: birinde bir regresyon olsa bile güçlü admin uçları korunur.

       amr claim'i iki adla okunur çünkü JwtSecurityTokenHandler'ın varsayılan
       inbound mapping'i kısa adı uzun WS-Federation adına çevirebilir; policy
       bu ayara bağlı kalmasın. */
    options.AddPolicy(AuthorizationPolicies.AdminMfaRequired, policy =>
    {
        policy.RequireAuthenticatedUser();
        policy.RequireRole(ApplicationRoles.Admin);
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
    var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("IdentitySeed");

    /* Yalnızca bootstrap/first-run provisioning yapar. Mevcut bir hesabın
       rolünü, şifresini veya durumunu ezmez — bir yöneticinin bilinçli
       kararı restart sonrasında geri alınmaz (AUTH-3.1). */
    await IdentityDataSeeder.SeedAsync(userManager, roleManager, adminSeedOptions, logger);
}

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();

app.UseCors(DevCorsPolicy);

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.Run();
