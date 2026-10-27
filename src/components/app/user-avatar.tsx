import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export const initials = (n: string) => n.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

export type AvatarUser = { name: string; color: string; avatar?: string | null };

export function UserAvatar({ user, className, textClass }: { user: AvatarUser; className?: string; textClass?: string }) {
  return (
    <Avatar className={cn("size-8", className)}>
      {user.avatar && <AvatarImage src={user.avatar} alt={user.name} className="object-cover" />}
      <AvatarFallback className={textClass} style={{ background: user.color, color: "white" }}>{initials(user.name)}</AvatarFallback>
    </Avatar>
  );
}
