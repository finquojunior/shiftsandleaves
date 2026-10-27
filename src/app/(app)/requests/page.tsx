import { requireUser } from "@/lib/auth";
import { avatarUrl, getAllUsers, getFestiveDays, getRequestDetail, getRequestsFor } from "@/lib/data";
import { RequestsView } from "@/components/app/requests";

export default async function RequestsPage({ searchParams }: PageProps<"/requests">) {
  const sp = await searchParams;
  const me = await requireUser();
  const openId = typeof sp.open === "string" ? Number(sp.open) : null;
  const [{ mine, inbox, days }, users, festive, detail] = await Promise.all([getRequestsFor(me), getAllUsers(), getFestiveDays(), openId ? getRequestDetail(openId, me) : null]);
  return (
    <RequestsView
      me={{ id: me.id, role: me.role, timezone: me.timezone, schedule: me.schedule, remote: me.remote }}
      mine={mine}
      inbox={inbox}
      days={days}
      users={users.map((u) => ({ id: u.id, name: u.name, color: u.color, avatar: avatarUrl(u), role: u.role, timezone: u.timezone }))}
      detail={detail}
      festive={festive}
    />
  );
}
