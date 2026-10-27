import { redirect } from "next/navigation";
import { format, subDays } from "date-fns";
import { requireUser } from "@/lib/auth";
import { analytics } from "@/lib/analytics";
import { AnalyticsView } from "@/components/app/analytics";

export default async function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  const me = await requireUser();
  if (me.role === "employee") redirect("/");
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const today = format(new Date(), "yyyy-MM-dd");
  const f = {
    from: /^\d{4}-\d{2}-\d{2}$/.test(str("from")) ? str("from") : format(subDays(new Date(), 90), "yyyy-MM-dd"),
    to: /^\d{4}-\d{2}-\d{2}$/.test(str("to")) ? str("to") : format(subDays(new Date(), -90), "yyyy-MM-dd"),
    dept: str("dept") ? Number(str("dept")) : null,
    users: str("users") ? str("users").split(",").map(Number).filter(Boolean) : [],
    status: (str("status") === "all" ? "all" : "approved") as "approved" | "all",
  };
  const data = await analytics(f);
  return <AnalyticsView filters={f} today={today} {...data} />;
}
