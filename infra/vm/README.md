# Azure VM

Everything the FundHub VM runs **outside the repo checkout** is defined in this folder, and `install.sh` puts it in
place. A new VM (Ubuntu 24.04) is: clone the repo, `sudo bash infra/vm/install.sh`, done. On this VM, re-run it after
changing anything here.

```bash
sudo bash infra/vm/install.sh --diff     # what would change (nothing is touched)
sudo bash infra/vm/install.sh            # apply; idempotent, safe to repeat
```

The repo is the source of truth: edit the file here, then run `install.sh`, never edit `/etc/...` by hand (the next run
would show it in `--diff` and overwrite it). Files are **copied** to the system, not linked, so editing the repo
cannot change what runs as root until `install.sh` is run with sudo.

| Folder / file | Installed to | What |
|---|---|---|
| `caddy/Caddyfile` | `/etc/caddy/Caddyfile` | HTTPS; `/authelia*` → login portal, `/engine/*` → receiver (token), `/drive/*` and `/bi/*` behind 2FA (signed `/bi` embeds public), everything else → code-server behind 2FA |
| `authelia/configuration.yml`, `authelia/override.conf` | `/etc/authelia/`, `/etc/systemd/system/authelia.service.d/` | 2FA portal (apt.authelia.com). Secrets in `/etc/authelia-secrets/*` (outside `/etc/authelia`: the package resets that folder to 0640 at every boot), users in `/etc/authelia/users.yml` |
| `postgres/fundhub.conf` | `/etc/postgresql/18/main/conf.d/` | PostgreSQL 18 (apt.postgresql.org) tuning; database and role `fundhub_engine`, `127.0.0.1:5432` |
| `code-server/config.yaml.example` | `~/.config/code-server/config.yaml` (first install only) | code-server on `127.0.0.1:8080` |
| `systemd/fundhub-capture.service` | `/etc/systemd/system/` | Receiver for the browser extension (`engine capture-server`, `127.0.0.1:4477`) |
| `systemd/fundhub-engine-backup.{service,timer}`, `bin/backup-engine-db.sh` | `/etc/systemd/system/`, `/usr/local/lib/fundhub/` | Nightly `pg_dump` 03:30 UTC → `/var/backups/fundhub-engine/`, 14 days |
| `systemd/fundhub-engine-{worker,scheduler}.service` | `/etc/systemd/system/` | Intelligence pipeline worker and scheduler. Skipped until `services/engine/.env` exists |
| `systemd/fundhub-metabase.service`, `bin/metabase-install.sh` | `/etc/systemd/system/`, `/opt/metabase` | Data intelligence (Metabase, pinned + checksum) on `127.0.0.1:3010`, published at `/bi`; installed by `sudo bash infra/vm/bin/metabase-install.sh`, see [docs/data-intelligence.md](../../docs/data-intelligence.md) |
| `drive/config.yaml`, `systemd/fundhub-drive.service` | `/etc/fundhub-drive/`, `/etc/systemd/system/` | Drive (FileBrowser Quantum, pinned + checksum) on `127.0.0.1:8090`, files in `/srv/fundhub-drive`; see [docs/operations.md → Drive](../../docs/operations.md#4-drive) |

Placeholders in these files (`@DOMAIN@`, `@USER@`, `@REPO@`, `@NODE_DIR@`) are filled in by `install.sh`; override with
`DOMAIN=… APP_USER=… NODE_DIR=… sudo -E bash infra/vm/install.sh`.

**Secrets are never in git.** `install.sh` creates them once and never overwrites them:

| Secret | File |
|---|---|
| Extension token, engine DB URL | `services/engine/.env` (`CAPTURE_TOKEN`, `ENGINE_DATABASE_URL`), `packages/engine-db/.env` |
| Data module | `services/scraper/.env` (you create it from `.env.example`) |
| Authelia | `/etc/authelia-secrets/*`, `/etc/authelia/users.yml`; after a new install the first password is in `/etc/authelia/initial-credentials` (deleted by the first password change) |
| code-server password | `~/.config/code-server/config.yaml` |
| Data intelligence | `/etc/metabase/metabase.env` (app DB password, encryption key — never change it), `~/.fundhub-secrets/bi-ro-db-url`, `~/.fundhub-secrets/metabase-embed-secret` |
| Drive | `/etc/fundhub-drive/secrets.env` (JWT key — never change it, TOTP key, bootstrap password); logins go through Authelia |

Not managed here: Azure itself (VM size, disks, network security group: ports 22/80/443 only), SSH keys, and the
Node.js install (nvm).

## 2FA (Authelia)

Adding people, passwords, lost phones, blocks and lock-outs: **[docs/access-and-recovery.md](../../docs/access-and-recovery.md)**. Something down: **[docs/troubleshooting.md](../../docs/troubleshooting.md)**. Helpers in `bin/`: `health.sh` (what is broken and how to fix it), `authelia-useradd.sh` (add a user; `--admin` for code-server), `authelia-passwd.sh` (change a password), `authelia-cli.sh` (bans, TOTP reset, config check), `export-secrets.sh` (encrypted backup of the VM-only secrets, see [docs/secrets.md](../../docs/secrets.md)).

Every browser request except `/engine/*` (the extension, which uses its token) and the portal itself needs an
Authelia session (code-server and the Drive share it). The Drive is open to every VM user; code-server only to group
`admins`: password, then a 6-digit code from an authenticator app. 3 wrong tries in 5 min lock the user for
30 min. Sessions last 12 h (2 h idle). SSH (key only, passwords disabled) is the emergency way in.

* First password (new install only, until it is changed): `sudo cat /etc/authelia/initial-credentials`.
* Registering the authenticator sends a one-time code to a file (no email server):
  `sudo cat /var/lib/authelia/notification.txt`.
* Change the password: `sudo bash infra/vm/bin/authelia-passwd.sh` (asks twice, restarts Authelia,
  restores the old file if Authelia does not start).
* Lost phone: `sudo bash infra/vm/bin/authelia-cli.sh storage user totp delete alejandro`, then register again.
* Locked out of the browser: SSH in, `sudo cp /etc/caddy/Caddyfile.bak-pre-authelia /etc/caddy/Caddyfile && sudo systemctl reload caddy`
  (removes the 2FA gate), fix, then `sudo bash infra/vm/install.sh` puts the gate back.
* Logs: `journalctl -u authelia -f`.

## Data module

The scraper (`services/scraper`) runs here instead of GitHub Actions. Create `services/scraper/.env` from
`services/scraper/.env.example` (`DATABASE_URL` with the `fundhub_scraper` role, `ANTHROPIC_API_KEY`), `chmod 600`.
The timers then start working on their own.

```bash
systemctl list-timers 'fundhub-*'                 # next runs
sudo systemctl start fundhub-scraper-jobs         # run the queue now
journalctl -u fundhub-scraper-jobs -u fundhub-scraper-weekly -n 50
```

## Everyday

**Capture server (for the browser extension):** it starts at boot. To start/restart it by hand in code-server use
*Terminal → Run Task → Capture server: start* (or *restart / stop / status / logs*), or the ▶ next to `capture:start`
in the Explorer's **NPM Scripts** view. Same thing from a terminal: `npm run capture:start` (`bin/capture.sh`).

```bash
sudo systemctl restart fundhub-capture          # after pulling engine code
journalctl -u fundhub-capture -f                # receiver log
npm run engine:db:migrate                       # after a schema change (from the repo root)
sudo systemctl start fundhub-engine-backup      # backup now
sudo ls -lh /var/backups/fundhub-engine         # backups
```

## Backups

The nightly job (`fundhub-engine-backup.timer`, 03:30 UTC, script `infra/vm/bin/backup-engine-db.sh`, installed at `/usr/local/lib/fundhub/`) backs up:

| What | How | Where | Kept |
|---|---|---|---|
| Engine DB, Metabase DB (VM Postgres) | `pg_dump -Fc`, checked with `pg_restore --list` | `/var/backups/fundhub-engine`, plus `RCLONE_REMOTE` | 14 days |
| Website DB (Neon), with `WEBSITE_BACKUP_URL` set | `pg_dump -Fc` over TLS, checked | same | 14 days |
| Engine files (PDFs, raw pages, captures), with `RCLONE_FILES_REMOTE` set | `rclone copy --immutable` (only new files) | `RCLONE_FILES_REMOTE` | forever |

Settings live in `/etc/default/fundhub-backup` (root only, `chmod 600`). After editing the script in the repo, reinstall it with `sudo install -m 755 infra/vm/bin/backup-engine-db.sh /usr/local/lib/fundhub/backup-engine-db.sh`. Add Azure Backup of the whole VM on top (portal → VM → Backup).

**Website DB role.** Create it once in Neon's SQL Editor, logged in as the database owner (`neondb_owner`):

```sql
CREATE ROLE fundhub_backup WITH LOGIN PASSWORD '<long random password>';
GRANT CONNECT ON DATABASE neondb TO fundhub_backup;
GRANT USAGE ON SCHEMA public TO fundhub_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO fundhub_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO fundhub_backup;
-- tables created later by migrations (run as the role that runs the migrations, normally neondb_owner):
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO fundhub_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO fundhub_backup;
```

Then set `WEBSITE_BACKUP_URL=postgresql://fundhub_backup:<password>@<endpoint>.<region>.aws.neon.tech/neondb?sslmode=require`. Use the host **without** `-pooler`. The script adds certificate checking with the system roots.

**Restore the website DB** into a new Neon branch first (never straight over production). Neon console → Branches → *Create branch* (empty), then:

```bash
pg_restore --no-owner --no-privileges -d "<new branch connection string>" /var/backups/fundhub-engine/website-<stamp>.dump
```

Check it, then point the apps at it or copy the needed rows back.

## Restore a backup

```bash
sudo systemctl stop fundhub-capture
sudo -u postgres dropdb fundhub_engine
sudo -u postgres createdb -O fundhub_engine -E UTF8 --lc-collate=C --lc-ctype=C -T template0 fundhub_engine
sudo -u postgres pg_restore --no-owner --role=fundhub_engine -d fundhub_engine /var/backups/fundhub-engine/<file>.dump
sudo systemctl start fundhub-capture
```

## Import the database from the old PC

The engine database now has a different, layered schema, so the old PC's database is **not** restored here.
Its LBR captures and filing PDFs are re-sent through the capture receiver instead, and rebuilt by the new pipeline:
follow [docs/import-old-pc-data.md](../../docs/import-old-pc-data.md) (written so a Claude session on the old PC can
run it end to end).

## Data disk for filing PDFs

Filing PDFs and raw captures (the engine's "blobs") live on their own Azure data disk, not on the 30 GB OS disk. The database stores only each file's SHA-256 and its key (`docs/ab/ab12….pdf`), never the bytes. Identical files are stored once.

**Only CSSF entities that are not funds keep their PDFs** (supervised firms, ManCos / AIFMs, banks, financial institutions, service providers, GPs with a CSSF record). The rule is in `packages/engine-db/src/core/document-scope.ts` and is chosen with `DOCUMENT_SCOPE` in `services/engine/.env`: `cssf` (default) or `legacy` (service providers and fund GPs, the earlier rule). The capture server refuses PDFs for other companies, and the browser extension shows "Save all documents" only in scope. Every company still keeps its filings list.

**Size:** about 1,400 companies in scope × about 60 filings × about 0.6 MB per PDF comes to at most about 50 GB. 128 GB leaves room. PDFs are not compressed further (they already are); capture files are stored gzipped.

1. Azure portal → VM → **Disks** → *Create and attach a new disk*: **Standard HDD (S10)**, **128 GB** (cheapest; PDFs are written once and rarely read — Standard SSD E10 also works), same region, LUN 0 → **Save**. The disk can be attached while the VM runs.
2. On the VM: `sudo bash infra/vm/bin/data-disk-setup.sh`. The script:
   - formats the empty disk (label `fundhub-data`);
   - mounts it at `/srv/fundhub-data` at every boot;
   - moves `services/engine/.engine-data/blobs` and `…/captures` there (the old folders are kept as `*.old-<date>`; delete them after checking);
   - sets `STORAGE_ROOT=/srv/fundhub-data/engine/blobs` and `CAPTURES_DIR=/srv/fundhub-data/engine/captures` in `services/engine/.env`;
   - restarts the engine.
3. **Back up the files:** either an Azure snapshot of the disk (portal → the disk → *Create snapshot*, or a snapshot policy), or set `RCLONE_FILES_REMOTE` (and `FILES_DIR` if needed) in `/etc/default/fundhub-backup`: the nightly backup then copies new PDFs, raw pages and captures off the VM (only new files are sent; never pruned). The nightly `pg_dump` does not include the files.
4. **More space later:** Azure portal → the disk → *Size + performance* → enlarge it, then on the VM run `sudo resize2fs $(blkid -L fundhub-data)`. No downtime.

`sudo bash infra/vm/bin/health.sh` reports the disk's usage.

## Move the database to a data disk

1. Azure portal → VM → **Disks** → *Create and attach a new disk* (Standard SSD, 64 GB, same region). Then:
2. On the VM (check the new disk's name with `lsblk`; below it is `sdb`, a disk with **no** partitions):

```bash
sudo mkfs.ext4 -L fundhub-pg /dev/sdb      # NOT fundhub-data: that label is the PDF disk
sudo systemctl stop fundhub-capture postgresql
sudo mkdir /mnt/newpg && sudo mount /dev/sdb /mnt/newpg
sudo rsync -aHAX /var/lib/postgresql/ /mnt/newpg/
sudo umount /mnt/newpg && sudo rmdir /mnt/newpg
echo 'LABEL=fundhub-pg /var/lib/postgresql ext4 defaults,nofail 0 2' | sudo tee -a /etc/fstab
sudo mv /var/lib/postgresql /var/lib/postgresql.old && sudo mkdir /var/lib/postgresql && sudo mount -a
sudo systemctl start postgresql fundhub-capture     # check, then: sudo rm -rf /var/lib/postgresql.old
```

Put `/var/backups` (or an rclone remote, see `backup-engine-db.sh`) somewhere other than the database disk.
