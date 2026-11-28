# FundHub LBR Capture (Chrome extension)

The extension saves the LBR (RCS) pages and filing documents **you open** into the FundHub engine on the Azure VM (or a local one). It never searches, never moves from one company to the next by itself, and never touches LBR's anti-robot check. You browse LBR normally, and the extension does the copying.

The work has two phases, and the popup has one tab for each:

| Tab | Phase | What you do | What the engine gets |
|---|---|---|---|
| **1 · Find companies** | Build the list of companies registered in Luxembourg | Click **Search on LBR →** (or press Space on the LBR page) word after word | Every company on each results page: RCS number, name, status |
| **2 · Capture filings** | Fill in each company | Work through a **round**: **Open on LBR →** company after company | Profile, every filing, and (optionally) every PDF |

The tab you pick also decides what the panel on LBR pages offers next: a search (tab 1) or a company (tab 2).

## Set up in 5 minutes

1. **Get the files on your PC**: clone or pull the repo, or download the folder `services/engine/browser-extension` from code-server (right-click → Download).
2. **Load it in Chrome**: `chrome://extensions` → switch on **Developer mode** (top right) → **Load unpacked** → choose the folder.
3. **Pin it**: puzzle-piece icon in the toolbar → pin **FundHub LBR Capture**.
4. **Get the token**: in code-server on the VM, open a terminal and run `npm run capture:token`. Copy the value.
5. **Connect**: click the extension icon. The setup screen asks for the engine address (keep the default) and the token. Paste it and click **Connect**. The header turns green: **Connected**.
6. **Log in on https://www.lbr.lu**, then use tab 1 or tab 2.

If **Connect** fails, the popup says why and what to do:

| Popup says | Fix |
|---|---|
| The access token is missing or wrong | Copy it again with `npm run capture:token` |
| The VM answers, but the capture server is not running | code-server: **Terminal → Run Task → Capture server: start** (or `npm run capture:start`) |
| Cannot reach the VM | The VM is off (Azure portal → Start) or you are offline |

After any change to the extension files, click **↻ Reload** on its card in `chrome://extensions`. Settings (⚙ in the popup header) hold the connection, the admin console address (for the Registry / Round register links), **Save the LBR pages I open** (switch off to browse without sending anything) and **Keep a copy of each PDF in Downloads**.

## How it is wired (VM)

The engine (database + receiver) runs on the **Azure VM** (`alejandro-code.centralindia.cloudapp.azure.com`). Chrome runs on your own PC and talks to it over HTTPS:

```
Chrome extension ──HTTPS :443──▶ Caddy  /engine/*  ──▶ capture-server 127.0.0.1:4477 ──▶ engine Postgres 127.0.0.1:5432
                  (Bearer token)        (on the VM)
```

No extra port is opened: only 443 (already used by code-server). Ports 4477 and 5432 stay private to the VM.

**On the VM** (already set up, both start on boot):

| Service | What | Commands |
|---|---|---|
| `postgresql@18-main` | Engine database (PostgreSQL 18, `fundhub_engine`), backed up nightly | see [infra/vm/README.md](../../../infra/vm/README.md) |
| `fundhub-capture` | The receiver (`engine capture-server`) | `sudo systemctl restart fundhub-capture` · logs: `journalctl -u fundhub-capture -f` |
| Caddy | HTTPS; `handle_path /engine/*` → `127.0.0.1:4477` | `/etc/caddy/Caddyfile`, `sudo systemctl reload caddy` |

The token lives in `services/engine/.env` (git-ignored) as `CAPTURE_TOKEN=…`. Show it with `grep CAPTURE_TOKEN services/engine/.env`. To change it, edit the file, `sudo systemctl restart fundhub-capture`, and paste the new one in the extension. Without a token the receiver refuses every request that came through the proxy.

After pulling new engine code: `sudo systemctl restart fundhub-capture`.

Start / restart / stop the receiver from code-server: **Terminal → Run Task → Capture server: …**, or `npm run capture:start | capture:restart | capture:stop | capture:status`.

**Local receiver instead** (engine on your own computer): run `npm run engine:db:local` and `npm run engine -- capture-server`, then on the setup screen open **Engine on this computer instead?** → **Use local receiver** (`http://127.0.0.1:4477`, no token needed).

If you used the DevTools snippet before, you can delete it: the extension replaces it.

## Capture rounds (first full pass, then monthly updates)

Work in **rounds**. Each round is a list of companies to visit and a record of what was found. One round is active at a time.

| Round | Covers | What a visit saves |
|---|---|---|
| **Initial** | Companies known (GLEIF / CSSF) but never captured | Profile and all filings; documents if you save them |
| **Update** (e.g. monthly) | Companies already captured. Those most likely to have changed come first: another source changed, then recent filers, then service providers. "Skip if captured in the last N days" leaves out recent ones. | **Only changes.** An unchanged page writes nothing. Only **new filings' PDFs** are fetched, because documents already saved are skipped. |

**In the popup (tab 2 · Capture filings):**
* The **round** card shows its name, progress and what was found (new / changed / unchanged / skipped / new filings / new PDFs).
* The dark **Next company** box has the **Open on LBR →** button.
* Round buttons: **New round…** (kind, which companies: all / service providers / asset managers / CSSF entities / name, skip-days), **Close round** (archives it), **Reset skipped** (puts skipped and failed companies back in the queue).
* **Also save every PDF of each company I open**: fetches the documents not saved yet, a few seconds apart.
* **Up next** (fold-out): the following companies, each with Open or ✕ (skip).

**In the panel on LBR pages:**
* the round's progress;
* the result for the current page ("No change since the last pass", or "Changed · 2 new filings");
* a large **Next in round → Open** button.

**Alt+Shift+N** opens the next company of the round.

**Register:** the admin console page **Scraping engine → Capture rounds** (`/admin/engine/rounds`) lists every round and its counts, plus each company's result. You can also use the CLI: `npm run engine -- round:list | round:status | round:start --kind update --scope sp --skip-days 20 | round:close | round:reset-skipped`.

Without an active round, the extension falls back to the list of never-captured companies.

## Search sweep (find the companies FundHub doesn't know yet)

GLEIF and the CSSF only list part of the RCS. The **search sweep** finds the rest by searching LBR for **words that appear in company names**, one click at a time. Each click does what typing the word in LBR's search box does, and the results page is saved automatically.

**How LBR's search behaves** (checked on real pages, Nov 2026), and why the sweep uses real words:
* an RCS number finds **only that exact company** ("B3168" → nothing, or one company), so numbers cannot be swept;
* text matches **whole words**, accents ignored: `ar` finds "AR CAPITAL" and every "S.**àr**.l.", but not "ARENDT". Prefixes such as `aa`, `ab`, `aaa` find nothing useful;
* a list shows **at most 199** companies.

**How the plan works** (three phases, in this order)
1. **Common words** (~1,700): words in at least 20 known names ("global", "equity", "lux", "holding"…), most common first. Each one fills a page with 199 companies.
2. **Letters** (~17,900): every two-letter word `aa`…`zz`, then every three-letter word `aaa`…`zzz`. These find the many short acronym names ("AA+ IMMO", "ABC S.A.") that no known name would suggest. Their lists are usually complete (under 199).
3. **Related names** (~25,000): the rarer words of known names, to find related companies ("arendt" → Arendt Digital Services next to Arendt Investor Services).

* **Snowball:** each results page adds the words of the names that were **new** to FundHub. A word moves to phase 1 once it is in 20 known names.
* A word whose list is full is marked **list full**: LBR has more companies with it than it shows. Those companies are reached through their other words.
* A search without results ("Your search was not successful") counts as done. Words that look like an RCS number (`b2`, `e123`) are never searched.
* **Speed:** the word is booked as soon as the page arrives, and the panel offers the next search straight away. The companies are stored in the background, 6 at a time. The receiver's terminal shows "↳ stored 199 companies of "fund" in 9.8 s". If the receiver stops before that, `npm run engine -- rcs:import-captures` stores the saved pages.
* About 45,000 searches in all. Early ones find the most new companies. A complete list only comes from the official LBR extract ([../docs/lbr-data-reuse-request.md](../docs/lbr-data-reuse-request.md)).

**Use**
1. Popup → tab **1 · Find companies** → **Prepare search list** (once). Or run `npm run engine -- sweep:plan` (repeat it now and then to add words from newly known names).
2. Being on tab 1 makes the panel on LBR pages offer **Next search →** instead of the next company.
3. Click **Search on LBR →** (or press **Alt+Shift+S**). When the list has loaded, the panel shows the result, for example "fund ✓ done · 199 companies · 23 new to FundHub · +41 words". Then the next one: on the LBR page just press **Space** (or **N**); **X** skips the word. One key per search, no mouse needed — each search is still started by you (LBR's captcha rules out unattended searching).
4. LBR's check appears as it does for any visitor. Wait for it, then carry on. **Skip** sets a word aside; **Bring back skipped words** (popup → Coverage by RCS prefix) brings them back. Any search you type yourself also counts.

**Merging into the registry.** Each row is stored as source `lbr_bulk` and resolved like any other record:
* a number the registry already has (from GLEIF / CSSF) is added to **that** entity, so there are no duplicates;
* a new number becomes a new entity;
* a name that matches an entity without an RCS number gives a **pending match** for review, never an automatic merge.

The list's status ("radiée", "en faillite"…) is recorded. An "unknown" status never overwrites a real one.

Progress: popup (words searched, companies found, numbers known per RCS prefix), or `npm run engine -- sweep:status`.

## Use

1. Log in on https://www.lbr.lu as usual.
2. **Pick a company.** There are three ways:
   * The **popup**, tab 2: **Open on LBR →**, or **Up next** for the following companies (without a round you can filter by service providers, asset managers, CSSF entities, or name / B-number).
   * The **panel** on LBR pages (bottom right) shows the next 5.
   * The shortcut **Alt+Shift+N** opens the next company of the work list, using the popup's filter.

   Companies open on `…/consult-company/B…?tab=deposit`, the list of filings.
3. When the page has loaded and LBR's check is gone, the page is **saved automatically**: profile and filings. If LBR shows its check, the panel says so; complete it, and saving follows.
4. **Documents.**
   * Any document you open is saved and linked to its filing.
   * The panel's **Save all documents of this company** (shown only for companies in the document scope — by default CSSF entities that are not funds, `DOCUMENT_SCOPE` on the engine) opens the remaining documents 4–8 s apart. It stops on LBR's check, an access limit, or **Stop**.
   * With the popup switch **Also save every PDF of each company I open** (tab 2), this starts by itself on each company you open.

You can stop at any time. The work list skips everything already captured, so the next session continues where you left off.

**Interrupted document runs resume without duplicates.**
* If you refresh or close the page during **Save all documents**, the run continues by itself when you reopen that company (within 12 h).
* It only requests documents not saved yet.
* A document that arrives twice is recognised ("already saved — skipped") and is not stored or counted again.
* **Stop** ends the run for good. Click the button to start it again later.

**Don't let Chrome translate LBR pages.** The extension keeps LBR pages untranslated, and never saves a page the browser has translated. Translation would change company data (for example "Société à responsabilité limitée" → "Limited liability company") and record fake changes. If you see the note "This page is translated", choose **Show original**.

| Where | What it shows |
|---|---|
| Popup | Connection status; companies known / captured, documents, saved today; tab 1 (search sweep) and tab 2 (rounds, next company, Up next list); ⚙ Settings |
| Panel (minimise with –) | This company in the engine: whether it was captured, its filings, its sources (CSSF / GLEIF / RCS), documents saved with a progress bar; messages; the next companies; totals |
| Toolbar badge | Documents saved in this browser session |

Saving a **search-results page** stores every company on it (RCS number, name, struck off). Sole traders (A-numbers) are skipped, because their names are personal data.

The logo is generated by `scripts/make-icons.mjs`. To change it, edit the colours or shapes there, run `node scripts/make-icons.mjs`, then reload the extension.

## Where the data goes

| What | Where |
|---|---|
| Company profile, filings, history | Engine database. In the admin console: **Scraping engine → Registry**, then the company page (RCS filings tab). Or run `npm run engine -- entity B100554`. |
| Raw page captures (for re-import after parser updates) | On the VM: `services/engine/.engine-data/captures/`. `rcs:import-captures` re-imports them. |
| PDFs | Object storage, `docs/<first 2 hex chars>/<sha256>.pdf`, each file stored once (on the VM: `/srv/fundhub-data/engine/blobs/docs/` once the data disk is set up). Listed in `raw.documents` (with the RCS number it was sent for) and linked from `clean.filings.document_sha256`. Kept only for the document scope (`DOCUMENT_SCOPE`, default: CSSF entities that are not funds). |

## Limits (on purpose)

* One company at a time, opened by you. Documents load at a human pace. The extension stops when LBR shows its check or an access limit.
* For **every** RCS company and all their documents, the route is the official LBR data extract: see `../docs/lbr-data-reuse-request.md`.
* Filing documents name directors and other people. Record the GDPR basis and a retention period for them.
