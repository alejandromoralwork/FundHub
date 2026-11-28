// FundHub LBR Capture — popup.
//   setup view    : shown until the engine answers; says exactly what is wrong and how to fix it.
//   main view     : stats + two tabs that follow the workflow:
//                   1 · Find companies  = search sweep (builds the list of Luxembourg companies);
//                   2 · Capture filings = capture rounds (profile, filings, PDFs of each company).
//                   The tab you pick also decides what the panel on LBR pages offers (next search / next company).
//   settings view : connection, what gets saved, shortcuts.
// Nothing opens by itself: every LBR page is opened by a click or a key press.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const send = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r || { ok: false, error: "No answer from the extension" })));
const fmt = (n) => (typeof n === "number" ? n.toLocaleString() : "–");
const pct = (a, b) => (b ? Math.min(100, Math.round((a / b) * 1000) / 10) : 0);
const store = (o) => chrome.storage.local.set(o);
const tags = (c) =>
  (c.serviceProvider ? '<span class="fh-tag sp">service provider</span>' : "") +
  (c.kind === "asset_manager" ? '<span class="fh-tag">asset manager</span>' : "") +
  (c.status === "struck_off" ? '<span class="fh-tag off">struck off</span>' : "");

const DEFAULT_ENGINE = "https://alejandro-code.centralindia.cloudapp.azure.com/engine";
const DEFAULT_ADMIN = "https://fundhub.lu/admin";
const DEFAULTS = { engineUrl: DEFAULT_ENGINE, engineToken: "", adminUrl: DEFAULT_ADMIN, enabled: true, autoDocs: false, keepLocalCopy: false, filter: "", sweepMode: false, popupTab: "" };
let cfg = { ...DEFAULTS };
let view = "setup";
let tab = "capture";

// ------------------------------------------------------------------ views
function show(v) {
  view = v;
  for (const id of ["setup", "main", "settings"]) $("v-" + id).hidden = id !== v;
  $("foot").hidden = v !== "main";
  $("gear").hidden = v === "settings";
}
function setStatus(kind, text) {
  $("status").className = "fh-status " + kind;
  $("status-txt").textContent = text;
}

/** What to do about a failed engine call, by error code (set in bg.js). */
function fix(r) {
  const local = /^http:\/\/(127\.0\.0\.1|localhost)/.test(cfg.engineUrl);
  switch (r.code) {
    case "token":
      return ["The access token is missing or wrong.", "On the VM run <code>npm run capture:token</code> and paste the value below."];
    case "down":
      return ["The VM answers, but the capture server is not running.", "In code-server: <b>Terminal → Run Task → Capture server: start</b> (or <code>npm run capture:start</code>)."];
    case "offline":
      return local
        ? ["No capture server on this computer.", "Start it: <code>npm run engine -- capture-server</code>."]
        : ["Cannot reach the VM.", "Check your internet connection and that the VM is switched on (Azure portal → Start)."];
    case "notengine":
      return ["That address is not a FundHub engine.", "It should end in <code>/engine</code>, e.g. the default address."];
    default:
      return [r.error || "Unknown problem.", ""];
  }
}

// ------------------------------------------------------------------ start
chrome.storage.local.get(DEFAULTS, (v) => {
  cfg = v;
  tab = v.popupTab || (v.sweepMode ? "find" : "capture");
  $("s-url").value = $("e-url").value = v.engineUrl;
  $("s-token").value = $("e-token").value = v.engineToken;
  $("e-admin").value = v.adminUrl;
  $("enabled").checked = v.enabled;
  $("autoDocs").checked = v.autoDocs;
  $("keepLocalCopy").checked = v.keepLocalCopy;
  const PRESETS = ["sp", "am", "cssf"];
  $("filter").value = PRESETS.includes(v.filter) ? v.filter : "";
  if (v.filter && !PRESETS.includes(v.filter)) $("search").value = v.filter;
  syncLinks();
  check();
});

function syncLinks() {
  const admin = String(cfg.adminUrl || DEFAULT_ADMIN).replace(/\/+$/, "");
  $("l-rounds").href = admin + "/engine/rounds";
  $("l-registry").href = admin + "/engine/registry";
  $("conn-line").textContent = `${cfg.engineUrl} · ${cfg.engineToken ? "token set" : "no token"}`;
  $("paused").hidden = cfg.enabled;
}

/** Tests the engine; shows setup on failure, the main view on success. */
async function check() {
  setStatus("wait", "Checking engine…");
  const st = await send({ type: "stats" });
  if (!st.ok) {
    setStatus("bad", "Not connected");
    const [what, how] = fix(st);
    $("setup-problem").innerHTML = `<b>${esc(what)}</b>${how ? "<br />" + how : ""}`;
    $("setup-problem").hidden = !cfg.engineToken && st.code === "token"; // first run: no scary error, just the steps
    if (view !== "settings") show("setup");
    return st;
  }
  const s = st.stats;
  setStatus("ok", "Connected");
  $("k-known").textContent = fmt(s.known);
  $("k-captured").textContent = fmt(s.captured);
  $("k-docs").textContent = fmt(s.docs_saved);
  $("k-today").textContent = fmt((s.today || 0) + (s.docs_today || 0));
  if (view !== "settings") show("main");
  selectTab(tab);
  return st;
}

// ------------------------------------------------------------------ setup + settings
const toggleShow = (btn, input) => btn.addEventListener("click", () => {
  input.type = input.type === "password" ? "text" : "password";
  btn.textContent = input.type === "password" ? "Show" : "Hide";
});
toggleShow($("s-show"), $("s-token"));
toggleShow($("e-show"), $("e-token"));

async function saveConnection(url, token, admin) {
  cfg.engineUrl = url.trim().replace(/\/+$/, "") || DEFAULT_ENGINE;
  cfg.engineToken = token.trim();
  if (admin !== undefined) cfg.adminUrl = admin.trim().replace(/\/+$/, "") || DEFAULT_ADMIN;
  await store({ engineUrl: cfg.engineUrl, engineToken: cfg.engineToken, adminUrl: cfg.adminUrl });
  $("s-url").value = $("e-url").value = cfg.engineUrl;
  $("s-token").value = $("e-token").value = cfg.engineToken;
  syncLinks();
}
$("s-connect").addEventListener("click", async () => {
  $("s-connect").disabled = true;
  $("s-connect").textContent = "Testing…";
  await saveConnection($("s-url").value, $("s-token").value);
  const r = await check();
  if (!r.ok) $("setup-problem").hidden = false;
  $("s-connect").disabled = false;
  $("s-connect").textContent = "Connect";
});
$("s-local").addEventListener("click", () => {
  $("s-url").value = "http://127.0.0.1:4477";
  $("s-connect").click();
});
$("e-save").addEventListener("click", async () => {
  await saveConnection($("e-url").value, $("e-token").value, $("e-admin").value);
  $("e-result").textContent = "Testing…";
  const r = await check();
  $("e-result").innerHTML = r.ok ? '<span class="good">✓ Connected</span>' : `<span class="err">${esc(fix(r)[0])}</span>`;
});
$("gear").addEventListener("click", () => show("settings"));
$("back").addEventListener("click", () => check());

$("enabled").addEventListener("change", () => { cfg.enabled = $("enabled").checked; store({ enabled: cfg.enabled }); syncLinks(); });
$("resume").addEventListener("click", () => { $("enabled").checked = true; $("enabled").dispatchEvent(new Event("change")); });
$("autoDocs").addEventListener("change", () => store({ autoDocs: $("autoDocs").checked }));
$("keepLocalCopy").addEventListener("change", () => store({ keepLocalCopy: $("keepLocalCopy").checked }));

// ------------------------------------------------------------------ tabs
document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => selectTab(b.dataset.tab)));
function selectTab(t) {
  tab = t;
  // The tab also sets what the panel on LBR pages offers next: a search (tab 1) or a company (tab 2).
  store({ popupTab: t, sweepMode: t === "find" });
  document.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
  $("t-find").hidden = t !== "find";
  $("t-capture").hidden = t !== "capture";
  return t === "find" ? loadFind() : loadCapture();
}

// ------------------------------------------------------------------ tab 1: search sweep
const PHASE = { 1: "Common words", 2: "Short words & acronyms", 3: "Related names" };
async function loadFind() {
  const body = $("f-body");
  const r = await send({ type: "sweep", n: 1 });
  $("f-details").hidden = true;
  if (!r.ok) {
    body.innerHTML = `<div class="fh-alert">${r.error === "not found"
      ? "The capture server runs old code. Restart it: <b>Run Task → Capture server: restart</b>."
      : esc(fix(r)[0])}</div>`;
    return;
  }
  const st = r.sweep;
  if (!st.planned) {
    body.innerHTML = `<div class="fh-card">
        <div class="fh-h2">Prepare the search list</div>
        <p class="fh-hint">FundHub makes a list of words from the company names it already knows. Each search adds the words of the new companies it finds. Do this once.</p>
        <button class="fh-btn primary wide" id="f-plan">Prepare search list</button>
      </div>`;
    $("f-plan").onclick = async () => {
      $("f-plan").disabled = true;
      $("f-plan").textContent = "Preparing…";
      const p = await send({ type: "sweep-plan" });
      if (!p.ok) alert(p.error || "Could not prepare the search list");
      loadFind();
    };
    return;
  }
  const w = st.words;
  const phases = (st.phases || [])
    .map((p) => `<div class="fh-phase"><span>${PHASE[p.phase] || "Phase " + p.phase}</span><span class="fh-bar"><i style="width:${pct(p.done, p.total)}%"></i></span><span class="num">${fmt(p.done)} / ${fmt(p.total)}</span></div>`)
    .join("");
  const next = r.next[0];
  body.innerHTML = `
    <div class="fh-card">
      <div class="fh-big"><b>${fmt(w.found)}</b> new companies found <span class="fh-hint">· ${fmt(w.found_today)} today in ${fmt(w.today)} searches</span></div>
      ${phases}
    </div>
    ${next
      ? `<div class="fh-next">
           <div class="lbl">Next search</div>
           <div class="term">${esc(next.term)}</div>
           <div class="sub">${esc(PHASE[next.phase] || "")} · appears in ${fmt(next.seen)} known names</div>
           <div class="fh-row"><button class="go" id="f-go">Search on LBR →</button><button class="fh-btn ghost sm light" id="f-skip" title="Set this word aside">Skip</button></div>
         </div>`
      : '<div class="fh-done">Every word has been searched 🎉</div>'}`;
  $("f-go")?.addEventListener("click", async () => { await send({ type: "open-sweep", item: next }); window.close(); });
  $("f-skip")?.addEventListener("click", async () => { await send({ type: "sweep-skip", term: next.term }); loadFind(); });
  $("f-details").hidden = false;
  $("f-table").innerHTML =
    "<tr><th>Prefix</th><th>Known</th><th>Highest no.</th><th>Coverage</th></tr>" +
    st.coverage
      .slice(0, 6)
      .map((c) => `<tr><td class="mono">${esc(c.prefix)}</td><td>${fmt(c.known)}</td><td>${c.max ? fmt(c.max) : "–"}</td><td>${c.max ? pct(c.known, c.max) + "%" : "–"}</td></tr>`)
      .join("");
}
$("f-reset").addEventListener("click", async () => { await send({ type: "sweep-reset" }); loadFind(); });

// ------------------------------------------------------------------ tab 2: capture rounds
const currentFilter = () => $("search").value.trim() || $("filter").value;
let filterTimer = null;
$("filter").addEventListener("change", () => { $("search").value = ""; store({ filter: currentFilter() }); loadCapture(); });
$("search").addEventListener("input", () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => { store({ filter: currentFilter() }); loadCapture(); }, 300);
});

async function loadCapture() {
  if (!$("newRound").hidden) return;
  const q = await send({ type: "queue", n: 10, filter: currentFilter() });
  const body = $("c-body");
  if (!q.ok) {
    body.innerHTML = `<div class="fh-alert">${esc(fix(q)[0])}</div>`;
    return;
  }
  const round = q.round;
  const items = q.items || [];
  const next = items[0];
  let html = "";
  if (round) {
    const s = round.stats;
    const p = pct(s.done, s.total);
    html += `<div class="fh-card">
        <div class="fh-row"><div class="fh-h2">${esc(round.name)}</div><span class="fh-tag ${round.kind === "update" ? "" : "sp"}">${round.kind === "update" ? "update" : "initial"}</span></div>
        <div class="fh-hint">Started ${new Date(round.startedAt).toLocaleDateString()} · ${fmt(s.done)} of ${fmt(s.total)} companies (${p}%)</div>
        <div class="fh-bar big"><i style="width:${p}%"></i></div>
        <div class="fh-chips">
          <span title="Captured for the first time">new <b>${fmt(s.captured)}</b></span>
          <span title="Something changed since the last capture">changed <b>${fmt(s.changed)}</b></span>
          <span title="A legal fact changed: waits in Review (filings and documents already saved)">held <b>${fmt(s.held || 0)}</b></span>
          <span title="Nothing changed">unchanged <b>${fmt(s.unchanged)}</b></span>
          <span title="Skipped or failed — bring them back with Reset skipped">skipped <b>${fmt(s.skipped)}</b></span>
          <span>new filings <b>${fmt(s.new_filings)}</b></span>
          <span>new PDFs <b>${fmt(s.new_documents)}</b></span>
        </div>
        <div class="fh-row end">
          <button class="fh-btn ghost sm" id="a-reset" title="Put skipped and failed companies back in the queue">Reset skipped</button>
          <button class="fh-btn ghost sm" id="a-close" title="Finish this round; it stays in the register">Close round</button>
          <button class="fh-btn ghost sm" id="a-new">New round…</button>
        </div>
      </div>`;
  } else {
    html += `<div class="fh-card">
        <div class="fh-h2">No round running</div>
        <p class="fh-hint">A round is a list of companies to visit, with progress and results kept in the round register. Without one you just get the companies never captured, in priority order.</p>
        <button class="fh-btn primary wide" id="a-new">Start a round…</button>
      </div>`;
  }
  html += next
    ? `<div class="fh-next">
         <div class="lbl">Next company${round ? " in this round" : ""}</div>
         <div class="term"><span class="mono">${esc(next.rcs)}</span> ${esc(next.name || "")}</div>
         <div class="sub">${tags(next)}${esc(next.category || "")}</div>
         <button class="go" id="c-go">Open on LBR →</button>
       </div>`
    : `<div class="fh-done">${round ? "Round complete 🎉 Close it, or Reset skipped to retry the skipped ones." : "Every known company has been captured 🎉"}</div>`;
  body.innerHTML = html;

  $("c-go")?.addEventListener("click", async () => { await send({ type: "open", rcs: next.rcs }); window.close(); });
  $("a-new").onclick = () => { $("newRound").hidden = false; body.hidden = true; syncForm(); };
  if (round) {
    $("a-reset").onclick = async () => { await send({ type: "round-reset" }); loadCapture(); };
    $("a-close").onclick = async () => {
      if (!confirm(`Close the round "${round.name}"? It stays in the register; companies not visited are recorded as such.`)) return;
      await send({ type: "round-close" });
      loadCapture();
    };
  }
  $("c-filter-wrap").hidden = !!round;
  renderQueue(items.slice(1));
}

function renderQueue(items) {
  const list = $("queue");
  $("c-queue-n").textContent = items.length ? `(${items.length})` : "";
  if (!items.length) return (list.innerHTML = '<li class="fh-empty">Nothing else queued.</li>');
  list.innerHTML = items
    .map((c) => `<li>
        <span class="mono">${esc(c.rcs)}</span>
        <span class="name"><div title="${esc(c.name)}">${esc(c.name)}</div><div class="meta">${tags(c)}${esc(c.category || "")}</div></span>
        <button class="fh-btn sm" data-open="${esc(c.rcs)}">Open</button>
        <button class="fh-btn ghost sm" data-skip="${esc(c.rcs)}" title="Skip (Reset skipped brings it back)">✕</button>
      </li>`)
    .join("");
  list.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", async () => { await send({ type: "open", rcs: b.dataset.open }); window.close(); }));
  list.querySelectorAll("[data-skip]").forEach((b) => b.addEventListener("click", async () => { await send({ type: "skip", rcs: b.dataset.skip }); loadCapture(); }));
}

// ---- new-round form
const roundKind = () => document.querySelector('input[name="kind"]:checked').value;
function syncForm() {
  $("n-text-wrap").hidden = $("n-scope").value !== "text";
  $("n-skip-wrap").hidden = roundKind() !== "update";
}
function closeForm() {
  $("newRound").hidden = true;
  $("c-body").hidden = false;
  loadCapture();
}
$("n-scope").addEventListener("change", syncForm);
document.querySelectorAll('input[name="kind"]').forEach((r) => r.addEventListener("change", syncForm));
$("n-cancel").addEventListener("click", closeForm);
$("n-start").addEventListener("click", async () => {
  const kind = roundKind();
  const options = {
    kind,
    filter: $("n-scope").value,
    text: $("n-scope").value === "text" ? $("n-text").value.trim() : undefined,
    skipDays: kind === "update" ? Number($("n-skip").value) || 0 : 0,
    name: $("n-name").value.trim() || undefined,
  };
  $("n-start").disabled = true;
  const r = await send({ type: "round-start", options });
  $("n-start").disabled = false;
  if (!r.ok) return alert(r.error || "Could not start the round");
  closeForm();
});
