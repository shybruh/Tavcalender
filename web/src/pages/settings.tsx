import { useRef, useState, type FormEvent } from "react"
import { useTheme } from "next-themes"
import { toast } from "sonner"
import { BellIcon, DownloadIcon, MonitorIcon, MoonIcon, SendIcon, SunIcon } from "lucide-react"
import { pb, errorMessage } from "@/lib/pb"
import { isStandalone } from "@/lib/push"
import { toAvatarBlob } from "@/lib/image"
import { useAuth } from "@/hooks/use-auth"
import { useAppSettings } from "@/hooks/queries"
import { useInstallPrompt, usePush } from "@/hooks/use-push"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { UserAvatar } from "@/components/user-avatar"

export const COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899", "#64748b"]

export function SettingsPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-3 md:p-6">
      <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Settings</h1>
      <ProfileCard />
      <NotificationsCard />
      <DiscordCard />
      <AppearanceCard />
    </div>
  )
}

function ProfileCard() {
  const { user } = useAuth()
  const [name, setName] = useState(user?.name ?? "")
  const [color, setColor] = useState(user?.color ?? COLORS[0])
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await pb.collection("users").update(user!.id, { name: name.trim(), color })
      toast.success("Profile saved")
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const [uploading, setUploading] = useState(false)

  async function uploadAvatar(file: File | undefined) {
    if (!file) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append("avatar", await toAvatarBlob(file), "avatar.jpg")
      await pb.collection("users").update(user!.id, form)
      toast.success("Photo updated")
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = "" // allow picking the same file again
    }
  }

  async function removeAvatar() {
    try {
      await pb.collection("users").update(user!.id, { avatar: null })
      toast.success("Photo removed")
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>How your friends see you.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save}>
          <FieldGroup className="gap-4">
            <div className="flex items-center gap-3">
              <UserAvatar user={user} size="lg" className="size-14" />
              <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? "Uploading…" : user?.avatar ? "Change photo" : "Add photo"}
              </Button>
              {user?.avatar && !uploading && (
                <Button type="button" variant="ghost" size="sm" onClick={removeAvatar}>Remove</Button>
              )}
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => uploadAvatar(e.target.files?.[0])} />
            </div>
            <Field>
              <FieldLabel htmlFor="name">Name</FieldLabel>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
            </Field>
            <Field>
              <FieldLabel>Your color</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className="size-8 rounded-full ring-offset-2 ring-offset-background transition data-[on=true]:ring-2 data-[on=true]:ring-foreground"
                    data-on={color === c}
                    style={{ backgroundColor: c }}
                    aria-label={c}
                  />
                ))}
              </div>
            </Field>
            <div className="text-sm text-muted-foreground">{user?.email}</div>
            <Button type="submit" className="self-start" disabled={busy}>Save</Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}

function NotificationsCard() {
  const { state, busy, enable, disable } = usePush()
  const { available, install } = useInstallPrompt()

  async function test() {
    try {
      await pb.send("/api/tav/test-push", { method: "POST" })
      toast.success("Sent! It should pop up in a moment.")
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><BellIcon className="size-4" /> Notifications</CardTitle>
        <CardDescription>Push notifications for this device: new signups (admin), events, RSVPs and reminders.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {state === "unsupported" && <p className="text-sm text-muted-foreground">This browser doesn't support push notifications.</p>}
        {state === "needs-install" && (
          <p className="text-sm text-muted-foreground">On iPhone/iPad, push only works from the home-screen app: tap <b>Share → Add to Home Screen</b>, open it from there, then come back here.</p>
        )}
        {state === "denied" && <p className="text-sm text-muted-foreground">Notifications are blocked. Allow them in your browser's site settings, then reload.</p>}
        {(state === "on" || state === "off") && (
          <Field orientation="horizontal" className="justify-between">
            <FieldLabel htmlFor="push">Push notifications on this device</FieldLabel>
            <Switch id="push" checked={state === "on"} disabled={busy} onCheckedChange={(on) => (on ? enable() : disable())} />
          </Field>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={test}><SendIcon /> Send test notification</Button>
          {available && !isStandalone() && (
            <Button variant="outline" size="sm" onClick={install}><DownloadIcon /> Install app</Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function AppearanceCard() {
  const { theme, setTheme } = useTheme()
  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
      </CardHeader>
      <CardContent>
        <ToggleGroup variant="outline" value={[theme ?? "system"]} onValueChange={(v) => v[0] && setTheme(v[0] as string)}>
          <ToggleGroupItem value="light"><SunIcon /> Light</ToggleGroupItem>
          <ToggleGroupItem value="dark"><MoonIcon /> Dark</ToggleGroupItem>
          <ToggleGroupItem value="system"><MonitorIcon /> System</ToggleGroupItem>
        </ToggleGroup>
      </CardContent>
    </Card>
  )
}

function DiscordCard() {
  const { user } = useAuth()
  const { data: settings } = useAppSettings()
  const [busy, setBusy] = useState(false)
  const botReady = !!settings?.discord_app_id && !!settings?.discord_bot_name

  async function patch(data: Record<string, unknown>) {
    try {
      await pb.collection("users").update(user!.id, data)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  async function unlink() {
    setBusy(true)
    try {
      await pb.send("/api/tav/discord/unlink", { method: "POST" })
      await pb.collection("users").authRefresh()
      toast.success("Discord unlinked")
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (!botReady && !user?.discord_id) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><DiscordIcon className="size-4" /> Discord</CardTitle>
        <CardDescription>Make plans, answer invites and get reminders right in Discord.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {user?.discord_id ? (
          <>
            <div className="flex items-center gap-2 text-sm">
              <span className="size-2 rounded-full bg-green-500" />
              Linked as <b>{user.discord_name || "your Discord account"}</b>
              <div className="flex-1" />
              <Button size="sm" variant="ghost" onClick={unlink} disabled={busy}>Unlink</Button>
            </div>
            <Field orientation="horizontal" className="justify-between">
              <FieldLabel htmlFor="dm-invites">DM me invites and “are you free?” requests</FieldLabel>
              <Switch id="dm-invites" checked={!user.discord_mute_invites} onCheckedChange={(on) => patch({ discord_mute_invites: !on })} />
            </Field>
            <Field orientation="horizontal" className="justify-between">
              <FieldLabel htmlFor="dm-reminders">DM me reminders</FieldLabel>
              <Switch id="dm-reminders" checked={!user.discord_mute_reminders} onCheckedChange={(on) => patch({ discord_mute_reminders: !on })} />
            </Field>
          </>
        ) : (
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {settings?.discord_server_invite && (
              <li>Join the server: <a href={settings.discord_server_invite} target="_blank" rel="noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">open invite</a></li>
            )}
            <li>Type <code className="rounded bg-muted px-1">/register</code> in any channel with the bot.</li>
            <li>Tap the button it sends you and confirm.</li>
          </ol>
        )}
        <p className="text-xs text-muted-foreground">
          Commands: <code>/plan</code> · <code>/remind</code> · <code>/today</code> · <code>/week</code> · <code>/free</code> · <code>/group connect</code>
        </p>
      </CardContent>
    </Card>
  )
}

/** Discord's mark (lucide has no brand icons). */
export function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.4 18.4 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18.1a19.9 19.9 0 0 0 6 3l1.3-2a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4a12.7 12.7 0 0 1-2 1l1.3 2a19.8 19.8 0 0 0 6-3c.5-5.2-.8-9.7-3.6-13.7ZM8 15.4c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z" />
    </svg>
  )
}
