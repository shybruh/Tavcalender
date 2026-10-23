import { useState, type FormEvent } from "react"
import { formatDistanceToNow } from "date-fns"
import { toast } from "sonner"
import { CheckIcon, ExternalLinkIcon, ShieldIcon, UserCheckIcon, XIcon } from "lucide-react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { pb, displayName, errorMessage, type User } from "@/lib/pb"
import { parsePb } from "@/lib/dates"
import { useAuth } from "@/hooks/use-auth"
import { botInviteUrl, useAppSettings, useUsers } from "@/hooks/queries"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { UserAvatar } from "@/components/user-avatar"
import { EmptyState } from "@/components/empty-state"
import { ConfirmButton } from "@/components/confirm-button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { DiscordIcon } from "./settings"

// The site admin only decides who gets into the app. Friendships and groups are run
// by the people in them, and admins have no access to anyone's plans.

function useUserPatch() {
  const qc = useQueryClient()
  return async (u: User, data: Partial<User>, msg: string) => {
    try {
      await pb.collection("users").update(u.id, data)
      qc.invalidateQueries({ queryKey: ["users"] })
      toast.success(msg)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
}

export function AdminPage() {
  const { data: users } = useUsers()
  const pending = users?.filter((u) => u.status === "pending") ?? []
  // until the user picks a tab, open on requests whenever there are any
  const [picked, setPicked] = useState<string | null>(null)
  const tab = picked ?? (pending.length ? "requests" : "members")

  return (
    <div className="mx-auto max-w-3xl p-3 md:p-6">
      <h1 className="mb-1 text-xl font-semibold tracking-tight md:text-2xl">Admin</h1>
      <p className="mb-4 text-sm text-muted-foreground">Approve who can use the app. Friends and groups are managed by everyone themselves.</p>
      <Tabs value={tab} onValueChange={(v) => setPicked(v as string)}>
        <TabsList className="mb-4 w-full sm:w-auto">
          <TabsTrigger value="requests">
            Sign-ups {pending.length > 0 && <Badge className="ml-1">{pending.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="discord"><DiscordIcon className="size-3.5" /> Discord</TabsTrigger>
        </TabsList>
        <TabsContent value="requests"><Requests pending={pending} /></TabsContent>
        <TabsContent value="members"><Members /></TabsContent>
        <TabsContent value="discord"><DiscordAdmin /></TabsContent>
      </Tabs>
    </div>
  )
}

function Requests({ pending }: { pending: User[] }) {
  const patch = useUserPatch()
  if (!pending.length) {
    return <EmptyState icon={<UserCheckIcon className="size-6" />} title="No one waiting" description="New sign-ups show up here, and you'll get a notification." />
  }
  return (
    <div className="flex flex-col gap-2">
      {pending.map((u) => {
        const created = parsePb(u.created)
        return (
          <div key={u.id} className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3">
            <UserAvatar user={u} />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{displayName(u)}</div>
              <div className="truncate text-sm text-muted-foreground">
                {u.email}{created && ` · ${formatDistanceToNow(created, { addSuffix: true })}`}
              </div>
            </div>
            <div className="flex w-full gap-2 sm:w-auto">
              <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => patch(u, { status: "rejected" }, `${displayName(u)} was declined`)}>
                <XIcon /> Decline
              </Button>
              <Button className="flex-1 sm:flex-none" onClick={() => patch(u, { status: "approved" }, `${displayName(u)} is in!`)}>
                <CheckIcon /> Approve
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Members() {
  const { user: me } = useAuth()
  const { data: users } = useUsers()
  const patch = useUserPatch()
  const members = (users ?? []).filter((u) => u.status !== "pending")

  return (
    <div className="flex flex-col gap-2">
      {members.map((u) => {
        const isMe = u.id === me?.id
        return (
          <div key={u.id} className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3">
            <UserAvatar user={u} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 font-medium">
                {displayName(u)}
                {u.role === "admin" && <Badge variant="secondary"><ShieldIcon /> Admin</Badge>}
                {u.status === "rejected" && <Badge variant="destructive">Declined</Badge>}
                {isMe && <Badge variant="outline">You</Badge>}
              </div>
              <div className="truncate text-sm text-muted-foreground">{u.email}</div>
            </div>
            {!isMe && (
              <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                {u.status === "rejected" ? (
                  <Button size="sm" variant="outline" onClick={() => patch(u, { status: "approved" }, `${displayName(u)} is in!`)}>Approve</Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => patch(u, { role: u.role === "admin" ? "member" : "admin" }, u.role === "admin" ? "Admin removed" : "Made admin")}
                    >
                      {u.role === "admin" ? "Remove admin" : "Make admin"}
                    </Button>
                    <ConfirmButton
                      size="sm"
                      variant="ghost"
                      title={`Revoke ${displayName(u)}?`}
                      description="They'll be locked out of the app until approved again."
                      confirmLabel="Revoke"
                      onConfirm={() => patch(u, { status: "rejected", role: "member" }, "Access revoked")}
                    >
                      Revoke
                    </ConfirmButton>
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---- discord -------------------------------------------------------------------------

function DiscordAdmin() {
  const qc = useQueryClient()
  const { data: settings } = useAppSettings()
  const tokenState = useQuery({
    queryKey: ["discord-token"],
    queryFn: () => pb.send<{ has_token: boolean }>("/api/tav/admin/discord-token", {}),
  })
  const [appId, setAppId] = useState<string | null>(null)
  const [invite, setInvite] = useState<string | null>(null)
  const [token, setToken] = useState("")
  const [busy, setBusy] = useState(false)

  const appIdValue = appId ?? settings?.discord_app_id ?? ""
  const inviteValue = invite ?? settings?.discord_server_invite ?? ""
  const lastSeen = settings?.discord_last_seen ? parsePb(settings.discord_last_seen) : null
  const online = !!lastSeen && Date.now() - lastSeen.getTime() < 3 * 60 * 1000 && !!settings?.discord_bot_name
  const guilds = settings?.discord_guilds ?? 0

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!settings) return
    setBusy(true)
    try {
      await pb.collection("app_settings").update(settings.id, {
        discord_app_id: appIdValue.trim(),
        discord_server_invite: inviteValue.trim(),
        // links the bot sends (e.g. /register) point here
        app_url: window.location.origin,
      })
      if (token.trim()) await pb.send("/api/tav/admin/discord-token", { method: "POST", body: { token: token.trim() } })
      setToken("")
      qc.invalidateQueries({ queryKey: ["app_settings"] })
      qc.invalidateQueries({ queryKey: ["discord-token"] })
      toast.success("Saved. The bot picks this up within 30 seconds.")
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function clearToken() {
    await pb.send("/api/tav/admin/discord-token", { method: "POST", body: { token: "" } })
    qc.invalidateQueries({ queryKey: ["discord-token"] })
    toast("Bot token removed. The bot will disconnect.")
  }

  const statusText = online
    ? `In ${guilds} server${guilds === 1 ? "" : "s"} · last check-in ${formatDistanceToNow(lastSeen!, { addSuffix: true })}`
    : settings?.discord_error
      || (lastSeen ? `Last seen ${formatDistanceToNow(lastSeen, { addSuffix: true })}` : "The bot service hasn't checked in yet. Is the tavcal-discord container running?")

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className={online ? "size-2.5 rounded-full bg-green-500" : "size-2.5 rounded-full bg-muted-foreground/40"} />
            {online ? `Connected as ${settings?.discord_bot_name}` : "Bot not connected"}
          </CardTitle>
          <CardDescription>{statusText}</CardDescription>
        </CardHeader>
        {settings?.discord_app_id && (
          <CardContent>
            <a href={botInviteUrl(settings.discord_app_id)} target="_blank" rel="noreferrer">
              <Button variant="outline"><ExternalLinkIcon /> Add bot to a server</Button>
            </a>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Setup</CardTitle>
          <CardDescription>One-time, about two minutes.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="mb-5 list-decimal space-y-1.5 pl-5 text-sm">
            <li>
              Go to{" "}
              <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">
                discord.com/developers/applications
              </a>{" "}
              and click <b>New Application</b>. Name it (e.g. “Tav Calendar”).
            </li>
            <li>On <b>General Information</b>, copy the <b>Application ID</b> into the box below.</li>
            <li>Open <b>Bot</b>, click <b>Reset Token</b>, and copy it into the token box. No special intents are needed.</li>
            <li>Save, then use <b>Add bot to a server</b> above.</li>
            <li>Tell everyone to type <code className="rounded bg-muted px-1">/register</code> in Discord.</li>
          </ol>
          <form onSubmit={save}>
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="d-app">Application ID</FieldLabel>
                <Input id="d-app" value={appIdValue} onChange={(e) => setAppId(e.target.value)} inputMode="numeric" placeholder="123456789012345678" />
              </Field>
              <Field>
                <FieldLabel htmlFor="d-token">Bot token</FieldLabel>
                <Input
                  id="d-token"
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={tokenState.data?.has_token ? "Saved (paste a new one to replace it)" : "Paste the bot token"}
                />
                <FieldDescription>
                  Stored on the server only and never shown again.
                  {tokenState.data?.has_token && (
                    <>
                      {" "}
                      <button type="button" className="text-destructive underline-offset-4 hover:underline" onClick={clearToken}>Remove token</button>
                    </>
                  )}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="d-invite">Server invite link (optional)</FieldLabel>
                <Input id="d-invite" type="url" value={inviteValue} onChange={(e) => setInvite(e.target.value)} placeholder="https://discord.gg/…" />
                <FieldDescription>Shown in everyone's Settings so they can join the server.</FieldDescription>
              </Field>
              <Button type="submit" className="self-start" disabled={busy || !settings}>Save</Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
