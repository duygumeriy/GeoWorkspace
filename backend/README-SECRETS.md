# Secret yapılandırması

Bu projede **hiçbir gerçek credential appsettings dosyalarında veya kaynak kodda
tutulmaz.** Aşağıdaki iki değer secret'tır ve her geliştiricinin kendi
makinesinde tanımlaması gerekir.

| Configuration anahtarı | Ne işe yarar | Zorunlu mu |
|---|---|---|
| `Jwt:Key` | JWT imzalama anahtarı (HMAC-SHA256) | **Evet** — tanımlı değilse uygulama başlamaz |
| `AdminSeed:Password` | İlk yönetici hesabının şifresi | Yalnızca hesap veritabanında henüz yoksa |

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
