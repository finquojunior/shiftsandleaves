import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getFestiveDays, getSettings } from "@/lib/data";
import { SettingsView } from "@/components/app/settings";

export default async function SettingsPage() {
  const me = await requireUser();
  if (me.role === "employee") redirect("/");
  const [settings, festive] = await Promise.all([getSettings(), getFestiveDays()]);
  return <SettingsView settings={settings} festive={festive} />;
}
