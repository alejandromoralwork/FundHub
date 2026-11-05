# Running FundHub locally

FundHub is several separate parts. Each runs in **its own terminal** and keeps running until you press **Ctrl+C**. Nothing starts by itself: if a page doesn't load, the part behind it isn't running.

## The parts

| # | Part | Command (from `C:\Users\pc\FundHub`) | Address | Needed for |
|---|---|---|---|---|
| 1 | **Website database** (Postgres) | `npm run db:local` | `localhost:5433` | Website and admin console |
| 2 | **Website** | `npm run dev:web` | http://localhost:3000 | The public site |
| 3 | **Admin console** | `npm run dev:admin` | http://localhost:3001/admin | Staff tools, including **Scraping engine** pages |
| 4 | **Engine database** (Postgres) | `npm run engine:db:local` | `localhost:5434` | Scraping engine, admin **Scraping engine** pages, extension |
| 5 | **Capture receiver** | `cd services\engine` then `node --import tsx src/cli.ts capture-server` | `127.0.0.1:4477` | The Chrome extension (FundHub LBR Capture) |
| 6 | Engine worker (optional) | `npm run engine -- worker --groups cssf,gleif,maintenance` | — | Jobs started from the admin **Jobs** page |

`npm run dev` starts parts 2 and 3 together. The databases (1 and 4) must already be running.

**Why `/admin/engine/registry` wasn't loading:** part 3 (`npm run dev:admin`) wasn't running. The admin console also needs part 1, and its engine pages need part 4. The admin console's address always includes `/admin`: http://localhost:3001/admin.

## First time only (one-time setup)

Run these once, each in a terminal at `C:\Users\pc\FundHub`:

```powershell
npm install

# Website database: start it (terminal A, leave it open)…
npm run db:local
# …then in another terminal: create the tables + sample providers
npm run db:setup

# Engine database: start it (terminal B, leave it open)…
npm run engine:db:local
# …then in another terminal: create the tables + categories and rules
npm run engine:db:setup

# Your staff login for the local admin console (prints a temporary password: note it)
npm run staff -w @fundhub/admin -- create you@fundhub.lu "Your Name" owner
```

Log in at http://localhost:3001/admin with that email and temporary password. The first login asks you to set up two-factor authentication: scan the QR code with an authenticator app. You can then change the password on the **Account** page.

> **Local vs production.** The root `.env.local` holds the Neon (production) settings pulled from Vercel, but the local apps don't read it: they use the local databases on ports 5433 and 5434. The staff account in `.env.staff-owner.local` belongs to production. **Locally, create your own staff user with the command above.**

## Every day

Open one terminal per line, all at `C:\Users\pc\FundHub` unless stated otherwise, and start them **in this order**:

```powershell
# 1. Website database
npm run db:local

# 2. Engine database
npm run engine:db:local

# 3. Website + admin console (or separately: npm run dev:web / npm run dev:admin)
npm run dev

# 4. Capture receiver for the Chrome extension
cd services\engine
node --import tsx src/cli.ts capture-server
```

Then open:

| What | Address |
|---|---|
| Website | http://localhost:3000 |
| Admin console | http://localhost:3001/admin |
| Scraping engine overview | http://localhost:3001/admin/engine |
| Registry (all entities) | http://localhost:3001/admin/engine/registry |
| Capture rounds (register) | http://localhost:3001/admin/engine/rounds |
| Engine jobs | http://localhost:3001/admin/engine/jobs |
| LBR capture | Chrome with the **FundHub LBR Capture** extension: [services/engine/browser-extension/README.md](services/engine/browser-extension/README.md) |

You only need the parts you use:

| To use | Start |
|---|---|
| Only the extension (capturing LBR) | 2 (engine DB) + 4 (receiver) |
| Admin console with engine pages | 1 + 2 + `npm run dev:admin` |
| Website only | 1 + `npm run dev:web` |

**Stopping:** press Ctrl+C in each terminal. The data stays: `packages/db/.pg-data` (website) and `packages/engine-db/.pg-data` (engine).

## Useful engine commands (from `C:\Users\pc\FundHub`)

```powershell
npm run engine -- status                       # census, queue, recent runs
npm run engine -- round:status                 # current capture round
npm run engine -- round:list                   # register of capture rounds
npm run engine -- entity B145917               # one company with all its sources
npm run engine -- run cssf_census --types SPP  # run a job directly (no worker needed)
npm run engine -- run gleif_sync               # GLEIF delta since the last sync
npm test -w @fundhub/engine                    # engine tests
```

## When something doesn't work

| Message / symptom | Meaning | Fix |
|---|---|---|
| Browser shows "This site can't be reached" on `localhost:3001` | Admin console isn't running | `npm run dev:admin` |
| `localhost:3001` works but you see a login page | Normal | Log in with your **local** staff user (see first-time setup) |
| Admin **Scraping engine** pages say "engine database is not reachable" | Engine DB isn't running | `npm run engine:db:local` |
| `Missing script: "engine:db:local"` | You ran it inside `services\engine` | Run it from `C:\Users\pc\FundHub` |
| `npm run engine:db:local` says "already running" | It's already up (another terminal or Claude Code) | Nothing to do |
| `EADDRINUSE … 4477` when starting the receiver | A receiver is already running | Use that one, or close it first |
| `EADDRINUSE … :::3001` (or `3000`) when starting the admin console / website | It's **already running** in another terminal (e.g. from `npm run dev`) | Just open http://localhost:3001/admin. To restart it, press Ctrl+C in that terminal, or run `Get-NetTCPConnection -LocalPort 3001 -State Listen \| ForEach-Object { Stop-Process -Id $_.OwningProcess }` |
| Extension popup says "Engine not running" | Receiver (part 4) isn't running | Start the capture-server |
| Admin login fails with a password that works on fundhub.lu | That's the production account | Create a local staff user |
| Things look stale after code changes | Dev servers auto-reload, but the extension doesn't | `chrome://extensions` → **↻ Reload** on FundHub LBR Capture |

## Where things live

| Part | Folder |
|---|---|
| Website | `apps/web` |
| Admin console | `apps/admin` (pages under `src/app/(console)`, engine pages under `…/engine`) |
| Website database schema | `packages/db` |
| Engine database schema and shared engine logic | `packages/engine-db` |
| Scraping engine (CSSF, GLEIF, RCS, receiver, CLI) | `services/engine` ([README](services/engine/README.md)) |
| Chrome extension | `services/engine/browser-extension` ([README](services/engine/browser-extension/README.md)) |
| Notes on LBR access | `services/engine/docs/lbr-findings.md` |
