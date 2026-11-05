# FundHub LBR Capture (Chrome extension)

The extension saves the LBR (RCS) pages and filing documents **you open** into the FundHub engine on your computer. It never searches, never moves from one company to the next by itself, and never touches LBR's anti-robot check. You browse LBR normally, and the extension does the copying.

## Install (once)

1. **Start the engine database**, in its own terminal, **from the repo root**:

   ```powershell
   cd C:\Users\pc\FundHub
   npm run engine:db:local
   ```

   If it says "already running", that's fine.
2. **Start the receiver**, in a second terminal:

   ```powershell
   cd C:\Users\pc\FundHub\services\engine
   node --import tsx src/cli.ts capture-server
   ```

   Run only one copy of each: a second copy fails because the port is already in use.
3. **Load the extension.** In Chrome, go to `chrome://extensions`, switch **Developer mode** on (top right), click **Load unpacked**, and choose the folder `services/engine/browser-extension`.
4. **Pin it** (puzzle-piece icon, then pin **FundHub LBR Capture**). After any change to the extension files, click **↻ Reload** on its card in `chrome://extensions`.

If you used the DevTools snippet before, you can delete it: the extension replaces it.

## Capture rounds (first full pass, then monthly updates)

Work in **rounds**. Each round is a list of companies to visit and a record of what was found. One round is active at a time.

| Round | Covers | What a visit saves |
|---|---|---|
| **Initial** | Companies known (GLEIF / CSSF) but never captured | Profile and all filings; documents if you save them |
| **Update** (e.g. monthly) | Companies already captured. Those most likely to have changed come first: another source changed, then recent filers, then service providers. "Skip if captured in the last N days" leaves out recent ones. | **Only changes.** An unchanged page writes nothing. Only **new filings' PDFs** are fetched, because documents already saved are skipped. |

**In the popup:**
* The **Round** card shows its name, progress and what was found (new / changed / unchanged / skipped / new filings / new PDFs).
* The big **NEXT** box shows the next company with an **Open next →** button.
* Buttons: **New…** (kind, scope: all / service providers / asset managers / name, skip-days), **Close** (archives the round), **Reset skipped** (puts skipped and failed companies back in the queue).

**In the panel on LBR pages:**
* the round's progress;
* the result for the current page ("No change since the last pass", or "Changed · 2 new filings");
* a large **Next in round → Open** button.

**Alt+Shift+N** opens the next company of the round.

**Register:** the admin console page **Scraping engine → Capture rounds** (`/admin/engine/rounds`) lists every round and its counts, plus each company's result. You can also use the CLI: `npm run engine -- round:list | round:status | round:start --kind update --scope sp --skip-days 20 | round:close | round:reset-skipped`.

Without an active round, the extension falls back to the list of never-captured companies.

## Use

1. Log in on https://www.lbr.lu as usual.
2. **Pick a company.** There are three ways:
   * The **popup** (the FundHub icon in the toolbar) lists the next companies with name, category and service-provider / asset-manager tags. You can filter it by service providers, asset managers, or name / B-number.
   * The **panel** on LBR pages (bottom right) shows the next 5.
   * The shortcut **Alt+Shift+N** opens the next company of the work list, using the popup's filter.

   Companies open on `…/consult-company/B…?tab=deposit`, the list of filings.
3. When the page has loaded and LBR's check is gone, the page is **saved automatically**: profile and filings. If LBR shows its check, the panel says so; complete it, and saving follows.
4. **Documents.**
   * Any document you open is saved and linked to its filing.
   * The panel's **Save all documents of this company** opens the remaining documents 4–8 s apart. It stops on LBR's check, an access limit, or **Stop**.
   * With the popup switch **Also save each company's documents when I open it**, this starts by itself on each company you open.

You can stop at any time. The work list skips everything already captured, so the next session continues where you left off.

**Interrupted document runs resume without duplicates.**
* If you refresh or close the page during **Save all documents**, the run continues by itself when you reopen that company (within 12 h).
* It only requests documents not saved yet.
* A document that arrives twice is recognised ("already saved — skipped") and is not stored or counted again.
* **Stop** ends the run for good. Click the button to start it again later.

**Don't let Chrome translate LBR pages.** The extension keeps LBR pages untranslated, and never saves a page the browser has translated. Translation would change company data (for example "Société à responsabilité limitée" → "Limited liability company") and record fake changes. If you see the note "This page is translated", choose **Show original**.

| Where | What it shows |
|---|---|
| Popup | Engine status; companies captured, documents saved, done today and left; progress against all known RCS numbers; the switches; the filterable list of next companies (Open, or ✕ to skip for this session) |
| Panel (minimise with –) | This company in the engine: whether it was captured, its filings, its sources (CSSF / GLEIF / RCS), documents saved with a progress bar; messages; the next companies; totals |
| Toolbar badge | Documents saved in this browser session |

Saving a **search-results page** stores every company on it (RCS number, name, struck off). Sole traders (A-numbers) are skipped, because their names are personal data.

The logo is generated by `scripts/make-icons.mjs`. To change it, edit the colours or shapes there, run `node scripts/make-icons.mjs`, then reload the extension.

## Where the data goes

| What | Where |
|---|---|
| Company profile, filings, history | Engine database. In the admin console: **Scraping engine → Registry**, then the company page (RCS filings tab). Or run `npm run engine -- entity B100554`. |
| Raw page captures (for re-import after parser updates) | `services/engine/.engine-data/captures/`. `rcs:import-captures` re-imports them. |
| PDFs | Object storage, `docs/<sha256>.pdf` (locally `services/engine/.engine-data/blobs/docs/`). Listed in the `documents` table and linked from `rcs_filings.document_sha256`. |

## Limits (on purpose)

* One company at a time, opened by you. Documents load at a human pace. The extension stops when LBR shows its check or an access limit.
* For **every** RCS company and all their documents, the route is the official LBR data extract: see `../docs/lbr-data-reuse-request.md`.
* Filing documents name directors and other people. Record the GDPR basis and a retention period for them.
