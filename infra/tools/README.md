# FundHub self-hosted tools

Open-source tools that run next to the FundHub website and admin, on one Docker server:

| Tool | What for | URL (example) |
|---|---|---|
| **Nextcloud** | Drive (files in folders), team calendar, task boards (Deck) | `https://drive.fundhub.lu` |
| **Twenty** | CRM: contacts, companies, deal pipelines | `https://crm.fundhub.lu` |
| **Listmonk** | Newsletter: lists, double opt-in, campaigns, unsubscribe | `https://newsletter.fundhub.lu` |

Caddy provides HTTPS automatically. One Postgres and one Redis are shared. Backups run nightly.

## 1. Server

- Ubuntu 24.04, **8 GB RAM**, 2–4 vCPU, 80+ GB disk, in the EU (e.g. Hetzner CPX31 or CX42 in Falkenstein, Nuremberg or Helsinki; about €15–25/month).
- DNS: create `A` records for `drive`, `crm` and `newsletter` (`.fundhub.lu`) pointing to the server IP.

## 2. Install

```bash
# on the server, as root
git clone https://github.com/alejandromoralwork/FundHub.git && cd FundHub/infra
bash setup.sh          # first run: creates .env with generated secrets
nano .env              # set the three domains and ACME_EMAIL
bash setup.sh          # second run: firewall, starts everything, schedules backups
```

Admin passwords for Nextcloud and Listmonk are in `.env`. Change them after the first login.

## 3. First configuration

**Nextcloud**
- Apps → enable **Calendar**, **Deck** (task boards) and **Contacts**. Create folders such as `Finance/Receipts`, `Clients`, `Providers`, `Legal`, `Marketing`.
- Create one user per team member. Set the admin URL `NEXTCLOUD_URL=https://drive.fundhub.lu` on the `fund-hub-admin` Vercel project to get the links in the admin sidebar.

**Twenty (CRM)**
- Open `https://crm.fundhub.lu`, create the workspace and invite the team.
- Settings → Data model → Opportunities: set stages for the two pipelines (advisory clients; Pro sales to providers).
- Settings → Developers → API → create a key. On `fund-hub-admin` set `TWENTY_URL=https://crm.fundhub.lu` and `TWENTY_API_KEY=…`. The Inbox "Send to CRM" button then creates the contact and an opportunity. Check the field names once in Twenty's API playground (Settings → Developers → API); FundHub sends `name.firstName/lastName`, `emails.primaryEmail` and an opportunity `name` with `pointOfContactId`.

**Listmonk (newsletter)**
- `https://newsletter.fundhub.lu/admin` → Settings: set the SMTP server (e.g. Resend SMTP), sender `FundHub <news@fundhub.lu>`, and the public root URL.
- Lists → create **FundHub newsletter**, type *Public*, opt-in *Double*. Copy its UUID.
- On the `fund-hub` (website) project set `LISTMONK_URL=https://newsletter.fundhub.lu` and `LISTMONK_LIST_UUID=…`. The newsletter form then appears in the website footer, and sign-ups that tick the newsletter box are subscribed (with confirmation email).
- On `fund-hub-admin` set `LISTMONK_URL` too, for the sidebar link.

## 4. Backups and updates

- `backup.sh` runs nightly at 02:30: all databases (`pg_dumpall`) and Nextcloud files go to `/var/backups/fundhub`, kept for 14 days. **Copy them off the server too** (e.g. a Hetzner Storage Box with `rsync`), otherwise a lost server means lost backups.
- Updates: `docker compose pull && docker compose up -d`. Once running, pin versions in `.env` (`NEXTCLOUD_TAG`, `TWENTY_TAG`, `LISTMONK_TAG`) and upgrade deliberately; Nextcloud only supports upgrading one major version at a time.

## Later: social posting and accounting

These are documented here, not installed yet, because their setups change often. Follow the official guides when you're ready:

- **Postiz** (open source, AGPL; schedules posts to LinkedIn, X, Facebook, Instagram and more): https://docs.postiz.com — needs about 4 GB RAM more, and you connect each social account in Postiz. FundHub's content studio already produces per-network texts and a CSV export; an API connection can be added once Postiz runs. Set `POSTIZ_URL` on the admin project for the sidebar link.
- **Bigcapital** (open source accounting, AGPL): https://docs.bigcapital.app — FundHub's Finance module exports revenue and expenses as CSV, and each expense has a `synced_ref` field ready for an API sync.
