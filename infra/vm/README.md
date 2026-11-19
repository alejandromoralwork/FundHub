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
| `caddy/Caddyfile` | `/etc/caddy/Caddyfile` | HTTPS; `/authelia*` → login portal, `/engine/*` → receiver (token), everything else → code-server behind 2FA |
| `authelia/configuration.yml`, `authelia/override.conf` | `/etc/authelia/`, `/etc/systemd/system/authelia.service.d/` | 2FA portal (apt.authelia.com). Secrets in `/etc/authelia/secrets/*`, users in `/etc/authelia/users.yml` |
| `postgres/fundhub.conf` | `/etc/postgresql/18/main/conf.d/` | PostgreSQL 18 (apt.postgresql.org) tuning; database and role `fundhub_engine`, `127.0.0.1:5432` |
| `code-server/config.yaml.example` | `~/.config/code-server/config.yaml` (first install only) | code-server on `127.0.0.1:8080` |
| `systemd/fundhub-capture.service` | `/etc/systemd/system/` | Receiver for the browser extension (`engine capture-server`, `127.0.0.1:4477`) |
| `systemd/fundhub-engine-backup.{service,timer}`, `bin/backup-engine-db.sh` | `/etc/systemd/system/`, `/usr/local/lib/fundhub/` | Nightly `pg_dump` 03:30 UTC → `/var/backups/fundhub-engine/`, 14 days |
| `systemd/fundhub-scraper-{jobs,weekly}.{service,timer}` | `/etc/systemd/system/` | Data module: queued "Run scrape" jobs every 5 min; AI extraction Mondays 03:00 UTC. Skipped until `services/scraper/.env` exists |
| `systemd/fundhub-drive.service` | `/etc/systemd/system/` (not enabled) | Internal drive on `127.0.0.1:8090`, see [docs/operations.md → Drive](../../docs/operations.md#4-drive) |

Placeholders in these files (`@DOMAIN@`, `@USER@`, `@REPO@`, `@NODE_DIR@`) are filled in by `install.sh`; override with
`DOMAIN=… APP_USER=… NODE_DIR=… sudo -E bash infra/vm/install.sh`.

**Secrets are never in git.** `install.sh` creates them once and never overwrites them:

| Secret | File |
|---|---|
| Extension token, engine DB URL | `services/engine/.env` (`CAPTURE_TOKEN`, `ENGINE_DATABASE_URL`), `packages/engine-db/.env` |
| Data module | `services/scraper/.env` (you create it from `.env.example`) |
| Authelia | `/etc/authelia/secrets/*`, `/etc/authelia/users.yml`, first password in `/etc/authelia/initial-credentials` |
| code-server password | `~/.config/code-server/config.yaml` |

Not managed here: Azure itself (VM size, disks, network security group: ports 22/80/443 only), SSH keys, and the
Node.js install (nvm).

## 2FA (Authelia)

Every browser request except `/engine/*` (the extension, which uses its token) and the portal itself needs an
Authelia session: password, then a 6-digit code from an authenticator app. 3 wrong tries in 5 min lock the user for
30 min. Sessions last 12 h (2 h idle). SSH (key only, passwords disabled) is the emergency way in.

* First password: `sudo cat /etc/authelia/initial-credentials`.
* Registering the authenticator sends a one-time code to a file (no email server):
  `sudo cat /var/lib/authelia/notification.txt`.
* Change the password: `sudo bash infra/vm/bin/authelia-passwd.sh` (asks twice, restarts Authelia,
  restores the old file if Authelia does not start).
* Lost phone: `sudo -u authelia authelia storage user totp delete alejandro --config /etc/authelia/configuration.yml`,
  then register again.
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

```bash
sudo systemctl restart fundhub-capture          # after pulling engine code
journalctl -u fundhub-capture -f                # receiver log
npm run engine:db:migrate                       # after a schema change (from the repo root)
sudo systemctl start fundhub-engine-backup      # backup now
sudo ls -lh /var/backups/fundhub-engine         # backups
```

## Restore a backup

```bash
sudo systemctl stop fundhub-capture
sudo -u postgres dropdb fundhub_engine
sudo -u postgres createdb -O fundhub_engine -E UTF8 --lc-collate=C --lc-ctype=C -T template0 fundhub_engine
sudo -u postgres pg_restore --no-owner --role=fundhub_engine -d fundhub_engine /var/backups/fundhub-engine/<file>.dump
sudo systemctl start fundhub-capture
```

## Import the database from the old PC

The old PC's database is the embedded Postgres 18 folder `packages\engine-db\.pg-data` (the embedded server has no
`pg_dump`, so the dump is made here on the VM).

1. Old PC: **stop** `npm run engine:db:local` (Ctrl+C), then zip `packages\engine-db\.pg-data` and
   `services\engine\.engine-data\captures` + `blobs` (not `rcs-profile`).
2. Upload the zips to the VM (drag into code-server). Unzip so the folder is `packages/engine-db/.pg-data`, and the
   captures/blobs under `services/engine/.engine-data/`.
3. Start the old database on its own port, dump it, restore it into the VM's Postgres:

```bash
cd ~/projects/FundHub
npm run engine:db:local &                       # serves the copied folder on 127.0.0.1:5434
PGPASSWORD=postgres pg_dump -Fc -h 127.0.0.1 -p 5434 -U postgres -d fundhub_engine -f ~/engine-oldpc.dump
kill %1
# then "Restore a backup" above with ~/engine-oldpc.dump, then: npm run engine:db:migrate
```

If the copied folder does not start on Linux, dump it on the old PC instead: install the PostgreSQL 18
"Command Line Tools" (EDB installer, uncheck the server), run the same `pg_dump` against port 5434, upload the
`.dump`.

## Move the database to a data disk

1. Azure portal → VM → **Disks** → *Create and attach a new disk* (Standard SSD, 64 GB, same region). Then:
2. On the VM (check the new disk's name with `lsblk`; below it is `sdb`, a disk with **no** partitions):

```bash
sudo mkfs.ext4 -L fundhub-data /dev/sdb
sudo systemctl stop fundhub-capture postgresql
sudo mkdir /mnt/newpg && sudo mount /dev/sdb /mnt/newpg
sudo rsync -aHAX /var/lib/postgresql/ /mnt/newpg/
sudo umount /mnt/newpg && sudo rmdir /mnt/newpg
echo 'LABEL=fundhub-data /var/lib/postgresql ext4 defaults,nofail 0 2' | sudo tee -a /etc/fstab
sudo mv /var/lib/postgresql /var/lib/postgresql.old && sudo mkdir /var/lib/postgresql && sudo mount -a
sudo systemctl start postgresql fundhub-capture     # check, then: sudo rm -rf /var/lib/postgresql.old
```

Put `/var/backups` (or an rclone remote, see `backup-engine-db.sh`) somewhere other than the database disk.
