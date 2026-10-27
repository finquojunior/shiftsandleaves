import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { avatarUrl, getNotifications } from "@/lib/data";
import { AppShell } from "@/components/app/shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const notifications = await getNotifications(user.id);
  return (
    <AppShell user={{ id: user.id, name: user.name, email: user.email, role: user.role, color: user.color, timezone: user.timezone, avatar: avatarUrl(user), mustChangePassword: user.mustChangePassword }} notifications={notifications}>
      {children}
    </AppShell>
  );
}
