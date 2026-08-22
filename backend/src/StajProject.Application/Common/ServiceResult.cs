namespace StajProject.Application.Common;

/// <summary>
/// Hatanın controller tarafında hangi HTTP koduna karşılık geldiğini belirler.
/// </summary>
public enum ServiceErrorKind
{
    /// <summary>400 — doğrulama hatası.</summary>
    Validation,

    /// <summary>404 — kayıt bulunamadı.</summary>
    NotFound,

    /// <summary>
    /// 403 — kimlik doğrulanmış ancak bu kaynak üzerinde yetki yok
    /// (ör. başkasının çizimini değiştirme girişimi).
    /// </summary>
    Forbidden,

    /// <summary>
    /// 409 — istek geçerli ama sistemin mevcut durumuyla çelişiyor
    /// (ör. son aktif Admin'in rolünü düşürme girişimi).
    /// </summary>
    Conflict,

    /// <summary>502 — bağımlı servis geçerli bir yanıt üretemedi.</summary>
    Upstream,

    /// <summary>504 — bağımlı servis zaman aşımına uğradı.</summary>
    Timeout
}

/// <summary>
/// Servis katmanının başarı/doğrulama-hatası sonucunu exception kullanmadan
/// controller'a taşıması için basit sonuç tipi.
/// </summary>
public sealed class ServiceResult<T>
{
    private ServiceResult(T? value, string? error, ServiceErrorKind errorKind)
    {
        Value = value;
        Error = error;
        ErrorKind = errorKind;
    }

    public T? Value { get; }

    public string? Error { get; }

    /// <summary><see cref="IsSuccess"/> false ise anlamlıdır.</summary>
    public ServiceErrorKind ErrorKind { get; }

    public bool IsSuccess => Error is null;

    public static ServiceResult<T> Success(T value) => new(value, null, ServiceErrorKind.Validation);

    public static ServiceResult<T> Failure(string error) => new(default, error, ServiceErrorKind.Validation);

    public static ServiceResult<T> NotFound(string error) => new(default, error, ServiceErrorKind.NotFound);

    public static ServiceResult<T> Conflict(string error) => new(default, error, ServiceErrorKind.Conflict);

    public static ServiceResult<T> Forbidden(string error) => new(default, error, ServiceErrorKind.Forbidden);

    public static ServiceResult<T> Upstream(string error) => new(default, error, ServiceErrorKind.Upstream);

    public static ServiceResult<T> Timeout(string error) => new(default, error, ServiceErrorKind.Timeout);
}
