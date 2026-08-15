using StajProject.Domain.Common;

namespace StajProject.Application.Interfaces;

/// <summary>
/// Bir çizim kaydı üzerinde mutation yapılıp yapılamayacağını söyleyen port.
/// </summary>
/// <remarks>
/// Kural tek bir yerde — API katmanındaki resource-based authorization
/// handler'ında — tanımlıdır; servisler kuralı kopyalamaz, yalnızca sorar.
/// Bu sayede ileride eklenecek geometry edit (move/scale/vertex) işlemleri de
/// aynı kuralı yeniden yazmadan kullanabilir.
/// </remarks>
public interface IDrawingAuthorizationService
{
    /// <summary>
    /// Geçerli kullanıcı bu kaydı düzenleyebilir/silebilir mi?
    /// Admin her kayda, diğer kullanıcılar yalnızca kendi kayıtlarına erişebilir.
    /// </summary>
    Task<bool> CanManageAsync(IStyledDrawingFeature drawing);

    /// <summary>
    /// Toplu işlemler için: kayıtların <b>tamamı</b> yönetilebiliyorsa true.
    /// Kısmi yetki toplu mutasyonu başlatmaya yetmez.
    /// </summary>
    Task<bool> CanManageAllAsync(IEnumerable<IStyledDrawingFeature> drawings);
}
