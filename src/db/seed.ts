import { sql } from "drizzle-orm";
import { db, schema } from "./index";
import { hashPassword } from "@/lib/auth";

const day = (s: number, e: number) => Array.from({ length: 7 }, () => [{ start: s, end: e }]);
const split = (...slots: [number, number][]) => Array.from({ length: 7 }, () => slots.map(([start, end]) => ({ start, end })));
const pw = hashPassword("password");

/** demo data, wipes everything first. Local dev and tests only: every account's password is "password". */
export async function seed() {
  if (process.env.DATABASE_URL?.startsWith("postgres")) throw new Error("Refusing to seed demo accounts into a hosted database");
  await db.execute(sql`truncate events, notifications, request_days, requests, users, departments, festive_days, settings restart identity cascade`);

  const [eng, sup, des] = await db
    .insert(schema.departments)
    .values([
      { name: "Engineering", minStaff: 2 },
      { name: "Support", minStaff: 2 },
      { name: "Design", minStaff: 1 },
    ])
    .returning();

  await db.insert(schema.users).values([
    { name: "Asha Rao", email: "admin@team.local", passwordHash: pw, role: "admin", departmentId: eng.id, timezone: "Asia/Kolkata", color: "#7c3aed", schedule: day(540, 1080) },
    { name: "Omar Haddad", email: "hr@team.local", passwordHash: pw, role: "hr", departmentId: sup.id, timezone: "Asia/Kolkata", color: "#0ea5e9", schedule: day(600, 1140) },
    { name: "Mei Lin", email: "mei@team.local", passwordHash: pw, departmentId: eng.id, timezone: "Asia/Kolkata", color: "#f59e0b", schedule: day(480, 1020) },
    { name: "Diego Alvarez", email: "diego@team.local", passwordHash: pw, departmentId: eng.id, timezone: "America/New_York", remote: true, color: "#10b981", schedule: split([540, 780], [1020, 1260]), joinedOn: "2025-03-01" },
    { name: "Priya Nair", email: "priya@team.local", passwordHash: pw, departmentId: eng.id, timezone: "Asia/Kolkata", color: "#ef4444", schedule: day(1320, 1800) },
    { name: "Tomasz Kowalski", email: "tomasz@team.local", passwordHash: pw, departmentId: sup.id, timezone: "Europe/London", remote: true, color: "#ec4899", schedule: day(420, 960) },
    { name: "Sara Okafor", email: "sara@team.local", passwordHash: pw, departmentId: sup.id, timezone: "Asia/Kolkata", color: "#14b8a6", schedule: day(840, 1380) },
    { name: "Lucas Moreau", email: "lucas@team.local", passwordHash: pw, departmentId: des.id, timezone: "Asia/Kolkata", color: "#f97316", schedule: day(600, 1140) },
    { name: "Hana Sato", email: "hana@team.local", passwordHash: pw, departmentId: des.id, timezone: "Asia/Tokyo", remote: true, color: "#8b5cf6", schedule: day(540, 1080), joinedOn: "2026-10-20" },
    { name: "Ravi Menon", email: "ravi@team.local", passwordHash: pw, departmentId: sup.id, timezone: "Asia/Kolkata", color: "#64748b", schedule: day(600, 1140), joinedOn: "2024-06-01", leftOn: "2026-10-15", active: false },
  ]);

  await db.insert(schema.festiveDays).values([
    { date: "2026-11-08", name: "Diwali" },
    { date: "2026-12-25", name: "Christmas" },
    { date: "2027-01-01", name: "New Year" },
    { date: "2027-01-14", name: "Pongal" },
    { date: "2027-01-26", name: "Republic Day" },
    { date: "2027-03-14", name: "Holi" },
  ]);

  await db.insert(schema.settings).values([
    { key: "deadline_day", value: 5 },
    { key: "casual_quota", value: 6 },
    { key: "festive_quota", value: 6 },
    { key: "late_hours", value: 24 },
  ]);
}

if (process.argv[1]?.endsWith("seed.ts")) seed().then(() => { console.log("seeded"); process.exit(0); });
