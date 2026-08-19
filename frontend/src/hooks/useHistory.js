import { useCallback, useRef, useState } from 'react'

/**
 * Undo/redo as a command stack.
 *
 * A command is `{ label, undo, redo }` where both handlers are async and return
 * `true` on success. Every command talks to the API first and only then mutates
 * the map, so local state and the database cannot drift apart: if the request
 * fails the command reports failure, the stack pointer is left exactly where it
 * was, and the caller shows an error toast.
 *
 * Commands address features by their stable client key rather than by database
 * id — undoing a delete re-inserts the row under a new id (see `nextClientKey`).
 *
 * The stacks live in a ref because `undo()`/`redo()` need to read them
 * synchronously mid-flight; the React state alongside exists purely to
 * re-render the toolbar's enabled/disabled state.
 *
 * <b>Every command is a real mutation, in BOTH directions.</b> Undoing a create
 * deletes the row; undoing a delete restores it; redoing a delete deletes it
 * again. So a command carries the permission codes each direction actually
 * needs (`undoPermissions` / `redoPermissions`) and `authorize` decides whether
 * the pending one may run right now. Authorization is live: a permission can be
 * withdrawn after the command was recorded, and "it was allowed when it
 * happened" says nothing about whether replaying it is allowed now.
 *
 * The check sits HERE rather than on the toolbar button because Ctrl/Cmd+Z and
 * Ctrl+Y reach `undo()`/`redo()` directly — gating only the button would leave
 * the keyboard as an open door.
 *
 * @param {{ authorize?: (command: object, direction: 'undo'|'redo') => boolean }} [options]
 *   Omitted in tests that do not care; the default allows everything, and the
 *   permission-aware caller supplies a real one.
 */
export default function useHistory({ authorize } = {}) {
  const stacksRef = useRef({ past: [], future: [] })
  /* Bekleyen komutlar da yayımlanır: çağıran, düğmeyi yalnızca yığın boş
     olduğu için değil, O ADIMIN yetkisi olmadığı için de kapatabilsin. */
  const [flags, setFlags] = useState({
    canUndo: false,
    canRedo: false,
    undoCommand: null,
    redoCommand: null,
  })
  // Guards against a second undo/redo starting while an API call is in flight.
  const busyRef = useRef(false)

  const publish = useCallback(() => {
    const { past, future } = stacksRef.current
    setFlags({
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      undoCommand: past.at(-1) ?? null,
      redoCommand: future.at(-1) ?? null,
    })
  }, [])

  /** Records an action that has already been performed successfully. */
  const push = useCallback(
    (command) => {
      // Any new action invalidates the redo branch.
      stacksRef.current = { past: [...stacksRef.current.past, command], future: [] }
      publish()
    },
    [publish],
  )

  const clear = useCallback(() => {
    stacksRef.current = { past: [], future: [] }
    publish()
  }, [publish])

  const run = useCallback(
    async (direction) => {
      if (busyRef.current) return { ok: true, skipped: true }

      const { past, future } = stacksRef.current
      const command = direction === 'undo' ? past.at(-1) : future.at(-1)
      if (!command) return { ok: true, skipped: true }

      /* Fail-closed. Yetkisi olmayan adım ÇALIŞTIRILMAZ ve yığından da
         DÜŞÜRÜLMEZ: yetki geri verildiğinde aynı adım yeniden kullanılabilir
         olmalı. Sunucu zaten reddederdi; buradaki amaç isteği hiç açmamak. */
      if (authorize && !authorize(command, direction)) {
        return { ok: false, unauthorized: true, command }
      }

      busyRef.current = true
      try {
        const ok = await (direction === 'undo' ? command.undo() : command.redo())

        if (!ok) {
          // Failed: the stack is untouched, so the user can retry or move on.
          return { ok: false, command }
        }

        stacksRef.current =
          direction === 'undo'
            ? { past: stacksRef.current.past.slice(0, -1), future: [...stacksRef.current.future, command] }
            : { past: [...stacksRef.current.past, command], future: stacksRef.current.future.slice(0, -1) }
        publish()

        return { ok: true, command }
      } finally {
        busyRef.current = false
      }
    },
    [publish, authorize],
  )

  const undo = useCallback(() => run('undo'), [run])
  const redo = useCallback(() => run('redo'), [run])

  return {
    canUndo: flags.canUndo,
    canRedo: flags.canRedo,
    undoCommand: flags.undoCommand,
    redoCommand: flags.redoCommand,
    push,
    undo,
    redo,
    clear,
  }
}
