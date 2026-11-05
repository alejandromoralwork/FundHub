/*
 * FILE: services/engine/browser-extension/bg.js   (extension background service worker)
 * WHAT IT DOES: relays what content.js / the popup need to and from the FundHub engine on this computer
 *   (`engine capture-server`, http://127.0.0.1:4477): page captures, documents, the work list ("queue"),
 *   progress numbers, a company's status. It also handles the "open next company" shortcut (Alt+Shift+N):
 *   one keypress = you ask for the next company, it opens in the current LBR tab. Talks ONLY to 127.0.0.1.
 */
const ENGINE = "http://127.0.0.1:4477";
const COMPANY = (rcs) => "https://www.lbr.lu/mjrcs-web-front/consult-company/" + encodeURIComponent(rcs) + "?tab=deposit";

async function call(path, body) {
  const res = await fetch(ENGINE + path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  return res.json();
}

/** Opens a company in the active tab if it is an LBR tab, otherwise in a new tab. */
async function openCompany(rcs) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && /^https:\/\/www\.lbr\.lu\//.test(tab.url || "")) await chrome.tabs.update(tab.id, { url: COMPANY(rcs) });
  else await chrome.tabs.create({ url: COMPANY(rcs) });
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
  if (command !== "open-next") return;
  try {
    const { filter } = await chrome.storage.local.get({ filter: "" });
    const r = await call(`/queue?n=1&filter=${encodeURIComponent(filter)}`);
    if (r.items && r.items[0]) await openCompany(r.items[0].rcs);
  } catch (_) {
    /* engine not running: the popup shows it */
  }
});
