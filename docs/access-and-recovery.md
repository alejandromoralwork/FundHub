# Access and recovery

How to give people access to each part of FundHub, take it away, and get back in when something is lost. Each section is self-contained: jump to the one you need. `<vm>` = `alejandro-code.centralindia.cloudapp.azure.com`; commands run from the repo folder on the VM (`cd ~/projects/FundHub`) unless stated.

## 0. Who logs in where

| Login | Protects | Who has one | Add / reset with |
|---|---|---|---|
| **Staff account** (password + authenticator) | Admin console `fundhub.lu/admin` | FundHub staff | Admin **Staff** page, or `npm run staff` ([§1](#1-admin-console-staff-accounts)) |
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
| Change your own password / authenticator | **Account** page |

**The owner is locked out** (lost phone, forgotten password, no other owner): use the command line with the production database.

```bash
# Production database URL with the owner/admin role (Vercel → fund-hub-admin → Settings → Environment Variables,
# or `vercel env pull`). Never commit it.
export DATABASE_URL='postgres://…'
npm run staff -w @fundhub/admin -- list
npm run staff -w @fundhub/admin -- reset-password you@fundhub.lu     # prints a temporary password once; the next login asks for your own
npm run staff -w @fundhub/admin -- reset-mfa you@fundhub.lu          # lost phone: set up 2FA again at next login
npm run staff -w @fundhub/admin -- create you@fundhub.lu "Your Name" owner   # a new owner, if needed
unset DATABASE_URL
```

Both resets sign the person out everywhere. The `DATABASE_URL` must be the **admin** or owner connection string (`fundhub_admin` / `neondb_owner`): the website's `fundhub_web` role is not allowed to read staff accounts, and the script then says *permission denied*. Its first output line shows which database and role it is using; `localhost:5433` means `DATABASE_URL` was not set in that terminal. Paste the string only at the hidden prompt (`read -rsp`), never into chats or files. Keep at least **two owners** so one can always reset the other.

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
