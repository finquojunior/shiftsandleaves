# Shift & Leave

Team calendar for a 24/7, flexible-hours team: who is working when (in your own timezone), monthly leave planning, approvals, and in-app notifications.

## Run locally

```bash
pnpm install
pnpm db:migrate   # creates data/app.db
pnpm db:seed      # demo team, password "password" for everyone
pnpm dev
```

Demo logins: `admin@team.local`, `hr@team.local`, `mei@team.local`, `diego@team.local` (remote, New York), `hana@team.local` (remote, Tokyo).

`pnpm test` runs the rules self-check.

## Rules (all editable in Settings by admins and HR)

- Every day is a working day unless a leave is approved. Default hours are a 7-day template in the person's own timezone, minimum 8 contiguous hours, may cross midnight.
- Remote members can split a day into slots (for example 9–13 and 17–21); the 8-hour minimum applies to the total.
- Casual leave: 6 per month, covers weekly off-days too. Half days count 0.5. Monthly plans must have at least one leave day in every full week.
- Festive leave: 6 per year, taken as one block of consecutive days that includes at least one festive date from the admin list (one day on each festival, or several days around one). Sick leave: no quota.
- Extended leave: no quota. HR or an admin must log a conversation with the person before it can be approved.
- Work from home: in-office members request days at home; no quota, same approval, usual hours. The calendar shows a house icon on those days.
- Monthly plan deadline is a day of the month. After it, a person requests a reopen; HR approves; they can then submit.
- Department minimum staff per day blocks leave requests at submit time. The person can submit anyway as an exception with a reason; HR or an admin sees the coverage numbers and the approval is logged as over threshold.
- Editing an approved leave or hours change creates a replacement request. The original stays in place until the replacement is approved, then it is marked replaced and the team gets one "changed" notification.
- Approvals: employee -> HR, HR -> admin, admin -> another admin (auto-approved if there is only one).
- Any change to hours or leave is a request. Once approved, everyone is notified and the calendar updates. Requests closer than the short-notice threshold to the shift start are flagged.

## Analytics

Admins and HR get an Analytics page: pick a date range, a department and any set of people, and see leave days by type, work-from-home days, hours adjustments and flags per person and per department, with a day-by-day history for each person. "Print report" prints exactly that selection with every history expanded; CSV exports the same.

## Accounts

Members have a joining date and, when they leave, a leaving date. Former members disappear from the calendar after that date, keep their history, show under "Former members" on the Team page, and cannot sign in. Admins and HR add members on the Team page with a temporary password; the member is asked to set their own on first login. Resetting a password works the same way from the member's edit dialog. Everyone changes their own password, timezone and photo from the avatar menu.

## Stack

Next.js 16 (App Router, server actions), shadcn/ui on Base UI, Tailwind 4, Motion, Drizzle + SQLite (libsql). Cookie session auth.

## Going hosted

Swap `src/db/index.ts` to `drizzle-orm/postgres-js` and the schema imports to `drizzle-orm/pg-core`, point `DATABASE_URL` at Supabase, replace `src/lib/auth.ts` with Supabase Auth, deploy to Vercel.
