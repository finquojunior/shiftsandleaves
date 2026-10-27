import { requireUser } from "@/lib/auth";
import { avatarUrl, getAllUsers, getDepartments } from "@/lib/data";
import { TeamView } from "@/components/app/team";

export default async function TeamPage() {
  const me = await requireUser();
  const [users, depts] = await Promise.all([getAllUsers(), getDepartments()]);
  return <TeamView me={{ id: me.id, role: me.role, timezone: me.timezone }} users={users.map((u) => ({ ...u, passwordHash: undefined, avatar: avatarUrl(u) }))} depts={depts} />;
}
