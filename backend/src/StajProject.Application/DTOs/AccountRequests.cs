namespace StajProject.Application.DTOs;

/* Hesap yönetimi request'leri.
   ÖNEMLİ: Bu DTO'ların hiçbiri role, isAdmin, permissions, userId,
   emailConfirmed veya twoFactorEnabled gibi server-owned alan İÇERMEZ.
   Model binder yalnızca burada tanımlı property'leri doldurur; request
   gövdesine eklenen fazladan alanlar sessizce yok sayılır ve hiçbir şekilde
   yetki yükseltmeye dönüşemez. */

public class RegisterRequest
{
    public string Username { get; set; } = string.Empty;

    public string Email { get; set; } = string.Empty;

    public string Password { get; set; } = string.Empty;

    /// <summary>
    /// Frontend doğrulaması burada da tekrarlanır: backend her zaman
    /// source of truth'tur, istemci kontrolü atlanabilir.
    /// </summary>
    public string ConfirmPassword { get; set; } = string.Empty;
}

public class ConfirmEmailRequest
{
    public int UserId { get; set; }

    /// <summary>Base64Url kodlanmış Identity token'ı.</summary>
    public string Token { get; set; } = string.Empty;
}

public class ResendConfirmationRequest
{
    public string Email { get; set; } = string.Empty;
}

public class ForgotPasswordRequest
{
    public string Email { get; set; } = string.Empty;
}

public class ResetPasswordRequest
{
    public string Email { get; set; } = string.Empty;

    /// <summary>Base64Url kodlanmış Identity token'ı.</summary>
    public string Token { get; set; } = string.Empty;

    public string NewPassword { get; set; } = string.Empty;

    public string ConfirmPassword { get; set; } = string.Empty;
}

public class ChangePasswordRequest
{
    public string CurrentPassword { get; set; } = string.Empty;

    public string NewPassword { get; set; } = string.Empty;

    public string ConfirmPassword { get; set; } = string.Empty;
}

/// <summary>
/// Yönetici tarafından parolasız oluşturulan hesabın davet bağlantısıyla
/// etkinleştirilmesi için gereken tek istemci girdileri.
/// </summary>
public class ActivateAccountRequest
{
    public int UserId { get; set; }

    /// <summary>Base64Url kodlanmış, özel AccountInvitation Identity token'ı.</summary>
    public string Token { get; set; } = string.Empty;

    public string Password { get; set; } = string.Empty;

    public string ConfirmPassword { get; set; } = string.Empty;
}

/// <summary>
/// Phase 13D'nin e-posta bağlantısını kurabilmesi için üretilen stateless
/// davet bilgisi. Rol içermez; aktivasyonda güncel rol veritabanından okunur.
/// </summary>
public sealed class AccountInvitationToken
{
    public int UserId { get; init; }

    public string Token { get; init; } = string.Empty;
}
