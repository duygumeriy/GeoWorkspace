import { useRef, useState } from 'react'
import { CloseIcon } from '../ui/icons/index.js'
import { TAG_LIMITS } from '../../map/drawingTypes.js'
import './TagInput.css'

/**
 * Chip-style tag editor.
 *
 * Typing a tag and pressing Enter (or comma) turns it into a chip; Backspace in
 * an empty field removes the last one, which is the shortcut people expect from
 * every other tag input. Each chip also carries a real remove button rather than
 * relying on that shortcut, because Backspace-to-delete does not exist on a
 * phone keyboard and hover-revealed controls do not exist on touch at all.
 *
 * The rules mirror the backend's (`DrawingMetadataValidator`) so the chips shown
 * here are already the tags that will be stored: trimmed, de-duplicated
 * case-insensitively, and capped. Rejections are explained inline instead of
 * silently dropping the input.
 *
 * @param {{ value: string[], onChange: (tags: string[]) => void,
 *           id?: string, disabled?: boolean }} props
 */
export default function TagInput({ value = [], onChange, id, disabled = false }) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  const atLimit = value.length >= TAG_LIMITS.maxCount

  const addTag = (raw) => {
    const trimmed = raw.trim()
    if (!trimmed) return

    if (atLimit) {
      setError(`En fazla ${TAG_LIMITS.maxCount} etiket ekleyebilirsiniz.`)
      return
    }
    if (trimmed.length > TAG_LIMITS.maxLength) {
      setError(`Etiketler en fazla ${TAG_LIMITS.maxLength} karakter olabilir.`)
      return
    }
    // Same case-insensitive comparison the backend uses, with the Turkish
    // locale so "İSTANBUL" and "istanbul" are recognised as one tag.
    if (value.some((tag) => tag.toLocaleLowerCase('tr') === trimmed.toLocaleLowerCase('tr'))) {
      setError('Bu etiket zaten eklendi.')
      setDraft('')
      return
    }

    onChange([...value, trimmed])
    setDraft('')
    setError('')
  }

  const removeTag = (index) => {
    onChange(value.filter((_, position) => position !== index))
    setError('')
    // Focus returns to the field so removing several chips in a row stays a
    // keyboard operation.
    inputRef.current?.focus()
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ',') {
      // Enter must not submit the surrounding form: here it means "finish this
      // tag", and losing the drawing's whole popup to it would be a bad trade.
      event.preventDefault()
      addTag(draft)
      return
    }
    if (event.key === 'Backspace' && draft === '' && value.length > 0) {
      removeTag(value.length - 1)
    }
  }

  return (
    <div className="tag-input">
      {value.length > 0 && (
        <ul className="tag-input-chips">
          {value.map((tag, index) => (
            <li key={tag} className="tag-chip">
              <span className="tag-chip-text">{tag}</span>
              <button
                type="button"
                className="tag-chip-remove"
                aria-label={`${tag} etiketini kaldır`}
                disabled={disabled}
                onClick={() => removeTag(index)}
              >
                <CloseIcon size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        id={id}
        ref={inputRef}
        type="text"
        className="tag-input-field"
        value={draft}
        disabled={disabled || atLimit}
        maxLength={TAG_LIMITS.maxLength}
        autoComplete="off"
        placeholder={atLimit ? `En fazla ${TAG_LIMITS.maxCount} etiket` : 'Etiket yazıp Enter’a basın'}
        aria-describedby={`${id}-hint`}
        onChange={(event) => {
          setDraft(event.target.value)
          if (error) setError('')
        }}
        onKeyDown={handleKeyDown}
        // Leaving the field commits what was typed, so a half-entered tag is
        // not lost just because the user tabbed on to the save button.
        onBlur={() => addTag(draft)}
      />

      <p className="tag-input-hint" id={`${id}-hint`}>
        {error || `${value.length}/${TAG_LIMITS.maxCount} etiket · Enter ile ekleyin`}
      </p>
    </div>
  )
}
