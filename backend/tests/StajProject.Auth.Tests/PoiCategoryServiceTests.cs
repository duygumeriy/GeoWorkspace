using Microsoft.EntityFrameworkCore;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Pois;
using StajProject.Domain.Entities;

namespace StajProject.Auth.Tests;

/// <summary>
/// <see cref="StajProject.Infrastructure.Services.PoiCategoryService"/>
/// davranışı: hiyerarşi kuralları, döngü koruması, yol üretimi ve iki ayrı
/// okuma sözleşmesi.
/// </summary>
/// <remarks>
/// <b>Döngü koruması yalnızca arayüzde OLAMAZ.</b> Veritabanı geçişli bir
/// döngüyü tek satıra bakan bir kısıtla engelleyemez, dolayısıyla kural servis
/// katmanının sorumluluğudur ve testlerin ağırlığı oradadır.
/// </remarks>
public class PoiCategoryServiceTests
{
    /* --- Oluşturma ---------------------------------------------------------------- */

    [Fact]
    public async Task A_root_category_is_created_with_server_owned_state()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();

        var before = DateTime.UtcNow;
        var result = await fixture.Categories.CreateCategoryAsync(new CreatePoiCategoryRequest { Name = "  Yeme-İçme  ", IconKey = "map-pin", ColorHex = "#8B5CF6" });
        var after = DateTime.UtcNow;

        Assert.True(result.IsSuccess);
        Assert.Equal("Yeme-İçme", result.Value!.Name);
        Assert.Null(result.Value.ParentId);
        Assert.True(result.Value.IsActive);
        Assert.False(result.Value.IsDeleted);

        var stored = await fixture.Db.PoiCategories.SingleAsync();

        // CreatedDate servis tarafından AÇIKÇA damgalanır; ModifiedDate
        // AppDbContext.SaveChanges içinde.
        Assert.InRange(stored.CreatedDate, before, after);
        Assert.InRange(stored.ModifiedDate, before, after);
    }

    [Fact]
    public async Task A_child_category_is_created_under_its_parent()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();

        // Kullanılabilir üstün iki koşulu AÇIKÇA yazılır: bu test, reddedilen
        // üç bileşimin karşısındaki tek geçerli bileşimdir.
        var parent = await fixture.AddCategoryAsync("Yeme-İçme", isActive: true, isDeleted: false);

        var result = await fixture.Categories.CreateCategoryAsync(
            new CreatePoiCategoryRequest { Name = "Restoran", ParentId = parent.Id, IconKey = "map-pin", ColorHex = "#8B5CF6" });

        Assert.True(result.IsSuccess);
        Assert.Equal(parent.Id, result.Value!.ParentId);
        Assert.Equal("Yeme-İçme", result.Value.ParentName);
        Assert.Equal("Yeme-İçme / Restoran", result.Value.Path);
        Assert.Equal(1, result.Value.Depth);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public async Task A_category_without_a_name_is_rejected(string? name)
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();

        Assert.False((await fixture.Categories.CreateCategoryAsync(new CreatePoiCategoryRequest { Name = name, IconKey = "map-pin", ColorHex = "#8B5CF6" })).IsSuccess);
    }

    [Fact]
    public async Task A_name_longer_than_the_column_is_rejected()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();

        var result = await fixture.Categories.CreateCategoryAsync(
            new CreatePoiCategoryRequest { Name = new string('a', PoiCategory.MaxNameLength + 1), IconKey = "map-pin", ColorHex = "#8B5CF6" });

        Assert.False(result.IsSuccess);
    }

    [Theory]
    /* Kullanılabilir üst = aktif VE silinmemiş. Reddedilen üç bileşim, o
       koşulun olumsuzlanmasıdır; dördüncü bileşim (aktif + silinmemiş) geçerli
       yoldur ve A_child_category_is_created_under_its_parent tarafından
       kanıtlanır. */
    [InlineData(false, false)]
    [InlineData(true, true)]
    [InlineData(false, true)]
    public async Task An_unusable_parent_is_rejected_on_create(bool isActive, bool isDeleted)
    {
        /* Pasif ya da silinmiş bir üstün altına ekleme, doğduğu anda görünmeyen
           bir dal yaratırdı. */
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var parent = await fixture.AddCategoryAsync("Kullanılmaz", isActive: isActive, isDeleted: isDeleted);

        var result = await fixture.Categories.CreateCategoryAsync(
            new CreatePoiCategoryRequest { Name = "Alt", ParentId = parent.Id, IconKey = "map-pin", ColorHex = "#8B5CF6" });

        Assert.False(result.IsSuccess);
    }

    [Fact]
    public async Task A_parent_that_does_not_exist_is_rejected()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();

        Assert.False((await fixture.Categories.CreateCategoryAsync(
            new CreatePoiCategoryRequest { Name = "Alt", ParentId = 9999, IconKey = "map-pin", ColorHex = "#8B5CF6" })).IsSuccess);
    }

    /* --- Döngü koruması ------------------------------------------------------------ */

    [Fact]
    public async Task A_category_cannot_become_its_own_parent()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Kendi");

        var result = await fixture.Categories.UpdateCategoryAsync(
            category.Id,
            new UpdatePoiCategoryRequest { Name = "Kendi", ParentId = category.Id, IsActive = true, IconKey = "map-pin", ColorHex = "#8B5CF6" });

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);

        // Hiçbir şey yazılmadı: üst hâlâ null.
        Assert.Null((await fixture.Db.PoiCategories.SingleAsync(c => c.Id == category.Id)).ParentId);
    }

    [Fact]
    public async Task An_indirect_cycle_is_rejected()
    {
        /* A → B → C zinciri kuruluyken A'nın üstünü C yapmak, üç düğümü de
           kökten kopuk bir halkaya çevirirdi. */
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var a = await fixture.AddCategoryAsync("A");
        var b = await fixture.AddCategoryAsync("B", a.Id);
        var c = await fixture.AddCategoryAsync("C", b.Id);

        var result = await fixture.Categories.UpdateCategoryAsync(
            a.Id,
            new UpdatePoiCategoryRequest { Name = "A", ParentId = c.Id, IsActive = true, IconKey = "map-pin", ColorHex = "#8B5CF6" });

        Assert.False(result.IsSuccess);
        Assert.Null((await fixture.Db.PoiCategories.SingleAsync(x => x.Id == a.Id)).ParentId);
    }

    [Fact]
    public async Task A_cycle_through_a_hidden_category_is_still_rejected()
    {
        /* Döngü kontrolü TÜM satırları okur: pasif bir düğümden geçen döngü de
           döngüdür ve görünmez olması onu zararsız yapmaz. */
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var a = await fixture.AddCategoryAsync("A");
        var hidden = await fixture.AddCategoryAsync("Gizli", a.Id, isActive: false);
        var leaf = await fixture.AddCategoryAsync("Yaprak", hidden.Id);

        var result = await fixture.Categories.UpdateCategoryAsync(
            a.Id,
            new UpdatePoiCategoryRequest { Name = "A", ParentId = leaf.Id, IsActive = true, IconKey = "map-pin", ColorHex = "#8B5CF6" });

        Assert.False(result.IsSuccess);
    }

    [Fact]
    public void Corrupt_ancestry_data_cannot_loop_forever()
    {
        /* Elle atılmış bir UPDATE A → B → A bırakabilir. Yol üreticisi ziyaret
           edilen kimlikleri izler ve derinliği sınırlar; sonuç sonsuz döngü
           DEĞİL, kesilmiş bir yoldur. */
        var nodes = new Dictionary<int, PoiCategoryHierarchy.Node>
        {
            [1] = new(1, "A", 2),
            [2] = new(2, "B", 1)
        };

        var path = PoiCategoryHierarchy.BuildPath(nodes, 1);

        Assert.Equal("B / A", path);
        Assert.True(PoiCategoryHierarchy.WouldCreateCycle(nodes, 1, 2));
        Assert.True(PoiCategoryHierarchy.DepthOf(nodes, 1) < PoiCategoryHierarchy.MaxDepth);
    }

    [Fact]
    public void A_chain_deeper_than_the_guard_is_truncated_rather_than_hanging()
    {
        var nodes = new Dictionary<int, PoiCategoryHierarchy.Node>();

        for (var i = 1; i <= PoiCategoryHierarchy.MaxDepth * 3; i++)
        {
            nodes[i] = new PoiCategoryHierarchy.Node(i, $"N{i}", i == 1 ? null : i - 1);
        }

        var deepest = nodes.Keys.Max();

        Assert.Equal(PoiCategoryHierarchy.MaxDepth - 1, PoiCategoryHierarchy.DepthOf(nodes, deepest));
    }

    /* --- Güncelleme ----------------------------------------------------------------- */

    [Fact]
    public async Task A_valid_re_parent_succeeds()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var food = await fixture.AddCategoryAsync("Yeme-İçme");
        var shopping = await fixture.AddCategoryAsync("Alışveriş");
        var cafe = await fixture.AddCategoryAsync("Kafe", shopping.Id);

        var result = await fixture.Categories.UpdateCategoryAsync(
            cafe.Id,
            new UpdatePoiCategoryRequest { Name = "Kafe", ParentId = food.Id, IsActive = true, IconKey = "map-pin", ColorHex = "#8B5CF6" });

        Assert.True(result.IsSuccess);
        Assert.Equal(food.Id, result.Value!.ParentId);
        Assert.Equal("Yeme-İçme / Kafe", result.Value.Path);
    }

    [Fact]
    public async Task An_unusable_parent_is_rejected_on_re_parent()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var hidden = await fixture.AddCategoryAsync("Pasif", isActive: false);
        var category = await fixture.AddCategoryAsync("Taşınacak");

        var result = await fixture.Categories.UpdateCategoryAsync(
            category.Id,
            new UpdatePoiCategoryRequest { Name = "Taşınacak", ParentId = hidden.Id, IsActive = true, IconKey = "map-pin", ColorHex = "#8B5CF6" });

        Assert.False(result.IsSuccess);
    }

    [Fact]
    public async Task An_inactive_category_can_be_edited_back_into_use()
    {
        // Yönetim pasif bir kategoriyi düzenleyebilmelidir; aksi hâlde
        // pasifleştirme geri dönülemez bir işlem olurdu.
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Pasif", isActive: false);

        var result = await fixture.Categories.UpdateCategoryAsync(
            category.Id,
            new UpdatePoiCategoryRequest { Name = "Yeniden Aktif", IsActive = true, IconKey = "map-pin", ColorHex = "#8B5CF6" });

        Assert.True(result.IsSuccess);
        Assert.True(result.Value!.IsActive);
    }

    [Fact]
    public async Task A_deleted_category_is_not_found_for_editing()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Silinmiş", isDeleted: true);

        var result = await fixture.Categories.UpdateCategoryAsync(
            category.Id,
            new UpdatePoiCategoryRequest { Name = "Geri", IsActive = true, IconKey = "map-pin", ColorHex = "#8B5CF6" });

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.NotFound, result.ErrorKind);
    }

    [Fact]
    public void The_update_contract_carries_no_audit_or_delete_fields()
    {
        var properties = typeof(UpdatePoiCategoryRequest).GetProperties().Select(p => p.Name).ToArray();

        /* Sözleşmenin TAMAMI sayılır, "şu alan yok" denmez: kapalı bir liste,
           yazılabilir bir alanın yanlışlıkla EKLENMESİNİ de yakalar. Faz 2'de
           IconKey ve ColorHex bilinçli olarak eklendi; Slug ise burada YOKTUR
           ve olmamalıdır — teknik kimlik oluşturmada üretilir ve yeniden
           adlandırmayla değişmez. */
        Assert.Equal(
            ["ColorHex", "IconKey", "IsActive", "Name", "ParentId"],
            properties.OrderBy(name => name, StringComparer.Ordinal));
    }

    /* --- Listeler --------------------------------------------------------------------- */

    [Fact]
    public async Task The_public_list_hides_inactive_and_deleted_categories()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        await fixture.AddCategoryAsync("Görünür");
        await fixture.AddCategoryAsync("Pasif", isActive: false);
        await fixture.AddCategoryAsync("Silinmiş", isDeleted: true);

        var categories = await fixture.Categories.GetActiveCategoriesAsync();

        Assert.Equal(["Görünür"], categories.Select(c => c.Name));
    }

    [Fact]
    public async Task The_public_list_is_ordered_by_hierarchy_then_name()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var food = await fixture.AddCategoryAsync("Yeme-İçme");
        await fixture.AddCategoryAsync("Restoran", food.Id);
        await fixture.AddCategoryAsync("Kafe", food.Id);
        await fixture.AddCategoryAsync("Alışveriş");

        var paths = (await fixture.Categories.GetActiveCategoriesAsync()).Select(c => c.Path);

        // Her alt ağaç kendi üstünün hemen ardında, kardeşler alfabetik.
        Assert.Equal(
            ["Alışveriş", "Yeme-İçme", "Yeme-İçme / Kafe", "Yeme-İçme / Restoran"],
            paths);
    }

    [Fact]
    public async Task The_admin_list_includes_inactive_and_deleted_categories()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        await fixture.AddCategoryAsync("Görünür");
        await fixture.AddCategoryAsync("Pasif", isActive: false);
        await fixture.AddCategoryAsync("Silinmiş", isDeleted: true);

        var categories = await fixture.Categories.GetAdminCategoriesAsync();

        Assert.Equal(3, categories.Count);
        Assert.Contains(categories, c => c.Name == "Pasif" && !c.IsActive);
        Assert.Contains(categories, c => c.Name == "Silinmiş" && c.IsDeleted);
    }

    [Fact]
    public async Task The_admin_list_resolves_paths_through_hidden_parents()
    {
        /* Yönetim ekranı, pasif bir üstün altındaki dalın nereye bağlı
           olduğunu göstermek zorundadır; yol kesilirse alt ağaç kökmüş gibi
           görünürdü. */
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var hidden = await fixture.AddCategoryAsync("Pasif Üst", isActive: false);
        await fixture.AddCategoryAsync("Alt", hidden.Id);

        var categories = await fixture.Categories.GetAdminCategoriesAsync();

        Assert.Contains(categories, c => c.Path == "Pasif Üst / Alt" && c.ParentName == "Pasif Üst");
    }
}
