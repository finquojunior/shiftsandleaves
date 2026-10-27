import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { currentUser } from "@/lib/auth";

/** profile picture bytes. URLs carry ?v=<upload time>, so the browser keeps each version for a year. */
export async function GET(_req: Request, ctx: RouteContext<"/avatar/[id]">) {
  if (!(await currentUser())) return new Response(null, { status: 401 });
  const id = Number((await ctx.params).id);
  const u = Number.isInteger(id) ? await db.query.users.findFirst({ columns: { avatar: true }, where: eq(schema.users.id, id) }) : null;
  const m = u?.avatar?.match(/^data:(image\/jpeg);base64,(.+)$/);
  if (!m) return new Response(null, { status: 404 });
  return new Response(Buffer.from(m[2], "base64"), {
    headers: { "Content-Type": m[1], "Cache-Control": "private, max-age=31536000, immutable" },
  });
}
