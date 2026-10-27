import { connection } from "next/server";
import { getSettings } from "@/lib/data";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  await connection(); // the passkey switch is read per request, not frozen at build time
  return <LoginForm passkeys={(await getSettings()).passkeys === 1} />;
}
