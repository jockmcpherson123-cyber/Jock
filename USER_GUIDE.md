# Grounds Ops — Team Guide & Account Booklet

A plain-English handbook for the crew and management at Congressional Country
Club. It covers **who gets an account**, **how to create logins**, **what each
person can do**, and **how to find or fix things**. Keep it with the rollout —
it's written to hand to a new tester on day one.

> Setting the app up from scratch (database, hosting, keys) is a separate job —
> see **SETUP.md**. This guide is for *using* it once it's live.

---

## 1. The three roles (who can do what)

Every login has one **role**. It decides what that person sees and can change.

| Role | Who it's for | Can do | Cannot do |
|---|---|---|---|
| **Operator** | Crew / sprayers | See today's jobs, open assigned spray sheets, tick off tanks, sign "sprayed by", do inventory counts, read labels & SDS, use the Job Board | Create/edit the program, edit the Chemical Library, change Settings, **approve** sheets |
| **Superintendent** | Assistants / spray techs who build the plan | Everything an Operator can, **plus** build the Annual Program, create & edit spray and fert sheets, edit the Chemical Library, run Early Order and Reports, change Settings | **Approve** (final sign-off) sheets |
| **Director** | Jock (Director of Grounds) | **Everything**, including **approving** spray sheets so they become the official record | — |

Rule of thumb: **crew = Operator**, **assistants = Superintendent**, **you = Director**.
You can have more than one of each, but keep Directors few — they hold the approval pen.

What a role changes on screen:
- **Operators** see a short "crew" sidebar: *To Spray, Records, Fert Sheets,
  Inventory, Labels & SDS, Chemistry Guide, Weather, Job Board, Playbook*.
- **Superintendents / Directors** see the full sidebar with **Annual Program,
  Chemical Library, Reports, Settings**, etc.
- Only a **Director** sees the **Approve** button on a pending spray sheet.

---

## 2. Creating a login (step by step)

Logins are **email + password**, created by an admin — there is **no public
sign-up**, which keeps the app locked to your team. You create each account once
in Supabase; the app picks it up automatically.

**A. Add the person in Supabase**
1. Go to [supabase.com](https://supabase.com) → open the **Grounds** project.
2. Left sidebar → **Authentication** → **Users** → **Add user** → **Create new user**.
3. Enter their **email** and a **temporary password**. (Tick "Auto Confirm User"
   so they can log in right away.)
4. Click **Create user**. A matching profile is created automatically, starting
   as an **Operator**.

**B. Set their role (only if they're not an Operator)**
1. Left sidebar → **SQL Editor** → **New query**.
2. Paste this, change the email and role, and **Run**:
   ```sql
   update public.profiles
   set role = 'superintendent',        -- or 'director'
       full_name = 'First Last'
   where id = (select id from auth.users where email = 'person@ccclub.org');
   ```
   Roles are exactly `operator`, `superintendent`, or `director`.

**C. Give them their login**
- Send them their email + temporary password and the site link. They can change
  their display name in the app; have them change the password in a new session
  (or you reset it in Supabase → Authentication → Users → ⋯ → Reset password).

> **Also add them in the app:** Settings → **People** lists operators and
> directors for the sheet pickers ("Operator", "Sprayed by", "Approved by") and
> holds their **applicator license #** and expiry. The Supabase account is the
> *login*; the People entry is the *name + license* that prints on records.
> Add them in **both** places, spelled the same way.

### Account roster — fill this in before rollout

| Name | Email (login) | Role | Applicator license # | License expiry |
|---|---|---|---|---|
| Jock McPherson | jmcpherson@ccclub.org | director | | |
| | | superintendent | | |
| | | operator | | |
| | | operator | | |

---

## 3. First login & getting your bearings

1. Open the site link → sign in with your email + password.
2. **Home** is your start screen: today's date, what's scheduled, soil-temp
   windows, low-stock warnings, and compliance reminders.
3. **Course bar** (top): **Blue Course / Gold Course / All**. It filters the
   whole app to one course. Areas marked **Both** (like Rough) show under each;
   **All** shows everything once. Set each area's course in
   Settings → Sprayer Areas.
4. **Search** (top right) jumps to any product, spray sheet, or soil test.

---

## 4. By role — your quick start

### Operator (crew / sprayer)
1. **To Spray** — your assigned sheets. Open one.
2. Read the mix: each product's **per-tank** amount is the bold number you
   measure into each tank; **total** is the whole job.
3. Tick each product as it goes in the tank; add the day's **weather**.
4. When the spray is done, choose yourself under **Sprayed by** and **sign**.
5. **Inventory** — after spraying, count what's left and apply it so stock stays
   honest.
6. **Labels & SDS** — open any product's label or safety sheet from here or the
   spray sheet.

### Superintendent (build the plan)
1. **Chemical Library** — make sure every product has its rate, **oz/case**,
   **cost/case**, **company**, and (for fertilizers) its **N-P-K**. Paste a label
   link and tap **Fill from label** to auto-fill.
2. **Annual Program** — build or import the season's sprays; set each area's
   **tanks**. The **Sheet** view shows per-area rates and totals.
3. **Early Order** (Annual Program → Early Order) — the season's quantities,
   cases, and cost, grouped by **company** (your rebate base) and by **type/area**.
4. **Create spray sheet** on a planned day → it carries the tanks and rates.
5. **Fert Sheets** for granular applications.
6. **Reports** — Nutrients, Cost, Usage, Rotation, EIQ.

### Director (approve & own the record)
1. Everything the Superintendent does, plus:
2. Open a **pending** spray sheet → review → **Approve**. Approval makes it the
   official, inspection-ready record (the Maryland record book pulls from it).
3. Keep an eye on **Home → compliance reminders** (license expiries, missing
   EPA #/REI/SDS).

---

## 5. What each section is for (the whole sidebar)

**Spray program**
- **Home** — the day at a glance; jump-off point.
- **Annual Program** — the season plan; Sheet view, Early Order, Performance, Coverage.
- **Spray Sheets** — all spray sheets (To Spray / Pending / Completed / All).
- **Fert Sheets** — granular fertilizer applications.
- **Chemical Library** — every product: rates, label facts, ordering, labels/SDS.
- **Inventory Count** — count the shelf and log it; keeps stock honest.
- **Chemistry Guide** — reference on chemistries and groups.

**Agronomy**
- **Field Data**, **GDD & Growth**, **Wetting Agents**, **Soil-Temp Timing**,
  **Soil Tests**, **Height of Cut**, **Reference** — the turf-science tools.

**Course & crew**
- **Irrigation Map**, **Parts**, **Job Board** (daily crew assignments),
  **Training**, **Playbook** (contacts & procedures), **Tournament**.

**Reports**
- **Weekly AI Reports**, **Weekly Report**, **Season Reports** (Nutrients, Cost,
  Usage, Rotation, EIQ, Days Since), **Weather**.

**Settings** (managers only) — Property Setup, Course Info, Location, **People**,
**Sprayer Areas**, Sprayers, Lists, Backup.

---

## 6. "How do I…" — common tasks

- **Create a spray sheet** → Annual Program → a planned day → **Create spray
  sheet**; or (one-off) Spray Sheets → New. Set area, products, rates, tanks → Save.
- **Approve a sheet** (Director) → Spray Sheets → Pending → open → **Approve**.
- **Mark a sheet sprayed** → open the approved sheet → add weather → **Sprayed by**
  → sign → **Mark as sprayed**.
- **Do an inventory count** → Inventory Count → type each counted number → **Apply**.
- **Run the Early Order** → Annual Program → **Early Order** → review by
  company/type/area → **Export CSV**.
- **Roll the plan to next year** → Annual Program → **Roll forward** → set the new
  year → (optional) *Match weekday* → **Create Season**.
- **Add a product** → Chemical Library → **Add Product** → paste the label link →
  **Fill from label** → check the rates → **Save**.
- **Set an area's size, tanks, and course** → Settings → **Sprayer Areas** → edit.

---

## 7. Fixing & finding things (troubleshooting)

| Problem | What's going on / the fix |
|---|---|
| **Can't log in** | Wrong email/password. Reset it in Supabase → Authentication → Users → ⋯ → Reset password. Confirm the user is "confirmed". |
| **I don't see Settings / Annual Program** | You're an **Operator**. Ask the admin to set your role to `superintendent` or `director`. |
| **No Approve button** | Only **Directors** can approve. |
| **An area (Rough, Natives, Driving Range) isn't showing** | Its **Course** isn't set. Settings → Sprayer Areas → set Blue / Gold / **Both**. "Both" shows under each course. |
| **Page won't load / looks old after an update** | The app caches hard. Close the tab and reopen, or hard-refresh (desktop). It self-heals on the next load. |
| **A product shows "add oz/case" in Early Order** | Add **Oz/case** (and cost) in Chemical Library → Ordering, so cases and cost can be figured. |
| **Fertilizer isn't counting in Nutrients** | The product needs its **N-P-K** filled in the Chemical Library (liquids also need density, lb/gal). |
| **Stock shows 0 everywhere** | The inventory table must exist — an admin runs `supabase/phase31.sql` once. Then do an Inventory Count to set starting stock. |
| **Numbers look off for a multi-tank area** | Check the area's **Area per tank** and **Default Tanks** in Settings → Sprayer Areas; the plan should be re-imported with per-row tank counts. |
| **Find anything** | Use the **Search** box (top right): products, spray sheets, soil tests. |
| **Who approved / sprayed it?** | Open the sheet — "Approved by" and "Sprayed by" are on it; the Season Reports and MD record book summarize them. |

Who to ask: **Jock (Director)** for approvals, roles, and anything compliance.
Admin/Supabase questions → whoever holds the Supabase login (see SETUP.md).

---

## 8. Admin checklist before testing (for the person setting it up)

- [ ] Database migrations applied, including **`supabase/phase31.sql`** (inventory counts).
- [ ] Each tester has a **Supabase login** and the right **role**.
- [ ] Each tester is in **Settings → People** with their **license #** and expiry.
- [ ] **Sprayer Areas** have **Area per tank**, **Default Tanks**, and **Course** set.
- [ ] **Chemical Library** products have rates, oz/case, cost, company, and N-P-K.
- [ ] The **Annual Program** is imported with per-row tank counts.
- [ ] Everyone has the site link and this guide.
