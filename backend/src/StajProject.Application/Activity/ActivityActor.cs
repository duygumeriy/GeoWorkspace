namespace StajProject.Application.Activity;

/// <summary>
/// Bir aktivite kaydının aktörü, AÇIKÇA verildiğinde.
/// </summary>
/// <remarks>
/// Yalnızca oturumun bulunmadığı yaşam döngüsü geçişlerinde kullanılır ve
/// değeri daima SUNUCUNUN kendi durumundan gelir (ör. çalışan bir simülasyonun
/// sahibi). Kullanıcı adı verilmezse yazıcı onu kayıt anında veritabanından
/// çözer — ad, kaydın anlık kopyasıdır.
/// </remarks>
/// <param name="UserId">Doğrulanmış kullanıcı kimliği.</param>
/// <param name="UserName">Biliniyorsa ad; yoksa <c>null</c>.</param>
public sealed record ActivityActor(int UserId, string? UserName = null);
