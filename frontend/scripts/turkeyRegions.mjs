/**
 * Türkiye'nin 7 coğrafi bölgesi ve her bölgeye bağlanan iller.
 *
 * <b>BU EŞLEME BİR YAKLAŞIMDIR.</b> Coğrafi bölgeler 1941 Birinci Türk Coğrafya
 * Kongresi'nde fiziki coğrafya ölçütleriyle tanımlanmıştır ve sınırları il
 * sınırlarını BİREBİR TAKİP ETMEZ: bazı iller iki bölgeye bölünür (örneğin
 * Afyonkarahisar, Isparta, Sivas, Kastamonu). Burada her il, ağırlıklı olarak
 * bulunduğu TEK bir bölgeye bağlanmıştır — yaygın olarak kullanılan idari
 * basitleştirme budur.
 *
 * Bunun sonucu, arayüzde de AÇIKÇA söylenir: bölge seçimi "il sınırlarının
 * birleşiminden oluşturulan yaklaşık bölge kapsamı" olarak etiketlenir. Resmî
 * bir bölge sınırı veri kümesi gibi sunulmaz.
 *
 * Bu dosya yalnızca DERLEME zamanında okunur (bkz. build-turkey-provinces.mjs).
 */

/** Bölge anahtarı → görünen ad. Anahtarlar SourceKey olarak saklanır. */
export const REGIONS = [
  { key: 'MARMARA', name: 'Marmara' },
  { key: 'EGE', name: 'Ege' },
  { key: 'AKDENIZ', name: 'Akdeniz' },
  { key: 'IC_ANADOLU', name: 'İç Anadolu' },
  { key: 'KARADENIZ', name: 'Karadeniz' },
  { key: 'DOGU_ANADOLU', name: 'Doğu Anadolu' },
  { key: 'GUNEYDOGU_ANADOLU', name: 'Güneydoğu Anadolu' },
]

/** Bölge anahtarı → ISO 3166-2 il kodları. 81 ilin her biri TAM BİR kez geçer. */
export const REGION_PROVINCE_CODES = {
  MARMARA: [
    'TR-10', 'TR-11', 'TR-16', 'TR-17', 'TR-22', 'TR-34',
    'TR-39', 'TR-41', 'TR-54', 'TR-59', 'TR-77',
  ],
  EGE: [
    'TR-03', 'TR-09', 'TR-20', 'TR-35', 'TR-43', 'TR-45', 'TR-48', 'TR-64',
  ],
  AKDENIZ: [
    'TR-01', 'TR-07', 'TR-15', 'TR-31', 'TR-32', 'TR-33', 'TR-46', 'TR-80',
  ],
  IC_ANADOLU: [
    'TR-06', 'TR-18', 'TR-26', 'TR-38', 'TR-40', 'TR-42', 'TR-50',
    'TR-51', 'TR-58', 'TR-66', 'TR-68', 'TR-70', 'TR-71',
  ],
  KARADENIZ: [
    'TR-05', 'TR-08', 'TR-14', 'TR-19', 'TR-28', 'TR-29', 'TR-37', 'TR-52', 'TR-53',
    'TR-55', 'TR-57', 'TR-60', 'TR-61', 'TR-67', 'TR-69', 'TR-74', 'TR-78', 'TR-81',
  ],
  DOGU_ANADOLU: [
    'TR-04', 'TR-12', 'TR-13', 'TR-23', 'TR-24', 'TR-25', 'TR-30',
    'TR-36', 'TR-44', 'TR-49', 'TR-62', 'TR-65', 'TR-75', 'TR-76',
  ],
  GUNEYDOGU_ANADOLU: [
    'TR-02', 'TR-21', 'TR-27', 'TR-47', 'TR-56', 'TR-63', 'TR-72', 'TR-73', 'TR-79',
  ],
}
