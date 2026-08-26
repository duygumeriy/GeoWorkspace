using System.Buffers.Binary;
using System.IO.Compression;

namespace StajProject.Application.Rendering;

/// <summary>
/// En küçük, bağımlılıksız RGBA PNG yazıcısı.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden bir görüntü kütüphanesi eklenmedi.</b> Buradaki ihtiyaç tek bir
/// şeydir: bilinen genişlik/yükseklikte, 8 bit, RGBA, aralıksız (interlace
/// yok) bir tampon dosyaya çevrilsin. PNG'nin bu alt kümesi yaklaşık yüz
/// satırdır ve sıkıştırmanın tamamını .NET'in kendi <see cref="ZLibStream"/>'i
/// yapar. Bir çizim/görüntü kütüphanesi (SkiaSharp, ImageSharp) yalnızca bunun
/// için projeye yerel ikili bağımlılık, lisans ve sürüm yüzeyi eklerdi.
/// </para>
/// <para>
/// <b>Yalnızca YAZAR.</b> Bir PNG çözücü YOKTUR ve gerekmez: analiz rasteri
/// artık dışarıdan bir görüntü okuyup birleştirmez, doğrudan sayılardan
/// üretilir.
/// </para>
/// <para>
/// Üretilen dosya spesifikasyonun zorunlu üçlüsünü taşır: <c>IHDR</c>,
/// <c>IDAT</c>, <c>IEND</c>. Her satır <b>filtre 0</b> (None) ile yazılır —
/// filtre seçimi yalnızca sıkıştırma oranını etkiler, doğruluğu değil, ve
/// yoğunluk rasteri zaten büyük düz alanlar içerdiği için deflate tek başına
/// iyi iş çıkarır.
/// </para>
/// </remarks>
public static class PngWriter
{
    private static readonly byte[] Signature = [137, 80, 78, 71, 13, 10, 26, 10];

    /// <summary>Renk tipi 6: truecolour + alpha.</summary>
    private const byte ColorTypeRgba = 6;

    private const byte BitDepth = 8;

    /// <summary>
    /// <paramref name="rgba"/> tamponunu PNG bayt dizisine çevirir.
    /// </summary>
    /// <param name="rgba">
    /// Satır satır, soldan sağa, <c>R,G,B,A</c> sırasıyla; uzunluğu
    /// <c>width × height × 4</c> olmalıdır.
    /// </param>
    public static byte[] WriteRgba(ReadOnlySpan<byte> rgba, int width, int height)
    {
        if (width <= 0 || height <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(width), "Genişlik ve yükseklik pozitif olmalıdır.");
        }

        if (rgba.Length != (long)width * height * 4)
        {
            throw new ArgumentException(
                $"Tampon boyutu {(long)width * height * 4} olmalıdır; gelen: {rgba.Length}.",
                nameof(rgba));
        }

        /* Her satırın başına filtre baytı eklenir. PNG'de bu bayt satırın
           PARÇASIDIR ve olmadan dosya çözülemez. */
        var stride = width * 4;
        var raw = new byte[(stride + 1) * (long)height];

        for (var row = 0; row < height; row++)
        {
            var target = row * (stride + 1);
            raw[target] = 0; // filtre: None
            rgba.Slice(row * stride, stride).CopyTo(raw.AsSpan(target + 1, stride));
        }

        using var output = new MemoryStream();
        output.Write(Signature);

        Span<byte> header = stackalloc byte[13];
        BinaryPrimitives.WriteInt32BigEndian(header[..4], width);
        BinaryPrimitives.WriteInt32BigEndian(header.Slice(4, 4), height);
        header[8] = BitDepth;
        header[9] = ColorTypeRgba;
        header[10] = 0; // sıkıştırma: deflate
        header[11] = 0; // filtre yöntemi: adaptif
        header[12] = 0; // interlace: yok

        WriteChunk(output, "IHDR", header);
        WriteChunk(output, "IDAT", Deflate(raw));
        WriteChunk(output, "IEND", []);

        return output.ToArray();
    }

    private static byte[] Deflate(byte[] raw)
    {
        using var compressed = new MemoryStream();

        /* <see cref="ZLibStream"/> zlib başlığı ve Adler-32 sağlamasını da
           yazar; PNG'nin `IDAT` içeriği tam olarak budur. Ham
           <c>DeflateStream</c> kullanmak başlıksız bir akış üretir ve hiçbir
           çözücü onu okuyamazdı. */
        using (var deflate = new ZLibStream(compressed, CompressionLevel.Optimal, leaveOpen: true))
        {
            deflate.Write(raw);
        }

        return compressed.ToArray();
    }

    private static void WriteChunk(Stream stream, string type, ReadOnlySpan<byte> data)
    {
        Span<byte> length = stackalloc byte[4];
        BinaryPrimitives.WriteInt32BigEndian(length, data.Length);
        stream.Write(length);

        Span<byte> typeBytes = stackalloc byte[4];
        for (var index = 0; index < 4; index++)
        {
            typeBytes[index] = (byte)type[index];
        }

        stream.Write(typeBytes);
        stream.Write(data);

        /* CRC, tip VE veriyi birlikte kapsar — yalnızca veriyi kapsayan bir
           sağlama dosyayı sessizce bozuk kılardı. */
        var crc = Crc32.Start();
        crc = Crc32.Append(crc, typeBytes);
        crc = Crc32.Append(crc, data);

        Span<byte> crcBytes = stackalloc byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(crcBytes, Crc32.Finish(crc));
        stream.Write(crcBytes);
    }

    /// <summary>PNG chunk'larının zorunlu CRC-32'si (IEEE 802.3 polinomu).</summary>
    private static class Crc32
    {
        private static readonly uint[] Table = BuildTable();

        internal static uint Start() => 0xFFFFFFFFu;

        internal static uint Append(uint crc, ReadOnlySpan<byte> data)
        {
            foreach (var value in data)
            {
                crc = Table[(crc ^ value) & 0xFF] ^ (crc >> 8);
            }

            return crc;
        }

        internal static uint Finish(uint crc) => crc ^ 0xFFFFFFFFu;

        private static uint[] BuildTable()
        {
            var table = new uint[256];

            for (var index = 0u; index < 256u; index++)
            {
                var value = index;

                for (var bit = 0; bit < 8; bit++)
                {
                    value = (value & 1) != 0 ? 0xEDB88320u ^ (value >> 1) : value >> 1;
                }

                table[index] = value;
            }

            return table;
        }
    }
}
