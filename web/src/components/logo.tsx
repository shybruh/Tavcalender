import { Link } from "react-router"
import { cn } from "@/lib/utils"

export const APP_NAME = "Tav Calendar"

/** Outline calendar mark; takes the theme's primary colour (purple in light, white in dark). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cn("size-7 text-primary", className)} aria-hidden>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 10h17" />
      <path d="M8 3v4M16 3v4" />
    </svg>
  )
}

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
      <LogoMark />
      <span>{APP_NAME}</span>
    </Link>
  )
}
