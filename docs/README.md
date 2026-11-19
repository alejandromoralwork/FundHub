# FundHub documentation

All project documentation starts here. Component READMEs stay next to their code and are linked below.

## Start here

| Document | Read it to… |
|---|---|
| [product.md](product.md) | Know what FundHub offers, to whom, and which admin module does what |
| [architecture.md](architecture.md) | Understand the parts, where each runs, the two databases, data flows, security, and known gaps |
| [codebase.md](codebase.md) | Find your way in the repo: every folder, conventions, how to make common changes |
| [development.md](development.md) | Set up a machine and run everything locally |
| [services.md](services.md) | Look up any module or service: what it does, where it runs, how to start, stop and check it |
| [operations.md](operations.md) | Deploy, run the Azure VM, the Drive, backups and secrets |
| [access-and-recovery.md](access-and-recovery.md) | Add or remove people anywhere, and get back in when a password, phone, key or server is lost |

## Component guides

| Component | Guide |
|---|---|
| Scraping engine (sources, pipeline, jobs, schedules, Docker) | [services/engine/README.md](../services/engine/README.md) |
| LBR capture extension (install, rounds, search sweep) | [services/engine/browser-extension/README.md](../services/engine/browser-extension/README.md) |
| Azure VM: install script, every config outside the repo, 2FA, restore, data disk | [infra/vm/README.md](../infra/vm/README.md) |
| LBR access findings · data-reuse request | [lbr-findings.md](../services/engine/docs/lbr-findings.md) · [lbr-data-reuse-request.md](../services/engine/docs/lbr-data-reuse-request.md) |
| Self-hosted tools: Nextcloud, Twenty, Listmonk | [infra/tools/README.md](../infra/tools/README.md) |
| Marketing pack (LaTeX, diagrams) | [marketing/README.md](../marketing/README.md) |

## Reference

* Environment variables: [`.env.example`](../.env.example) (website, admin) and [`services/engine/.env.example`](../services/engine/.env.example) (engine), each line commented.
* Database schemas: [`packages/db/src/schema.ts`](../packages/db/src/schema.ts) (website), [`packages/engine-db/src/schema.ts`](../packages/engine-db/src/schema.ts) (engine).
* Every source file starts with a header explaining what it does and where it runs.

## Keeping the docs useful

* One topic, one place: link instead of copying.
* Change the docs in the same commit as the code they describe.
* Architecture changes (a new part, database, or service) go into [architecture.md](architecture.md), including its *Known gaps* list.
