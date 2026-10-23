import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { avatarUrl, displayName, type User } from "@/lib/pb"
import { cn } from "@/lib/utils"

export function UserAvatar({ user, size = "default", className }: {
  user: User | null | undefined
  size?: "default" | "sm" | "lg"
  className?: string
}) {
  const name = displayName(user)
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()
  return (
    <Avatar size={size} className={cn(className)} title={name}>
      <AvatarImage src={avatarUrl(user)} alt={name} />
      <AvatarFallback style={{ backgroundColor: user?.color || undefined }} className={cn(user?.color && "text-white font-medium")}>
        {initials}
      </AvatarFallback>
    </Avatar>
  )
}
