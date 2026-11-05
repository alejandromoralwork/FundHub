/*
 * FILE: services/engine/browser-extension/hook.js   (runs INSIDE the LBR page, "MAIN" world, before LBR's code)
 * WHAT IT DOES: watches the responses the LBR page itself receives and passes two kinds on to the extension:
 *   - documents (PDF) the page downloads when you open a filing → saved and linked to the filing;
 *   - the company data (JSON from /mjrcs-web-api/v1/companies/…) the page loads to draw itself → kept with the
 *     page capture.
 *   It only COPIES responses the page already got: it never sends a request of its own, so it adds nothing to
 *   LBR's traffic and does not touch LBR's anti-robot check.
 */
(() => {
  if (window.__fundhubHook) return;
  window.__fundhubHook = true;

  // Keep LBR pages in their ORIGINAL text: browser translation would turn "Société à responsabilité limitée" into
  // "Limited liability company", "F.W." into "FW"… and those would be saved as fake changes.
  document.documentElement.setAttribute("translate", "no");
  document.documentElement.classList.add("notranslate");
  // Google's own "do not translate this page" tag, added as soon as <head> exists.
  const addNoTranslateMeta = () => {
    if (!document.head || document.head.querySelector('meta[name="google"][content="notranslate"]')) return !!document.head;
    const m = document.createElement("meta");
    m.name = "google";
    m.content = "notranslate";
    document.head.prepend(m);
    return true;
  };
  if (!addNoTranslateMeta()) document.addEventListener("readystatechange", addNoTranslateMeta, { once: true });

  const post = (msg) => window.postMessage({ __fundhub: true, ...msg }, location.origin);
  const toBase64 = (buf) => {
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const isPdf = (type, buf) => /pdf/i.test(type || "") || (buf && buf.byteLength > 4 && new Uint8Array(buf, 0, 4).join() === "37,80,68,70"); // "%PDF"
  const isCompanyApi = (url) => /\/mjrcs-web-api\/v1\/companies\//.test(url);

  // Looks at one response (fetch Response clone or XHR) without changing what the page receives.
  const inspect = async (url, type, getBuffer, getText) => {
    try {
      if (/pdf|octet-stream/i.test(type || "")) {
        const buf = await getBuffer();
        if (buf && isPdf(type, buf)) post({ kind: "pdf", url, contentType: "application/pdf", data: toBase64(buf) });
      } else if (/json/i.test(type || "") && isCompanyApi(url)) {
        post({ kind: "api", url, json: JSON.parse(await getText()) });
      }
    } catch (_) {
      /* never break the page */
    }
  };

  // LBR also asks the browser to DOWNLOAD each document it opens (a hidden <a download href="blob:…">), which makes
  // Chrome show a "Save as" dialog / put a copy in your folders. The PDF is already copied to FundHub above, so —
  // unless the popup switch "Also keep a copy in my Downloads" is on — that extra download is skipped.
  let suppressDownloads = true;
  window.addEventListener("message", (e) => {
    if (e.source === window && e.data && e.data.__fundhubCfg) suppressDownloads = !!e.data.suppressDownloads;
  });
  const isBlobDownload = (a) => a && a.tagName === "A" && a.hasAttribute("download") && /^blob:/i.test(a.href || "");
  const origAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (suppressDownloads && isBlobDownload(this)) return;
    return origAnchorClick.call(this);
  };
  document.addEventListener(
    "click",
    (e) => {
      const a = e.target && e.target.closest ? e.target.closest("a") : null;
      if (suppressDownloads && isBlobDownload(a)) e.preventDefault();
    },
    true,
  );

  // fetch()
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = res.url || String(args[0] && args[0].url ? args[0].url : args[0]);
      const type = res.headers.get("content-type");
      const copy = res.clone();
      inspect(url, type, () => copy.arrayBuffer(), () => copy.text());
    } catch (_) {}
    return res;
  };

  // XMLHttpRequest (axios, used by the LBR portal)
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__fundhubUrl = url;
    this.addEventListener("load", () => {
      try {
        const type = this.getResponseHeader("content-type");
        const abs = new URL(this.__fundhubUrl, location.href).href;
        const rt = this.responseType;
        inspect(
          abs,
          type,
          async () => (rt === "arraybuffer" ? this.response : rt === "blob" ? await this.response.arrayBuffer() : null),
          async () => (rt === "" || rt === "text" ? this.responseText : rt === "json" ? JSON.stringify(this.response) : ""),
        );
      } catch (_) {}
    });
    return origOpen.call(this, method, url, ...rest);
  };
})();
