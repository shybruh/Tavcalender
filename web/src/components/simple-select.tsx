import type { ReactNode } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

export interface SelectOption {
  value: string
  label: ReactNode
}

/** Thin wrapper around shadcn Select for the common "list of options" case. */
export function SimpleSelect({ value, onChange, options, placeholder, className, id, size }: {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  className?: string
  id?: string
  size?: "sm" | "default"
}) {
  return (
    <Select items={options} value={value} onValueChange={(v) => onChange((v as string) ?? "")}>
      <SelectTrigger id={id} size={size} className={cn("w-full", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
