"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { CalendarDays, Inbox, Users, Settings, LogOut, CalendarClock, UserRound, BarChart3 } from "lucide-react";
import type { Notification, Role } from "@/db/schema";
import { logout } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { NotificationBell } from "./notification-bell";
import { ProfileDialog } from "./profile-dialog";
import { UserAvatar } from "./user-avatar";
import { cn } from "@/lib/utils";

export type ShellUser = { id: number; name: string; email: string; role: Role; color: string; timezone: string; avatar: string | null; mustChangePassword: boolean };

export { initials } from "./user-avatar";

export function AppShell({ user, notifications, children }: { user: ShellUser; notifications: Notification[]; children: React.ReactNode }) {
  const path = usePathname();
  const [profile, setProfile] = useState<false | "photo" | "password">(user.mustChangePassword ? "password" : false);
  const nav = [
    { href: "/", label: "Calendar", icon: CalendarDays },
    { href: "/requests", label: "Requests", icon: Inbox },
    { href: "/team", label: "Team", icon: Users },
    ...(user.role !== "employee" ? [{ href: "/analytics", label: "Analytics", icon: BarChart3 }] : []),
    ...(user.role !== "employee" ? [{ href: "/settings", label: "Settings", icon: Settings }] : []),
  ];
  return (
    <div className="flex-1 flex flex-col">
      <header className="print:hidden sticky top-0 z-30 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-3 sm:gap-4 sm:px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><CalendarClock className="size-4" /></span>
            <span className="hidden sm:inline">Shift &amp; Leave</span>
          </Link>
          <nav className="flex items-center gap-0.5 rounded-full bg-muted p-1 sm:ml-2 sm:gap-1">
            {nav.map((n) => {
              const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href} className={cn("relative flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-sm transition-colors sm:px-3", active ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {active && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-full bg-card shadow-sm" transition={{ type: "spring", stiffness: 400, damping: 30 }} />}
                  <n.icon className="relative size-4" />
                  <span className="relative hidden md:inline">{n.label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <span className="hidden text-xs text-muted-foreground lg:inline">{user.timezone}</span>
            <NotificationBell items={notifications} />
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="rounded-full" />}>
                <UserAvatar user={user} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    <div className="font-medium">{user.name}</div>
                    <div className="text-xs text-muted-foreground capitalize">{user.role}</div>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setProfile("photo")}><UserRound className="size-4" /> Profile &amp; settings</DropdownMenuItem>
                <DropdownMenuItem onClick={() => logout()}><LogOut className="size-4" /> Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>
      {user.mustChangePassword && (
        <div className="border-b bg-amber-500/10 px-4 py-2 text-center text-sm text-amber-800 dark:text-amber-200">
          You&apos;re using a temporary password. <button type="button" className="font-medium underline underline-offset-2" onClick={() => setProfile("password")}>Set your own now</button>.
        </div>
      )}
      <main className="mx-auto w-full max-w-7xl min-w-0 flex-1 px-3 py-4 sm:px-4 sm:py-6">{children}</main>
      <ProfileDialog user={user} open={profile !== false} section={profile || "photo"} onClose={() => setProfile(false)} />
    </div>
  );
}
