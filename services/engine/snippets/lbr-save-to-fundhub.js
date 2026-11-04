/*
 * FundHub — "Save this LBR page" (Chrome DevTools snippet)
 *
 * WHAT IT DOES: sends the LBR company page YOU are looking at (its visible text + HTML) to the FundHub engine
 *   running on your computer (`engine capture-server`, http://127.0.0.1:4477). The engine parses it, stores it
 *   with history, and answers with the next RCS numbers to open. It does not browse LBR, call LBR's internal
 *   API, or touch LBR's anti-robot check — you search and open each company yourself, as usual.
 *
 * SET UP ONCE:
 *   1. Start the receiver:   cd services/engine  →  node --import tsx src/cli.ts capture-server
 *   2. Chrome → open https://www.lbr.lu → F12 (DevTools) → Sources → Snippets → "+ New snippet"
 *      → name it "FundHub save" → paste this whole file → Ctrl+S.
 * USE (each company):
 *   1. Search the RCS number on LBR as usual and open the company page (and its "List of filings").
 *   2. Run the snippet: in DevTools press Ctrl+Enter in the snippet, or Ctrl+P → type "!FundHub save" → Enter.
 *   3. A small FundHub panel shows what was saved and links to the next numbers. Click one, repeat.
 * If the receiver is not running, the page is downloaded as a .json file instead; import those later with
 *   node --import tsx src/cli.ts rcs:import-captures --dir "%USERPROFILE%\Downloads"
 */
(async () => {
  const ENGINE = "http://127.0.0.1:4477";
  const SEARCH = "https://www.lbr.lu/mjrcs-web-front/consult-search-list?search=";

  // --- small floating panel (replaced on every run)
  document.getElementById("fundhub-panel")?.remove();
  const panel = document.createElement("div");
  panel.id = "fundhub-panel";
  panel.style.cssText =
    "position:fixed;right:16px;bottom:16px;z-index:2147483647;width:340px;max-height:60vh;overflow:auto;" +
    "background:#fff;color:#111;border:2px solid #0b2a4a;border-radius:10px;padding:12px 14px;" +
    "font:13px/1.4 system-ui,Segoe UI,Arial;box-shadow:0 8px 24px rgba(0,0,0,.25)";
  const close = '<a href="#" id="fundhub-x" style="float:right;text-decoration:none;color:#666">✕</a>';
  const show = (html) => {
    panel.innerHTML = close + '<div style="font-weight:600;margin-bottom:6px">FundHub capture</div>' + html;
    panel.querySelector("#fundhub-x").onclick = (e) => { e.preventDefault(); panel.remove(); };
  };
  document.body.appendChild(panel);
  show("Saving this page…");

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const nextLinks = (next) =>
    next && next.length
      ? '<div style="margin-top:8px">Next to open:</div>' +
        next.map((n) => `<div><a href="${SEARCH}${encodeURIComponent(n)}" style="color:#0b5cad">${esc(n)}</a> · <a href="#" data-skip="${esc(n)}" style="color:#999">skip</a></div>`).join("")
      : '<div style="margin-top:8px;color:#666">Work list empty.</div>';
  const wireSkips = () =>
    panel.querySelectorAll("[data-skip]").forEach((a) => {
      a.onclick = async (e) => {
        e.preventDefault();
        const r = await fetch(ENGINE + "/skip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rcs: a.dataset.skip }) }).then((x) => x.json());
        show("Skipped " + esc(a.dataset.skip) + nextLinks(r.next));
        wireSkips();
      };
    });

  const payload = { url: location.href, text: document.body.innerText, html: document.documentElement.outerHTML };

  try {
    const r = await fetch(ENGINE + "/capture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).then((x) => x.json());
    const head = r.ok
      ? `<div style="color:#0a7a3d">✓ ${esc(r.rcs)} saved — ${esc(r.status)}</div><div>${esc(r.name)}</div><div style="color:#666">${esc(r.filings)} filings${r.changes ? ` · ${esc(r.changes)} changes` : ""}</div>`
      : `<div style="color:#b45309">⚠ ${esc(r.rcs || "")} ${esc(r.error)}</div>`;
    show(head + nextLinks(r.next));
    wireSkips();
  } catch (err) {
    // Receiver not reachable: keep the page as a file instead (Downloads), import it later.
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "fundhub-lbr-" + Date.now() + ".json";
    a.click();
    show(`<div style="color:#b45309">Engine not reachable (${esc(err.message)}). The page was downloaded as a file instead — run <code>rcs:import-captures</code> later.</div>`);
  }
})();
