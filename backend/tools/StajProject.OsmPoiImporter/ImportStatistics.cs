using System.Globalization;
using System.Text;

namespace StajProject.OsmPoiImporter;

/// <summary>
/// İçe aktarımın sayılabilir sonucu.
/// </summary>
/// <remarks>
/// <para>
/// <b>Tek bir "atlandı" sayısı YETMEZ.</b> "9231 atlandı" bir bilgi değil, bir
/// sorudur: eşleme tablosu mu eksik, çıkarım mı kısmi, geometri mi bozuk?
/// Kırılım (<see cref="Skipped"/>) o sorunun cevabıdır ve eşlemeyi düzeltmenin
/// tek yoludur.
/// </para>
/// <para>
/// <b><see cref="RowsPerSlug"/> ZORUNLUDUR.</b> Kategori eşlemesinin birincil
/// sağlık göstergesidir: <c>yeme-icme</c> binlerce satır alırken <c>kafe</c>
/// boş kalıyorsa "en özel kategori kazanır" kuralı çalışmıyor demektir ve bu,
/// yalnızca toplam sayıya bakarak ASLA fark edilmezdi.
/// </para>
/// </remarks>
public sealed class ImportStatistics
{
    /// <summary>
    /// Kaynakta görülen <b>etiketli</b> OSM elemanı sayısı.
    /// </summary>
    /// <remarks>
    /// <b>Etiketsiz düğümler sayılmaz</b> — gerçek bir çıkarımdaki düğümlerin
    /// ezici çoğunluğu yolların köşe noktalarıdır ve bir "eleman" olarak
    /// raporlanmaları sayıyı anlamsız biçimde şişirirdi. Bu sayaç, <see
    /// cref="Read"/> ile <see cref="TotalSkipped"/> arasındaki farkı açıklayan
    /// üst kümedir: etiketli her eleman ya bir özelliğe dönüşür ya da kaynakta
    /// atlanır.
    /// </remarks>
    public int TaggedElements { get; set; }

    /// <summary>
    /// Kaynak bağdaştırıcısının <b>ürettiği</b> özellik sayısı.
    /// </summary>
    /// <remarks>
    /// Dosyadaki eleman sayısı DEĞİLDİR: eşleme kuralına hiç uymayan ya da
    /// geometrisi kurulamayan elemanlar bu sayaca hiç girmez; onlar
    /// <see cref="Skipped"/> içinde görünür. Bu yüzden atlananların üretilen
    /// özelliklerden çok daha büyük olması normaldir (bkz. <see cref="TaggedElements"/>).
    /// </remarks>
    public int Read { get; set; }

    /// <summary>Kanonik bir kategoriye çözülen özellik sayısı (geometri denetiminden ÖNCE).</summary>
    public int Candidate { get; set; }

    /// <summary>Kanonik bir kategoriye eşlenen eleman sayısı.</summary>
    public int Mapped { get; set; }

    /// <summary>
    /// Birden çok İLGİSİZ kategori eşleşti ve özgüllükle çözüldü.
    /// </summary>
    /// <remarks>
    /// Bir hata değil, bir UYARIDIR: çözülmüş bile olsa belirsizlik, eşleme
    /// tablosunun gözden geçirilmesi gerektiğini söyler.
    /// </remarks>
    public int AmbiguousResolved { get; set; }

    public int Inserted { get; set; }

    public int Updated { get; set; }

    /// <summary>Zaten aynı olan, dolayısıyla yazılmayan satırlar.</summary>
    public int Unchanged { get; set; }

    /// <summary>Kuru çalıştırmada eklenecek olan satır sayısı.</summary>
    public int WouldInsert { get; set; }

    /// <summary>Kuru çalıştırmada güncellenecek olan satır sayısı.</summary>
    public int WouldUpdate { get; set; }

    public TimeSpan Duration { get; set; }

    /// <summary>Sebep başına atlanan eleman sayısı.</summary>
    public IReadOnlyDictionary<ImportSkipReason, int> Skipped => _skipped;

    /// <summary>Kanonik slug başına yazılan/yazılacak satır sayısı.</summary>
    public IReadOnlyDictionary<string, int> RowsPerSlug => _rowsPerSlug;

    private readonly Dictionary<ImportSkipReason, int> _skipped = [];
    private readonly Dictionary<string, int> _rowsPerSlug = new(StringComparer.Ordinal);
    private readonly Dictionary<AmbiguityKey, AmbiguityGroup> _resolvedAmbiguities = [];
    private readonly Dictionary<string, AmbiguityGroup> _unresolvedAmbiguities = new(StringComparer.Ordinal);

    /// <summary>Çakışma grubu başına saklanacak azami örnek kimlik.</summary>
    public const int MaxSamplesPerGroup = 3;

    /// <summary>
    /// Ayrıntılı belirsizlik kırılımı toplanacak mı.
    /// </summary>
    /// <remarks>
    /// Kapalıyken <see cref="AmbiguousResolved"/> yine sayılır — davranış
    /// değişmez — ama hiçbir grup/örnek saklanmaz. Tanılama bir MALİYETTİR ve
    /// yalnızca istendiğinde ödenir.
    /// </remarks>
    public bool DiagnosticsEnabled { get; set; }

    /// <summary>Çözülmüş belirsizliklerin çakışma başına toplamı.</summary>
    public IReadOnlyDictionary<AmbiguityKey, AmbiguityGroup> ResolvedAmbiguities => _resolvedAmbiguities;

    /// <summary>
    /// Çözülemeyip atlanan belirsizliklerin ÇAKIŞMA TÜRÜ başına toplamı.
    /// </summary>
    /// <remarks>
    /// Anahtar, berabere kalan adayların SIRALI slug kümesidir
    /// (<c>enerji-uretim-dagitim &lt;&gt; sanayi-uretim</c>). Yalnızca örnek
    /// kimlik saklamak "10 nesne atlandı" demekten biraz daha iyiydi; hangi
    /// kategori çiftlerinin çarpıştığını söylemiyordu ve dolayısıyla hangi
    /// kuralın gözden geçirileceğini de göstermiyordu.
    /// </remarks>
    public IReadOnlyDictionary<string, AmbiguityGroup> UnresolvedAmbiguities => _unresolvedAmbiguities;

    /// <summary>Çözülmüş bir belirsizliği kaydeder (yalnızca tanılama açıkken).</summary>
    /// <remarks>
    /// <b>Bellek SINIRLIDIR.</b> Saklanan şey özellikler değil, çakışma
    /// İMZALARIDIR: anahtar uzayı taksonomi × kural tablosuyla sınırlıdır ve
    /// girdi büyüklüğüyle büyümez. Grup başına en fazla
    /// <see cref="MaxSamplesPerGroup"/> kimlik tutulur.
    /// </remarks>
    public void RecordResolvedAmbiguity(AmbiguityResolution resolution, string externalId)
    {
        if (!DiagnosticsEnabled)
        {
            return;
        }

        var key = new AmbiguityKey(resolution.Reason, resolution.Signature);

        if (!_resolvedAmbiguities.TryGetValue(key, out var group))
        {
            group = new AmbiguityGroup();
            _resolvedAmbiguities[key] = group;
        }

        group.Add(externalId);
    }

    /// <summary>
    /// Çözülemeyen bir belirsizliği çakışma TÜRÜNE göre kaydeder (yalnızca
    /// tanılama açıkken).
    /// </summary>
    /// <remarks>
    /// <b>Bellek SINIRLIDIR.</b> Grup sayısı olası kategori KOMBİNASYONLARIYLA
    /// sınırlıdır — girdi büyüklüğüyle değil — ve grup başına en fazla
    /// <see cref="MaxSamplesPerGroup"/> kimlik tutulur. Aday kümesi çağıran
    /// tarafında sıralanır, dolayısıyla aynı çakışma iki farklı sırada gelse
    /// bile tek bir gruba düşer.
    /// </remarks>
    public void RecordUnresolvedAmbiguity(string signature, string externalId)
    {
        if (!DiagnosticsEnabled)
        {
            return;
        }

        if (!_unresolvedAmbiguities.TryGetValue(signature, out var group))
        {
            group = new AmbiguityGroup();
            _unresolvedAmbiguities[signature] = group;
        }

        group.Add(externalId);
    }

    public int TotalSkipped => _skipped.Values.Sum();

    public void Skip(ImportSkipReason reason) =>
        _skipped[reason] = _skipped.GetValueOrDefault(reason) + 1;

    public void CountSlug(string slug) =>
        _rowsPerSlug[slug] = _rowsPerSlug.GetValueOrDefault(slug) + 1;

    /// <summary>Konsola yazılacak okunabilir özet.</summary>
    public string Format(bool dryRun)
    {
        var builder = new StringBuilder();

        builder.AppendLine(dryRun ? "KURU ÇALIŞTIRMA — hiçbir satır yazılmadı." : "İçe aktarım tamamlandı.");
        builder.AppendLine();
        /* ETİKETLER, sayaçların GERÇEKTE ölçtüğü şeyi söyler. Önceki "Okunan
           eleman" başlığı yanıltıcıydı: sayaç dosyadaki elemanları değil,
           kaynak bağdaştırıcısının ÜRETTİĞİ özellikleri sayar — bu yüzden
           atlananlar ondan çok daha büyük olabilir ve bu bir hata değildir. */
        builder.AppendLine($"  Etiketli OSM elemanı : {TaggedElements}");
        builder.AppendLine($"  Üretilen özellik     : {Read}");
        builder.AppendLine($"  Kategorisi çözülen   : {Candidate}");
        builder.AppendLine($"  Eşleşen              : {Mapped}");
        builder.AppendLine($"  Belirsiz (çözülen)   : {AmbiguousResolved}");

        if (dryRun)
        {
            builder.AppendLine($"  Eklenecek            : {WouldInsert}");
            builder.AppendLine($"  Güncellenecek        : {WouldUpdate}");
        }
        else
        {
            builder.AppendLine($"  Eklenen              : {Inserted}");
            builder.AppendLine($"  Güncellenen          : {Updated}");
        }

        builder.AppendLine($"  Değişmeyen           : {Unchanged}");
        builder.AppendLine($"  Atlanan              : {TotalSkipped}");

        /* Atlananların üretilen özelliklerden büyük olması BEKLENEN durumdur:
           bir çıkarımdaki etiketli elemanların çoğu (bina, adres, yol) hiçbir
           POI kuralına uymaz ve özelliğe hiç dönüşmez. */
        builder.AppendLine(
            $"       ({TaggedElements} etiketli eleman = {Read} üretilen özellik + kaynakta atlanan)");

        if (_skipped.Count > 0)
        {
            builder.AppendLine();
            builder.AppendLine("  Atlama sebepleri:");

            foreach (var (reason, count) in _skipped.OrderByDescending(pair => pair.Value))
            {
                builder.AppendLine($"    {reason,-24} {count}");
            }
        }

        builder.AppendLine();
        builder.AppendLine("  Kategori dağılımı (slug başına satır):");

        if (_rowsPerSlug.Count == 0)
        {
            builder.AppendLine("    (yok)");
        }
        else
        {
            foreach (var (slug, count) in _rowsPerSlug.OrderByDescending(pair => pair.Value).ThenBy(pair => pair.Key, StringComparer.Ordinal))
            {
                builder.AppendLine($"    {slug,-28} {count}");
            }
        }

        AppendAmbiguityDiagnostics(builder);

        builder.AppendLine();
        builder.AppendLine(
            $"  Süre: {Duration.TotalSeconds.ToString("F1", CultureInfo.InvariantCulture)} sn");

        return builder.ToString();
    }

    /// <summary>
    /// Çözülmüş belirsizliklerin kırılımı — yalnızca tanılama açıkken.
    /// </summary>
    /// <remarks>
    /// Basılan şey ÖZELLİKLER değil, çakışma GRUPLARIDIR: 874 karar birkaç
    /// satıra iner. Her grubun yanında en fazla üç örnek kimlik durur, böylece
    /// bir kararı OSM üzerinde elle doğrulamak mümkün olur.
    /// </remarks>
    private void AppendAmbiguityDiagnostics(StringBuilder builder)
    {
        if (!DiagnosticsEnabled)
        {
            return;
        }

        builder.AppendLine();
        builder.AppendLine("  Çözülen belirsizlikler:");

        if (_resolvedAmbiguities.Count == 0)
        {
            builder.AppendLine("    (yok)");
        }
        else
        {
            foreach (var reasonGroup in _resolvedAmbiguities
                .GroupBy(pair => pair.Key.Reason)
                .OrderBy(group => group.Key))
            {
                builder.AppendLine($"    {reasonGroup.Key}");

                foreach (var (key, group) in reasonGroup
                    .OrderByDescending(pair => pair.Value.Count)
                    .ThenBy(pair => pair.Key.Signature, StringComparer.Ordinal))
                {
                    builder.AppendLine($"      {key.Signature,-52} {group.Count}");

                    foreach (var sample in group.Samples)
                    {
                        builder.AppendLine($"        örnek: {sample}");
                    }
                }
            }
        }

        var unresolved = _skipped.GetValueOrDefault(ImportSkipReason.AmbiguousMapping);

        builder.AppendLine();
        builder.AppendLine($"  Çözülemeyen belirsizlikler (atlandı): {unresolved}");

        if (_unresolvedAmbiguities.Count == 0)
        {
            builder.AppendLine("    (yok)");

            return;
        }

        foreach (var (signature, group) in _unresolvedAmbiguities
            .OrderByDescending(pair => pair.Value.Count)
            .ThenBy(pair => pair.Key, StringComparer.Ordinal))
        {
            builder.AppendLine($"      {signature,-52} {group.Count}");

            foreach (var sample in group.Samples)
            {
                builder.AppendLine($"        örnek: {sample}");
            }
        }
    }
}

/// <summary>Bir çakışma grubunun kimliği: sebep + imza.</summary>
/// <remarks>
/// Anahtar uzayı taksonomi ve kural tablosuyla SINIRLIDIR; girdi büyüklüğüyle
/// büyümez. Bu yüzden grup sözlüğü ayrıca bir üst sınır taşımaz.
/// </remarks>
public sealed record AmbiguityKey(AmbiguityResolutionReason Reason, string Signature);

/// <summary>Bir çakışma grubunun sayacı ve SINIRLI örnek listesi.</summary>
public sealed class AmbiguityGroup
{
    private readonly List<string> _samples = [];

    public int Count { get; private set; }

    /// <summary>En fazla <see cref="ImportStatistics.MaxSamplesPerGroup"/> kimlik.</summary>
    public IReadOnlyList<string> Samples => _samples;

    public void Add(string externalId)
    {
        Count++;

        /* Sayaç sınırsız artar ama örnek listesi SABİT kalır: 874 kararın
           tamamını saklamak, tanılamayı bir bellek sızıntısına çevirirdi. */
        if (_samples.Count < ImportStatistics.MaxSamplesPerGroup)
        {
            _samples.Add(externalId);
        }
    }
}
