import { Link, NavLink, Outlet, useNavigate } from "react-router"
import { useTheme } from "next-themes"
import {
  BellIcon,
  CalendarDaysIcon,
  HouseIcon,
  UsersIcon,
  LogOutIcon,
  MoonIcon,
  NotebookPenIcon,
  AlarmClockIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SunIcon,
} from "lucide-react"
import { useAuth, logout } from "@/hooks/use-auth"
import { useConnections, useGroupRequests, useMyGroups, useNotifications, useUsers } from "@/hooks/queries"
import { displayName } from "@/lib/pb"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { CalendarDot } from "@/components/calendar-dot"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { UserAvatar } from "@/components/user-avatar"
import { Logo } from "@/components/logo"

const NAV = [
  { to: "/", label: "Home", icon: HouseIcon, end: true },
  { to: "/calendar", label: "Calendar", icon: CalendarDaysIcon },
  { to: "/people", label: "People", icon: UsersIcon },
  { to: "/notes", label: "Notes", icon: NotebookPenIcon },
  { to: "/reminders", label: "Reminders", icon: AlarmClockIcon },
]

export function AppShell() {
  const { user, isAdmin } = useAuth()
  const { data: notifications } = useNotifications()
  const { data: users } = useUsers()
  const unread = notifications?.filter((n) => !n.read).length ?? 0
  const pendingCount = isAdmin ? users?.filter((u) => u.status === "pending").length ?? 0 : 0
  const peopleBadge = usePeopleBadge()
  const navigate = useNavigate()
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <div className="flex min-h-dvh">
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-sidebar md:flex">
        <div className="flex h-14 items-center gap-2 px-4">
          <Logo />
        </div>
        <nav className="flex flex-col gap-0.5 px-2">
          {NAV.map((item) => (
            <SideLink key={item.to} {...item} badge={item.to === "/people" ? peopleBadge : undefined} />
          ))}
          {isAdmin && <SideLink to="/admin" label="Admin" icon={ShieldCheckIcon} badge={pendingCount} />}
        </nav>
        <SidebarGroups />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="pt-safe sticky top-0 z-30 border-b bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/60">
          <div className="flex h-14 items-center gap-2 px-3 md:px-6">
            <div className="md:hidden">
              <Logo />
            </div>
            <div className="flex-1" />
            {isAdmin && pendingCount > 0 && (
              <Button variant="outline" size="sm" className="md:hidden" onClick={() => navigate("/admin")}>
                <ShieldCheckIcon /> {pendingCount}
              </Button>
            )}
            <Button variant="ghost" size="icon" className="relative" onClick={() => navigate("/notifications")} aria-label="Notifications">
              <BellIcon />
              {unread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground ring-2 ring-background">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="rounded-full" aria-label="Account" />}>
                <UserAvatar user={user} size="sm" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    <div className="font-medium text-foreground">{displayName(user)}</div>
                    <div className="truncate text-xs font-normal">{user?.email}</div>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/settings")}>
                  <SettingsIcon /> Settings
                </DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem onClick={() => navigate("/admin")}>
                    <ShieldCheckIcon /> Admin
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
                  {resolvedTheme === "dark" ? <SunIcon /> : <MoonIcon />}
                  {resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={async () => { await logout(); navigate("/login") }}>
                  <LogOutIcon /> Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-6">
          <Outlet />
        </main>

        {/* mobile bottom nav: floating frosted pill */}
        <nav className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-md rounded-full border border-border/60 bg-background/60 shadow-lg shadow-black/10 backdrop-blur-xl backdrop-saturate-150 supports-[not(backdrop-filter:blur(0))]:bg-background/95 md:hidden dark:shadow-black/40">
          <div className="grid h-14 grid-cols-5 p-1">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    "flex flex-col items-center justify-center gap-0.5 rounded-full text-[10px] font-medium text-muted-foreground transition-colors",
                    isActive ? "bg-primary/12 text-primary" : "active:bg-accent",
                  )
                }
              >
                <span className="relative">
                  <Icon className="size-5" />
                  {to === "/people" && peopleBadge > 0 && (
                    <span className="absolute -top-0.5 -right-1 size-2 rounded-full bg-primary ring-2 ring-background" aria-label={`${peopleBadge} waiting`} />
                  )}
                </span>
                {label}
              </NavLink>
            ))}
          </div>
        </nav>
      </div>
    </div>
  )
}

function SideLink({ to, label, icon: Icon, end, badge }: {
  to: string
  label: string
  icon: typeof CalendarDaysIcon
  end?: boolean
  badge?: number
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          isActive && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
        )
      }
    >
      <Icon className="size-4" />
      <span className="flex-1">{label}</span>
      {!!badge && <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{badge}</span>}
    </NavLink>
  )
}

/** Friend requests + group invites/join requests waiting on you. */
function usePeopleBadge() {
  const { user } = useAuth()
  const { incoming } = useConnections()
  const { data: requests } = useGroupRequests()
  const group = (requests ?? []).filter((r) =>
    (r.kind === "invite" && r.user === user?.id) || (r.kind === "request" && r.expand?.group?.owner === user?.id),
  ).length
  return incoming.length + group
}

/** Sidebar shortcut list of your groups. */
function SidebarGroups() {
  const groups = useMyGroups()
  if (!groups.length) return null
  return (
    <div className="mt-6 px-4">
      <div className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Your groups</div>
      <div className="flex flex-col gap-1">
        {groups.map((g) => (
          <Link key={g.id} to={`/groups/${g.id}`} className="flex items-center gap-2.5 rounded-md py-1 text-sm hover:text-foreground">
            <CalendarDot color={g.color} />
            <span className="truncate">{g.name}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
