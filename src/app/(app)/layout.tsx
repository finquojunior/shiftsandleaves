import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { avatarUrl, getNotifications, getPasskeys, getSettings } from "@/lib/data";
import { AppShell } from "@/components/app/shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const [notifications, settings, passkeys] = await Promise.all([getNotifications(user.id), getSettings(), getPasskeys(user.id)]);
  return (
    <AppShell user={{ id: user.id, name: user.name, email: user.email, role: user.role, color: user.color, timezone: user.timezone, avatar: avatarUrl(user), mustChangePassword: user.mustChangePassword, passkeys: settings.passkeys === 1 ? passkeys : null }} notifications={notifications}>
      {children}
    </AppShell>
  );
}
