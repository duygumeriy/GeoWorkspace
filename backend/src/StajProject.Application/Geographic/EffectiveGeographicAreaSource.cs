using StajProject.Domain.Common;

namespace StajProject.Application.Geographic;

/// <summary>
/// Yürürlükteki coğrafi alanın kalıcı kaynak kimliği. Geometrik
/// güvenlik kararının yerine geçmez; yalnızca idari analiz kataloğunu
/// üretirken açık il/bölge atamalarını korur.
/// </summary>
public sealed record EffectiveGeographicAreaSource(
    GeographicAreaSource SourceType,
    string? SourceKey);
