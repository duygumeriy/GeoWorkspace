import { useEffect } from 'react'

/** Typing in a field must never trigger a tool. */
function isTypingTarget(target) {
  if (!target) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable === true
  )
}

/**
 * Desktop power-user shortcuts.
 *
 *   P / L / G  draw tools      M  measurement
 *   Esc        abort drawing, then close the open panel
 *   Cmd/Ctrl+Z undo            Cmd/Ctrl+Shift+Z (or Ctrl+Y) redo
 *
 * Escape and the undo/redo combinations are always active — anything with a
 * keyboard attached should be able to back out of a drawing. Only the bare
 * letter shortcuts are gated on `lettersEnabled`, since on a touch-only device
 * they would just be dead weight (and the drawing hints would be misleading).
 *
 * @param {{ lettersEnabled: boolean, onTool: Function, onMeasure: Function,
 *           onEscape: Function, onUndo: Function, onRedo: Function }} handlers
 */
export default function useKeyboardShortcuts({ lettersEnabled, onTool, onMeasure, onEscape, onUndo, onRedo }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Escape still works from inside a field, so a panel can always be closed.
      if (event.key === 'Escape') {
        onEscape?.()
        return
      }

      if (isTypingTarget(event.target)) return

      const modifier = event.metaKey || event.ctrlKey

      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) onRedo?.()
        else onUndo?.()
        return
      }

      if (modifier && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        onRedo?.()
        return
      }

      // Plain letter shortcuts must not fight with browser/OS combinations.
      if (modifier || event.altKey || !lettersEnabled) return

      switch (event.key.toLowerCase()) {
        case 'p':
          onTool?.('point')
          break
        case 'l':
          onTool?.('line')
          break
        case 'g':
          onTool?.('polygon')
          break
        case 'm':
          onMeasure?.()
          break
        default:
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [lettersEnabled, onTool, onMeasure, onEscape, onUndo, onRedo])
}
