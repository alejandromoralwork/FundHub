# FundHub

Independent comparator of fund service providers in Luxembourg, with fund set-up and fee-negotiation advisory ([fundhub.lu](https://fundhub.lu)). FundHub is paid by fund managers, never by referral fees or commissions from the providers it compares.

## What is in this repository

| Part | Folder | Runs on |
|---|---|---|
| Public website | [`apps/web`](apps/web) | Vercel — fundhub.lu |
| Staff console | [`apps/admin`](apps/admin) | Vercel — fundhub.lu/admin |
| Scraping engine + LBR capture extension | [`services/engine`](services/engine/README.md) | Azure VM |
| Data module (AI web extraction) | [`services/scraper`](services/scraper) | Azure VM (systemd timers) |
| Shared code: taxonomy, DB schemas, email | [`packages/`](packages) | — |
| Self-hosted tools (Nextcloud, Twenty, Listmonk) | [`infra/tools/`](infra/tools/README.md) | Docker server |
| Marketing pack | [`marketing/`](marketing/README.md) | LaTeX |

Two databases: the **website DB** (Neon) serves the site and the business; the **engine DB** (PostgreSQL on the VM) is the staging area of the data pipeline. See [docs/architecture.md](docs/architecture.md).

## Quick start

```bash
npm install
npm run db:local          # terminal 1: website DB on :5433
npm run db:setup          # terminal 2: tables + sample providers
npm run staff -w @fundhub/admin -- create you@fundhub.lu "Your Name" owner
npm run dev               # website :3000, admin :3001/admin
```

Full setup, the engine and troubleshooting: [docs/development.md](docs/development.md).

## Documentation

**[docs/](docs/README.md)** is the single entry point:

* [Product](docs/product.md) — users, features, admin modules, business tools
* [Architecture](docs/architecture.md) — parts, databases, data flows, security, known gaps
* [Codebase](docs/codebase.md) — folder map, conventions, how to change things
* [Development](docs/development.md) — setup and daily running
* [Services](docs/services.md) — every module and service, how to operate it
* [Operations](docs/operations.md) — deploy, Azure VM, Drive, backups, secrets
* [Troubleshooting](docs/troubleshooting.md) — SSH into the VM, health check, fixing services
* [Secrets](docs/secrets.md) — what to keep in your password manager, encrypted secrets backup
* [Access and recovery](docs/access-and-recovery.md) — adding users, lost passwords, phones, keys, or the whole VM
