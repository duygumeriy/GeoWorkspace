# Secret yapılandırması

Bu projede **hiçbir gerçek credential appsettings dosyalarında veya kaynak kodda
tutulmaz.** Aşağıdaki iki değer secret'tır ve her geliştiricinin kendi
makinesinde tanımlaması gerekir.

| Configuration anahtarı | Ne işe yarar | Zorunlu mu |
|---|---|---|
| `Jwt:Key` | JWT imzalama anahtarı (HMAC-SHA256) | **Evet** — tanımlı değilse uygulama başlamaz |
| `AdminSeed:Password` | İlk yönetici hesabının şifresi | Yalnızca hesap veritabanında henüz yoksa |
| `Email:Smtp:Password` | SMTP anahtarı/şifresi | Yalnız gerçek SMTP etkinse |

Secret olmayan ayarlar (`Jwt:Issuer`, `Jwt:Audience`, `Jwt:ExpireMinutes`,
`AdminSeed:Username`, `AdminSeed:Email`, connection string) normal şekilde
`appsettings.Development.json` içinde kalır.

## Development kurulumu (User Secrets — önerilen)

User Secrets deposu proje klasörünün **dışında**, kullanıcı profilinde
(`~/.microsoft/usersecrets/<UserSecretsId>/secrets.json`) tutulur; bu yüzden
kaynak kontrolüne asla girmez.

```bash
cd backend

# JWT imzalama anahtarı — en az 32 bayt olmalı, rastgele üretin:
dotnet user-secrets set "Jwt:Key" "$(python3 -c 'import secrets;print(secrets.token_urlsafe(64))')" \
  --project src/StajProject.Api

# İlk yönetici şifresi (yalnızca hesap henüz yoksa gerekir):
dotnet user-secrets set "AdminSeed:Password" "<şifre>" --project src/StajProject.Api
```

Tanımlı anahtarları listelemek için (değerleri de yazdırır, dikkat):

```bash
dotnet user-secrets list --project src/StajProject.Api
```

## Alternatif: ortam değişkenleri

Her ortamda çalışır; CI/CD ve container için tercih edilen yoldur. İç içe
anahtarlarda ayraç çift alt çizgidir:

```bash
export Jwt__Key="..."
export AdminSeed__Password="..."
```

## Brevo Free SMTP (isteğe bağlı gerçek e-posta)

Gerçek e-posta kapalıyken `DevelopmentEmailSender` kullanılmaya devam eder.
Brevo'nun ücretsiz SMTP/transactional email planıyla gerçek gönderimi açmak için
önce ücretsiz hesap oluşturun, ücretli plan/credit/add-on satın almayın ve ödeme
bilgisi girmeyin. Gönderici adresini doğrulayıp bir SMTP key oluşturduktan sonra
credential'ları yalnızca kendi terminalinizde User Secrets'a girin:

```bash
dotnet user-secrets set "Email:Smtp:Enabled" "true" --project src/StajProject.Api
dotnet user-secrets set "Email:Smtp:Host" "<BREVO_SMTP_HOST>" --project src/StajProject.Api
dotnet user-secrets set "Email:Smtp:Port" "<BREVO_SMTP_PORT>" --project src/StajProject.Api
dotnet user-secrets set "Email:Smtp:UseSsl" "false" --project src/StajProject.Api
dotnet user-secrets set "Email:Smtp:Username" "<BREVO_SMTP_LOGIN>" --project src/StajProject.Api
dotnet user-secrets set "Email:Smtp:Password" "<BREVO_SMTP_KEY>" --project src/StajProject.Api
dotnet user-secrets set "Email:Smtp:FromAddress" "<VERIFIED_SENDER_EMAIL>" --project src/StajProject.Api
dotnet user-secrets set "Email:Smtp:FromName" "StajProject" --project src/StajProject.Api
```

SMTP açıkken zorunlu alanlardan biri eksikse uygulama başlamaz; development
sink'ine sessizce geri düşmez. Brevo panelindeki güncel SMTP host/port değerlerini
kullanın. SMTP key'i kaynak dosyaya, appsettings'e veya destek mesajlarına
yapıştırmayın.

macOS'ta yalnızca sertifika iptal servisine erişilememesinden kaynaklanan
`incomplete certificate revocation check` hatası görülürse, aşağıdaki yerel
User Secret kullanılabilir:

```bash
dotnet user-secrets set "Email:Smtp:CheckCertificateRevocation" "false" --project src/StajProject.Api
```

Güvenli varsayılan ve tracked appsettings değeri `true` kalır. Bu seçenek
hostname, sertifika zinciri veya imza doğrulamasını kapatmaz; uygulama hiçbir
permissive certificate callback kaydetmez.

Manuel doğrulama:

1. Backend'i kendi terminalinizden başlatın.
2. Ulaşabildiğiniz gerçek bir e-posta adresiyle kayıt olun.
3. Gelen doğrulama e-postasındaki bağlantıyı açın.
4. Başarılı doğrulamadan sonra hesabın `PendingApproval` durumuna geçtiğini
   yönetici ekranından doğrulayın.

Öncelik sırası: `appsettings.json` → `appsettings.{Environment}.json` →
User Secrets (yalnız Development) → ortam değişkenleri. Yani ortam değişkeni
her zaman kazanır.

## Davranış notları

- **Fail-closed:** `Jwt:Key` yoksa veya 32 bayttan kısaysa uygulama açıklayıcı
  bir hatayla başlamayı reddeder. Varsayılan/fallback bir anahtar **üretilmez** —
  aksi hâlde tüm kurulumlarda aynı, tahmin edilebilir anahtarla token imzalanırdı.
- **Seeder (yalnızca bootstrap):** yönetici hesabı veritabanında zaten varsa
  hiçbir alanına dokunulmaz — şifre hash'i, **rolü**, e-postası, aktiflik
  durumu ve security stamp'i olduğu gibi kalır. Hesap yoksa ve
  `AdminSeed:Password` tanımlı değilse hesap oluşturulmaz; log'a çalıştırılacak
  komutu içeren bir `Error` kaydı düşer. Hiçbir koşulda varsayılan şifre
  üretilmez.
- **Zero-admin recovery:** startup'ta sistemde hiç *aktif Admin* kalmadıysa
  bootstrap hesabı Admin rolüne yükseltilir ve bu yüksek seviyede loglanır.
  Koşul dardır — "bootstrap hesabı Admin değil" değil, "hiç aktif Admin yok" —
  dolayısıyla bilinçli rol değişiklikleri geri alınmaz. Kapatmak için:
  `AdminSeed:EnableZeroAdminRecovery = false` (varsayılan `true`; kapatıldığında
  0 admin durumu manuel müdahale gerektirir).
- **Key rotasyonu:** `Jwt:Key` değiştirildiğinde daha önce üretilmiş tüm
  token'lar geçersiz olur; açık oturumlar bir kez yeniden login ister.
  (Frontend bunu zaten yönetiyor: 401 → otomatik logout.)
