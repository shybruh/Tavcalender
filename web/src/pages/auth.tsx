import { useState, type FormEvent } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"
import { ClockIcon, LogOutIcon, XCircleIcon } from "lucide-react"
import { pb, errorMessage } from "@/lib/pb"
import { useAuth, logout } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { APP_NAME, LogoMark } from "@/components/logo"

function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-muted/40 p-4">
      <div className="flex items-center gap-2 text-lg font-semibold">
        <LogoMark className="size-9" />
        {APP_NAME}
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  )
}

/** Where to go after logging in / signing up (only same-app paths, e.g. the Discord link page). */
function useNext() {
  const [params] = useSearchParams()
  const next = params.get("next") || ""
  return next.startsWith("/") && !next.startsWith("//") ? next : "/"
}
const withNext = (path: string, next: string) => (next === "/" ? path : `${path}?next=${encodeURIComponent(next)}`)

export function LoginPage() {
  const navigate = useNavigate()
  const next = useNext()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setBusy(true)
    setError("")
    try {
      await pb.collection("users").authWithPassword(String(form.get("email")), String(form.get("password")))
      navigate(next)
    } catch (err) {
      setError(errorMessage(err) === "Failed to authenticate." ? "Wrong email or password." : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Welcome back</CardTitle>
          <CardDescription>Log in to see what everyone's up to.</CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input id="email" name="email" type="email" autoComplete="email" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input id="password" name="password" type="password" autoComplete="current-password" required />
              </Field>
              {error && <FieldError>{error}</FieldError>}
            </FieldGroup>
          </CardContent>
          <CardFooter className="mt-6 flex-col gap-3">
            <Button type="submit" className="h-10 w-full" disabled={busy}>
              {busy ? "Logging in…" : "Log in"}
            </Button>
            <p className="text-sm text-muted-foreground">
              New here? <Link to={withNext("/signup", next)} className="font-medium text-primary underline-offset-4 hover:underline">Request access</Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </AuthLayout>
  )
}

export function SignupPage() {
  const navigate = useNavigate()
  const next = useNext()
  const [params] = useSearchParams()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const email = String(form.get("email"))
    const password = String(form.get("password"))
    if (password.length < 8) return setError("Password must be at least 8 characters.")
    setBusy(true)
    setError("")
    try {
      await pb.collection("users").create({
        name: String(form.get("name")).trim(),
        email,
        password,
        passwordConfirm: password,
      })
      await pb.collection("users").authWithPassword(email, password)
      navigate(next)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Request access</CardTitle>
          <CardDescription>An admin will approve your account before you can see the calendars.</CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="name">Name</FieldLabel>
                <Input id="name" name="name" autoComplete="name" placeholder="What your friends call you" required maxLength={60} defaultValue={params.get("name") ?? ""} />
              </Field>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input id="email" name="email" type="email" autoComplete="email" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
              </Field>
              {error && <FieldError className="whitespace-pre-line">{error}</FieldError>}
            </FieldGroup>
          </CardContent>
          <CardFooter className="mt-6 flex-col gap-3">
            <Button type="submit" className="h-10 w-full" disabled={busy}>
              {busy ? "Sending…" : "Sign up"}
            </Button>
            <p className="text-sm text-muted-foreground">
              Already have an account? <Link to={withNext("/login", next)} className="font-medium text-primary underline-offset-4 hover:underline">Log in</Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </AuthLayout>
  )
}

/** Shown to signed-in users who aren't approved (yet). Updates live when the admin decides. */
export function PendingPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const rejected = user?.status === "rejected"

  return (
    <AuthLayout>
      <Card className="text-center">
        <CardHeader className="items-center">
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            {rejected ? <XCircleIcon className="size-6" /> : <ClockIcon className="size-6 animate-pulse" />}
          </div>
          <CardTitle className="text-xl">{rejected ? "Request declined" : "Waiting for approval"}</CardTitle>
          <CardDescription>
            {rejected
              ? "The admin didn't approve this account. Reach out to them if you think this is a mistake."
              : `Hi ${user?.name || "there"}! The admin has been notified. This page will update automatically once you're let in.`}
          </CardDescription>
        </CardHeader>
        <CardFooter className="justify-center">
          <Button variant="ghost" onClick={async () => { await logout(); navigate("/login") }}>
            <LogOutIcon /> Log out
          </Button>
        </CardFooter>
      </Card>
    </AuthLayout>
  )
}
