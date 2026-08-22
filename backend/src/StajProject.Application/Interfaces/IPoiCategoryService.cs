using StajProject.Application.Common;
using StajProject.Application.DTOs;

namespace StajProject.Application.Interfaces;

/// <summary>
/// POI kategori hiyerarşisinin okunması ve yönetimi.
/// </summary>
/// <remarks>
/// <b>Neden POI servisinden ayrı.</b> Kategori yazma yolu kendine ait bir iş
/// kuralı taşır — döngü koruması ve yol üretimi — ve bu kural POI oluşturmayla
/// hiç kesişmez. Tek bir serviste toplanmaları, iki farklı yetki kapısının
/// (<c>poi.create</c> ile <c>poi.categories.manage</c>) aynı sınıfa bakması
/// demek olurdu.
/// </remarks>
public interface IPoiCategoryService
{
    /// <summary>
    /// Sıradan istemcinin gördüğü kategoriler: yalnızca aktif ve silinmemiş.
    /// POI oluşturma açılır listesi ile POI gösterimi bunu kullanır.
    /// </summary>
    Task<IReadOnlyList<PoiCategoryResponse>> GetActiveCategoriesAsync(
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Yönetim listesi: pasif ve soft-delete edilmiş kategoriler DÂHİL.
    /// </summary>
    Task<IReadOnlyList<AdminPoiCategoryResponse>> GetAdminCategoriesAsync(
        CancellationToken cancellationToken = default);

    Task<ServiceResult<AdminPoiCategoryResponse>> CreateCategoryAsync(
        CreatePoiCategoryRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Adı, üst kategoriyi ve aktifliği günceller. Silme bu fazın kapsamında
    /// DEĞİLDİR ve arayüzde karşılığı yoktur.
    /// </summary>
    Task<ServiceResult<AdminPoiCategoryResponse>> UpdateCategoryAsync(
        int id,
        UpdatePoiCategoryRequest request,
        CancellationToken cancellationToken = default);
}
