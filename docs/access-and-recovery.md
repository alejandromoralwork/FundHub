# Access and recovery

How to give people access to each part of FundHub, take it away, and get back in when something is lost. Each section is self-contained: jump to the one you need. `<vm>` = `alejandro-code.centralindia.cloudapp.azure.com`; commands run from the repo folder on the VM (`cd ~/projects/FundHub`) unless stated.

## 0. Who logs in where

| Login | Protects | Who has one | Add / reset with |
|---|---|---|---|
| **Staff account** (password + authenticator) | Admin console `fundhub.lu/admin` | FundHub staff | Admin **Staff** page, or from a terminal when locked out ([§1.1](#11-reset-an-admin-password-from-the-terminal-locked-out-no-email)) |
| **VM login** (Authelia: password + authenticator) | code-server (group `admins` only) and the Drive | People who need the Drive; admins | `infra/vm/bin/authelia-*.sh` ([§3](#3-vm-login-authelia-2fa)) |
| Drive account | Folder permissions in the Drive | Created automatically at first Drive visit | Drive *Settings → Users* ([§4](#4-drive)) |
| code-server password | Second lock behind Authelia | VM owner | `~/.config/code-server/config.yaml` ([§5](#5-code-server)) |
| **SSH key** | Terminal on the VM; the emergency way in | VM owner | Azure portal ([§6](#6-ssh-and-the-azure-vm)) |
| Extension token | Capture receiver `/engine` | Every Chrome extension install | `services/engine/.env` ([§7](#7-lbr-extension-token)) |
| Visitor / provider account | Website `/account` | The public | Self-service reset by email ([§2](#2-website-visitor-and-provider-accounts)) |
| Cloud accounts | Vercel, Neon, Azure, GitHub, Stripe, Resend, Anthropic, domain | Owner | Each provider ([§10](#10-cloud-and-third-party-accounts)) |

**Keep in a password manager:** your staff password, VM (Authelia) password, the authenticator backup/recovery codes of every service, the SSH private key, the extension token, and the recovery codes of each cloud account. Use an authenticator app that backs up or syncs its codes, or register a second device.

---

## 1. Admin console (staff accounts)

Roles: **owner** (everything, incl. Staff and Finance), **operations** (moderation, inbox, content, data, GDPR), **analyst** (data, engine, SQL, read-only), **sales** (inbox, email, content, billing). Full table: [services.md → Admin console](services.md#2-admin-console-appsadmin).

| Task | How |
|---|---|
| Add a person | Owner: **Staff** → add (email, name, role). A temporary password is shown once: send it privately. At first login they set up their authenticator, then **must choose their own password** before anything else |
| Change role / deactivate | **Staff** → the person's row. Deactivated people cannot log in; their history stays in the audit log |
| They forgot their password | Login page → *Forgot password* (email link; without an email service the link is in the admin's Vercel logs, search `email:console`), or owner: **Staff** → reset password. A reset gives a temporary password; at the next login (after the authenticator code) they are made to choose their own |
| They lost their phone | Owner: **Staff** → reset 2FA; at next login they register a new authenticator |
| Change your own password / authenticator | **Account** page (you stay signed in; other browsers are signed out). The **Staff** page has no reset buttons on your own row: a reset there would sign you out instantly |
| Locked out, no email, no other owner | From a terminal: [§1.1](#11-reset-an-admin-password-from-the-terminal-locked-out-no-email) |

### 1.1 Reset an admin password from the terminal (locked out, no email)

Use this when you cannot get in through the website: forgotten password, no reset email (email service not set up), lost phone, or no other owner to reset you. It works from **any terminal that has the repo**: the VM (code-server terminal, or SSH if the browser login is broken) or your own PC after `npm install`.

**Step 1 — Get the connection string that is allowed to change staff accounts.** It must use the role `neondb_owner` or `fundhub_admin`. Either:

* **Neon** (most reliable): https://console.neon.tech → the project → **Dashboard → Connect** → Database `neondb`, Role **`neondb_owner`**, and in the snippet menu choose **Connection string** (not *psql*, which wraps it as `psql '…'`) → **Copy** (copies the password even while it shows `****`); or
* **Vercel**: project **`fund-hub-admin`** (not `fund-hub`) → *Settings → Environment Variables* → `DATABASE_URL` → reveal → copy. Check it starts with `postgresql://fundhub_admin:` or `postgresql://neondb_owner:`.

> Do **not** use the website's string (`postgresql://fundhub_web:…`): that role is not allowed to read staff accounts.
> Never paste the string into a chat, email, document or file. If that happens, change that role's password (see [§8](#8-databases)).

**Step 2 — Open a terminal in the repo** and load the string without showing it:

```bash
cd ~/projects/FundHub                                  # on your PC: the folder where you cloned FundHub
read -rsp "Production DATABASE_URL: " DATABASE_URL; echo; export DATABASE_URL
```

Paste the string at the prompt and press **Enter**. Nothing appears while you paste: that is normal. Everything below must run **in this same terminal**.

**Step 3 — Find your exact staff email:**

```bash
npm run staff -w @fundhub/admin -- list
```

The first line must read `Database: ep-…neon.tech:5432 as neondb_owner` (or `fundhub_admin`). Then a table of staff accounts.

**Step 4 — Reset what you lost:**

```bash
npm run staff -w @fundhub/admin -- reset-password YOUR-STAFF-EMAIL     # forgotten password
npm run staff -w @fundhub/admin -- reset-mfa YOUR-STAFF-EMAIL          # lost phone / authenticator
```

`reset-password` prints a **temporary password once**: copy it immediately. Both sign the account out everywhere.
Nobody left who can log in at all? Create a new owner: `npm run staff -w @fundhub/admin -- create you@fundhub.lu "Your Name" owner`.

**Step 5 — Clear the string from the terminal:**

```bash
unset DATABASE_URL
```

**Step 6 — Log in:** https://fundhub.lu/admin/login with your email and the temporary password, then your authenticator code (after `reset-mfa`: scan the new QR code). The admin then shows **Choose your password**: set your own; you cannot use the console until you do.

**If it fails**

| The script says | Meaning | Fix |
|---|---|---|
| `Database: localhost:5433 …` and `ECONNREFUSED 127.0.0.1:5433` | `DATABASE_URL` is not set in this terminal (ran `unset` too early, or another terminal) | Redo step 2, then step 4, in the same terminal |
| `as fundhub_web` and `permission denied for table staff_users` | You used the website's connection string | Get the `neondb_owner` / `fundhub_admin` one (step 1) |
| `DATABASE_URL is not a valid connection string: …` (older versions: `Invalid URL`) | You pasted something other than the bare string, usually Neon's `psql '…'` snippet or a value with quotes/spaces | Copy only the part that starts with `postgresql://`, then redo step 2 |
| `password authentication failed` | The password in the string is wrong or was changed | Copy it again from Neon **Connect** |
| `No staff account for …` | Typo, or the account has another email | Run `list` (step 3) and use the exact email |
| `SECURITY WARNING: The SSL modes …` | Harmless notice from the database driver | Ignore |

**Locally** (your own development admin at `localhost:3001`), skip steps 1, 2 and 5: start the local database (`npm run db:local`) and run the same `npm run staff …` commands; they use the local database when `DATABASE_URL` is not set.

Keep at least **two owners**, so one can always reset the other from the **Staff** page without any of this.

## 2. Website visitor and provider accounts

Visitors sign up themselves at `/account/signup`. Forgotten password: `/account/forgot` sends a reset link by email (needs `RESEND_API_KEY`). Staff never see passwords. Provider access comes from a **company claim** approved in **Moderation → Company claims**. Delete or export a person's data through **GDPR requests**.

## 3. VM login (Authelia 2FA)

One login for the browser side of the VM. Members of group **`admins`** get code-server (a root shell on the VM: give it only to people who may control the whole server); everyone else gets the Drive only. 3 wrong tries in 5 minutes block the user for 30 minutes.

| Task | Command (on the VM) |
|---|---|
| Add a Drive user | `sudo bash infra/vm/bin/authelia-useradd.sh maria "Maria Lopez" maria@fundhub.lu` |
| Add an admin (Drive + code-server) | `sudo bash infra/vm/bin/authelia-useradd.sh maria "Maria Lopez" maria@fundhub.lu --admin` |
| First login of a new user | They open `https://<vm>/authelia/`, log in, choose *Register device*; Authelia "sends" a code by writing it to a file: `sudo cat /var/lib/authelia/notification.txt` → give it to them; they scan the QR code |
| Change a password | `sudo bash infra/vm/bin/authelia-passwd.sh <user>` (asks twice, restores the old file if anything fails) |
| Remove a user | Delete their block from `/etc/authelia/users.yml`, `sudo systemctl restart authelia`; also remove their Drive account (§4) |
| Make someone admin / not | Add or remove `    groups: ['admins']` in their block of `/etc/authelia/users.yml`, then restart Authelia |
| See who is blocked | `sudo bash infra/vm/bin/authelia-cli.sh storage bans user list` (and `… bans ip list`) |
| Lift a block | `sudo bash infra/vm/bin/authelia-cli.sh storage bans user revoke <user>` (or `… bans ip revoke <ip>`) |
| Lost phone | `sudo bash infra/vm/bin/authelia-cli.sh storage user totp delete <user>`, then they register a new device at next login |
| Logs | `journalctl -u authelia -f` |

### If you are locked out of the VM in the browser

You still have **SSH** (key only). In order of preference:

1. **Blocked after wrong tries:** SSH in, lift the block (table above), or wait 30 minutes. Don't keep trying while blocked: every attempt is refused and logged.
2. **Forgot the password / lost the phone:** SSH in, run `authelia-passwd.sh` / `totp delete` above.
3. **Authelia is broken or won't start:** reach code-server *through SSH*, which bypasses Authelia without exposing anything:
   ```bash
   ssh -L 8080:127.0.0.1:8080 alejandro@<vm>          # on your PC
   # then open http://localhost:8080 (code-server's own password: ~/.config/code-server/config.yaml)
   ```
   Fix it (`journalctl -u authelia -n 50`, `sudo bash infra/vm/bin/authelia-cli.sh validate-config`), or re-apply the known-good setup with `sudo bash infra/vm/install.sh`.
4. **No SSH either:** see [§6](#6-ssh-and-the-azure-vm).

## 4. Drive

The Drive uses the VM login (§3): there is no separate Drive password. A Drive account is created automatically the first time someone opens it.

| Task | How |
|---|---|
| Give someone the Drive | Add them to the VM login (§3, without `--admin`). At their first visit they get view, download, upload and edit, but not delete; adjust in Drive *Settings → Users* |
| No upload / delete buttons | Folder rights, not admin status, control these: Drive *Settings → Users* → the user → the `FundHub` source → tick create / modify / delete |
| Restrict folders | Drive *Settings → Users* → the user → access rules per folder (e.g. only `Clients` and `Marketing`) |
| Remove someone | Remove their VM login (§3), then delete their account in Drive *Settings → Users* |
| Drive admin | The VM user named in `adminUsername` (`infra/vm/drive/config.yaml`) |
| Drive won't start | `journalctl -u fundhub-drive -n 50`. "auth signing key … differs": `FILEBROWSER_JWT_TOKEN_SECRET` in `/etc/fundhub-drive/secrets.env` was changed — put the old value back (never rotate it) |
| Admin page says "Drive not configured" | Set `DRIVE_URL=https://<vm>/drive` on the admin project and redeploy |

Files are plain folders in `/srv/fundhub-drive`: even if the Drive app breaks, they are reachable over SSH.

## 5. code-server

Behind Authelia (group `admins`) **and** its own password. The password: `grep password ~/.config/code-server/config.yaml`. To change it, edit that file and `sudo systemctl restart code-server@alejandro`. If code-server does not load: `systemctl status code-server@alejandro`, `journalctl -u code-server@alejandro -n 50`; the SSH tunnel in §3 reaches it directly.

## 6. SSH and the Azure VM

SSH accepts **keys only** (passwords are disabled); bots trying passwords fail harmlessly.

| Situation | What to do |
|---|---|
| Add another person's / device's key | Append their **public** key to `~/.ssh/authorized_keys` on the VM |
| Lost your SSH key, still have the browser | In code-server's terminal, add a new public key to `~/.ssh/authorized_keys` |
| Lost the SSH key **and** the browser login | Azure portal → the VM → **Help → Reset password** → *Reset SSH public key* for user `alejandro`, paste a new public key. (Uses the Azure VM agent; the VM must be running) |
| VM does not answer at all | Azure portal → the VM → **Boot diagnostics** / **Serial console**; restart from the portal |
| Port blocked | Azure portal → VM → *Networking*: inbound rules must allow 22, 80, 443 |

**Losing the VM entirely** (deleted, disk lost): create a new Ubuntu 24.04 VM, install Node (nvm), clone the repo, `sudo bash infra/vm/install.sh` (recreates every service with new secrets), restore the engine DB from an off-VM backup ([infra/vm/README.md → Restore](../infra/vm/README.md#restore-a-backup)), copy back the Drive files, then give the extension the new token and re-register authenticators. This is why off-VM backups matter ([operations.md → Backups](operations.md#5-backups)).

## 7. LBR extension token

| Task | How |
|---|---|
| Find the token | `grep CAPTURE_TOKEN ~/projects/FundHub/services/engine/.env` |
| Set it in Chrome | Extension popup → **Connection** → Token → *Save & test* |
| Rotate it (leaked, person left) | `sed -i "s/^CAPTURE_TOKEN=.*/CAPTURE_TOKEN=$(openssl rand -hex 32)/" services/engine/.env && sudo systemctl restart fundhub-capture`, then update every extension install |
| "unauthorized" in the popup | Token missing or wrong in **Connection** |

## 8. Databases

| Situation | What to do |
|---|---|
| Engine DB password lost / leaked | `sudo -u postgres psql -c "alter role fundhub_engine password 'NEW'"`, update `ENGINE_DATABASE_URL` in `services/engine/.env` and `packages/engine-db/.env`, `sudo systemctl restart fundhub-capture` (and `ENGINE_DATABASE_URL` on the admin project if set) |
| Engine DB data lost | Restore last night's dump ([infra/vm/README.md → Restore](../infra/vm/README.md#restore-a-backup)) |
| Website DB role password leaked | Re-run `npm run db:roles -w @fundhub/db` with new passwords (see [operations.md](operations.md#2-deploying-the-website-and-admin)), update Vercel and `services/scraper/.env` |
| Website DB data lost | Neon console → point-in-time restore |

## 9. Data module key

`services/scraper/.env` holds the `fundhub_scraper` database URL and the Anthropic key. If leaked: rotate the key in the Anthropic console and the role password (§8), edit the file. The timers pick it up on the next run.

## 10. Cloud and third-party accounts

Turn on 2FA everywhere and store each service's **recovery codes** in the password manager. Recovery goes through the provider, not through FundHub.

| Account | Used for | If lost |
|---|---|---|
| Azure | The VM | Microsoft account recovery; add a second admin to the subscription |
| Vercel | Website and admin hosting, env vars | Vercel account recovery; add a team member |
| Neon | Website database | Neon account recovery (also reachable through the Vercel integration) |
| GitHub | The code | GitHub recovery codes; the VM and your PC still hold full clones |
| Domain registrar (`fundhub.lu`) | DNS, email routing | Registrar's recovery; keep the registrar login in the password manager |
| Stripe, Resend, Anthropic | Payments, email, AI | Provider recovery; rotate keys in Vercel / VM afterwards |

## 11. Someone leaves FundHub

1. Admin **Staff** → deactivate.
2. VM login: remove from `/etc/authelia/users.yml` (§3); Drive: delete their account (§4).
3. Remove their SSH key from `~/.ssh/authorized_keys` if they had one.
4. Rotate shared secrets they could have seen: extension token (§7); if they were an admin, also the engine DB password (§8) and any cloud keys.
5. Remove them from cloud accounts (Vercel team, Azure, GitHub, Neon, Stripe).
6. The **Audit log** keeps what they did.
