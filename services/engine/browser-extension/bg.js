/*
 * FILE: services/engine/browser-extension/bg.js   (extension background service worker)
 * WHAT IT DOES: relays what content.js / the popup need to and from the FundHub engine
 *   (`engine capture-server`): page captures, documents, the work list ("queue"),
 *   progress numbers, a company's status. It also handles the "open next company" shortcut (Alt+Shift+N):
 *   one keypress = you ask for the next company, it opens in the current LBR tab.
 *   Engine address and token come from the popup's Connection card (chrome.storage.local `engineUrl`,
 *   `engineToken`): the Azure VM (https://…/engine, token required) or a local receiver (http://127.0.0.1:4477).
 *   Search sweep: "open next search" (button or Alt+Shift+S) opens the next planned LBR search in the current tab,
 *   ONE search per click — exactly what typing it in LBR's search box does. Nothing runs on a timer.
 */
const DEFAULT_ENGINE = "https://alejandro-code.centralindia.cloudapp.azure.com/engine";
const SEARCH = (term) => "https://www.lbr.lu/mjrcs-web-front/consult-search-list?search=" + encodeURIComponent(term);
const COMPANY = (rcs) => "https://www.lbr.lu/mjrcs-web-front/consult-company/" + encodeURIComponent(rcs) + "?tab=deposit";

/** The engine address (no trailing slash) and its token, from the popup's Connection card. */
async function engine() {
  const { engineUrl, engineToken } = await chrome.storage.local.get({ engineUrl: DEFAULT_ENGINE, engineToken: "" });
  return { base: String(engineUrl || DEFAULT_ENGINE).replace(/\/+$/, ""), token: String(engineToken || "").trim() };
}

async function call(path, body) {
  const { base, token } = await engine();
  // The engine records which extension version sent each capture (capture files keep it for re-imports).
  const headers = { "X-FundHub-Ext": chrome.runtime.getManifest().version };
  if (token) headers.Authorization = "Bearer " + token;
  if (body) headers["Content-Type"] = "application/json";
  // Every failure carries a `code` so the popup can say what to do: offline | down | token | notengine | toolarge.
  let res;
  try {
    res = await fetch(base + path, body ? { method: "POST", headers, body: JSON.stringify(body) } : { headers });
  } catch (err) {
    return { ok: false, code: "offline", error: "Cannot reach the engine at " + base + " — is the VM on?" };
  }
  if (res.status === 401) return { ok: false, code: "token", error: "Engine token missing or wrong — set it in the popup (Settings)" };
  // Caddy answers 502/503/504 when nothing listens on 127.0.0.1:4477.
  if (res.status === 502 || res.status === 503 || res.status === 504)
    return { ok: false, code: "down", error: "The capture server on the VM is not running — start it (code-server: Run Task → Capture server: start)" };
  if (res.status === 413) return { ok: false, code: "toolarge", error: "Too large for the engine proxy (" + res.status + ")" };
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return { ok: false, code: "notengine", error: "Not a FundHub engine at " + base + " (HTTP " + res.status + ")" };
  return res.json();
}

/** Opens a URL in the active tab if it is an LBR tab, otherwise in a new tab. */
async function openLbr(url) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && /^https:\/\/www\.lbr\.lu\//.test(tab.url || "")) await chrome.tabs.update(tab.id, { url });
  else await chrome.tabs.create({ url });
}
const openCompany = (rcs) => openLbr(COMPANY(rcs));

/** Opens the search of one sweep word (its results list). Remembered for the panel. */
async function openSweepItem(item) {
  await chrome.storage.local.set({ lastSweepOpen: { term: item.term, at: Date.now() } });
  await openLbr(SEARCH(item.term));
}

/** Badge: documents saved in this browser session. */
let docs = 0;
const badge = () => {
  chrome.action.setBadgeBackgroundColor({ color: "#0b2a4a" });
  chrome.action.setBadgeText({ text: docs ? String(docs) : "" });
};

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    try {
      switch (msg.type) {
        case "capture":
          return reply(await call("/capture", msg.payload));
        case "document": {
          const r = await call("/document", msg.payload);
          if (r.ok) {
            docs++;
            badge();
          }
          return reply(r);
        }
        case "filings":
          return reply(await call("/filings?rcs=" + encodeURIComponent(msg.rcs)));
        case "next":
          return reply(await call("/next"));
        case "queue":
          return reply(await call(`/queue?n=${msg.n || 10}&filter=${encodeURIComponent(msg.filter || "")}`));
        case "stats":
          return reply(await call("/stats"));
        case "engine-info": {
          const { base, token } = await engine();
          return reply({ ok: true, base, hasToken: !!token });
        }
        case "company":
          return reply(await call("/company?rcs=" + encodeURIComponent(msg.rcs)));
        case "skip":
          return reply(await call("/skip", { rcs: msg.rcs }));
        // Capture rounds ("loops"): status, register, control.
        case "round":
          return reply(await call("/round"));
        case "rounds":
          return reply(await call("/rounds"));
        case "round-start":
          return reply(await call("/round/start", msg.options));
        case "round-close":
          return reply(await call("/round/close", {}));
        case "round-reset":
          return reply(await call("/round/reset-skipped", {}));
        // LBR search sweep.
        case "sweep":
          return reply(await call("/sweep?n=" + (msg.n || 6)));
        case "sweep-plan":
          return reply(await call("/sweep/plan", {}));
        case "sweep-skip":
          return reply(await call("/sweep/skip", { term: msg.term }));
        case "sweep-reset":
          return reply(await call("/sweep/reset-skipped", {}));
        case "open-sweep":
          await openSweepItem(msg.item);
          return reply({ ok: true });
        case "open":
          await openCompany(msg.rcs);
          return reply({ ok: true });
        default:
          return reply({ ok: false, error: "unknown message" });
      }
    } catch (err) {
      reply({ ok: false, error: "FundHub engine not reachable (" + err.message + ")" });
    }
  })();
  return true; // async reply
});

// Alt+Shift+N: open the next company of the work list (respecting the popup's filter).
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "open-next-search") {
    // Alt+Shift+S: the next search of the sweep (one keypress = one search).
    try {
      const r = await call("/sweep?n=1");
      if (r.next && r.next[0]) await openSweepItem(r.next[0]);
    } catch (_) {}
    return;
  }
  if (command !== "open-next") return;
  try {
    const { filter } = await chrome.storage.local.get({ filter: "" });
    const r = await call(`/queue?n=1&filter=${encodeURIComponent(filter)}`);
    if (r.items && r.items[0]) await openCompany(r.items[0].rcs);
  } catch (_) {
    /* engine not running: the popup shows it */
  }
});
