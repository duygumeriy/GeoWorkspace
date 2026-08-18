namespace StajProject.Domain.Common;

/// <summary>
/// Hesabın yaşam döngüsündeki açık durumu. Uygulamaya giriş hakkı bu alandan
/// okunur; koda dağılmış "doğrulandı mı / aktif mi" kombinasyonları yerine tek
/// bir kanonik değer vardır.
/// </summary>
/// <remarks>
/// <para>
/// <b>Mevcut alanlarla ilişkisi.</b> Bu enum <c>EmailConfirmed</c>,
/// <c>is_active</c> ve <c>is_deleted</c> alanlarının yerini ALMAZ; onları
/// çelişkisiz bir biçimde tamamlar:
/// <list type="bullet">
/// <item><c>EmailConfirmed</c> — Identity'nin sahibi olduğu doğrulama gerçeği.
/// <see cref="PendingEmailVerification"/> dışına çıkmanın ön koşuludur.</item>
/// <item><c>is_active</c> — "oturum açabilir" bayrağı. Yalnızca
/// <see cref="Active"/> durumunda <c>true</c>'dur; diğer tüm durumlarda
/// <c>false</c>'tur.</item>
/// <item><c>is_deleted</c> — durumdan bağımsız soft delete. Silinmiş kayıt
/// hangi durumda olursa olsun kimlik doğrulayamaz.</item>
/// </list>
/// </para>
/// <para>
/// Sayısal değerler veritabanında saklanır ve <b>değiştirilemez</b>; mevcut
/// satırların anlamı bu sıralamaya bağlıdır.
/// </para>
/// </remarks>
public enum AccountStatus
{
    /// <summary>Kayıt olmuş, e-posta adresini henüz doğrulamamış.</summary>
    PendingEmailVerification = 0,

    /// <summary>E-postası doğrulanmış, yönetici onayı bekliyor.</summary>
    PendingApproval = 1,

    /// <summary>Yönetici onaylamış; rolü atanmış ve giriş yapabilir.</summary>
    Active = 2,

    /// <summary>Daha önce aktifken yönetici tarafından devre dışı bırakılmış.</summary>
    Suspended = 3,

    /// <summary>Başvurusu yönetici tarafından reddedilmiş.</summary>
    Rejected = 4
}
