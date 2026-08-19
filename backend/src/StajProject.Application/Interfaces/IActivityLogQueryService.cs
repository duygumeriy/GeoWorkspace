using StajProject.Application.DTOs;

namespace StajProject.Application.Interfaces;

/// <summary>
/// Aktivite geçmişinin okunması.
/// </summary>
/// <remarks>
/// Yazma tarafından (<see cref="IActivityLogWriter"/>) AYRI tutulur: yazma her
/// istekte çalışan bir yan etki, okuma ise tek bir yönetim ekranının
/// sorgusudur. Tek arayüzde birleştirmek, her mutasyon isteğinin sorgulama
/// bağımlılığını da taşıması demekti.
/// </remarks>
public interface IActivityLogQueryService
{
    /// <summary>En yeniden eskiye, sayfalanmış.</summary>
    Task<ActivityLogPage> GetAsync(ActivityLogQuery query, CancellationToken cancellationToken = default);
}
