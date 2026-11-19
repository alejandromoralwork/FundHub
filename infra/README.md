# Infrastructure

| Folder | What | Guide |
|---|---|---|
| [`vm/`](vm/README.md) | The Azure VM: Caddy (HTTPS), Authelia (2FA), PostgreSQL 18 (engine DB), code-server, the engine receiver, data module timers, backups, Drive. Rebuilt by `vm/install.sh` | [vm/README.md](vm/README.md) |
| [`tools/`](tools/README.md) | Optional separate Docker server: Nextcloud, Twenty CRM, Listmonk | [tools/README.md](tools/README.md) |

Vercel (website, admin) and Neon (website DB) are configured in their dashboards: see [docs/operations.md](../docs/operations.md).
