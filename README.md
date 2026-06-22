# Big Brother Simulator

A browser-based simulation of the reality-competition format *Big Brother*. Cast a
custom season of houseguests and watch a full game play out: Head of Household
competitions, nominations, the Power of Veto, live eviction votes, jury management,
a three-part Final HOH, and a jury vote to crown a winner. The simulation models
relationships, grudges, alliances, and a library of authentic *Big Brother* twists,
then archives every completed season to a personal stats dashboard backed by Supabase.

> **▶ Play it live:** _(add your GitHub Pages URL here once deployed)_

---

## Highlights

- **~4,900-line vanilla-JavaScript game engine** with no framework and no build step. Pure HTML, CSS, and JS.
- **Stateful season simulation** with a relationship/grudge model, alliance formation and dissolution, weighted competition outcomes, and AI-driven nomination, veto, and voting decisions.
- **A twists system** of 15+ authentic *Big Brother* twists (Double Eviction, Battle of the Block, AI Arena, Pandora's Box, Diamond Veto, Coup d'État, Battle Back, and more), each with one-shot and multi-week behaviors and a planner that schedules them across the season.
- **Full authentication and persistence layer** using GitHub/Google OAuth via Supabase, with completed seasons archived to a Postgres database.
- **Per-user stats dashboard** showing each player's season history, win rates, and records, isolated per account.
- **Owner/admin console** to broadcast announcements, review a user-feedback inbox, view global cross-user statistics, monitor activity with anomaly detection, and export all data.
- **Database-enforced access control** where every table is protected by Postgres Row Level Security, not by UI gating, so a user can only ever read or write their own data.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, vanilla JavaScript (no framework) |
| Backend / Persistence | Supabase (PostgreSQL) |
| Authentication | Supabase Auth (GitHub & Google OAuth) |
| Access control | PostgreSQL Row Level Security (RLS) |
| Hosting | Static, deployable to GitHub Pages or any static host |

The entire client is three files (`index.html`, `style.css`, `script.js`) and runs
with no build tooling. Supabase is loaded from a CDN.

---

## How It Works

A season runs as a weekly loop until three houseguests remain:

1. **Head of Household:** houseguests compete; the winner gains nomination power and immunity.
2. **Nominations:** the HOH nominates two houseguests, weighted by relationships, grudges, and perceived competition threat.
3. **Power of Veto:** a subset competes; the winner may remove a nominee, forcing a replacement.
4. **Eviction:** the remaining houseguests vote, and ties are broken by the HOH. Evictees past the jury threshold join the jury.
5. **Twists** may fire in a given week, altering the format (extra evictions, extra nominees, returning players, format resets, secret powers, and more).

Once three remain, a **three-part Final HOH** plays out, the final HOH cuts one player,
and the **jury votes** for a winner, weighted by each juror's relationship with and
grudges against the finalists. Completed seasons are archived and surfaced in the dashboard.

### Relationship & grudge model

Every houseguest holds a private 0 to 100 relationship score and a grudge value toward
every other houseguest. Social encounters, nominations, veto decisions, and votes all
shift these values, which in turn drive future nominations, alliance formation, and the
final jury vote, so the social game compounds over the course of a season.

---

## Security Model

Access control is enforced at the database, not in the browser. Every table has Row
Level Security enabled, so the rules hold even if a user calls the API directly:

- **`seasons`:** a user may read and write only rows where `auth.uid() = owner_uid`; an additional owner-only policy enables the cross-user admin views.
- **`feedback`:** any authenticated user may submit; only the owner may read or manage.
- **`announcements`:** anyone may read active announcements; only the owner may manage them.
- **`user_notes`:** readable and writable only by the owner.
- **Elevated admin delete:** a `SECURITY DEFINER` Postgres function performs the owner-only cross-user delete, with the owner check enforced inside the function.

Because the Supabase **anon key is designed to be public** and access is enforced by
RLS, the anon key in `script.js` is safe to commit. No service-role key or other secret
is present in the client.

---

## Running & Deploying

The app must be served over `http://` (not opened as a `file://` path), because OAuth
redirects require a real origin.

**Locally:** open the folder in VS Code and click **Go Live** (Live Server), or run
`python -m http.server 8000`. For login to work, add the local URL (for example
`http://localhost:5500`) to Supabase under **Authentication > URL Configuration >
Redirect URLs**. The game plays without logging in; only saving seasons and the
dashboard require auth.

**GitHub Pages:** push to GitHub, enable Pages under **Settings > Pages**, then add the
resulting `https://<username>.github.io/<repo>/` URL to the same Supabase redirect list,
or login on the live site will fail.

<details>
<summary>Self-hosting against your own Supabase project</summary>

You'll need tables `seasons`, `feedback`, `announcements`, and `user_notes` with RLS
enabled per the [Security Model](#security-model); GitHub and/or Google OAuth providers
enabled; a `SECURITY DEFINER` function `admin_delete_season(season_id bigint)`; and
`SUPABASE_URL`, `SUPABASE_ANON`, and `OWNER_UID` set near the top of `script.js`.
</details>

---

## Project Status

Active early development. The core game loop, twists system, persistence, and admin
console are complete and functional. Ongoing work includes input hardening, code
cleanup, and UI polish.

---

## License & Use

© 2026 Jacob Fyffe. All rights reserved.

This repository is published publicly **for portfolio review and evaluation only**.
You are welcome to view, read, and run the code to evaluate the author's work. You may
**not** copy, redistribute, host, deploy, or publish this code or any derivative of it,
or represent it as your own, without prior written permission. See [`LICENSE.md`](LICENSE.md)
for the full terms.
