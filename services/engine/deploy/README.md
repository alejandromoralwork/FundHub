# Engine on the Azure VM

Copies of the VM's config live here so the setup can be rebuilt on a new VM. The backup units are symlinked into
`/etc/systemd/system/`; the others are copies (after editing one, copy it back to its system path).

| Piece | What | System path |
|---|---|---|
| PostgreSQL 18 (apt.postgresql.org, same major version as the embedded dev database) | Engine database `fundhub_engine`, role `fundhub_engine`, `127.0.0.1:5432` only | data: `/var/lib/postgresql/18/main`, tuning: `/etc/postgresql/18/main/conf.d/fundhub.conf` ← `postgresql-fundhub.conf` |
| `fundhub-capture.service` | Receiver for the browser extension (`engine capture-server`, `127.0.0.1:4477`) | `/etc/systemd/system/` |
| `Caddyfile` | HTTPS; `/engine/*` → receiver, everything else → code-server | `/etc/caddy/Caddyfile` |
| `fundhub-engine-backup.timer` + `.service` + `backup-engine-db.sh` | Nightly `pg_dump` at 03:30 UTC → `/var/backups/fundhub-engine/`, 14 days kept | symlinked |

Secrets (git-ignored): `services/engine/.env` (`CAPTURE_TOKEN`, `ENGINE_DATABASE_URL`) and
`packages/engine-db/.env` (`ENGINE_DATABASE_URL`, for `npm run engine:db:migrate`).

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
