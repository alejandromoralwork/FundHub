// FundHub LBR Capture — popup: the current capture round and its NEXT company, round control (new / close / reset
// skipped), progress, switches, and the list of upcoming companies. Nothing opens by itself: you click.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const send = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r || { ok: false })));
const fmt = (n) => (typeof n === "number" ? n.toLocaleString() : "–");
const tags = (c) =>
  (c.serviceProvider ? '<span class="fh-tag sp">service provider</span>' : "") +
  (c.kind === "asset_manager" ? '<span class="fh-tag">asset manager</span>' : "") +
  (c.status === "struck_off" ? '<span class="fh-tag off">struck off</span>' : "");

// ---- switches (stored; content.js and the shortcut read them)
chrome.storage.local.get({ enabled: true, autoDocs: false, keepLocalCopy: false, filter: "" }, (v) => {
  $("enabled").checked = v.enabled;
  $("autoDocs").checked = v.autoDocs;
  $("keepLocalCopy").checked = v.keepLocalCopy;
  $("filter").value = v.filter === "sp" || v.filter === "am" ? v.filter : "";
  if (v.filter && v.filter !== "sp" && v.filter !== "am") $("search").value = v.filter;
  load();
});
$("enabled").addEventListener("change", () => chrome.storage.local.set({ enabled: $("enabled").checked }));
$("autoDocs").addEventListener("change", () => chrome.storage.local.set({ autoDocs: $("autoDocs").checked }));
$("keepLocalCopy").addEventListener("change", () => chrome.storage.local.set({ keepLocalCopy: $("keepLocalCopy").checked }));

// ---- filter of the no-round work list
const currentFilter = () => $("search").value.trim() || $("filter").value;
let t = null;
$("filter").addEventListener("change", () => {
  $("search").value = "";
  chrome.storage.local.set({ filter: currentFilter() });
  load();
});
$("search").addEventListener("input", () => {
  clearTimeout(t);
  t = setTimeout(() => {
    chrome.storage.local.set({ filter: currentFilter() });
    load();
  }, 300);
});

// ---- new-round form
const showForm = (on) => ($("newRound").hidden = !on);
const syncForm = () => {
  $("n-text-wrap").hidden = $("n-scope").value !== "text";
  $("n-skip-wrap").hidden = document.querySelector('input[name="kind"]:checked').value !== "update";
};
$("n-scope").addEventListener("change", syncForm);
document.querySelectorAll('input[name="kind"]').forEach((r) => r.addEventListener("change", syncForm));
$("n-cancel").addEventListener("click", () => showForm(false));
$("n-start").addEventListener("click", async () => {
  const kind = document.querySelector('input[name="kind"]:checked').value;
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
  showForm(false);
  load();
});

// ---- everything else
async function load() {
  const [st, q] = await Promise.all([send({ type: "stats" }), send({ type: "queue", n: 15, filter: currentFilter() })]);
  if (!st.ok) {
    $("engine").className = "fh-sub bad";
    $("engine").textContent = "Engine not running — start capture-server";
  } else {
    const s = st.stats;
    $("engine").className = "fh-sub ok";
    $("engine").textContent = `Engine running · ${fmt(s.known)} RCS numbers known`;
    $("s-captured").textContent = fmt(s.captured);
    $("s-docs").textContent = fmt(s.docs_saved);
    $("s-today").textContent = fmt(s.today + s.docs_today);
    $("s-remaining").textContent = fmt(s.remaining);
  }
  renderRound(q.ok ? q.round : null, q.ok ? q.items : []);
  renderQueue(q);
}

function renderRound(round, items) {
  const actions = $("r-actions");
  if (!round) {
    $("r-name").textContent = "No active round";
    $("r-kind").textContent = "Start a round to work through a list of companies (initial, then monthly updates).";
    $("r-bar").style.width = "0";
    $("r-line").textContent = "";
    actions.innerHTML = '<button class="fh-btn" id="a-new">New round…</button>';
  } else {
    const s = round.stats;
    const pct = s.total ? Math.round((s.done / s.total) * 1000) / 10 : 0;
    $("r-name").textContent = round.name;
    $("r-kind").textContent = `${round.kind === "update" ? "Update round — only changes and new PDFs are saved" : "Initial round"} · started ${new Date(round.startedAt).toLocaleDateString()}`;
    $("r-bar").style.width = pct + "%";
    $("r-line").textContent = `${fmt(s.done)} / ${fmt(s.total)} (${pct}%) · new ${fmt(s.captured)} · changed ${fmt(s.changed)} · unchanged ${fmt(s.unchanged)} · skipped ${fmt(s.skipped)} · new filings ${fmt(s.new_filings)} · new PDFs ${fmt(s.new_documents)}`;
    actions.innerHTML =
      '<button class="fh-btn ghost" id="a-reset" title="Put skipped / failed companies back in the queue">Reset skipped</button>' +
      '<button class="fh-btn ghost" id="a-close" title="Close this round (kept in the register)">Close</button>' +
      '<button class="fh-btn" id="a-new">New…</button>';
    $("a-reset").onclick = async () => {
      const r = await send({ type: "round-reset" });
      if (r.ok) load();
    };
    $("a-close").onclick = async () => {
      if (!confirm(`Close the round "${round.name}"? It stays in the register; pending companies are recorded as not visited.`)) return;
      await send({ type: "round-close" });
      load();
    };
  }
  $("a-new").onclick = () => {
    showForm(true);
    syncForm();
  };
  // NEXT company — the big button.
  const next = items[0];
  $("r-next").innerHTML = next
    ? `<div class="lbl">Next ${round ? "in this round" : "company"}</div>
       <div><span class="rcs">${esc(next.rcs)}</span> <span class="nm">${esc(next.name || "")}</span></div>
       <div>${tags(next)}<span style="opacity:.8">${esc(next.category || "")}</span></div>
       <button class="go" id="go">Open next →</button>`
    : `<div class="lbl">${round ? "Round complete 🎉 — close it or reset skipped" : "Nothing left"}</div>`;
  $("go")?.addEventListener("click", async () => {
    await send({ type: "open", rcs: next.rcs });
    window.close();
  });
}

function renderQueue(r) {
  const list = $("queue");
  if (!r.ok) return (list.innerHTML = '<li class="fh-empty">Engine not reachable.</li>');
  const items = r.items.slice(1);
  if (!items.length) return (list.innerHTML = '<li class="fh-empty">Nothing else queued.</li>');
  list.innerHTML = items
    .map(
      (c) => `<li>
        <span class="rcs">${esc(c.rcs)}</span>
        <span class="name"><div title="${esc(c.name)}">${esc(c.name)}</div><div class="meta">${tags(c)}${esc(c.category || "")}</div></span>
        <button class="fh-btn" data-open="${esc(c.rcs)}">Open</button>
        <button class="fh-btn ghost" data-skip="${esc(c.rcs)}" title="Skip (in a round: recorded; Reset skipped brings it back)">✕</button>
      </li>`,
    )
    .join("");
  list.querySelectorAll("[data-open]").forEach((b) =>
    b.addEventListener("click", async () => {
      await send({ type: "open", rcs: b.dataset.open });
      window.close();
    }),
  );
  list.querySelectorAll("[data-skip]").forEach((b) =>
    b.addEventListener("click", async () => {
      await send({ type: "skip", rcs: b.dataset.skip });
      load();
    }),
  );
}
