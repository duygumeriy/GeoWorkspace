import { readFileSync } from 'node:fs'

/**
 * Kanonik taksonomiyi BACKEND kaynağından okur.
 *
 * Testin içine 44 anahtar kopyalamak, taksonominin ikinci bir tanımı olurdu ve
 * bir kategori değiştiğinde sessizce ayrışırdı. Tek kaynak
 * `PoiCategoryTaxonomy.All`'dur; burada yapılan tek şey onu okumaktır.
 */
const source = readFileSync(
  new URL('../../../../backend/src/StajProject.Domain/Common/PoiCategoryTaxonomy.cs', import.meta.url),
  'utf8',
)

/* Satır biçimi:
     new("slug", "Ad", parentSlugOrNull, "icon-key", PoiCategoryPalette.X), */
const entries = [...source.matchAll(
  /new\("([a-z0-9-]+)",\s*"[^"]+",\s*(null|"[a-z0-9-]+"),\s*"([a-z0-9-]+)"/g,
)]

const iconKeys = [...new Set(entries.map((match) => match[3]))]
const slugs = entries.map((match) => match[1])

export const PoiCategoryTaxonomy = { iconKeys, slugs }
