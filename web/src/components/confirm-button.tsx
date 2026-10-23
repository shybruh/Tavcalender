import { useState, type ReactNode } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

/** A button that asks for confirmation before running a destructive action. */
export function ConfirmButton({ title, description, confirmLabel = "Confirm", onConfirm, children, ...buttonProps }: {
  title: string
  description?: string
  confirmLabel?: string
  onConfirm: () => void | Promise<void>
  children: ReactNode
} & Omit<React.ComponentProps<typeof Button>, "onClick" | "title">) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button type="button" {...buttonProps} onClick={() => setOpen(true)}>{children}</Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={async () => { await onConfirm(); setOpen(false) }}>
              {confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
