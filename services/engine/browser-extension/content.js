/*
 * FILE: services/engine/browser-extension/content.js   (runs on LBR pages, isolated from LBR's own code)
 * WHAT IT DOES — only on pages YOU open:
 *   1. Auto-save: when a company page (…/consult-company/B…) or a search-results page has finished loading —
 *      and LBR's anti-robot check is NOT on screen — the page is sent to the FundHub engine (once per page
 *      state), together with the company data the page itself loaded (hook.js).
 *   2. Documents: every filing PDF the page receives is sent too, linked to the filing row you clicked.
 *   3. "Save all documents of this company" (or automatically, with the popup switch "Also save each company's
 *      documents when I open it"): opens that company's remaining documents one after another at a human pace
 *      (4–8 s). Stops by itself on LBR's check / access limit, or when you press Stop. Never leaves the page.
 *   4. The FundHub panel (bottom-right, can be minimised): this company in the engine (captured? filings,
 *      documents saved), progress, and the next companies — you choose; nothing opens by itself.
 */
(() => {
  const CHECK_RE = /captcha resolution|r[ée]solution du captcha|verifying\.\.\.|error occurred while validating the captcha|access limitation/i;
  const FILING_RE = /\bL\d{9}\b/;
  const ICON = chrome.runtime.getURL("icons/icon32.png");

  const settings = { enabled: true, autoDocs: false, keepLocalCopy: false, minimized: false, filter: "" };
  let lastKey = "";
  let apiData = [];
  let lastClick = { filing: null, at: 0 };
  let bulk = null; // { total, done, stop, waitingFor, resolve }
  let autoDocsDoneFor = null;
  /** Filings whose document was saved while this page is open (manual clicks or the run): never requested twice. */
  const savedFilings = new Set();
  const ui = { company: null, next: [], toast: "", note: "", stats: null, round: null, lastResult: null };

  const send = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r || { ok: false, error: chrome.runtime.lastError?.message || "no answer" })));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const pageKind = () => (/\/consult-company\//.test(location.pathname) ? "company" : /consult-search-list/.test(location.pathname + location.search) ? "list" : null);
  const rcsOfPage = () => (location.pathname.match(/consult-company\/([A-Za-z]\d{1,7})/) || [])[1] || null;

  // ---------------------------------------------------------------- panel (shadow DOM: LBR's CSS cannot touch it)
  const host = document.createElement("div");
  host.id = "fundhub-ext";
  const root = host.attachShadow({ mode: "open" });
  // The panel lives in a shadow root, so the body's innerText never includes it.
  const text = () => document.body?.innerText || "";
  const checkOnScreen = () => CHECK_RE.test(text());

  const CSS = `
    :host { all: initial; }
    .p { position: fixed; right: 14px; bottom: 14px; z-index: 2147483647; width: 340px; background: #fff; color: #14202e;
         border: 1px solid #d5dbe3; border-radius: 12px; box-shadow: 0 10px 28px rgba(11,42,74,.25);
         font: 12.5px/1.45 system-ui, "Segoe UI", Arial, sans-serif; overflow: hidden; }
    .h { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: #0b2a4a; color: #fff; }
    .h img { width: 20px; height: 20px; border-radius: 4px; }
    .h .t { font-weight: 650; flex: 1; }
    .dot { font-size: 11px; opacity: .9; }
    .x { background: transparent; border: 0; color: #fff; cursor: pointer; font-size: 14px; padding: 0 4px; }
    .b { padding: 8px 10px 10px; }
    .card { background: #f5f7fa; border-radius: 8px; padding: 7px 9px; margin-bottom: 8px; }
    .rcs { font-family: ui-monospace, Consolas, monospace; color: #0b2a4a; font-weight: 600; }
    .muted { color: #6b7785; font-size: 11.5px; }
    .ok { color: #0a7a3d; } .warn { color: #b45309; }
    .bar { height: 6px; background: #e4e8ee; border-radius: 3px; overflow: hidden; margin: 5px 0 2px; }
    .bar div { height: 100%; background: #f2b233; transition: width .3s; }
    .tag { display: inline-block; font-size: 10px; padding: 0 5px; border-radius: 8px; background: #e8f0fb; color: #0b5cad; margin-right: 4px; }
    .tag.sp { background: #fdf3dc; color: #8a5a00; }
    .btn { font: inherit; font-size: 12px; border: 1px solid #0b2a4a; background: #0b2a4a; color: #fff; border-radius: 6px; padding: 3px 9px; cursor: pointer; }
    .btn.ghost { background: #fff; color: #0b2a4a; }
    .row { display: flex; gap: 6px; align-items: center; justify-content: space-between; }
    .next { margin-top: 4px; }
    .next a { display: flex; gap: 8px; padding: 3px 4px; border-radius: 6px; color: inherit; text-decoration: none; }
    .next a:hover { background: #f5f7fa; }
    .next .n { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .toast { margin-top: 6px; }
    kbd { border: 1px solid #d5dbe3; border-bottom-width: 2px; border-radius: 4px; padding: 0 4px; font-size: 10.5px; background: #fff; }
    .round { border: 1px solid #0b2a4a; border-radius: 8px; padding: 6px 8px; margin-bottom: 8px; }
    .go { display: flex; flex-direction: column; gap: 2px; margin-top: 8px; padding: 8px 10px; border-radius: 8px; background: #0b2a4a; color: #fff; text-decoration: none; }
    .go:hover { background: #12406e; }
    .go .lbl { font-size: 10px; letter-spacing: .06em; text-transform: uppercase; opacity: .8; }
    .go .rcs2 { font-family: ui-monospace, Consolas, monospace; font-weight: 700; color: #f2b233; }
    .go .arrow { align-self: flex-end; font-weight: 650; color: #f2b233; }
  `;

  function render() {
    if (!document.body) return;
    if (!host.isConnected) document.body.appendChild(host);
    const kind = pageKind();
    const head = `<div class="h"><img src="${ICON}" alt=""><span class="t">FundHub capture</span>
      <span class="dot">${settings.enabled ? "● on" : "○ off"}</span><button class="x" id="min" title="${settings.minimized ? "Expand" : "Minimise"}">${settings.minimized ? "▢" : "–"}</button></div>`;
    if (settings.minimized) {
      root.innerHTML = `<style>${CSS}</style><div class="p" style="width:auto">${head}</div>`;
      root.getElementById("min").onclick = toggleMin;
      return;
    }
    let body = "";
    // The current capture round.
    if (ui.round) {
      const s = ui.round.stats;
      const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
      body += `<div class="round"><div class="row"><b>${esc(ui.round.name)}</b><span class="muted">${esc(s.done)} / ${esc(s.total)}</span></div>
        <div class="bar"><div style="width:${pct}%"></div></div>
        <div class="muted">changed ${esc(s.changed)} · unchanged ${esc(s.unchanged)} · new filings ${esc(s.new_filings)} · new PDFs ${esc(s.new_documents)}</div></div>`;
    }
    // This company in the engine.
    if (kind === "company") {
      const c = ui.company;
      const rcs = rcsOfPage();
      if (!c) body += `<div class="card"><span class="rcs">${esc(rcs)}</span> <span class="muted">not in the engine yet — saving when the page is ready</span></div>`;
      else {
        const docPct = c.with_docs ? Math.round((c.docs_saved / c.with_docs) * 100) : 0;
        body += `<div class="card">
          <div><span class="rcs">${esc(rcs)}</span> ${esc(c.name || "")}</div>
          <div>${c.sp ? '<span class="tag sp">service provider</span>' : ""}${c.kind === "asset_manager" ? '<span class="tag">asset manager</span>' : ""}<span class="muted">${esc(c.category || "")}</span></div>
          <div class="muted">${c.captured_at ? "✓ captured " + esc(new Date(c.captured_at).toLocaleString()) : "not captured yet"} · ${esc(c.filings)} filings · sources: ${esc((c.sources || []).join(", "))}</div>
          ${
            ui.lastResult && ui.lastResult.rcs === rcs
              ? `<div>${
                  ui.lastResult.status === "unchanged"
                    ? '<span class="muted">No change since the last pass.</span>'
                    : `<span class="ok">${ui.lastResult.status === "new" ? "New in the engine" : "Changed"}${ui.lastResult.newFilings ? ` · ${esc(ui.lastResult.newFilings)} new filings` : ""}</span>`
                }</div>`
              : ""
          }
          <div class="row"><span class="muted">Documents ${esc(c.docs_saved)}/${esc(c.with_docs)}</span><span class="muted">${docPct}%</span></div>
          <div class="bar"><div style="width:${docPct}%"></div></div>
          ${
            bulk
              ? `<div class="row"><span>📄 Saving documents ${bulk.done}/${bulk.total}…</span><button class="btn ghost" id="stop">Stop</button></div>`
              : c.with_docs > c.docs_saved
                ? `<button class="btn" id="bulk">Save all documents of this company</button>`
                : c.with_docs
                  ? `<span class="ok">All documents saved</span>`
                  : ""
          }
        </div>`;
      }
    } else if (kind === "list") body += `<div class="card muted">Search results are saved automatically (companies only; sole traders skipped).</div>`;
    else body += `<div class="card muted">Open a company page to save it.</div>`;
    if (ui.note) body += `<div class="warn">${esc(ui.note)}</div>`;
    if (ui.toast) body += `<div class="toast">${ui.toast}</div>`;
    // NEXT company — prominent; you click (or Alt+Shift+N). Nothing opens by itself.
    const nx = ui.next.find((c) => c.rcs !== rcsOfPage());
    if (nx)
      body += `<a href="#" class="go" data-open="${esc(nx.rcs)}"><span class="lbl">Next${ui.round ? " in round" : ""}</span>
        <span><span class="rcs2">${esc(nx.rcs)}</span> ${esc(nx.name || "")}</span><span class="arrow">Open →</span></a>
        <div class="muted" style="text-align:right">or <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd></div>`;
    else if (ui.round) body += `<div class="ok" style="margin-top:6px">Round complete — close it from the FundHub popup.</div>`;
    // Then the following ones.
    const rest = ui.next.filter((c) => c !== nx && c.rcs !== rcsOfPage());
    if (rest.length) {
      body += `<div class="row" style="margin-top:8px"><b>After that</b></div><div class="next">`;
      body += rest
        .slice(0, 4)
        .map((c) => `<a href="#" data-open="${esc(c.rcs)}"><span class="rcs">${esc(c.rcs)}</span><span class="n" title="${esc(c.name)}">${esc(c.name)}</span>${c.serviceProvider ? '<span class="tag sp">SP</span>' : ""}</a>`)
        .join("");
      body += "</div>";
    }
    if (ui.stats) body += `<div class="muted" style="margin-top:6px">Captured ${esc(ui.stats.captured)} · documents ${esc(ui.stats.docs_saved)} · ${esc(ui.stats.remaining)} left</div>`;
    root.innerHTML = `<style>${CSS}</style><div class="p">${head}<div class="b">${body}</div></div>`;
    root.getElementById("min").onclick = toggleMin;
    root.getElementById("bulk")?.addEventListener("click", saveAllDocuments);
    root.getElementById("stop")?.addEventListener("click", () => bulk && ((bulk.stop = true), (bulk.userStop = true)));
    root.querySelectorAll("[data-open]").forEach((a) =>
      a.addEventListener("click", (e) => {
        e.preventDefault();
        send({ type: "open", rcs: a.dataset.open });
      }),
    );
  }
  function toggleMin() {
    settings.minimized = !settings.minimized;
    chrome.storage.local.set({ minimized: settings.minimized });
    render();
  }
  const toast = (html) => {
    ui.toast = html;
    render();
  };

  async function refresh() {
    const rcs = rcsOfPage();
    const [q, st, co] = await Promise.all([
      send({ type: "queue", n: 6, filter: settings.filter }),
      send({ type: "stats" }),
      rcs ? send({ type: "company", rcs }) : Promise.resolve(null),
    ]);
    if (!q.ok) ui.note = "FundHub engine not reachable — start: node --import tsx src/cli.ts capture-server";
    else if (ui.note.startsWith("FundHub engine")) ui.note = "";
    ui.next = q.items || [];
    ui.round = q.round || null;
    ui.stats = st.stats || null;
    ui.company = co && co.company ? co.company : null;
    render();
  }

  // Tell hook.js (in the page) whether LBR's own extra download of each document should be skipped.
  const sendCfg = () => window.postMessage({ __fundhubCfg: true, suppressDownloads: settings.enabled && !settings.keepLocalCopy }, location.origin);

  chrome.storage.local.get(settings, (v) => {
    Object.assign(settings, v);
    sendCfg();
    refresh();
  });
  chrome.storage.onChanged.addListener((c) => {
    for (const k of Object.keys(c)) if (k in settings) settings[k] = c[k].newValue;
    sendCfg();
    if (c.filter) refresh();
    else render();
  });

  // ---------------------------------------------------------------- 1. auto-save pages
  let capturing = false;
  /**
   * Saves the page when it is ready. `force` = save even if this exact page state was already sent
   * (used before "Save all documents", so the company's filings are known).
   * @returns the receiver's answer, or null when nothing was sent.
   */
  async function maybeCapture(force = false) {
    if (!settings.enabled || capturing) return null;
    const kind = pageKind();
    if (!kind) return null;
    const t = text();
    if (CHECK_RE.test(t)) {
      ui.note = "Waiting for LBR's check — complete it on the page.";
      render();
      return null;
    }
    if (ui.note.startsWith("Waiting for LBR")) ui.note = "";
    // Never save a page the browser has translated (Google Translate marks <html> with "translated-ltr/rtl").
    if (/translated-(ltr|rtl)/.test(document.documentElement.className)) {
      ui.note = "This page is translated by the browser — choose \"Show original\" so FundHub saves LBR's own text.";
      render();
      return null;
    }
    if (ui.note.startsWith("This page is translated")) ui.note = "";
    // A company is saved from its "List of filings" tab (the filings are part of what we record).
    // Struck-off companies ("radiée", with a Deletion date) may have no filings list: save them anyway.
    const filingsShown = /consult the filing|filing n°/i.test(t) || /deletion date|date de radiation/i.test(t);
    const ready = kind === "list" ? /\d+ search result\(s\)/i.test(t) : /registration date/i.test(t) && /legal form/i.test(t) && filingsShown;
    if (!ready) {
      if (kind === "company" && /registration date/i.test(t) && !filingsShown && !ui.note) {
        ui.note = 'Open the "List of filings" tab to save this company.';
        render();
      }
      return null;
    }
    if (ui.note.startsWith('Open the "List of filings"')) ui.note = "";
    const key = location.href + "|" + t.length + "|" + ((t.match(FILING_RE) || [])[0] || "");
    if (key === lastKey && !force) return null;
    lastKey = key;
    capturing = true;
    try {
      return await sendCapture(kind, t);
    } finally {
      capturing = false;
    }
  }

  async function sendCapture(kind, t) {
    const payload = { url: location.href, text: t, html: document.documentElement.outerHTML, api: apiData.slice(-5) };
    const r = await send({ type: "capture", payload });
    if (r.ok && r.rcs) ui.lastResult = { rcs: r.rcs, status: r.status, newFilings: r.newFilings || 0 };
    if (r.ok)
      toast(
        r.kind === "list"
          ? `<span class="ok">✓ Search list: ${esc(r.companies)} companies saved</span>`
          : `<span class="ok">✓ ${esc(r.rcs)} saved — ${esc(r.status)} (${esc(r.filings)} filings${r.linkedDocuments ? `, ${esc(r.linkedDocuments)} documents linked` : ""})</span>`,
      );
    else toast(`<span class="warn">⚠ ${esc(r.rcs || "")} ${esc(r.error)}</span>`);
    await refresh();
    // An interrupted "Save all documents" for this company? Continue it (already-saved documents are skipped).
    if (kind === "company" && r.ok) await maybeResumeBulk();
    // Optional: save this company's documents straight away (only for the page you opened, once).
    if (settings.autoDocs && kind === "company" && r.ok && autoDocsDoneFor !== rcsOfPage() && ui.company && ui.company.with_docs > ui.company.docs_saved) {
      autoDocsDoneFor = rcsOfPage();
      saveAllDocuments();
    }
    return r;
  }

  // The portal is a single-page app that keeps changing (widgets, animations): a plain "wait until quiet" timer
  // would never fire. So: try 1.5 s after a change, but never later than 4 s after the first pending change,
  // and also check every 3 s (cheap: nothing is sent unless the page state is new).
  let timer = null;
  let firstPending = 0;
  const schedule = () => {
    const now = Date.now();
    if (!firstPending) firstPending = now;
    clearTimeout(timer);
    const wait = Math.max(0, Math.min(1500, 4000 - (now - firstPending)));
    timer = setTimeout(() => {
      firstPending = 0;
      maybeCapture();
    }, wait);
  };
  setInterval(() => maybeCapture(), 3000);
  new MutationObserver((muts) => {
    if (muts.every((m) => m.target === host || host.contains(m.target))) return; // our own panel
    schedule();
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  let href = location.href;
  setInterval(() => {
    if (location.href !== href) {
      href = location.href;
      apiData = [];
      lastKey = "";
      ui.toast = "";
      ui.company = null;
      if (bulk) bulk.stop = true;
      refresh();
      schedule();
    }
    if (!host.isConnected) render();
  }, 1000);

  // ---------------------------------------------------------------- 2. documents and data from hook.js
  document.addEventListener(
    "click",
    (e) => {
      if (e.target === host) return;
      const row = e.target.closest?.("tr, li, [role=row], .row") || e.target.parentElement;
      const m = row && (row.innerText || "").match(FILING_RE);
      if (m) lastClick = { filing: m[0], at: Date.now() };
    },
    true,
  );

  window.addEventListener("message", async (ev) => {
    if (ev.source !== window || !ev.data || !ev.data.__fundhub) return;
    const msg = ev.data;
    if (msg.kind === "api") {
      apiData.push({ url: msg.url, json: msg.json });
      return;
    }
    if (msg.kind === "pdf" && settings.enabled) {
      const filingNumber = (msg.url.match(FILING_RE) || [])[0] || (Date.now() - lastClick.at < 60_000 ? lastClick.filing : null);
      const r = await send({ type: "document", payload: { url: msg.url, contentType: msg.contentType, data: msg.data, filingNumber, rcs: rcsOfPage() } });
      if (r.ok) {
        if (filingNumber) savedFilings.add(filingNumber);
        if (ui.company && r.linked && !r.alreadySaved) ui.company.docs_saved += 1;
        toast(r.alreadySaved ? `<span class="muted">📄 ${esc(filingNumber)} was already saved — skipped</span>` : `<span class="ok">📄 ${esc(filingNumber || "document")} saved${r.linked ? "" : " (not linked to a filing)"}</span>`);
      } else toast(`<span class="warn">⚠ document: ${esc(r.error)}</span>`);
      if (bulk && bulk.waitingFor && (!filingNumber || filingNumber === bulk.waitingFor)) bulk.resolve(true);
    }
  });

  // ---------------------------------------------------------------- 3. save all documents of this company
  /**
   * The "consult the filing" control of a filing row. On LBR it is an SVG PDF icon
   * (`svg.fa-file-pdf[aria-label="Consult the filing"]`), not a link or button.
   */
  function consultControl(row) {
    return (
      row.querySelector('[aria-label="Consult the filing"], svg.fa-file-pdf, .pdf') ||
      [...row.querySelectorAll("a[href], button, [role=button], [tabindex]")].filter((el) => el.getClientRects().length > 0).pop() ||
      null
    );
  }
  /** Clicks any element, including SVG icons (SVG elements have no .click() method). */
  function clickElement(el) {
    el.scrollIntoView({ block: "center" });
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
  }
  /** Filing rows currently on the page: { filing, row } (first cell holds the filing number). */
  function filingRows() {
    const out = [];
    const seen = new Set();
    for (const row of document.querySelectorAll("tr")) {
      const first = row.querySelector("td");
      const t = (first?.textContent || "").trim();
      if (/^L\d{9}$/.test(t) && !seen.has(t)) {
        seen.add(t);
        out.push({ filing: t, row });
      }
    }
    return out;
  }

  async function saveAllDocuments() {
    const rcs = rcsOfPage();
    if (!rcs || bulk) return;
    let known = await send({ type: "filings", rcs });
    if (!known.filings || !known.filings.length) {
      // The company page is not saved yet: save it first, so documents are linked to their filings.
      await maybeCapture(true);
      known = await send({ type: "filings", rcs });
    }
    if (!known.filings || !known.filings.length) {
      ui.note = 'Save the company first: open its "List of filings" tab and wait for "✓ saved".';
      return render();
    }
    const todo = new Set(known.filings.filter((f) => f.has_documents && !f.saved).map((f) => f.filing_number));
    const rows = filingRows().filter((r) => todo.has(r.filing));
    if (!rows.length) {
      ui.note = todo.size ? `${todo.size} documents to save, but their rows are not on this page (scroll / show all filings?).` : "All documents of this company are already saved.";
      return render();
    }
    bulk = { total: rows.length, done: 0, stop: false, userStop: false, waitingFor: null, resolve: () => {} };
    // Remember the run: if the page is refreshed (or you come back later), it resumes by itself and skips what
    // is already saved. Only "Stop" or finishing forgets it.
    await chrome.storage.local.set({ bulkResume: { rcs, at: Date.now() } });
    let misses = 0;
    render();
    for (const { filing, row } of rows) {
      if (bulk.stop) break;
      // Saved meanwhile (opened by hand, or a late arrival)? Never request it twice.
      if (savedFilings.has(filing)) {
        bulk.done++;
        continue;
      }
      if (checkOnScreen()) {
        ui.note = "LBR is showing its check / a limit — stopped. Continue later with the same button.";
        break;
      }
      const ctl = consultControl(row);
      if (!ctl) {
        bulk.done++;
        continue;
      }
      const got = new Promise((resolve) => {
        bulk.waitingFor = filing;
        bulk.resolve = resolve;
        setTimeout(() => resolve(false), 20_000);
      });
      lastClick = { filing, at: Date.now() };
      clickElement(ctl);
      const ok = await got;
      if (!bulk) break;
      bulk.done++;
      misses = ok ? 0 : misses + 1;
      if (misses >= 2) {
        ui.note = "No document arrived for 2 filings in a row — open one document by hand so the flow can be checked. Stopped.";
        break;
      }
      render();
      await sleep(4000 + Math.random() * 4000); // human pace
    }
    const finished = bulk && !bulk.stop && bulk.done >= bulk.total;
    if (finished || (bulk && bulk.userStop)) await chrome.storage.local.remove("bulkResume");
    bulk = null;
    await refresh();
  }

  /** Resumes an interrupted "Save all documents" for this company (page refreshed / reopened within 12 h). */
  async function maybeResumeBulk() {
    const rcs = rcsOfPage();
    if (!rcs || bulk) return;
    const { bulkResume } = await chrome.storage.local.get("bulkResume");
    if (!bulkResume || bulkResume.rcs !== rcs || Date.now() - bulkResume.at > 12 * 3600_000) return;
    ui.toast = '<span class="ok">↻ Resuming document saving where it stopped…</span>';
    saveAllDocuments();
  }

  schedule();
})();
