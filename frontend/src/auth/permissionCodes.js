/**
 * Kanonik yetki kodları — backend'in `PermissionCodes` sabitlerinin birebir
 * karşılığı.
 *
 * <b>Kaynak burası DEĞİLDİR.</b> Gerçek katalog veritabanındadır ve
 * yetkilendirme kararını her zaman backend verir. Bu dosya yalnızca kodların
 * arayüzde harf harf yazılmasını önler: `can('drawings.point.creat')` gibi bir
 * yazım hatası sessizce "yetki yok" demek olurdu ve hiçbir yerde hata
 * vermezdi.
 *
 * <b>Burada rol yoktur.</b> "Viewer şunları görür" biçiminde bir matris
 * bilinçli olarak eklenmez: rol→yetki eşlemesinin sahibi veritabanıdır ve onu
 * burada ikinci kez yazmak, bir rolün yetkisi değiştiği gün sessizce çelişen
 * iki kural kitabı yaratırdı. Arayüz yalnızca ETKİN kodları tüketir; özel bir
 * rol ya da kullanıcıya özel bir yetki bu sayede kendiliğinden çalışır.
 */
export const PERMISSIONS = Object.freeze({
  /* --- Harita ------------------------------------------------------------- */
  MAP_VIEW: 'map.view',

  /* --- Çizim oluşturma ---------------------------------------------------- */
  DRAWINGS_POINT_CREATE: 'drawings.point.create',
  DRAWINGS_LINE_CREATE: 'drawings.line.create',
  DRAWINGS_POLYGON_CREATE: 'drawings.polygon.create',

  /* --- Çizim yönetimi ----------------------------------------------------- */
  DRAWINGS_VIEW: 'drawings.view',
  DRAWINGS_METADATA_UPDATE: 'drawings.metadata.update',
  DRAWINGS_GEOMETRY_UPDATE: 'drawings.geometry.update',
  DRAWINGS_STYLE_UPDATE: 'drawings.style.update',
  DRAWINGS_DELETE: 'drawings.delete',
  DRAWINGS_RESTORE: 'drawings.restore',

  /* --- Araçlar ------------------------------------------------------------ */
  MEASUREMENT_USE: 'measurement.use',
  SELECTION_USE: 'selection.use',

  /* --- Envanter ----------------------------------------------------------- */
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_ANALYSIS: 'inventory.analysis',

  /* --- Isı haritası -------------------------------------------------------- */
  /* Envanter analizinden AYRI bir koddur: analiz çalıştırabilen birinin ısı
     haritasını da görebildiği varsayımı bilinçli olarak yoktur. */
  HEATMAP_VIEW: 'heatmap.view',

  /* --- Katmanlar ---------------------------------------------------------- */
  LAYERS_VIEW: 'layers.view',
  LAYERS_MANAGE: 'layers.manage',

  /* --- Kullanıcılar ------------------------------------------------------- */
  USERS_VIEW: 'users.view',
  USERS_CREATE: 'users.create',
  USERS_UPDATE: 'users.update',
  USERS_DEACTIVATE: 'users.deactivate',
  USERS_DELETE: 'users.delete',

  /* --- Roller ------------------------------------------------------------- */
  ROLES_VIEW: 'roles.view',
  ROLES_CREATE: 'roles.create',
  ROLES_UPDATE: 'roles.update',
  ROLES_DELETE: 'roles.delete',

  /* --- Yetkiler ----------------------------------------------------------- */
  PERMISSIONS_VIEW: 'permissions.view',
  PERMISSIONS_ASSIGN: 'permissions.assign',

  /* --- Coğrafi yetkilendirme ---------------------------------------------- */
  /* Katalog eksiksiz tutulur: bu kodları HENÜZ hiçbir ekran tüketmiyor —
     coğrafi yetki arayüzü sonraki fazda gelir. Sabitin burada durması, o ekran
     yazılırken kodun elle yeniden yazılmasını (ve sessizce yanlış yazılmasını)
     önler. */
  GEOGRAPHY_VIEW: 'geography.view',
  GEOGRAPHY_MANAGE: 'geography.manage',

  /* --- Denetim ------------------------------------------------------------ */
  /* Aktivite geçmişi kendi yetkisidir ve users.view / permissions.view altına
     gizlenmez: kayıt, diğer yöneticilerin hareketlerini de gösterir. Kullanıcı
     listesini görebilmek, yönetim geçmişini okuyabilmekle aynı şey değildir. */
  ACTIVITY_VIEW: 'activity.view',
})

/**
 * Çizim türü → o türü OLUŞTURMA yetkisi.
 *
 * Üç kod ayrı kalır ve tek bir "çizim oluşturma" yetkisine indirgenmez, çünkü
 * backend'de de ayrılar: `POST /api/drawings/point` yalnızca
 * `drawings.point.create` arar. Geçmiş yığınındaki bir "ileri al" adımı da
 * aynı ucu çağırdığı için aynı eşlemeyi kullanır.
 */
export const DRAWING_CREATE_PERMISSIONS = Object.freeze({
  point: PERMISSIONS.DRAWINGS_POINT_CREATE,
  line: PERMISSIONS.DRAWINGS_LINE_CREATE,
  polygon: PERMISSIONS.DRAWINGS_POLYGON_CREATE,
})

/**
 * Yönetim panelinin bölümleri, kenar çubuğundaki SIRAYLA.
 *
 * Tek tanım: kenar çubuğu, `/admin` kök yönlendirmesi ve rota koruyucuları
 * hepsi bunu okur. Üç yerde üç ayrı liste tutmak, bir bölüm eklendiğinde
 * menüde görünüp yönlendirmede atlanmasına açık kapı bırakırdı.
 */
export const ADMIN_SECTIONS = Object.freeze([
  { path: '/admin/users', permission: PERMISSIONS.USERS_VIEW },
  { path: '/admin/roles', permission: PERMISSIONS.ROLES_VIEW },
  { path: '/admin/permissions', permission: PERMISSIONS.PERMISSIONS_VIEW },
  /* Aktivite geçmişi de bir yönetim BÖLÜMÜDÜR: yalnızca `activity.view`
     taşıyan bir denetçi, başka hiçbir yetkisi olmasa bile yönetim panelini
     açabilmeli ve doğrudan bu sayfaya yönlendirilmelidir. Listeye eklenmeseydi
     menüde görünür ama /admin kökü onu hiç seçmezdi. */
  { path: '/admin/activity', permission: PERMISSIONS.ACTIVITY_VIEW },
])

/** Yönetim paneline girişi açan yetkiler: en az biri yeterlidir. */
export const ADMIN_ENTRY_PERMISSIONS = Object.freeze(ADMIN_SECTIONS.map((section) => section.permission))
