# Grounds Operations — Congressional Country Club

A multi-user web app for golf course grounds management: digital spray sheets,
chemical library, inventory, N-P-K compliance reporting, and (later) an
agronomic intelligence engine. Rebuilt from a single-file prototype into a real,
hosted, login-protected application.

**Stack:** Next.js 16 (React) · Supabase (Postgres + Auth) · Tailwind CSS ·
hosted on Vercel.

---

## The four moving parts (plain English)

- **This code** — the app itself (the "restaurant"). Lives here in GitHub.
- **Supabase** — the database + logins (the "storeroom and guest list").
- **Vercel** — the host that publishes the app live and re-publishes on every
  push to GitHub (the "high-street location").
- **GitHub** — where the code is stored; the hand-off point between the code and
  Vercel.

Flow: **edit code → push to GitHub → Vercel republishes → live app talks to
Supabase.**

---

## First-time setup

1. **Supabase:** create a project, then run `supabase/schema.sql` in the SQL
   Editor. Copy your Project URL and anon key.
2. **Local env:** copy `.env.example` to `.env.local` and paste those two values
   in. (Only needed to run the app on your own machine.)
3. **Vercel:** import this GitHub repo, add the same two values as Environment
   Variables, and deploy.

See the in-file comments in `supabase/schema.sql` and `.env.example` for exact,
click-by-click steps.

## Running locally

```bash
npm install
npm run dev      # open http://localhost:3000
```

---

## Build roadmap

- **Phase 0 — Foundation (done):** real logins, roles, database, live hosting.
- **Phase 1 — Spray Ops:** dashboard, spray sheets + calculations, chemical
  library, approvals, inventory, reports, settings, print/PDF.
- **Phase 2 — Annual Program:** season planner, Excel import, early-order
  calculator, resistance management.
- **Phase 3 — Intelligence:** weather pipeline, disease-risk models, GDD, and
  the recommendation + adaptive-learning engine.

## Project layout

```
app/            Pages and server actions (Next.js App Router)
  login/        Login screen
  actions/      Server-side login/logout
lib/
  supabase/     Browser + server database connectors
  getUser.js    Fetch the current user and their role
proxy.js        Runs on every request: refreshes session, enforces login
supabase/
  schema.sql    Database blueprint — run once in Supabase
```
