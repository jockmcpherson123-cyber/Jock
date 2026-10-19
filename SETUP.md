# Setting up your own copy from scratch

This guide stands up a **complete, independent copy** of the app on accounts
that are entirely your own — nothing shared with any employer. Follow it
top to bottom and you'll have your own live site, your own database, and your
own AI features in about an afternoon. Most of it is free.

If you only want to *run* the app on your laptop to tinker, you just need
Steps 1, 2 and 6. The rest is for putting it live on the internet.

---

## The four accounts you'll need

Think of it like opening a restaurant (same analogy as the README):

| Account | What it is | Cost |
|---|---|---|
| **GitHub** | Where the code lives (this repo / your fork) | Free |
| **Supabase** | The database + logins ("storeroom and guest list") | Free tier is plenty |
| **Vercel** | The host that publishes the live site ("the shopfront") | Free (Hobby) |
| **Anthropic** | The AI key behind "Fill from label" etc. | Pay-per-use, pennies |

Create all four with a personal email that has nothing to do with work.

> **Heads-up on the free tiers:** Supabase pauses a free project after ~1 week
> of zero activity (one click un-pauses it). Vercel Hobby is for
> non-commercial use. If this ever becomes a paid product, move both to a paid
> plan — it's a billing change, not a rebuild.

---

## Step 1 — Get the code

Clone your own fork of the repo:

```bash
git clone https://github.com/<your-username>/<your-fork>.git
cd <your-fork>
npm install
```

You need **Node 20 or newer** (Next.js 16 requires it). Check with `node -v`.

---

## Step 2 — Build the database (Supabase)

1. Go to [supabase.com](https://supabase.com) → **New project**. Pick a name and
   a strong database password (save it somewhere). Wait ~2 minutes for it to
   finish provisioning.
2. Left sidebar → **SQL Editor** → **New query**.
3. Run the schema files **in this exact order**, one at a time (paste the file's
   contents, click **Run**, then do the next):

   ```
   supabase/schema.sql      ← Phase 0: logins & profiles (run this FIRST)
   supabase/phase1.sql
   supabase/phase2.sql
   supabase/phase3.sql
   ... and so on, in NUMBER order ...
   supabase/phase30.sql     ← run this LAST
   ```

   > ⚠️ **Order matters, and watch the numbers.** It's `phase2` *before*
   > `phase10` — go by the number (1, 2, 3 … 9, 10, 11 … 30), not alphabetical.
   > Each file is safe to re-run, so if you lose your place you can re-run one
   > without harm.

4. When all files have run, your database has every table the app needs —
   **empty**, ready for data.

### Grab your three Supabase keys

Supabase → **Project Settings** → **API**. Copy these (you'll paste them in
Step 5):

| Value | Supabase label | Used for |
|---|---|---|
| Project URL | "Project URL" | connecting to the DB |
| anon key | "anon" / "publishable" public key | the browser side |
| service role key | "service_role" **secret** key | server-only actions (crew, readings, parts, license checks) |

> 🔒 The **service role key is a secret** — it bypasses all row-level security.
> Never put it in `NEXT_PUBLIC_*`, never commit it, never paste it in the
> browser. It only goes in server environment variables.

---

## Step 3 — Get your Anthropic API key (AI features)

This powers "Fill from label" and the other AI helpers. It is **separate** from
any Claude chat subscription — it's a pay-as-you-go API key.

1. Go to [console.anthropic.com](https://console.anthropic.com) → **API Keys**
   → **Create Key**. Copy it.
2. Add a small amount of credit (Billing). At your usage this is cents, not
   dollars.

If you skip this, the whole app still works — only the AI autofill buttons will
show a "not set up" message.

---

## Step 4 — (Optional) Email for reports & license alerts

Two features send email: emailing a report (`/api/send-report`) and the daily
license-expiry alert (the cron in `vercel.json`). Skip this entirely if you
don't need email yet — the rest of the app is unaffected.

Pick **one** email method:

- **Resend (simplest):** sign up at [resend.com](https://resend.com), create an
  API key, set `RESEND_API_KEY` and `REPORT_FROM_EMAIL` (a from-address on a
  domain you've verified with Resend).
- **Gmail app password:** set `GMAIL_USER` (your address) and
  `GMAIL_APP_PASSWORD` (a Google "App Password", not your normal password).

For the daily license alert also set `LICENSE_ALERT_EMAIL` (who gets it),
`LICENSE_ALERT_FROM` (the from-address), and `CRON_SECRET` (any long random
string — it stops outsiders from triggering the cron).

---

## Step 5 — Set your environment variables

These are the secrets/config. They live **outside** the code — which is exactly
why the code is safe to lift and re-use: you just supply your own values here.

**For running locally:** copy `.env.example` to `.env.local` and fill it in.
`.env.local` is git-ignored, so your keys never get committed.

```bash
cp .env.example .env.local
# then edit .env.local
```

### Full variable reference

| Variable | Required? | Where it comes from |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Required** | Supabase → Settings → API (Project URL) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Required** | Supabase → Settings → API (anon key) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Required** for admin/server features | Supabase → Settings → API (service_role secret) |
| `ANTHROPIC_API_KEY` | Needed for AI autofill | console.anthropic.com → API Keys |
| `RESEND_API_KEY` | Optional (email via Resend) | resend.com |
| `REPORT_FROM_EMAIL` | Optional (email) | a verified from-address |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | Optional (email via Gmail) | your Google account |
| `LICENSE_ALERT_EMAIL` | Optional (license cron) | whoever should get alerts |
| `LICENSE_ALERT_FROM` | Optional (license cron) | a from-address |
| `CRON_SECRET` | Optional (protects the daily cron) | any long random string you invent |

The `NEXT_PUBLIC_` ones are meant to be seen by the browser — that's fine,
security comes from Supabase Row Level Security. Everything else is
server-only; never prefix those with `NEXT_PUBLIC_`.

---

## Step 6 — Run it on your laptop

```bash
npm run dev
# open http://localhost:3000
```

If the page loads and you can reach a login screen, the code + database are
talking. 🎉

---

## Step 7 — Put it live (Vercel)

1. Go to [vercel.com](https://vercel.com) → **Add New… → Project** → import your
   GitHub fork.
2. Framework preset: **Next.js** (auto-detected). No build-command changes
   needed.
3. **Environment Variables:** add the same values from Step 5 (at minimum the
   three Supabase vars + `ANTHROPIC_API_KEY`, plus any email/cron vars you're
   using). Add them for **Production** (and Preview if you want branch
   previews).
4. Click **Deploy**. Every future `git push` to your main branch auto-deploys.

The daily license-check cron in `vercel.json` runs automatically on Vercel —
nothing to configure, but it only *does* something if the email + `CRON_SECRET`
vars are set.

---

## Step 8 — Create your first user (make yourself admin)

1. On the live site (or local), go to the login/sign-up screen and create your
   account — this creates a row in Supabase `auth.users` and a matching
   `profiles` row.
2. Make yourself the top-level admin. The roles are `operator` (read-only),
   `superintendent` (manage), and `director` (approve / full access). In
   Supabase → **SQL Editor**, run this one line with your email:

   ```sql
   update profiles set role = 'director', full_name = 'Your Name'
   where id = (select id from auth.users where email = 'you@example.com');
   ```

   (Or edit the `role` cell directly in **Table Editor** → `profiles`.) See the
   footer of `supabase/schema.sql` for the same instruction.
3. Log out and back in. You now have full access.

---

## Staying in sync with another copy (optional)

If you forked from a shared/club repo and want their later changes to flow into
your copy:

```bash
git remote add upstream https://github.com/<their-org>/<their-repo>.git
git fetch upstream
git merge upstream/main      # or the default branch name
```

Do that whenever you want to pull their updates. Your own changes stay yours;
you push improvements back to them with a pull request. It's one-way on your
command — nothing syncs automatically, so the two copies never surprise you.

---

## Quick troubleshooting

- **"Invalid API key" / can't log in** → the two `NEXT_PUBLIC_SUPABASE_*`
  values are wrong or from a different project. Re-copy from Supabase → API.
- **Admin screens error / "permission denied"** → `SUPABASE_SERVICE_ROLE_KEY`
  is missing or wrong, or a phase SQL file didn't run. Re-run the phases.
- **AI autofill says "not set up"** → `ANTHROPIC_API_KEY` missing, or no credit
  on the Anthropic account.
- **A table is missing** → you skipped a phase file or ran them out of order.
  Re-run `schema.sql` then `phase1`…`phase30` in number order (safe to re-run).
- **Site works locally but not on Vercel** → you added the env vars locally but
  not in Vercel → Settings → Environment Variables (then redeploy).
