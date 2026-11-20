# Development

Setting up a machine and running FundHub locally. Works the same on Linux (e.g. the Azure VM through code-server), macOS and Windows; Windows notes are at the end.

## 1. Tools

| Tool | Version | Why |
|---|---|---|
| Git | 2.40+ | Clone and push |
| Node.js | **20.9 or newer** (LTS) | Everything runs on Node; npm comes with it |
| Google Chrome | current | The LBR capture extension |
| Vercel CLI, GitHub CLI | optional | Pull production env vars, deploy, PRs |

Not needed: Docker, a system Postgres, Python. Local databases are real Postgres servers started from npm (`embedded-postgres`).

## 2. First-time setup

```bash
git clone git@github.com:alejandromoralwork/FundHub.git && cd FundHub
npm install                         # also downloads the Postgres binaries

# Terminal A — website database (port 5433), leave it running
npm run db:local
# Terminal B — engine database (port 5434), leave it running
npm run engine:db:local
# Terminal C — tables and sample data
npm run db:setup
npm run engine:db:setup
npm run staff -w @fundhub/admin -- create you@fundhub.lu "Your Name" owner   # prints a temporary password
```

Log in at http://localhost:3001/admin with that password and set up 2FA with an authenticator app.

Only for the automated RCS browser (diagnosis): `npx playwright install chromium`.

**Local works without any `.env` file.** The root `.env.local` (production Neon settings from `vercel env pull`) is not read by the local apps, and the production staff account does not exist locally: create your own with the command above.

## 3. Every day

| # | Part | Command | Address |
|---|---|---|---|
| 1 | Website database | `npm run db:local` | `localhost:5433` |
| 2 | Engine database | `npm run engine:db:local` | `localhost:5434` |
| 3 | Website + admin | `npm run dev` (or `dev:web` / `dev:admin`) | http://localhost:3000 · http://localhost:3001/admin |
| 4 | Capture receiver (local extension use) | `npm run engine -- capture-server` | `127.0.0.1:4477` |
| 5 | Engine worker (optional) | `npm run engine -- worker --groups cssf,gleif,maintenance` | — |

Each runs in its own terminal until Ctrl+C. Start only what you need:

| To use | Start |
|---|---|
| Website only | 1 + `npm run dev:web` |
| Admin with engine pages | 1 + 2 + `npm run dev:admin` |
| Extension against a local engine | 2 + 4, and in the extension popup **Engine on this computer instead? → Use local receiver** |

Data stays between runs in `packages/db/.pg-data` and `packages/engine-db/.pg-data` (git-ignored).

## 4. Useful commands

```bash
npm run typecheck                               # all workspaces
npm test -w @fundhub/engine                     # engine tests
npm test -w @fundhub/scraper

npm run engine -- status                        # census, queue, recent runs
npm run engine -- entity B145917                # one company with all its sources
npm run engine -- run cssf_census --types SPP   # run a job directly (no worker)
npm run engine -- run gleif_sync                # GLEIF delta
npm run engine -- round:status | round:list     # capture rounds
npm run engine -- sweep:plan | sweep:status     # LBR search sweep

npm run scrape -- run --source ai_web --provider <slug> --dry-run   # needs ANTHROPIC_API_KEY
npm run scrape -- jobs                          # jobs queued from the admin

npm run db:generate / engine:db:generate        # migration after a schema change
npm run staff -w @fundhub/admin -- …            # staff accounts
```

## 5. Files that are not in Git

Copy these between machines by USB or a password manager, never through Git, email or chat.

| Path | What | Needed? |
|---|---|---|
| `.env.local` | Production (Neon / Vercel) settings | Production work only; or `vercel env pull .env.local` |
| `.env.scraper.local` | Data module keys (`ANTHROPIC_API_KEY`) | AI scraper |
| `.env.staff-owner.local` | Production staff owner login | Production admin |
| `services/engine/.env`, `packages/engine-db/.env` | Engine settings and secrets (on the VM: `CAPTURE_TOKEN`, `ENGINE_DATABASE_URL`) | Engine |
| `packages/engine-db/.pg-data/` | Local engine DB (~1.2 GB) | To keep local engine data (stop the DB before copying) |
| `services/engine/.engine-data/captures/`, `blobs/` | Captured LBR pages, PDFs | To keep / re-import captures |
| `business_plan.pdf`, `marketing.zip` | Private documents | Optional |

**Never copy** `services/engine/.engine-data/rcs-profile/` (your LuxTrust browser session): log in again instead.

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| "This site can't be reached" on `localhost:3001` | Admin isn't running: `npm run dev:admin` |
| Admin engine pages say the engine database is not reachable | `npm run engine:db:local` |
| `Missing script: "engine:db:local"` | Run it from the repo root |
| "already running" from a `db:local` | Fine, it is up |
| `EADDRINUSE` on 3000 / 3001 / 4477 | Already running in another terminal; use it or stop it |
| Admin login fails with the production password | Create a local staff user |
| Extension changes don't apply | `chrome://extensions` → ↻ Reload |
| `npm install` fails on `embedded-postgres` | Node 20.9+; antivirus may block the binary download |
| `rcs:login`: "Executable doesn't exist" | `npx playwright install chromium` |

## Windows notes

* Run the same commands in PowerShell from the repo folder (e.g. `C:\Users\<you>\FundHub`).
* Stop a process holding a port: `Get-NetTCPConnection -LocalPort 3001 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess }`.
* `LF will be replaced by CRLF` warnings are harmless: `.gitattributes` keeps server scripts as LF.
* Claude Code's project memory lives in `C:\Users\<you>\.claude\projects\<folder>\memory\`; copy it to keep notes across PCs.
