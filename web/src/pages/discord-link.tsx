import { useState } from "react"
import { Link, useSearchParams } from "react-router"
import { useQuery } from "@tanstack/react-query"
import { CheckCircle2Icon, LinkIcon, XCircleIcon } from "lucide-react"
import { pb, displayName, errorMessage } from "@/lib/pb"
import { useAuth } from "@/hooks/use-auth"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { APP_NAME, LogoMark } from "@/components/logo"

/** Where /register in Discord sends you: connect that Discord account to your app account. */
export function DiscordLinkPage() {
  const [params] = useSearchParams()
  const token = params.get("t") ?? ""
  const { user } = useAuth()
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle")
  const [error, setError] = useState("")

  const info = useQuery({
    queryKey: ["discord-link", token],
    queryFn: () => pb.send<{ valid: boolean; discord_name?: string }>("/api/tav/discord/link-info", { query: { t: token } }),
    enabled: !!token,
  })
  const here = `/link/discord?t=${encodeURIComponent(token)}`
  const discordName = info.data?.discord_name || "your Discord account"

  async function claim() {
    setState("busy")
    try {
      await pb.send("/api/tav/discord/claim", { method: "POST", body: { token } })
      await pb.collection("users").authRefresh()
      setState("done")
    } catch (err) {
      setError(errorMessage(err))
      setState("error")
    }
  }

  let body
  if (!token || info.data?.valid === false) {
    body = (
      <Card className="text-center">
        <CardHeader className="items-center">
          <XCircleIcon className="mx-auto mb-2 size-10 text-muted-foreground" />
          <CardTitle>Link expired</CardTitle>
          <CardDescription>Links from Discord last 30 minutes. Type <code>/register</code> in Discord again for a fresh one.</CardDescription>
        </CardHeader>
      </Card>
    )
  } else if (info.isLoading) {
    body = <Skeleton className="h-48 rounded-xl" />
  } else if (state === "done") {
    body = (
      <Card className="text-center">
        <CardHeader className="items-center">
          <CheckCircle2Icon className="mx-auto mb-2 size-10 text-primary" />
          <CardTitle>Discord connected</CardTitle>
          <CardDescription>
            <b>{discordName}</b> is now linked to {displayName(user)}.
            {user?.status === "approved"
              ? " Head back to Discord and try /plan."
              : " Once an admin approves your account you can use the bot."}
          </CardDescription>
        </CardHeader>
        <CardFooter className="justify-center">
          <Link to="/" className={buttonVariants()}>Open {APP_NAME}</Link>
        </CardFooter>
      </Card>
    )
  } else if (!user) {
    body = (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><LinkIcon className="size-5" /> Connect {discordName}</CardTitle>
          <CardDescription>Log in to link it to your account, or make an account if you're new. An admin approves new accounts.</CardDescription>
        </CardHeader>
        <CardFooter className="flex-col gap-2">
          <Link to={`/login?next=${encodeURIComponent(here)}`} className={buttonVariants({ className: "h-10 w-full" })}>I have an account</Link>
          <Link
            to={`/signup?next=${encodeURIComponent(here)}&name=${encodeURIComponent(info.data?.discord_name ?? "")}`}
            className={buttonVariants({ variant: "outline", className: "h-10 w-full" })}
          >
            I'm new here
          </Link>
        </CardFooter>
      </Card>
    )
  } else {
    body = (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><LinkIcon className="size-5" /> Connect Discord</CardTitle>
          <CardDescription>
            Link <b>{discordName}</b> to <b>{displayName(user)}</b> ({user.email})? The bot will act as you: it can see and make the same plans you can.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {user.discord_id && (
            <p className="text-sm text-muted-foreground">This replaces your currently linked Discord account ({user.discord_name}).</p>
          )}
          {state === "error" && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
        <CardFooter className="flex-col gap-2">
          <Button className="h-10 w-full" onClick={claim} disabled={state === "busy"}>{state === "busy" ? "Linking…" : "Link accounts"}</Button>
          <Link to="/" className={buttonVariants({ variant: "ghost", className: "w-full" })}>Cancel</Link>
        </CardFooter>
      </Card>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-muted/40 p-4">
      <div className="flex items-center gap-2 text-lg font-semibold">
        <LogoMark className="size-9" />
        {APP_NAME}
      </div>
      <div className="w-full max-w-sm">{body}</div>
    </div>
  )
}
