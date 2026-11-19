# Troubleshooting the VM

What to do when something on the Azure VM stops answering: how to get in, how to find what is broken, and how to fix each service. For people and passwords see [access-and-recovery.md](access-and-recovery.md); for what each service is see [services.md](services.md).

`<vm>` = `alejandro-code.centralindia.cloudapp.azure.com` (public IP `74.225.205.122`). VM user: `alejandro`.

## 1. Getting into the VM

There are three ways in. When the browser (code-server) does not work, use SSH; when SSH does not work either, use the Azure portal.

### 1.1 SSH from your computer (the normal emergency way)

The VM accepts **SSH keys only**: passwords are switched off, and the `alejandro` user has no password at all.

**Once, on each computer you will use** (Windows PowerShell, macOS or Linux terminal; `ssh` is built in):

```bash
ssh-keygen -t ed25519 -C "your-name laptop"     # Enter for the default file; set a passphrase
cat ~/.ssh/id_ed25519.pub                        # Windows: type $env:USERPROFILE\.ssh\id_ed25519.pub
```

Copy that one line (it starts with `ssh-ed25519`) and add it to the VM **while you still have access**: in a code-server terminal run `nano ~/.ssh/authorized_keys`, paste it on a new line, save. Without access: Azure portal → the VM → **Help → Reset password** → *Reset SSH public key*, user `alejandro`, paste the line.

**Connect:**

```bash
ssh alejandro@alejandro-code.centralindia.cloudapp.azure.com
```

First time it asks to trust the host key: answer `yes`. Optional shortcut in `~/.ssh/config` on your computer:

```
Host fundhub-vm
    HostName alejandro-code.centralindia.cloudapp.azure.com
    User alejandro
    IdentityFile ~/.ssh/id_ed25519
```

then just `ssh fundhub-vm`.

**Reach code-server through SSH**, skipping Authelia (for when the login portal is broken):

```bash
ssh -L 8080:127.0.0.1:8080 alejandro@alejandro-code.centralindia.cloudapp.azure.com
# keep it open, then browse http://localhost:8080 (password: grep password ~/.config/code-server/config.yaml on the VM)
```

| SSH says | Meaning | Fix |
|---|---|---|
| `Permission denied (publickey)` | Your key is not in `~/.ssh/authorized_keys` on the VM, or you used another key | Add it (above), or `ssh -i path/to/key …` |
| `Connection timed out` | VM stopped, or port 22 blocked | Azure portal: VM running? *Networking*: inbound rule for 22 |
| `REMOTE HOST IDENTIFICATION HAS CHANGED` | The VM was rebuilt (new host key), or something is in between | If you rebuilt it: `ssh-keygen -R alejandro-code.centralindia.cloudapp.azure.com`; otherwise stop and investigate |

### 1.2 Azure portal (no SSH, no browser)

* **Run command** (works without any login): portal → the VM → **Operations → Run command → RunShellScript**. Runs as root. Examples: `systemctl restart authelia`, `bash /home/alejandro/projects/FundHub/infra/vm/bin/health.sh`, or append a new SSH key: `echo 'ssh-ed25519 AAAA… you' >> /home/alejandro/.ssh/authorized_keys`.
* **Reset password → Reset SSH public key**: puts a new key in place for `alejandro`.
* **Restart / Start**: VM overview page. A restart is safe: every FundHub service starts on boot.
* **Serial console** needs a user with a password, which `alejandro` does not have; use Run command instead.

## 2. Find what is broken: the health check

```bash
cd ~/projects/FundHub && sudo bash infra/vm/bin/health.sh
```

It changes nothing. It checks every service and timer, the local ports, that Authelia and the Drive can read their secret files, that the public URLs answer as expected (`/authelia/` 200, `/` and `/drive/` 302 to the login, `/engine` 401 without token), the HTTPS certificate, disk, memory and the last backup. Every **FAIL** line prints the command that usually fixes it.

Other first checks:

```bash
systemctl --failed                                  # anything crashed
journalctl -b -p err --no-pager | tail -40          # errors since the last boot
sudo bash infra/vm/install.sh --diff                # did a config file drift from the repo?
uptime; last -x reboot | head -3                    # did the VM restart?
```

## 3. Service by service

The general pattern for any service `X`: `systemctl status X` (is it running?), `journalctl -u X -n 50 --no-pager` (why not?), fix, `sudo systemctl restart X`. If its config is the problem, re-apply the known-good one from the repo: `sudo bash infra/vm/install.sh`.

| Symptom | Likely cause | Check | Fix |
|---|---|---|---|
| Browser: site does not load at all | VM stopped, or Caddy down | Azure portal; `systemctl status caddy` | Start the VM; `sudo systemctl restart caddy` |
| Browser: "502 Bad Gateway" on the login page | Authelia down | `systemctl status authelia`; `journalctl -u authelia -n 50` | See **Authelia** below |
| Browser: "502" after logging in | code-server down | `systemctl status code-server@alejandro` | `sudo systemctl restart code-server@alejandro` |
| Login page loads but your password is refused | Wrong password, or you are blocked (3 tries) | `sudo bash infra/vm/bin/authelia-cli.sh storage bans user list` | [access-and-recovery.md §3](access-and-recovery.md#3-vm-login-authelia-2fa) |
| Logged in, but `/` says forbidden / loops to login | Your user is not in group `admins` | `sudo grep -A5 'alejandro:' /etc/authelia/users.yml` | Add `    groups: ['admins']`, `sudo systemctl restart authelia` |
| Drive page "502" | Drive down | `systemctl status fundhub-drive` | `sudo systemctl restart fundhub-drive`; "auth signing key … differs" in the log: the JWT key in `/etc/fundhub-drive/secrets.env` was changed, put the old value back (from your secrets backup) |
| Extension: "engine not reachable" | Receiver or database down | `systemctl status fundhub-capture postgresql@18-main` | `sudo systemctl restart postgresql@18-main fundhub-capture` |
| Extension: "unauthorized" | Token wrong in the popup | `grep CAPTURE_TOKEN services/engine/.env` | Paste it in the popup's **Connection** |
| Admin engine pages: "engine database not reachable" | Postgres down, or `ENGINE_DATABASE_URL` wrong | `systemctl status postgresql@18-main` | Restart it; check the URL |
| "Run scrape" jobs never run | `services/scraper/.env` missing, or timer stopped | `systemctl list-timers 'fundhub-*'`; `journalctl -u fundhub-scraper-jobs -n 30` | Create the `.env`; `sudo systemctl enable --now fundhub-scraper-jobs.timer` |
| No new backups | Backup failing | `journalctl -u fundhub-engine-backup -n 30` | Fix the error; `sudo systemctl start fundhub-engine-backup` |
| Everything slow, services killed | Out of memory (4 GB VM) | `free -m`; `journalctl -k | grep -i oom` | Close editor tabs / restart code-server; consider a bigger VM |
| Writes fail everywhere | Disk full | `df -h /` | Delete old dumps in `/var/backups/fundhub-engine`, old captures; grow the disk |

### Authelia

Authelia guards code-server and the Drive. If it is down, both are unreachable (502), but SSH still works.

1. `journalctl -u authelia -n 50 --no-pager` and look for `level=error` / `level=fatal`.
2. Typical messages:
   * `error loading secret path /etc/authelia-secrets/… permission denied` → `sudo chown -R authelia:authelia /etc/authelia-secrets && sudo chmod 700 /etc/authelia-secrets && sudo chmod 600 /etc/authelia-secrets/*`
   * an error about the **storage encryption key** (the key does not match the database) → the storage key changed: restore `/etc/authelia-secrets/storage_encryption_key` from your secrets backup (otherwise: delete `/var/lib/authelia/db.sqlite3` and everyone registers their authenticator again).
   * `error … configuration` → `sudo bash infra/vm/bin/authelia-cli.sh validate-config` shows which line; or re-apply the repo version with `sudo bash infra/vm/install.sh`.
   * `users.yml` errors (after a manual edit) → `sudo cp /etc/authelia/users.yml.bak /etc/authelia/users.yml` (the helper scripts keep that backup).
3. `sudo systemctl restart authelia`, then the health check.
4. Still broken and you need code-server now: the SSH tunnel in §1.1.

### Caddy

`caddy validate --config /etc/caddy/Caddyfile` shows syntax errors. **Do not edit `/etc/caddy/Caddyfile` by hand** to work around something: edit `infra/vm/caddy/Caddyfile` and run `sudo bash infra/vm/install.sh`, otherwise the next install overwrites the change. Certificate problems: `journalctl -u caddy | grep -i acme` (ports 80 and 443 must be open in Azure).

### PostgreSQL (engine database)

`systemctl status postgresql@18-main`, logs `sudo tail -50 /var/log/postgresql/postgresql-18-main.log`. Connect: `sudo -u postgres psql fundhub_engine`. Restore from backup: [infra/vm/README.md → Restore](../infra/vm/README.md#restore-a-backup).

## 4. Incident log

### 2026-11-19: Authelia down after a reboot (code-server and Drive unreachable)

* **What happened.** The VM restarted at 17:43 UTC. Authelia failed to start with `permission denied` on its three secret files, so Caddy could not check logins and code-server and the Drive returned errors. Fixed by hand at 18:00 (`chmod 700` on the folder).
* **Cause.** The Authelia package ships a boot-time rule, `/usr/lib/tmpfiles.d/authelia.conf` (`Z /etc/authelia/* 0640`), that resets everything under `/etc/authelia` to mode 0640 at **every boot**. The secrets had been placed in a subfolder, `/etc/authelia/secrets/`; mode 0640 on a folder removes the right to enter it, so the files became unreadable. It only showed after the first reboot, and the manual fix would have been undone at the next one.
* **Fix.** Secrets moved to `/etc/authelia-secrets/` (outside the package's rule); `install.sh` creates them there and migrates old installs. Verified by running the package's boot rule by hand and restarting Authelia. `health.sh` now checks that Authelia can read its secrets.
* **Lesson.** After installing or changing a system service, test a reboot (or at least `sudo systemd-tmpfiles --create`) before relying on it; and keep an independent way in (SSH key, Azure Run command).
