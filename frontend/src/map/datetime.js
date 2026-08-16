/**
 * One date formatter for every panel that shows an audit timestamp.
 *
 * The API sends UTC; the browser renders it in the reader's own zone. Both the
 * selected-drawing panel and the analysis results use this, so a record cannot
 * appear to have been modified at two different times depending on which panel
 * is open.
 */

/** dd.MM.yyyy HH:mm, or an em dash when the API sent nothing. */
export function formatDateTime(value) {
  if (!value) return '—'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  return date.toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
