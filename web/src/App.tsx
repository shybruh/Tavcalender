import { Navigate, Outlet, Route, Routes, useLocation, useSearchParams } from "react-router"
import { useAuth, useAuthSync } from "@/hooks/use-auth"
import { useRealtimeSync } from "@/hooks/queries"
import { AppShell } from "@/components/app-shell"
import { LoginPage, PendingPage, SignupPage } from "@/pages/auth"
import { HomePage } from "@/pages/home"
import { CalendarPage } from "@/pages/calendar"
import { PeoplePage } from "@/pages/people"
import { GroupDetailPage } from "@/pages/group-detail"
import { AgendaPage } from "@/pages/agenda"
import { EventPage } from "@/pages/event"
import { NotesPage } from "@/pages/notes"
import { RemindersPage } from "@/pages/reminders"
import { NotificationsPage } from "@/pages/notifications"
import { SettingsPage } from "@/pages/settings"
import { AdminPage } from "@/pages/admin"
import { DiscordLinkPage } from "@/pages/discord-link"

export default function App() {
  useAuthSync()
  useRealtimeSync()

  return (
    <Routes>
      {/* works logged in or out (and while pending) */}
      <Route path="/link/discord" element={<DiscordLinkPage />} />
      <Route element={<GuestOnly />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
      </Route>
      <Route element={<RequireApproved />}>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="group" element={<Navigate to="/calendar" replace />} />
          <Route path="people" element={<PeoplePage />} />
          <Route path="groups/:id" element={<GroupDetailPage />} />
          <Route path="agenda" element={<AgendaPage />} />
          <Route path="event/:id" element={<EventPage />} />
          <Route path="notes" element={<NotesPage />} />
          <Route path="reminders" element={<RemindersPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="admin" element={<RequireAdmin />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function GuestOnly() {
  const { user } = useAuth()
  const [params] = useSearchParams()
  const next = params.get("next") || "/"
  return user ? <Navigate to={next.startsWith("/") && !next.startsWith("//") ? next : "/"} replace /> : <Outlet />
}

function RequireApproved() {
  const { user, isApproved } = useAuth()
  const location = useLocation()
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  if (!isApproved) return <PendingPage />
  return <Outlet />
}

function RequireAdmin() {
  const { isAdmin } = useAuth()
  return isAdmin ? <AdminPage /> : <Navigate to="/" replace />
}
