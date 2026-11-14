# Setting up FundHub on a new PC

The steps to go from a blank Windows PC to a working FundHub dev setup. Daily use is in [LOCAL-DEV.md](LOCAL-DEV.md).

## 1. Install the tools

| Tool | Version | Why | Get it |
|---|---|---|---|
| **Git** | any recent (2.40+) | Clone and push | https://git-scm.com/download/win (keep "Git Bash" and "Git Credential Manager" ticked) |
| **Node.js** | **20.9 or newer** (20 LTS or 22 LTS) | Everything runs on Node | https://nodejs.org (LTS installer; it includes npm) |
| **npm** | 10.x (comes with Node) | Workspaces / install | `npm -v` to check |
| **Google Chrome** | current | The FundHub LBR Capture extension | https://www.google.com/chrome |
| VS Code + Claude Code | optional | Editor | https://code.visualstudio.com |
| Vercel CLI | optional | Pull production env vars, deploy | `npm i -g vercel` |
| GitHub CLI | optional | PRs, Actions secrets | https://cli.github.com |

**Not needed:** Docker, a system Postgres install, Python. The local databases are real Postgres servers started from npm (`embedded-postgres`).

Check:

```powershell
git --version
node -v      # must print v20.9.0 or higher
npm -v
```

## 2. Get the code

```powershell
cd C:\Users\<you>
git clone https://github.com/alejandromoralwork/FundHub.git
cd FundHub
npm install
```

`npm install` also downloads the Postgres binaries for the two local databases.

**Only if you will use the automated RCS browser** (`npm run engine -- rcs:login`): Playwright also needs its browser:

```powershell
npx playwright install chromium
```

## 3. Copy the files that are NOT on GitHub

These are kept out of Git on purpose (they hold secrets or are local data). Copy them from the old PC over a USB stick or a password manager, never through GitHub, email or chat.

| File / folder (relative to `FundHub\`) | What it is | Needed? |
|---|---|---|
| `.env.local` | Production (Neon/Vercel) settings | Only for production work. The local apps don't read it. Alternative: `vercel link` then `vercel env pull .env.local` |
| `.env.scraper.local` | Data module keys (e.g. `ANTHROPIC_API_KEY`) | If you run the scraper / AI features |
| `.env.staff-owner.local` | Production staff owner login | Only for production admin work |
| `services/engine/.env` (if you created one) | Engine overrides | Only if you changed engine defaults |
| `business_plan.pdf` | Private document | Optional |
| `services/engine/.engine-data/captures/` | LBR pages captured by the extension (~30 MB) | **Yes if any captures are not yet ingested.** Otherwise optional |
| `services/engine/.engine-data/blobs/` | Raw files and PDFs the engine stored (~480 MB) | Optional (needed only to re-parse old captures) |
| `packages/engine-db/.pg-data/` | Local engine database (~1.2 GB) | Optional, see step 4 |
| `packages/db/.pg-data/` | Local website database | No: recreate it with `npm run db:setup` |

**Do not copy** `services/engine/.engine-data/rcs-profile/`. It is the browser profile holding your LuxTrust session. Log in again on the new PC instead (`npm run engine -- rcs:login`).

Template for every setting: [.env.example](.env.example) (website/admin) and [services/engine/.env.example](services/engine/.env.example) (engine). Local development works **without any `.env` file**.

## 4. Create the local databases

Each database runs in its own terminal and stays open.

```powershell
# Terminal A: website database (port 5433)
npm run db:local
# Terminal C: tables + sample providers
npm run db:setup

# Terminal B: engine database (port 5434)
npm run engine:db:local
# Terminal C: tables + categories, rules, RCS prefixes
npm run engine:db:setup
```

**Keeping the engine data from the old PC** (instead of starting empty): on the old PC, stop `engine:db:local` (Ctrl+C) **before** copying `packages/engine-db/.pg-data`. Copying it while it runs corrupts it. Put it in the same place on the new PC, then run `npm run engine:db:local` followed by `npm run engine:db:migrate`.

**Starting empty** works too: rebuild the census with `npm run engine -- run cssf_census` and `npm run engine -- run gleif_sync`. See [services/engine/README.md](services/engine/README.md).

## 5. Create your local admin login

```powershell
npm run staff -w @fundhub/admin -- create you@fundhub.lu "Your Name" owner
```

It prints a temporary password. Log in at http://localhost:3001/admin and set up 2FA with an authenticator app.

## 6. Install the Chrome extension

Follow [services/engine/browser-extension/README.md](services/engine/browser-extension/README.md): `chrome://extensions`, turn on Developer mode, **Load unpacked**, then choose `services\engine\browser-extension`.

## 7. Check that everything works

```powershell
npm run typecheck                 # all apps and packages
npm test -w @fundhub/engine       # engine tests (DB tests run when engine:db:local is up)
npm test -w @fundhub/scraper
npm run dev                       # website :3000, admin :3001/admin
```

Then follow the **Every day** section of [LOCAL-DEV.md](LOCAL-DEV.md).

## Claude Code memory (optional)

Claude Code keeps project notes outside the repo, in `C:\Users\<you>\.claude\projects\<folder-name>\memory\`. On the old PC that is `C:\Users\pc\.claude\projects\c--Users-pc-FundHub\memory\`. To keep them, copy that folder to the matching folder on the new PC. The folder name follows the path where you clone the repo.

## Troubleshooting a fresh install

| Symptom | Fix |
|---|---|
| `npm install` fails on `embedded-postgres` | Check Node is 20.9+. Antivirus may block the Postgres binary download: allow it, or retry |
| `db:local` fails with "port in use" | Another Postgres already uses 5433/5434. Stop it |
| `rcs:login` says "Executable doesn't exist" | `npx playwright install chromium` |
| Line-ending warnings (`LF will be replaced by CRLF`) | Harmless. `.gitattributes` keeps server scripts as LF |
| `git push` asks for a password | Sign in through Git Credential Manager (browser window), or `gh auth login` |
