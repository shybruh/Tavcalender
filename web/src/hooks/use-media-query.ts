import { useSyncExternalStore } from "react"

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query)
      mql.addEventListener("change", cb)
      return () => mql.removeEventListener("change", cb)
    },
    () => window.matchMedia(query).matches,
  )
}

/** Desktop layout: wide enough, and not a phone forced into phone layout (see index.html). */
export function useIsDesktop() {
  const wide = useMediaQuery("(min-width: 768px)")
  return wide && !document.documentElement.classList.contains("force-mobile")
}
