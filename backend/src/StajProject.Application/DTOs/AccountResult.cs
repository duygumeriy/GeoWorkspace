namespace StajProject.Application.DTOs;

/// <summary>
/// Hesap işlemlerinin sonucu. Başarı durumunda kullanıcıya gösterilecek
/// mesajı, başarısızlıkta doğrulama hatalarını taşır.
/// </summary>
/// <remarks>
/// Hiçbir zaman token, hash, security stamp veya kullanıcı nesnesi taşımaz —
/// bu tip doğrudan HTTP gövdesine serialize edilir.
/// </remarks>
public sealed class AccountResult
{
    private AccountResult(bool succeeded, string message, IReadOnlyList<string> errors)
    {
        Succeeded = succeeded;
        Message = message;
        Errors = errors;
    }

    public bool Succeeded { get; }

    public string Message { get; }

    /// <summary>Alan bazlı doğrulama hataları; başarıda boştur.</summary>
    public IReadOnlyList<string> Errors { get; }

    public static AccountResult Success(string message) => new(true, message, []);

    public static AccountResult Failure(string message, IReadOnlyList<string>? errors = null) =>
        new(false, message, errors ?? []);

    public static AccountResult Failure(string message, string error) => new(false, message, [error]);
}
