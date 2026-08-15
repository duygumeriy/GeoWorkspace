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
 */
export default function useHistory() {
  const stacksRef = useRef({ past: [], future: [] })
  const [flags, setFlags] = useState({ canUndo: false, canRedo: false })
  // Guards against a second undo/redo starting while an API call is in flight.
  const busyRef = useRef(false)

  const publish = useCallback(() => {
    const { past, future } = stacksRef.current
    setFlags({ canUndo: past.length > 0, canRedo: future.length > 0 })
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
    [publish],
  )

  const undo = useCallback(() => run('undo'), [run])
  const redo = useCallback(() => run('redo'), [run])

  return { canUndo: flags.canUndo, canRedo: flags.canRedo, push, undo, redo, clear }
}
