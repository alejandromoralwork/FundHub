# Secrets: what exists, where, and what to keep safe

Every password, key and token FundHub depends on, where it lives, and what happens if it is lost. Use this to decide what goes into your password manager and what to back up off the VM. How to rotate each one: [access-and-recovery.md](access-and-recovery.md).

## 1. The rules

1. **One password manager is the source of truth** for everything that only a person knows (passwords, recovery codes, SSH key passphrase, the secrets bundle passphrase). Use a manager with its own 2FA (for example Proton Pass, Bitwarden or 1Password), in a vault called *FundHub*, and set up its emergency access / recovery kit.
2. **Never put a secret in**: git (`.env*` files are ignored, keep it that way), chats or AI assistants, email, tickets, the FundHub Drive (it lives on the same VM it would have to help you recover), screenshots.
3. **Paste connection strings only at hidden prompts** (`read -rsp …`), never as command-line arguments (they land in shell history).
4. **Anything pasted where it should not be is leaked**: rotate it right away ([access-and-recovery.md](access-and-recovery.md)).
5. **The VM is not a backup.** Anything that exists only on the VM is lost with it: keep the encrypted secrets bundle (§3) and off-VM data backups.

## 2. Inventory

**Must save — lost means locked out or data loss:**

| Secret | Lives in | If lost |
|---|---|---|
| Admin console password + authenticator (per staff) | Neon `staff_users` (hash) + phone | Another owner resets it; or terminal reset ([§1.1](access-and-recovery.md#11-reset-an-admin-password-from-the-terminal-locked-out-no-email)) |
| VM login password + authenticator (Authelia) | `/etc/authelia/users.yml` (hash) + phone | Reset over SSH ([§3](access-and-recovery.md#3-vm-login-authelia-2fa)) |
| **SSH private key** (+ its passphrase) | Your computer `~/.ssh/id_ed25519` | Azure portal → Reset SSH public key; keep a second key on another device |
| **Authelia storage key** `/etc/authelia-secrets/storage_encryption_key` | VM only | Registered authenticators can no longer be read: everyone re-registers (delete `/var/lib/authelia/db.sqlite3`) |
| **Metabase encryption key** `MB_ENCRYPTION_SECRET_KEY` in `/etc/metabase/metabase.env` | VM only | Stored data-source passwords can no longer be read: re-enter them (re-run `npm run bi:provision`) |
| **Drive JWT key** `FILEBROWSER_JWT_TOKEN_SECRET` in `/etc/fundhub-drive/secrets.env` | VM only | Drive refuses to start until its user database is reset (files are safe) |
| Cloud accounts + their **recovery codes**: Azure, Vercel, Neon, GitHub, domain registrar, Stripe, Resend, Anthropic | Each provider | Provider's own recovery; without recovery codes this can take days |
| Authenticator app backup | Phone | Enable cloud backup in the app, or register a second device everywhere |

**Save for convenience — can be regenerated:**

| Secret | Lives in | Regenerate |
|---|---|---|
| Extension token `CAPTURE_TOKEN` | `services/engine/.env` | New random value, restart `fundhub-capture`, update every extension |
| Engine DB password | `services/engine/.env`, `packages/engine-db/.env` | `ALTER ROLE fundhub_engine PASSWORD …` |
| Neon role passwords (`neondb_owner`, `fundhub_admin`, `fundhub_web`, `fundhub_scraper`, `fundhub_analyst_ro`) | Neon + Vercel env vars | Neon SQL Editor `ALTER ROLE …` (or `npm run db:roles`), then update Vercel and redeploy |
| Data module keys | `services/scraper/.env` | New key in the Anthropic console; role password as above |
| Stripe / Resend / Anthropic API keys, webhook secrets | Vercel env vars | Provider dashboard, then Vercel + redeploy |
| Authelia session and JWT secrets | `/etc/authelia-secrets/` | Any new random value (everyone logs in again) |
| Metabase embedding secret | `~/.fundhub-secrets/metabase-embed-secret` + Vercel `METABASE_EMBED_SECRET` | Delete the file, re-run `npm run bi:provision`, update Vercel |
| Metabase API key (`fundhub-console`) | Password manager + Vercel `METABASE_API_KEY` | Metabase → Admin → Authentication → API keys → regenerate, update Vercel |
| Metabase app DB / `fundhub_bi_ro` passwords | `/etc/metabase/metabase.env`, `~/.fundhub-secrets/bi-ro-db-url` | `ALTER ROLE …`, update the file (and re-run `bi:provision` for `fundhub_bi_ro`) |
| code-server password | `~/.config/code-server/config.yaml` | Edit, restart `code-server@alejandro` |

**Not secrets, but irreplaceable data** (back up off the VM): the engine database (nightly dumps in `/var/backups/fundhub-engine`), the Drive files (`/srv/fundhub-drive`), LBR captures and PDFs (`/srv/fundhub-data/engine/` once the data disk is set up, else `services/engine/.engine-data/`). The website database is protected by Neon's point-in-time restore.

## 3. The VM secrets bundle

The secrets that exist **only on the VM** are saved together in one encrypted file:

```bash
cd ~/projects/FundHub
sudo bash infra/vm/bin/export-secrets.sh     # asks for a passphrase twice
```

It writes `~/fundhub-vm-secrets-YYYYMMDD.tar.gz.gpg` (AES-256, protected by your passphrase) containing `/etc/authelia-secrets/`, `/etc/authelia/users.yml`, `/etc/fundhub-drive/secrets.env`, `services/engine/.env`, `packages/engine-db/.env`, `services/scraper/.env`, code-server's config and the backup settings. Then:

1. Download it (code-server: right-click the file → *Download*).
2. Store the file **and** its passphrase in the password manager.
3. Delete it from the VM: `rm ~/fundhub-vm-secrets-*.tar.gz.gpg`.
4. Make a new one after any change: new user, rotated token or password, rebuilt VM.

**Restore** on a new or rebuilt VM:

```bash
gpg -d fundhub-vm-secrets-YYYYMMDD.tar.gz.gpg | sudo tar -xzpf - -C /
sudo bash infra/vm/install.sh          # keeps the restored secrets, recreates everything else
```

## 4. Checklist

* [ ] Password manager with 2FA and an emergency kit; a *FundHub* vault.
* [ ] In it: admin console password, VM (Authelia) password, code-server password, SSH key passphrase, secrets-bundle passphrase.
* [ ] Recovery codes of: Azure, Vercel, Neon, GitHub, registrar, Stripe, Resend, Anthropic, and the password manager itself.
* [ ] Authenticator app backed up, or a second device registered.
* [ ] A second SSH key (another computer) in `~/.ssh/authorized_keys`.
* [ ] Latest VM secrets bundle stored (§3), and deleted from the VM.
* [ ] At least two admin console owners.
* [ ] Off-VM copies of the engine database dumps and the Drive files ([operations.md → Backups](operations.md#5-backups)).
* [ ] Every secret that was ever pasted into a chat has been rotated.
