"use client";
import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Bell, BellOff, Check, CheckCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { Notification } from "@/db/schema";
import { markNotificationRead, markNotificationsRead } from "@/actions/requests";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function NotificationBell({ items }: { items: Notification[] }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"all" | "unread">("all");
  // optimistic read state; the server copy catches up on the next refresh
  const [readIds, setReadIds] = useState<Set<number>>(new Set());
  const isRead = (n: Notification) => n.read || readIds.has(n.id);
  const unread = items.filter((n) => !isRead(n)).length;
  const shown = tab === "unread" ? items.filter((n) => !isRead(n)) : items;

  const markOne = (id: number) => { setReadIds((s) => new Set(s).add(id)); markNotificationRead(id); };
  const markAll = () => { setReadIds(new Set(items.map((n) => n.id))); markNotificationsRead(); };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="ghost" size="icon" className="relative rounded-full" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} />}>
        <Bell className="size-4" />
        <AnimatePresence>
          {unread > 0 && (
            <motion.span key="dot" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: "spring", stiffness: 500, damping: 20 }} className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
              {unread > 9 ? "9+" : unread}
            </motion.span>
          )}
        </AnimatePresence>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] max-w-[calc(100vw-1.5rem)] gap-0 p-0">
        <div className="flex items-center gap-2 px-3 pt-3 pb-2">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">{unread}</span>}
          <Button variant="ghost" size="sm" className="ml-auto h-7 gap-1 px-2 text-xs" disabled={!unread} onClick={markAll}>
            <CheckCheck className="size-3.5" /> Mark all as read
          </Button>
        </div>
        <div className="px-3 pb-2">
          <Tabs value={tab} onValueChange={(v) => setTab(v as "all" | "unread")}>
            <TabsList className="w-full">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="unread">Unread{unread > 0 && ` (${unread})`}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="max-h-96 overflow-y-auto overscroll-contain border-t">
          {shown.length === 0 && (
            <div className="grid place-items-center gap-1.5 px-3 py-8 text-center text-sm text-muted-foreground">
              <BellOff className="size-5 opacity-60" />
              {tab === "unread" ? "You're all caught up." : "Nothing yet."}
            </div>
          )}
          <ul className="divide-y">
            <AnimatePresence initial={false}>
              {shown.map((n) => {
                const read = isRead(n);
                return (
                  <motion.li key={n.id} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="group relative overflow-hidden">
                    <Link
                      href={n.href ?? "/"}
                      onClick={() => { if (!read) markOne(n.id); setOpen(false); }}
                      className={cn("flex items-start gap-2.5 py-2.5 pr-10 pl-3 text-sm transition-colors hover:bg-accent", !read && "bg-primary/[0.04]")}
                    >
                      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full transition-colors", read ? "bg-transparent" : "bg-primary")} aria-hidden />
                      <div className="min-w-0">
                        <div className={cn("truncate", read ? "text-muted-foreground" : "font-medium")}>{n.title}</div>
                        {n.body && <div className="line-clamp-2 text-xs text-muted-foreground">{n.body}</div>}
                        <div className="mt-0.5 text-[11px] text-muted-foreground">{formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}</div>
                      </div>
                    </Link>
                    {!read && (
                      <Tooltip>
                        <TooltipTrigger render={
                          <Button variant="ghost" size="icon-sm" aria-label="Mark as read" onClick={() => markOne(n.id)}
                            className="absolute top-2 right-2 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100" />
                        }>
                          <Check className="size-3.5" />
                        </TooltipTrigger>
                        <TooltipContent side="left">Mark as read</TooltipContent>
                      </Tooltip>
                    )}
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}
