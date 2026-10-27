"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Camera, Fingerprint, Globe, KeyRound, Trash2 } from "lucide-react";
import { startRegistration } from "@simplewebauthn/browser";
import { changePassword, saveAvatar, updateTimezone } from "@/actions/profile";
import { passkeyRegister, passkeyRegisterOptions, removePasskey } from "@/actions/passkeys";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { fmtDate } from "@/lib/time";
import { UserAvatar, type AvatarUser } from "./user-avatar";

export type PasskeyRow = { id: number; backedUp: boolean; createdAt: string; lastUsedAt: string | null };

/** resize to a 192px square JPEG in the browser so the DB stays small */
function toSquareJpeg(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = 192, c = document.createElement("canvas");
      c.width = c.height = size;
      const ctx = c.getContext("2d")!;
      const m = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, size, size);
      resolve(c.toDataURL("image/jpeg", 0.85));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// browsers still report some legacy ICU names; show the modern ones
const MODERN: Record<string, string> = { "Asia/Calcutta": "Asia/Kolkata", "Asia/Katmandu": "Asia/Kathmandu", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Asia/Rangoon": "Asia/Yangon", "Europe/Kiev": "Europe/Kyiv", "America/Buenos_Aires": "America/Argentina/Buenos_Aires" };
const tzList = (current: string) => {
  let zones: string[] = ["UTC"];
  try { zones = Intl.supportedValuesOf("timeZone").map((z) => MODERN[z] ?? z); } catch {}
  return [...new Set([...zones, current])].sort();
};
const tzOffset = (tz: string) => {
  try {
    const p = new Intl.DateTimeFormat("en", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((x) => x.type === "timeZoneName");
    return p?.value ?? "";
  } catch { return ""; }
};

export function ProfileDialog({ user, open, section = "photo", onClose }: {
  user: AvatarUser & { email?: string; timezone: string; mustChangePassword?: boolean; passkeys?: PasskeyRow[] | null }; open: boolean; section?: "photo" | "password"; onClose: () => void;
}) {
  const [preview, setPreview] = useState<string | null | undefined>(undefined); // undefined = unchanged
  const [tz, setTz] = useState(user.timezone);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);
  const zones = useMemo(() => tzList(user.timezone), [user.timezone]);
  const shown = preview === undefined ? user.avatar : preview;
  const forced = !!user.mustChangePassword;

  const savePhoto = () => start(async () => { const r = await saveAvatar(preview ?? null); if (r.ok) { toast.success("Photo updated"); setPreview(undefined); } else toast.error(r.error); });
  const saveTz = () => start(async () => { const r = await updateTimezone(tz); if (r.ok) toast.success(`Timezone set to ${tz}`); else toast.error(r.error); });
  const addPasskey = () => start(async () => {
    const optionsJSON = await passkeyRegisterOptions();
    if (!optionsJSON) return void toast.error("Passkeys are turned off");
    let response;
    try { response = await startRegistration({ optionsJSON }); } catch { return; } // cancelled, or this device already has one
    const r = await passkeyRegister(response);
    if (r.ok) toast.success("Passkey added. You can sign in with it now."); else toast.error(r.error);
  });
  const savePw = () => {
    if (pw.next !== pw.confirm) return toast.error("Passwords don't match");
    start(async () => { const r = await changePassword(pw.current, pw.next); if (r.ok) { toast.success("Password changed"); setPw({ current: "", next: "", confirm: "" }); if (forced) onClose(); } else toast.error(r.error); });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !forced && onClose()}>
      <DialogContent className="sm:max-w-md" showCloseButton={!forced} initialFocus={section === "password" ? pwRef : undefined}>
        <DialogHeader>
          <DialogTitle>Profile &amp; settings</DialogTitle>
          <DialogDescription>{forced ? "Set your own password to continue." : `Photo, timezone${user.passkeys ? ", passkeys" : ""} and password.`}</DialogDescription>
        </DialogHeader>

        {!forced && (
          <>
            <div className="flex items-center gap-4">
              <button type="button" onClick={() => fileRef.current?.click()} className="group relative shrink-0 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label="Change photo">
                <UserAvatar user={{ ...user, avatar: shown }} className="size-20" textClass="text-xl" />
                <span className="absolute inset-0 grid place-items-center rounded-full bg-black/40 text-white opacity-0 transition group-hover:opacity-100"><Camera className="size-5" /></span>
              </button>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{user.name}</div>
                <div className="truncate text-xs text-muted-foreground">{user.email}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}><Camera className="size-3.5" /> Upload</Button>
                  {shown && <Button size="sm" variant="ghost" onClick={() => setPreview(null)}><Trash2 className="size-3.5" /> Remove</Button>}
                  {preview !== undefined && <Button size="sm" disabled={pending} onClick={savePhoto}>Save photo</Button>}
                </div>
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setPreview(await toSquareJpeg(f)); e.target.value = ""; }} />
            </div>

            <Separator />

            <div className="grid gap-2">
              <Label htmlFor="tz" className="flex items-center gap-1.5"><Globe className="size-3.5" /> Timezone</Label>
              <div className="flex gap-2">
                {/* ponytail: native select handles 400+ zones with keyboard search for free */}
                <select id="tz" value={tz} onChange={(e) => setTz(e.target.value)} className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30">
                  {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")} ({tzOffset(z)})</option>)}
                </select>
                <Button size="sm" disabled={pending || tz === user.timezone} onClick={saveTz}>Save</Button>
              </div>
              <p className="text-xs text-muted-foreground">Your default hours are stored in this zone, and every calendar you see is shown in it.</p>
            </div>

            <Separator />

            {user.passkeys && (
              <>
                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="flex items-center gap-1.5"><Fingerprint className="size-3.5" /> Passkeys</Label>
                    <Button size="sm" variant="secondary" disabled={pending} onClick={addPasskey}>Add passkey</Button>
                  </div>
                  <ul className="grid gap-1">
                    {user.passkeys.map((p) => (
                      <li key={p.id} className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm">
                        <span className="flex-1">{p.backedUp ? "Synced passkey" : "Device passkey"} · added {fmtDate(p.createdAt, "d MMM yyyy")}</span>
                        <span className="text-xs text-muted-foreground">{p.lastUsedAt ? `used ${fmtDate(p.lastUsedAt, "d MMM")}` : "not used yet"}</span>
                        <Button size="icon-sm" variant="ghost" aria-label="Remove passkey" disabled={pending} onClick={() => start(async () => { await removePasskey(p.id); toast.success("Passkey removed"); })}><Trash2 className="size-3.5" /></Button>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground">{user.passkeys.length ? "Sign in with Face ID, Touch ID, Windows Hello or your phone instead of a password." : "None yet. Add one to sign in with Face ID, Touch ID, Windows Hello or your phone."}</p>
                </div>

                <Separator />
              </>
            )}
          </>
        )}

        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); savePw(); }}>
          <Label className="flex items-center gap-1.5"><KeyRound className="size-3.5" /> {forced ? "New password" : "Change password"}</Label>
          {!forced && <Input ref={pwRef} type="password" autoComplete="current-password" placeholder="Current password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required />}
          <div className="grid gap-3 sm:grid-cols-2">
            <Input ref={forced ? pwRef : undefined} type="password" autoComplete="new-password" placeholder="New password (8+)" minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required />
            <Input type="password" autoComplete="new-password" placeholder="Repeat new password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required />
          </div>
          <div className="flex justify-end"><Button type="submit" size="sm" disabled={pending}>{forced ? "Set password" : "Change password"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
