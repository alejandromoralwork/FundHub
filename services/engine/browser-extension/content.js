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
 *   5. Search sweep (popup tab "1 · Find companies" turns on sweepMode): on a search-results page, what the search found (companies new
 *      to FundHub, list full or not, words added) and a "Next search →" button. One click = one search; never
 *      automatic.
 */
(() => {
  const CHECK_RE = /captcha resolution|r[ée]solution du captcha|verifying\.\.\.|error occurred while validating the captcha|access limitation/i;
  const FILING_RE = /\bL\d{9}\b/;
  const ICON = chrome.runtime.getURL("icons/icon32.png");

  const settings = { enabled: true, autoDocs: false, keepLocalCopy: false, minimized: false, filter: "", sweepMode: false, autopilot: null };
  let lastKey = "";
  let apiData = [];
  let lastClick = { filing: null, at: 0 };
  let bulk = null; // { total, done, stop, waitingFor, resolve }
  let autoDocsDoneFor = null;
  /** Filings whose document was saved while this page is open (manual clicks or the run): never requested twice. */
  const savedFilings = new Set();
  let sweepKeyTarget = null; // the word Space / N would search now (null while the page is being booked)
  let sweepKeyBusy = false;
  const ui = { company: null, next: [], toast: "", note: "", stats: null, round: null, lastResult: null, sweepNext: [], sweepResult: null, sweepWarn: "" };

  const send = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r || { ok: false, error: chrome.runtime.lastError?.message || "no answer" })));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const pageKind = () => (/\/consult-company\//.test(location.pathname) ? "company" : /consult-search-list/.test(location.pathname + location.search) ? "list" : null);
  const currentSearch = () => (new URLSearchParams(location.search).get("search") || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
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
          <div class="row"><span class="muted" title="${esc(c.docs_filings || "")}">Key documents ${esc(c.docs_saved)}/${esc(c.with_docs)}</span><span class="muted">${docPct}%</span></div>
          <div class="bar"><div style="width:${docPct}%"></div></div>
          ${
            bulk
              ? `<div class="row"><span>📄 Saving documents ${bulk.done}/${bulk.total}…</span><button class="btn ghost" id="stop">Stop</button></div>`
              : c.docs_wanted === false
                ? `<span class="muted">Documents not kept for this company (only ${esc(c.docs_scope || "CSSF entities that are not funds")})</span>`
                : c.with_docs > c.docs_saved
                ? `<button class="btn" id="bulk">Save all documents of this company</button>`
                : c.with_docs
                  ? `<span class="ok">All documents saved</span>`
                  : ""
          }
        </div>`;
      }
    } else if (kind === "list") {
      const sw = ui.sweepResult;
      if (sw)
        body += `<div class="card"><div><span class="rcs">${esc(sw.term)}</span> <span class="ok">✓ done</span>${
          sw.capped ? ` <span class="muted">(list full: LBR shows only ${esc(sw.rows)} of them)</span>` : ""
        }</div><div class="muted">${esc(sw.rows)} companies · <b>${esc(sw.newNumbers)} new</b> to FundHub · +${esc(sw.addedWords)} words to search</div></div>`;
      else body += `<div class="card muted">Search results are saved automatically (companies only; sole traders skipped).</div>`;
    }
    else body += `<div class="card muted">Open a company page to save it.</div>`;
    if (ui.note) body += `<div class="warn">${esc(ui.note)}</div>`;
    if (ui.toast) body += `<div class="toast">${ui.toast}</div>`;
    if (ui.sweepWarn) body += `<div class="warn">${esc(ui.sweepWarn)}</div>`;
    // Sweep mode: NEXT search instead of the next company. One click = one search.
    const sx = settings.sweepMode ? ui.sweepNext.find((t) => t.term !== currentSearch()) : null;
    // On a results page, offer the next word only once this page is booked (otherwise the same word comes back).
    const waitBooking = settings.sweepMode && kind === "list" && currentSearch() && !ui.listAnswered;
    sweepKeyTarget = settings.sweepMode && !waitBooking ? sx : null;
    if (settings.sweepMode) {
      if (waitBooking) body += `<div class="muted" style="margin-top:6px">Saving this page… the next search appears in a moment.</div>`;
      else if (sx)
        body += `<a href="#" class="go" id="sweepGo"><span class="lbl">Next search (sweep)</span>
          <span><span class="rcs2">${esc(sx.term)}</span> ${sx.phase === 1 ? "common word" : sx.phase === 2 ? "letters" : "related names"} · in ${esc(sx.seen)} known names</span><span class="arrow">Search →</span></a>
          <div class="row"><a href="#" class="muted" id="sweepSkip">skip (<kbd>X</kbd>)</a><span class="muted">press <kbd>Space</kbd> or <kbd>N</kbd> — one key, no mouse</span></div>`;
      else if (ui.sweepError === "not found") body += `<div class="warn" style="margin-top:6px">The capture receiver is running old code: restart it (Ctrl+C, then start it again) to use the sweep.</div>`;
      else body += `<div class="ok" style="margin-top:6px">Search sweep complete (or not planned yet — see the FundHub popup).</div>`;
    }
    if (!settings.sweepMode) body += autopilotCard();
    // NEXT company — prominent; you click (or Alt+Shift+N), or the autopilot does.
    const nx = settings.sweepMode ? null : ui.next.find((c) => c.rcs !== rcsOfPage());
    if (nx)
      body += `<a href="#" class="go" data-open="${esc(nx.rcs)}"><span class="lbl">Next${ui.round ? " in round" : ""}</span>
        <span><span class="rcs2">${esc(nx.rcs)}</span> ${esc(nx.name || "")}</span><span class="arrow">Open →</span></a>
        <div class="muted" style="text-align:right">or <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd></div>`;
    else if (ui.round && !settings.sweepMode) body += `<div class="ok" style="margin-top:6px">Round complete — close it from the FundHub popup.</div>`;
    // Then the following ones.
    const rest = settings.sweepMode ? [] : ui.next.filter((c) => c !== nx && c.rcs !== rcsOfPage());
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
    root.getElementById("apStart")?.addEventListener("click", autopilotStart);
    root.getElementById("apStop")?.addEventListener("click", () => autopilotStop("Stopped by you."));
    root.getElementById("sweepGo")?.addEventListener("click", (e) => {
      e.preventDefault();
      send({ type: "open-sweep", item: sx });
    });
    root.getElementById("sweepSkip")?.addEventListener("click", async (e) => {
      e.preventDefault();
      await send({ type: "sweep-skip", term: sx.term });
      refresh();
    });
    root.querySelectorAll("[data-open]").forEach((a) =>
      a.addEventListener("click", (e) => {
        e.preventDefault();
        send({ type: "open", rcs: a.dataset.open });
      }),
    );
  }
  // Sweep keys — ONE key per search, so the wrist rests: Space / N = next search, X = skip the word.
  // Searches stay one per key press; the company autopilot (section 3) is the only thing that runs by itself.
  document.addEventListener(
    "keydown",
    async (e) => {
      if (!sweepKeyTarget || sweepKeyBusy || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
      const el = e.composedPath()[0];
      if (el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName || ""))) return;
      const k = e.key.toLowerCase();
      if (k !== " " && k !== "n" && k !== "x") return;
      e.preventDefault();
      const item = sweepKeyTarget;
      sweepKeyTarget = null; // one press = one action, even if the key bounces
      sweepKeyBusy = true;
      try {
        if (k === "x") {
          await send({ type: "sweep-skip", term: item.term });
          await refresh();
        } else await send({ type: "open-sweep", item });
      } finally {
        sweepKeyBusy = false;
      }
    },
    true,
  );
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
    const [q, st, co, sw] = await Promise.all([
      send({ type: "queue", n: 6, filter: settings.filter }),
      send({ type: "stats" }),
      rcs ? send({ type: "company", rcs }) : Promise.resolve(null),
      settings.sweepMode ? send({ type: "sweep", n: 3 }) : Promise.resolve(null),
    ]);
    ui.sweepNext = (sw && sw.next) || [];
    ui.sweepError = sw && !sw.ok ? sw.error : null;
    // A sweep search that LBR answered with a company page (exact match) instead of a results list.
    const { lastSweepOpen } = await chrome.storage.local.get("lastSweepOpen");
    ui.sweepWarn =
      rcs && lastSweepOpen && Date.now() - lastSweepOpen.at < 30_000
        ? `LBR opened a company page for the search "${lastSweepOpen.term}" (one exact match): it is saved; carry on with the next search.`
        : "";
    if (!q.ok) ui.note = "FundHub engine not reachable" + (q.error ? " — " + q.error : "") + ". Open the FundHub popup: it shows what is wrong and how to fix it.";
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
    if (c.filter || c.sweepMode) refresh();
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
      if (autopilotOn()) await autopilotStop("LBR is showing its check or an access limit. Autopilot paused: finish the check yourself, wait a while, then press Start again.");
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
    const ready = kind === "list" ? /\d+ search result\(s\)|your search was not successful|aucun r[ée]sultat/i.test(t) : /registration date/i.test(t) && /legal form/i.test(t) && filingsShown;
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
      // LBR shows the filings in pages of 200: add the rows of the other pages, so the engine gets the full list.
      const full = kind === "company" ? await withAllFilingPages(t) : t;
      return await sendCapture(kind, full);
    } finally {
      capturing = false;
    }
  }

  async function sendCapture(kind, t) {
    const payload = { url: location.href, text: t, html: document.documentElement.outerHTML, api: apiData.slice(-5) };
    const r = await send({ type: "capture", payload });
    if (r.ok && r.rcs) ui.lastResult = { rcs: r.rcs, status: r.status, newFilings: r.newFilings || 0 };
    if (r.ok && r.kind === "list") ui.sweepResult = r.sweep || null;
    if (kind === "list") ui.listAnswered = true;
    if (r.ok)
      toast(
        r.kind === "list"
          ? `<span class="ok">✓ Search list: ${esc(r.companies)} companies saved · ${esc(r.newNumbers ?? 0)} new to FundHub</span>`
          : `<span class="ok">✓ ${esc(r.rcs)} saved — ${esc(r.status)} (${esc(r.filings)} filings${r.linkedDocuments ? `, ${esc(r.linkedDocuments)} documents linked` : ""})</span>`,
      );
    else toast(`<span class="warn">⚠ ${esc(r.rcs || "")} ${esc(r.error)}</span>`);
    await refresh();
    // An interrupted "Save all documents" for this company? Continue it (already-saved documents are skipped).
    if (kind === "company" && r.ok) await maybeResumeBulk();
    // Optional: save this company's documents straight away (only for the page you opened, once).
    // Automatic documents only for companies in the document scope (DOCUMENT_SCOPE on the engine) and only the
    // kept filing types (the engine's /filings answer marks each filing "wanted").
    if (!autopilotOn() && settings.autoDocs && kind === "company" && r.ok && autoDocsDoneFor !== rcsOfPage() && ui.company && ui.company.docs_wanted !== false && ui.company.with_docs > ui.company.docs_saved) {
      autoDocsDoneFor = rcsOfPage();
      saveAllDocuments();
    }
    if (kind === "company") autopilotStep(r);
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
      ui.sweepResult = null;
      ui.listAnswered = false;
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
      // The document is in hand: let "Save all documents" click the next one while this one uploads.
      if (bulk && bulk.waitingFor && (!filingNumber || filingNumber === bulk.waitingFor)) bulk.resolve(true);
      const upload = send({ type: "document", payload: { url: msg.url, contentType: msg.contentType, data: msg.data, filingNumber, rcs: rcsOfPage() } });
      uploads.add(upload);
      const r = await upload.finally(() => uploads.delete(upload));
      if (r.ok) {
        if (filingNumber) savedFilings.add(filingNumber);
        if (ui.company && r.linked && !r.alreadySaved) ui.company.docs_saved += 1;
        toast(r.alreadySaved ? `<span class="muted">📄 ${esc(filingNumber)} was already saved — skipped</span>` : `<span class="ok">📄 ${esc(filingNumber || "document")} saved${r.linked ? "" : " (not linked to a filing)"}</span>`);
      } else toast(`<span class="warn">⚠ document: ${esc(r.error)}</span>`);
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

  // ---- the filings list is paginated (200 rows per page)
  /** Pause between two documents of "Save all documents". */
  const DOC_PAUSE_MS = [1500, 3000];
  /** Document uploads still on their way to the engine. */
  const uploads = new Set();
  const paginator = () => document.querySelector('[id$="_deposit-list-table_paginate"]');
  /** Highest page number shown in the paginator (1 when there is no paginator). */
  const filingPageCount = () => Math.max(1, ...[...(paginator()?.querySelectorAll("span.page") || [])].map((x) => Number(x.textContent.trim()) || 1));
  const firstFilingShown = () => (filingRows()[0] || {}).filing || null;
  /** Waits until the table shows other rows than `before` (the page changed); false after 10 s. */
  async function waitRowsChange(before) {
    for (let i = 0; i < 50; i++) {
      await sleep(200);
      const now = firstFilingShown();
      if (now && now !== before) return true;
    }
    return false;
  }
  /** Moves to the next filings page; false when there is none (or it did not load). */
  async function nextFilingsPage() {
    const next = paginator()?.querySelector(".fa-chevron-right.chevron-enabled");
    if (!next) return false;
    const before = firstFilingShown();
    clickElement(next);
    return waitRowsChange(before);
  }
  async function gotoFirstFilingsPage() {
    const one = [...(paginator()?.querySelectorAll("span.page") || [])].find((x) => x.textContent.trim() === "1");
    if (!one || one.classList.contains("text-decoration-underline")) return true;
    const before = firstFilingShown();
    clickElement(one);
    return waitRowsChange(before);
  }
  /** The rows on screen as page-text lines (filing no., date, type, details…), like the page's own text. */
  const rowsAsText = () =>
    filingRows()
      .map(({ row }) => [...row.cells].map((td) => (td.innerText || "").trim()).filter(Boolean).join("\n"))
      .join("\n");
  /**
   * Page text plus the rows of filings pages 2…n (inserted before the footer), then back to page 1.
   * Without a paginator: the text unchanged. If a page does not load: what was gathered, with a warning.
   */
  async function withAllFilingPages(t) {
    if (filingPageCount() <= 1 && !paginator()?.querySelector(".fa-chevron-right.chevron-enabled")) return t;
    const extra = [];
    let complete = true;
    for (let guard = 0; guard < 50; guard++) {
      if (!paginator()?.querySelector(".fa-chevron-right.chevron-enabled")) break;
      if (!(await nextFilingsPage())) {
        complete = false;
        break;
      }
      extra.push(rowsAsText());
    }
    await gotoFirstFilingsPage();
    if (!complete) toast('<span class="warn">⚠ Could not load every page of filings — saved what was shown. Save the page again later.</span>');
    if (!extra.length) return t;
    const footer = t.search(/\n\s*Site map\s*\n/i);
    return footer >= 0 ? t.slice(0, footer) + "\n" + extra.join("\n") + t.slice(footer) : t + "\n" + extra.join("\n");
  }

  async function saveAllDocuments() {
    const rcs = rcsOfPage();
    if (!rcs || bulk) return "busy";
    if (ui.company && ui.company.docs_wanted === false) return "nothing"; // not in the document scope
    let known = await send({ type: "filings", rcs });
    if (!known.filings || !known.filings.length) {
      // The company page is not saved yet: save it first, so documents are linked to their filings.
      await maybeCapture(true);
      known = await send({ type: "filings", rcs });
    }
    if (!known.filings || !known.filings.length) {
      ui.note = 'Save the company first: open its "List of filings" tab and wait for "✓ saved".';
      render();
      return "error";
    }
    // Only the filing types whose document the engine keeps (annual accounts, articles, registration, some modifications).
    const todo = new Set(known.filings.filter((f) => f.has_documents && !f.saved && f.wanted !== false).map((f) => f.filing_number));
    for (const f of savedFilings) todo.delete(f);
    if (!todo.size) {
      ui.note = "All key documents of this company are already saved.";
      render();
      return "nothing";
    }
    bulk = { total: todo.size, done: 0, stop: false, userStop: false, waitingFor: null, resolve: () => {} };
    // Remember the run: if the page is refreshed (or you come back later), it resumes by itself and skips what
    // is already saved. Only "Stop" or finishing forgets it.
    await chrome.storage.local.set({ bulkResume: { rcs, at: Date.now() } });
    let misses = 0;
    let outcome = "done";
    render();
    // The rows live on several pages of 200: start on page 1, then move page by page.
    if (filingPageCount() > 1) await gotoFirstFilingsPage();
    pages: for (;;) {
      for (const { filing, row } of filingRows().filter((x) => todo.has(x.filing))) {
        if (bulk.stop) break pages;
        todo.delete(filing);
        // Saved meanwhile (opened by hand, or a late arrival)? Never request it twice.
        if (savedFilings.has(filing)) {
          bulk.done++;
          continue;
        }
        if (checkOnScreen()) {
          ui.note = "LBR is showing its check / a limit — stopped. Continue later with the same button.";
          outcome = "blocked";
          break pages;
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
        const ok = await got; // resolves when the PDF reaches the page; its upload continues in the background
        if (!bulk) break pages;
        bulk.done++;
        misses = ok ? 0 : misses + 1;
        if (misses >= 2) {
          ui.note = "No document arrived for 2 filings in a row — open one document by hand so the flow can be checked. Stopped.";
          outcome = "error";
          break pages;
        }
        render();
        await sleep(DOC_PAUSE_MS[0] + Math.random() * (DOC_PAUSE_MS[1] - DOC_PAUSE_MS[0]));
      }
      if (bulk.stop || !todo.size || !(await nextFilingsPage())) break;
    }
    // Wait for the uploads still on their way to the engine before counting.
    await Promise.allSettled([...uploads]);
    if (outcome === "done" && todo.size && !bulk.stop) ui.note = `${todo.size} documents were not found on the filings pages (list changed?). Save the page again, then retry.`;
    const finished = bulk && !bulk.stop && bulk.done >= bulk.total;
    if (bulk && bulk.userStop) outcome = "stopped";
    if (finished || (bulk && bulk.userStop)) await chrome.storage.local.remove("bulkResume");
    bulk = null;
    await refresh();
    return outcome;
  }

  /** Resumes an interrupted "Save all documents" for this company (page refreshed / reopened within 12 h). */
  async function maybeResumeBulk() {
    const rcs = rcsOfPage();
    if (!rcs || bulk) return;
    const { bulkResume } = await chrome.storage.local.get("bulkResume");
    if (!bulkResume || bulkResume.rcs !== rcs || Date.now() - bulkResume.at > 12 * 3600_000) return;
    ui.toast = '<span class="ok">↻ Resuming document saving where it stopped…</span>';
    return saveAllDocuments();
  }

  // ---------------------------------------------------------------- 3. autopilot (optional)
  // Start → on each company page: wait for the auto-save, "Save all documents" (kept types, if in scope),
  // pause, then open the next company of the work list. It stops by itself on LBR's check or access limit
  // (never touches them; LBR dropped the captcha for certificate login, the access-limit page remains), after AUTOPILOT_MAX companies, after 3 failures in a row, or when the list is empty.
  // State lives in chrome.storage.local (settings.autopilot), so it survives the page loads it causes.
  const AUTOPILOT_MAX = 100; // companies per run
  const AUTOPILOT_PAUSE_MS = [20_000, 40_000]; // between two companies
  const AUTOPILOT_PAGE_TIMEOUT_MS = 90_000; // a company page that never becomes savable counts as a failure
  let apTimer = null;
  let apTick = null;
  let apNextAt = 0;
  let apBusy = false;
  let apWatchdog = null;
  const autopilotOn = () => !!(settings.autopilot && settings.autopilot.on);
  const apSave = (patch) => {
    settings.autopilot = { ...(settings.autopilot || {}), ...patch };
    return chrome.storage.local.set({ autopilot: settings.autopilot });
  };

  function autopilotCard() {
    const ap = settings.autopilot || {};
    if (!autopilotOn())
      return `<div class="card"><div class="row"><b>Autopilot</b><button class="btn" id="apStart">▶ Start</button></div>
        <div class="muted">Saves each company and its key documents, then opens the next one by itself (max ${AUTOPILOT_MAX} per run). Pauses on LBR's check.</div>
        ${ap.reason ? `<div class="muted">Last run: ${esc(ap.count || 0)} companies — ${esc(ap.reason)}</div>` : ""}</div>`;
    const secs = apNextAt ? Math.max(0, Math.round((apNextAt - Date.now()) / 1000)) : 0;
    const what = bulk ? "saving documents…" : apNextAt ? `next company in ${secs} s` : "saving this company…";
    return `<div class="card"><div class="row"><b>Autopilot ● running</b><button class="btn ghost" id="apStop">⏸ Stop</button></div>
      <div class="muted">${esc(ap.count || 0)}/${esc(ap.max || AUTOPILOT_MAX)} companies · ${esc(what)}</div></div>`;
  }

  async function autopilotStart() {
    await apSave({ on: true, count: 0, max: AUTOPILOT_MAX, fails: 0, startedAt: Date.now(), reason: "" });
    render();
    if (pageKind() === "company") {
      armWatchdog();
      const r = await maybeCapture(true); // runs autopilotStep when the page is savable
      if (!r && !capturing && !CHECK_RE.test(text())) render(); // not ready yet: the normal page watcher saves it
    } else await autopilotNext();
  }

  async function autopilotStop(reason) {
    clearTimeout(apTimer);
    clearInterval(apTick);
    clearTimeout(apWatchdog);
    apNextAt = 0;
    if (bulk) (bulk.stop = true), (bulk.userStop = true);
    await apSave({ on: false, reason });
    toast(`<span class="warn">Autopilot stopped — ${esc(reason)}</span>`);
  }

  /** A company page that never gets saved (layout, error page) must not hang the run. */
  function armWatchdog() {
    clearTimeout(apWatchdog);
    apWatchdog = setTimeout(async () => {
      if (!autopilotOn() || apBusy || bulk || apNextAt) return;
      if (CHECK_RE.test(text())) return autopilotStop("LBR is showing its check or an access limit.");
      await autopilotFailed(rcsOfPage(), "page did not become savable");
    }, AUTOPILOT_PAGE_TIMEOUT_MS);
  }

  async function autopilotFailed(rcs, why) {
    const fails = ((settings.autopilot && settings.autopilot.fails) || 0) + 1;
    await apSave({ fails });
    if (fails >= 3) return autopilotStop(`3 companies in a row failed (last: ${rcs || "?"}, ${why}).`);
    if (rcs) await send({ type: "skip", rcs }); // so the work list moves on
    await autopilotWaitThenNext();
  }

  /** After the page was saved: documents, then the next company. */
  async function autopilotStep(r) {
    if (!autopilotOn() || apBusy) return;
    apBusy = true;
    clearTimeout(apWatchdog);
    try {
      if (CHECK_RE.test(text())) return autopilotStop("LBR is showing its check or an access limit.");
      if (!r || !r.ok) return autopilotFailed(rcsOfPage(), (r && r.error) || "not saved");
      let outcome = "nothing";
      if (ui.company && ui.company.docs_wanted !== false && ui.company.with_docs > ui.company.docs_saved) outcome = await saveAllDocuments();
      if (!autopilotOn()) return; // stopped meanwhile
      if (outcome === "blocked") return autopilotStop("LBR is showing its check or an access limit.");
      if (outcome === "error") return autopilotFailed(rcsOfPage(), "documents did not arrive");
      const count = ((settings.autopilot && settings.autopilot.count) || 0) + 1;
      await apSave({ count, fails: 0 });
      if (count >= ((settings.autopilot && settings.autopilot.max) || AUTOPILOT_MAX)) return autopilotStop(`reached ${count} companies (one run). Press Start for more.`);
      await autopilotWaitThenNext();
    } finally {
      apBusy = false;
    }
  }

  async function autopilotWaitThenNext() {
    const [a, b] = AUTOPILOT_PAUSE_MS;
    apNextAt = Date.now() + a + Math.random() * (b - a);
    clearInterval(apTick);
    apTick = setInterval(render, 1000);
    render();
    clearTimeout(apTimer);
    apTimer = setTimeout(() => {
      clearInterval(apTick);
      apNextAt = 0;
      autopilotNext();
    }, apNextAt - Date.now());
  }

  async function autopilotNext() {
    if (!autopilotOn()) return;
    await refresh();
    const nx = ui.next.find((c) => c.rcs !== rcsOfPage());
    if (!nx) return autopilotStop(ui.round ? "the round is complete." : "the work list is empty.");
    await send({ type: "open-here", rcs: nx.rcs });
  }

  // A page opened by the autopilot: guard it, so a page that never becomes savable does not stop the run.
  if (pageKind() === "company")
    chrome.storage.local.get({ autopilot: null }, (v) => {
      if (v.autopilot && v.autopilot.on) armWatchdog();
    });

  schedule();
})();
