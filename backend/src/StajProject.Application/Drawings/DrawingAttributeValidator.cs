using StajProject.Application.Common;

namespace StajProject.Application.Drawings;

/// <summary>
/// Çizimin stil dışındaki öznitelik alanlarını doğrular. Şu an tek alan
/// <c>Name</c>; renk doğrulaması <c>DrawingStyleValidator</c> içindedir çünkü
/// renk kalıcı stil kolonlarının bir parçasıdır.
/// <para>
/// İki mod vardır ve ayrım kasıtlıdır:
/// <list type="bullet">
/// <item><b>Create</b> — kullanıcının öznitelik popup'ından gelen yeni kayıt.
/// İsim zorunludur.</item>
/// <item><b>Restore</b> — toplu silmenin geri alınması. Burada yalnızca daha
/// önce veritabanında bulunmuş satırlar yeniden yazılır; isim zorunluluğu
/// getirilirse bu kuraldan önce oluşturulmuş isimsiz kayıtlar geri
/// getirilemez hâle gelirdi.</item>
/// </list>
/// </para>
/// </summary>
public static class DrawingAttributeValidator
{
    /// <summary>EF mapping'indeki <c>HasMaxLength(200)</c> ile aynı sınır.</summary>
    public const int MaxNameLength = 200;

    /// <summary>Yeni kayıt: isim boş olamaz. Çıktı kırpılmış isimdir.</summary>
    public static ServiceResult<string> ValidateNameForCreate(string? name)
    {
        var trimmed = (name ?? string.Empty).Trim();

        if (trimmed.Length == 0)
        {
            return ServiceResult<string>.Failure("name alanı zorunludur ve boş olamaz.");
        }

        return CheckLength(trimmed);
    }

    /// <summary>Geri yükleme: isim boş kalabilir, uzunluk sınırı yine geçerlidir.</summary>
    public static ServiceResult<string> ValidateNameForRestore(string? name) =>
        CheckLength((name ?? string.Empty).Trim());

    private static ServiceResult<string> CheckLength(string trimmed) =>
        trimmed.Length > MaxNameLength
            ? ServiceResult<string>.Failure($"name en fazla {MaxNameLength} karakter olabilir.")
            : ServiceResult<string>.Success(trimmed);
}
