import { useCallback, useSyncExternalStore } from "react"

// Small per-device preferences stored in localStorage.

const listeners = new Set<() => void>()

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? "[]"
  } catch {
    return "[]"
  }
}

/** A persisted set of ids the user has toggled off. */
function useHiddenSet(key: string) {
  const raw = useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => read(key),
  )
  const hidden = new Set<string>(JSON.parse(raw))

  const toggle = useCallback((id: string) => {
    const next = new Set<string>(JSON.parse(read(key)))
    if (next.has(id)) next.delete(id)
    else next.add(id)
    try {
      localStorage.setItem(key, JSON.stringify([...next]))
    } catch {
      /* private mode */
    }
    listeners.forEach((l) => l())
  }, [key])

  return { hidden, toggle }
}

export const useHiddenCalendars = () => useHiddenSet("tav:hidden-calendars")
export const useHiddenPeople = () => useHiddenSet("tav:hidden-people")
