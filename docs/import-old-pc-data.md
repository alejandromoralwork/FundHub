# Push the old PC's scraped data into the new Intelligence DB

**Audience:** a Claude Code session running on the **old Windows PC** that holds FundHub's earlier LBR scraping work. It has no other context. Follow this file step by step and report back to the user at the checkpoints marked **⏸**.

**Goal:** get everything that cannot be fetched again into the new Intelligence DB on the Azure VM:
- LBR company pages captured by a person;
- LBR search-result lists;
- filing PDFs.

Everything else (GLEIF, CSSF, news, websites) the VM fetches by itself, so don't push it.

---

## 1. What changed since the old PC was used (read first)

- The engine database was **rebuilt with a new schema**. It used to be 24 tables in `public`. Now it has one Postgres schema per pipeline layer: `raw`, `staging`, `clean`, `match`, `core`, `mart`, `ops`.
  - **Never** restore the old `pg_dump` into the new DB, and never run `engine:db:migrate` / `engine:db:setup` against the old database. The old `infra/vm/README.md` section "Import the database from the old PC" is outdated.
- **Re-send the source material instead.** The VM pushes each page through the new pipeline (raw → staging → approval gate → clean → match → golden record), exactly as if the browser extension had just captured it. Companies, filings, identifiers and history are rebuilt from the pages.
- The receiver for that is the same HTTPS endpoint the Chrome extension uses, so **nothing has to be copied to the VM by hand** and no database port is needed.

## 2. The VM: addresses, ports, access

| What | Value |
|---|---|
| VM | Azure, Ubuntu 24.04, `D2as_v5` (2 vCPU, 8 GB), Spot. Auto-shutdown at 21:30, so it may be off: if every request times out, ask the user to start it in the Azure portal |
| Public name | `alejandro-code.centralindia.cloudapp.azure.com` |
| Capture receiver (use this) | `https://alejandro-code.centralindia.cloudapp.azure.com/engine/` → Caddy :443 → `capture-server` on `127.0.0.1:4477` (service `fundhub-capture`) |
| Receiver auth | Header `Authorization: Bearer <CAPTURE_TOKEN>`. Token is in `services/engine/.env` on the VM; the user can show it with `npm run capture:token` on the VM. It is also already stored in the old PC's Chrome extension (popup → Connection / Access token). |
| Receiver endpoints | `POST /engine/capture` (one LBR page or search list, JSON `{url, text, html}`), `POST /engine/document` (one PDF, JSON `{url, contentType, data(base64), filingNumber}`), `GET /engine/stats` (counts) |
| Body limit | 20 MB JSON per request (receiver), 25 MB (Caddy), so a PDF above ~14 MB can't be sent this way |
| Intelligence DB | PostgreSQL 18, database `fundhub_engine`, port **5432** |
| DB access from outside | Port 5432 accepts **only** login `fundhub_console`, over TLS (`sslmode=verify-full`), from the admin console on Vercel. Every other login is rejected (`pg_hba` reject). The owner `fundhub_engine` works only on the VM itself. **Don't use the DB port for this job**: use the receiver. |
| Other VM services | `/` code-server (VS Code in the browser), `/drive` Drive, `/bi` Metabase (Data intelligence) — all behind the Authelia 2FA login; `/authelia` login page. SSH on 22 with key only. |
| Engine on the VM | Repo at `/home/alejandro/projects/FundHub`; services `fundhub-engine-worker`, `fundhub-engine-scheduler`, `fundhub-capture`, `fundhub-metabase`; health check `sudo bash infra/vm/bin/health.sh` |
| State before the import (25 Nov 2026) | 1 LBR company page, 4 documents, 15 CSSF, 30 GLEIF, 374 news records, **no active capture round** |

## 3. The old PC: where the data is

The repo is at `C:\Users\pc\FundHub`; if it isn't there, search for the folder containing `services\engine\.engine-data`. All paths below are relative to the repo root.

| Data | Where | Push? |
|---|---|---|
| Captured LBR pages and search lists, one JSON file each (`{url, text, html, rcs?, capturedAt}`) | `services\engine\.engine-data\captures\*.json` | **Yes**, main source |
| Raw files and PDFs stored by the engine | `services\engine\.engine-data\blobs\` (path = `blobs\` + the DB's `blob_key`, e.g. `docs\ab\ab12…pdf`) | Yes: PDFs, and page bodies missing from `captures\` |
| Old engine database (embedded Postgres 18) | `packages\engine-db\.pg-data\`, served by `npm run engine:db:local` on **127.0.0.1:5434**, user `postgres`, password `postgres`, database `fundhub_engine` | Read only: it gives filing numbers for PDFs and finds pages not in `captures\` |
| Old tables used | `captures` (`blob_key`, `url`, `fetched_at`, `source_record_id`), `source_records` (`source`, `external_id`), `documents` (`sha256`, `blob_key`, `mime`, `filing_number`) | — |
| LuxTrust browser profile | `services\engine\.engine-data\rcs-profile\` | **Never** copy or send |

## 4. Steps

### 4.1 Safety copy ⏸

1. Stop anything using the old DB: close any terminal running `npm run engine:db:local` (Ctrl+C).
2. Copy `packages\engine-db\.pg-data` and `services\engine\.engine-data\captures` + `blobs` to a backup folder, for example `C:\Users\pc\fundhub-backup-<date>\`. Skip `rcs-profile`.
3. Tell the user the sizes and file counts. Continue once they confirm.

Don't `git pull` or `npm install` until the push is finished. If the repo must be updated to get this file, that's fine, but then still don't run any `engine:db:*` migrate/setup command.

### 4.2 Inventory ⏸

1. Start the old DB in its own terminal: `npm run engine:db:local`. Wait for it to say it's listening on 5434.
2. Count what exists, with `psql` or a short Node snippet using `pg`:
   ```sql
   select s.source, count(*) from captures c join source_records s on s.id = c.source_record_id group by 1 order by 1;
   select count(*), count(filing_number) from documents;
   select count(*) from source_records where source = 'rcs' and state = 'found';
   ```
   Also count `captures\*.json`, and the files under `blobs\docs\`.
3. Report the numbers to the user. Mention whether any `lbr_bulk` captures exist (official extract files). The script below doesn't send them; ask the user what to do.

### 4.3 Token and connection test ⏸

Ask the user to set the token **in their own terminal** so it never appears in the chat (PowerShell):
```powershell
$env:FUNDHUB_CAPTURE_TOKEN = '<paste token>'
```
Then test it:
```powershell
curl.exe -s -H "Authorization: Bearer $env:FUNDHUB_CAPTURE_TOKEN" https://alejandro-code.centralindia.cloudapp.azure.com/engine/stats
```
- **Expected:** `{"ok":true,"stats":{"captured":…}}`. Note the numbers; they're the "before" values.
- **401:** wrong token.
- **Timeout:** the VM is off.
- **502:** `fundhub-capture` is down; the user runs `sudo systemctl restart fundhub-capture` on the VM.

### 4.4 Dry run

Save the script from §5 as `push-old-data.mjs` in the repo root (don't commit it). Then:
```powershell
node push-old-data.mjs --dry-run
```
It reads everything and prints what it would send, without contacting the VM. Show the summary to the user.

### 4.5 Push captures, then documents ⏸

```powershell
node push-old-data.mjs --only=captures
node push-old-data.mjs --only=documents
```

- **Order:** captures first, because PDFs link to filings, which come from the company pages. A PDF sent before its filing is still stored, and the VM links it later.
- **Resumable:** progress is written to `.push-old-data\progress.jsonl`. Re-running skips what's already done, so after an interruption (VM shutdown, network) just run the same command again.
- **Speed:** about 1–3 pages per second. Search lists pause 2 s each, because the VM stores their companies in the background.
- **Stop and ask the user if:**
  - the script reports an **active capture round** on the VM;
  - you see **401**;
  - more than 5% of requests fail.

### 4.6 Verify ⏸

1. `GET /engine/stats` again and compare with §4.3: `captured`, `filings` and `docs_saved` should have grown by roughly the inventory numbers.
2. Report the script's summary, including the counts of `unchanged`, `skipped_translated`, `too_large` and errors.
3. The user checks in the admin: **Company intelligence → Companies**, and **Review → Staging approval**. LBR changes to legal facts may wait there for approval, depending on the review policy. Approving them, or setting the `rcs` policy to `auto` on the Sources page during the import, lets them flow on.
4. Don't delete anything on the old PC. The user decides about the backup after checking.

## 5. The script

Save it as `push-old-data.mjs` in the repo root. Node 20+ is required; it uses `pg` from the repo's `node_modules`.

```js
// push-old-data.mjs — sends the old PC's LBR captures and filing PDFs to the VM's capture receiver.
// Usage: node push-old-data.mjs [--dry-run] [--only=captures|documents]
// Env:   FUNDHUB_CAPTURE_TOKEN (required unless --dry-run)
//        FUNDHUB_VM_URL   (default https://alejandro-code.centralindia.cloudapp.azure.com/engine)
//        OLD_DB_URL       (default postgres://postgres:postgres@127.0.0.1:5434/fundhub_engine; optional)
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const require = createRequire(resolve("services/engine/package.json"));
const pg = require("pg");

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const ONLY = (args.find((a) => a.startsWith("--only=")) ?? "").split("=")[1] ?? "";
const VM = (process.env.FUNDHUB_VM_URL ?? "https://alejandro-code.centralindia.cloudapp.azure.com/engine").replace(/\/+$/, "");
const TOKEN = process.env.FUNDHUB_CAPTURE_TOKEN?.trim();
const OLD_DB = process.env.OLD_DB_URL ?? "postgres://postgres:postgres@127.0.0.1:5434/fundhub_engine";
const DATA = resolve("services/engine/.engine-data");
const CAPTURES = join(DATA, "captures");
const BLOBS = join(DATA, "blobs");
const STATE = resolve(".push-old-data");
const PROGRESS = join(STATE, "progress.jsonl");
const LBR = "https://www.lbr.lu";
const MAX_JSON = 19_000_000;

if (!DRY && !TOKEN) throw new Error("Set FUNDHUB_CAPTURE_TOKEN first (see §4.3).");
mkdirSync(STATE, { recursive: true });
const done = new Set(existsSync(PROGRESS) ? readFileSync(PROGRESS, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.ok).map((r) => r.key) : []);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = {};
const bump = (k, n = 1) => (stats[k] = (stats[k] ?? 0) + n);

async function oldDb() {
  const c = new pg.Client({ connectionString: OLD_DB });
  try { await c.connect(); return c; } catch (e) { console.warn(`! old DB not reachable (${e.message}); using files only`); return null; }
}

async function post(path, body) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${VM}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 401) throw Object.assign(new Error("401 unauthorized: wrong FUNDHUB_CAPTURE_TOKEN"), { fatal: true });
      if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status} ${json.error ?? ""}`);
      return { status: res.status, json };
    } catch (e) {
      if (e.fatal || attempt >= 5) throw e;
      const wait = 5_000 * attempt;
      console.warn(`  retry ${attempt} in ${wait / 1000}s: ${e.message}`);
      await sleep(wait);
    }
  }
}

function record(key, ok, extra) { appendFileSync(PROGRESS, JSON.stringify({ key, ok, at: new Date().toISOString(), ...extra }) + "\n"); }

// ---------- captures ----------
async function collectCaptures(db) {
  const items = new Map();
  const add = (body, at, from) => {
    if (!body?.url?.startsWith(LBR) || !body.text) return bump(`skipped_not_lbr_${from}`);
    if (/<html[^>]*class="[^"]*translated-(ltr|rtl)/i.test(body.html ?? "")) return bump("skipped_translated");
    const key = "cap:" + sha(body.url + "\n" + body.text);
    if (!items.has(key)) items.set(key, { key, at, body: { url: body.url, text: body.text, html: body.html ?? "" } });
  };
  if (existsSync(CAPTURES)) {
    for (const f of readdirSync(CAPTURES).filter((x) => x.endsWith(".json"))) {
      try {
        const p = join(CAPTURES, f);
        const b = JSON.parse(readFileSync(p, "utf8"));
        add(b, b.capturedAt ?? statSync(p).mtime.toISOString(), "file");
      } catch { bump("unreadable_file"); }
    }
  }
  if (db) {
    const { rows } = await db.query(`select c.blob_key, c.fetched_at from captures c join source_records s on s.id = c.source_record_id where s.source = 'rcs'`);
    for (const r of rows) {
      const p = join(BLOBS, r.blob_key);
      if (!existsSync(p)) { bump("db_capture_blob_missing"); continue; }
      try { add(JSON.parse(readFileSync(p, "utf8")), new Date(r.fetched_at).toISOString(), "db"); } catch { bump("db_capture_unreadable"); }
    }
  }
  // Oldest first: the newest version of a page is applied last, so it ends up current.
  return [...items.values()].sort((a, b) => a.at.localeCompare(b.at));
}

async function pushCaptures(db) {
  const items = await collectCaptures(db);
  const lists = items.filter((i) => /consult-search-list/i.test(i.body.url)).length;
  console.log(`captures: ${items.length} unique (${lists} search lists, ${items.length - lists} company pages), ${items.filter((i) => done.has(i.key)).length} already sent`);
  if (DRY) return;
  let n = 0;
  for (const it of items) {
    n++;
    if (done.has(it.key)) continue;
    const isList = /consult-search-list/i.test(it.body.url);
    try {
      const { status, json } = await post("/capture", it.body);
      // An active capture round on the VM would count these old pages as today's work: stop and let the user decide.
      if (json.round) throw Object.assign(new Error(`An LBR capture round is active on the VM ("${json.round.name}"). Ask the user to close it (npm run engine -- round:close) and re-run.`), { fatal: true });
      const ok = status === 200 && json.ok !== false;
      bump(ok ? (isList ? "list_sent" : `page_${json.status ?? "sent"}`) : "capture_refused");
      record(it.key, ok, { rcs: json.rcs, status: json.status, error: ok ? undefined : json.error });
      if (n % 25 === 0) console.log(`  ${n}/${items.length}`, JSON.stringify(stats));
    } catch (e) {
      if (e.fatal) throw e;
      bump("capture_failed");
      record(it.key, false, { error: e.message });
    }
    await sleep(isList ? 2000 : 300);
  }
}

// ---------- documents ----------
function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
}

async function pushDocuments(db) {
  const docs = new Map();
  if (db) {
    const { rows } = await db.query(`select sha256, blob_key, mime, filing_number from documents`);
    for (const r of rows) docs.set(r.sha256, { path: join(BLOBS, r.blob_key), mime: r.mime ?? "application/pdf", filing: r.filing_number });
  }
  // PDFs on disk that the DB does not list (or no DB): sent without a filing number.
  for (const p of walk(join(BLOBS, "docs"))) {
    const h = p.split(/[\\/]/).pop().split(".")[0];
    if (!docs.has(h)) docs.set(h, { path: p, mime: p.endsWith(".pdf") ? "application/pdf" : "application/octet-stream", filing: null });
  }
  const list = [...docs.entries()];
  console.log(`documents: ${list.length} (${list.filter(([, d]) => d.filing).length} with a filing number), ${list.filter(([h]) => done.has("doc:" + h)).length} already sent`);
  if (DRY) return;
  for (const [hash, d] of list) {
    const key = "doc:" + hash;
    if (done.has(key)) continue;
    if (!existsSync(d.path)) { bump("doc_file_missing"); record(key, false, { error: "file missing" }); continue; }
    const bytes = readFileSync(d.path);
    if (sha(bytes) !== hash) bump("doc_hash_mismatch");
    const data = bytes.toString("base64");
    if (data.length > MAX_JSON) { bump("doc_too_large"); record(key, false, { error: `too large (${bytes.length} bytes)`, path: d.path }); continue; }
    try {
      const { status, json } = await post("/document", { url: `${LBR}/old-pc-import/${d.filing ?? hash}`, contentType: d.mime, data, filingNumber: d.filing });
      const ok = status === 200 && json.ok !== false;
      bump(ok ? (json.alreadySaved ? "doc_already_on_vm" : json.linked ? "doc_linked" : "doc_stored_unlinked") : "doc_refused");
      record(key, ok, { filing: d.filing, error: ok ? undefined : json.error });
    } catch (e) {
      if (e.fatal) throw e;
      bump("doc_failed");
      record(key, false, { error: e.message });
    }
    await sleep(300);
  }
}

const db = await oldDb();
try {
  if (ONLY !== "documents") await pushCaptures(db);
  if (ONLY !== "captures") await pushDocuments(db);
} finally {
  await db?.end();
}
console.log("summary:", JSON.stringify(stats, null, 2));
if (!DRY) {
  const res = await fetch(`${VM}/stats`, { headers: { Authorization: `Bearer ${TOKEN}` } }).then((r) => r.json()).catch(() => null);
  console.log("VM stats now:", JSON.stringify(res?.stats ?? res));
}
```

## 6. Reading the results

| Count | Meaning |
|---|---|
| `page_new` / `page_changed` | Company page went through the whole pipeline (golden record created or updated) |
| `page_held` | Stored and waiting at the approval gate (Review → Staging approval), per the `rcs` review policy |
| `page_unchanged` | Identical content already on the VM. Fine. |
| `page_skipped` | The `rcs` source is disabled on the VM (Sources page): ask the user to enable it and re-run |
| `list_sent` | Search list accepted; its companies are stored in the background on the VM |
| `capture_refused` | The receiver rejected the page (see `error` in `progress.jsonl`), usually an unrecognised or logged-out page |
| `skipped_translated` | The page was translated by Chrome, so it isn't LBR's text. Never imported, by design. |
| `doc_linked` | PDF stored and attached to its filing |
| `doc_stored_unlinked` | PDF stored. Its filing isn't known yet; the VM links it when that company page arrives. |
| `doc_too_large` | Over ~14 MB. List them for the user. They can be opened again on LBR with the extension, or copied to the VM separately. |
| `db_capture_blob_missing` | The old DB lists a page whose raw file is gone. Not recoverable from this PC. |

## 7. If something goes wrong

| Symptom | Fix |
|---|---|
| `npm run engine:db:local` fails | Port 5434 busy: close the other Postgres. If `.pg-data` is damaged, use the backup copy from §4.1. Without the DB, the script still sends `captures\*.json` and PDFs from `blobs\docs` (PDFs without filing numbers). |
| All requests time out | The VM is off (Spot eviction or the 21:30 shutdown). The user starts it in Azure; then re-run, and progress resumes. |
| 502 Bad Gateway | `fundhub-capture` stopped on the VM: `sudo systemctl restart fundhub-capture` |
| 401 | Wrong token: `npm run capture:token` on the VM, then set it again (§4.3) |
| Many `capture_refused` | Send 2–3 examples from `progress.jsonl` (without the token) to the user. The LBR parser may need a fix on the VM; re-running afterwards resends only the failed ones. |
