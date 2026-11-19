# Engine on the Azure VM

Copies of the VM's config live here so the setup can be rebuilt on a new VM. The backup units are symlinked into
`/etc/systemd/system/`; the others are copies (after editing one, copy it back to its system path).

| Piece | What | System path |
|---|---|---|
| PostgreSQL 18 (apt.postgresql.org, same major version as the embedded dev database) | Engine database `fundhub_engine`, role `fundhub_engine`, `127.0.0.1:5432` only | data: `/var/lib/postgresql/18/main`, tuning: `/etc/postgresql/18/main/conf.d/fundhub.conf` ← `postgresql-fundhub.conf` |
| `fundhub-capture.service` | Receiver for the browser extension (`engine capture-server`, `127.0.0.1:4477`) | `/etc/systemd/system/` |
| `Caddyfile` | HTTPS; `/authelia*` → login portal, `/engine/*` → receiver (token), everything else → code-server behind 2FA | `/etc/caddy/Caddyfile` |
| Authelia (apt.authelia.com) | 2FA login portal: password + authenticator code, lockout after 3 failures | `/etc/authelia/configuration.yml` ← `authelia-configuration.example.yml` (secrets removed), users in `/etc/authelia/users.yml` |
| `fundhub-scraper-jobs.timer` / `-weekly.timer` + `.service` | Data module: queued "Run scrape" jobs every 5 min; AI web extraction Mondays 03:00 UTC. Skipped until `services/scraper/.env` exists | symlinked |
| `fundhub-drive.service` | Internal drive (file manager) on `127.0.0.1:8090`, files in `/srv/fundhub-drive`. **Not enabled yet**: see [docs/operations.md → Drive](../../../docs/operations.md#4-drive) | `/etc/systemd/system/` |
| `fundhub-engine-backup.timer` + `.service` + `backup-engine-db.sh` | Nightly `pg_dump` at 03:30 UTC → `/var/backups/fundhub-engine/`, 14 days kept | symlinked |

Secrets (git-ignored): `services/engine/.env` (`CAPTURE_TOKEN`, `ENGINE_DATABASE_URL`) and
`packages/engine-db/.env` (`ENGINE_DATABASE_URL`, for `npm run engine:db:migrate`).

## 2FA (Authelia)

Every browser request except `/engine/*` (the extension, which uses its token) and the portal itself needs an
Authelia session: password, then a 6-digit code from an authenticator app. 3 wrong tries in 5 min lock the user for
30 min. Sessions last 12 h (2 h idle). SSH (key only, passwords disabled) is the emergency way in.

* First password: `sudo cat /etc/authelia/initial-credentials`.
* Registering the authenticator sends a one-time code to a file (no email server):
  `sudo cat /var/lib/authelia/notification.txt`.
* Change the password: `authelia crypto hash generate argon2` → put the digest in `/etc/authelia/users.yml` →
  `sudo systemctl restart authelia`.
* Lost phone: `sudo -u authelia authelia storage user totp delete alejandro --config /etc/authelia/configuration.yml`,
  then register again.
* Locked out of the browser: SSH in, `sudo cp /etc/caddy/Caddyfile.bak-pre-authelia /etc/caddy/Caddyfile && sudo systemctl reload caddy`
  (removes the 2FA gate), fix, and put `Caddyfile` from this folder back.
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
