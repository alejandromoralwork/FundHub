import "server-only";
/**
 * FILE: apps/web/src/lib/report-pdf.ts
 * PART: website (apps/web)
 * WHAT IT DOES: Draws the Data Intelligence reports as PDF files, on demand, from live market statistics.
 *   The public "Market Snapshot" gets the overview and fee tables; the private "Provider Intelligence Report"
 *   additionally gets bar charts for fees, RFI demand, software, licences and asset classes.
 * WHERE IT RUNS: on the server only (`import "server-only"` makes the build fail if browser code imports it).
 *   A download route calls `renderReportPdf` and sends the resulting bytes to the browser as a .pdf file.
 * FRAMEWORK NOTES: uses pdf-lib, an npm library that builds PDFs in code. A PDF page is measured in "points"
 *   (1/72 inch); A4 is 595 × 842 points. Unlike a web page, y = 0 is the BOTTOM of the page, so writing
 *   downwards means making `y` smaller. Nothing flows automatically: we must wrap lines and start new pages ourselves.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `class` = a blueprint for objects that bundle data (fields) and functions (methods); `this` = the object itself.
 *   - constructor "parameter properties" `private doc: PDFDocument` = a parameter that is also stored as a field.
 *   - definite assignment `page!: PDFPage` = "this field is set before use, trust me" (set in newPage()).
 *   - tuple type `[number, number]` = a list of exactly two numbers.
 *   - destructured parameters with defaults `{ size = 10, bold = false } = {}`.
 *   - `Promise<Uint8Array>` = later delivers raw bytes (the PDF file); `string[][]` = a list of rows of texts.
 */

// `import { a } from "b"` loads named things from module b. From pdf-lib: the document class, a colour maker,
// the built-in fonts, and the types of a font and a page (`type …` = imported for type checking only).
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
// `@/…` = this app's src folder. The report definitions and the "Q4 2026"-style quarter name.
import { currentQuarter, type BuiltInReport } from "@/content/reports";
// `@fundhub/...` = our shared packages. `MarketStats` = the shape of the statistics the database query returns.
import type { MarketStats } from "@fundhub/db/queries";
// Formats a number as euros, e.g. "€12,500".
import { formatEur } from "@fundhub/core/format";
// Turns a category slug ("fund-administration") into its display name ("Fund Administration").
import { categoryLabel } from "@fundhub/core/taxonomy";

// Kind: constants — the colours used in the PDF. `rgb(red, green, blue)` takes values from 0 to 1.
// INK = main text (dark slate), MUTED = secondary grey, ACCENT = FundHub green, TRACK = light grey bar background.
const INK = rgb(0.118, 0.149, 0.196);
const MUTED = rgb(0.42, 0.46, 0.53);
const ACCENT = rgb(0.059, 0.616, 0.471);
const TRACK = rgb(0.91, 0.93, 0.95);
// Kind: constant — the A4 page size in points as [width, height].
const A4: [number, number] = [595.28, 841.89];
// Kind: constant — blank space kept around the page edges, in points.
const MARGIN = 50;

/**
 * Standard PDF fonts only encode WinAnsi; replace anything else.
 * Kind: constant holding an arrow function.
 * @param s  type `string` — any text.
 * @returns  `string`: the same text with every unsupported character replaced by "-". The regular expression
 *           `[^…]` means "any character NOT in this set"; the set holds normal printable characters, accented
 *           Latin letters and a few typographic signs (€, dashes, curly quotes, bullet, ellipsis). Without this,
 *           pdf-lib would throw an error on e.g. Greek or Chinese characters. `/g` = replace every occurrence.
 */
const safe = (s: string) =>
  s.replace(/[^\x20-\x7E -ÿ€–—‘’“”•…]/g, "-");

/**
 * Kind: class (not exported; a helper for this file).
 * A small "typewriter" over pdf-lib: it remembers the current page and the current height `y`, writes text with
 * line wrapping, headings, bar charts and tables, and starts a new page when the current one is full.
 * Create one with `new Writer(doc, font, boldFont, footerText)`.
 */
class Writer {
  // The page currently being written on. `!` = "always set before use" (the constructor calls newPage()).
  page!: PDFPage;
  // Current writing height in points, measured from the bottom of the page. `= 0` is its starting value.
  y = 0;
  /**
   * Kind: constructor (runs when `new Writer(...)` is called).
   * @param doc     type `PDFDocument` — the PDF being built.
   * @param font    type `PDFFont` — the normal font.
   * @param bold    type `PDFFont` — the bold font.
   * @param footer  type `string` — text printed at the bottom of every page.
   * The word `private` before each parameter also stores it on the object (e.g. `this.doc`), readable only
   * inside the class.
   */
  constructor(
    private doc: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont,
    private footer: string,
  ) {
    this.newPage();
  }

  /** Kind: method. Adds a blank A4 page, moves `y` to the top margin, and prints the footer near the bottom. */
  newPage() {
    this.page = this.doc.addPage(A4);
    // `A4[1]` = the page height (second item of the pair).
    this.y = A4[1] - MARGIN;
    this.page.drawText(safe(this.footer), { x: MARGIN, y: 28, size: 8, font: this.font, color: MUTED });
  }

  /**
   * Kind: method. Makes sure there is room for something `h` points tall; if not, starts a new page.
   * @param h  type `number` — the height needed. The bottom margin plus 20 points is kept free for the footer.
   */
  ensure(h: number) {
    if (this.y - h < MARGIN + 20) this.newPage();
  }

  /**
   * Kind: method. Writes a paragraph, wrapping it over as many lines (and pages) as needed.
   * @param s  type `string` — the text.
   * @param options  an object, all optional, unpacked by destructuring with defaults: `size` (font size, 10),
   *                 `bold` (false), `color` (INK), `gap` (space under each line, 4). `= {}` lets callers omit it.
   */
  text(s: string, { size = 10, bold = false, color = INK, gap = 4 } = {}) {
    const font = bold ? this.bold : this.font;
    // Usable line width: page width minus the left and right margins.
    const width = A4[0] - 2 * MARGIN;
    // Greedy word wrap.
    // (Add words to the line one by one; when the next word would make the line too wide, start a new line.)
    // `split(/\s+/)` = cut the text at every run of spaces/new lines.
    const words = safe(s).split(/\s+/);
    // `let` because the line being built changes as we go.
    let line = "";
    const lines: string[] = [];
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w;
      // pdf-lib can measure how wide text will be at a given size. `&& line` = never push an empty line
      // (a single word wider than the page stays on its own line).
      if (font.widthOfTextAtSize(candidate, size) > width && line) {
        lines.push(line);
        line = w;
      } else line = candidate;
    }
    // Don't forget the last, unfinished line.
    if (line) lines.push(line);
    // Draw each line, moving down the page (`-=` = subtract and store).
    for (const l of lines) {
      this.ensure(size + gap);
      this.y -= size;
      this.page.drawText(l, { x: MARGIN, y: this.y, size, font, color });
      this.y -= gap;
    }
  }

  /** Kind: method. A section heading (13 pt bold) with a short green underline, and spacing above and below. */
  heading(s: string) {
    // Room for the heading plus at least a line of content, so a heading is never left alone at a page bottom.
    this.ensure(40);
    this.y -= 14;
    this.text(s, { size: 13, bold: true });
    this.page.drawRectangle({ x: MARGIN, y: this.y - 2, width: 40, height: 2, color: ACCENT });
    this.y -= 10;
  }

  /**
   * Horizontal bar chart: one hue, value labels in ink (never color alone).
   * Kind: method.
   * @param rows  type `{ label: string; value: number; display: string }[]` — one bar each: its name, its number,
   *              and the text printed next to it (e.g. "€12,000" or "45%").
   * @param max   type `number` — the value that fills a whole bar. Default: the largest value among the rows
   *              (`Math.max(...list)` spreads the list into separate arguments), and at least 1 to avoid ÷0.
   *              For percentages callers pass 1 (= 100%).
   */
  bars(rows: { label: string; value: number; display: string }[], max = Math.max(...rows.map((r) => r.value), 1)) {
    // Layout: 200 points for the label, then the bar, then 90 points for the value text.
    const labelW = 200;
    const barW = A4[0] - 2 * MARGIN - labelW - 90;
    for (const r of rows) {
      this.ensure(18);
      this.y -= 12;
      // The label, cut to 42 characters so it never runs into the bar.
      this.page.drawText(safe(r.label).slice(0, 42), { x: MARGIN, y: this.y, size: 9, font: this.font, color: INK });
      const x = MARGIN + labelW;
      // Grey full-length track, then the green bar on top, proportional to value / max (at least 2 points wide).
      this.page.drawRectangle({ x, y: this.y - 1, width: barW, height: 8, color: TRACK });
      this.page.drawRectangle({ x, y: this.y - 1, width: Math.max(2, (r.value / max) * barW), height: 8, color: ACCENT });
      // The value printed in bold after the bar.
      this.page.drawText(safe(r.display), { x: x + barW + 8, y: this.y, size: 9, font: this.bold, color: INK });
      this.y -= 6;
    }
  }

  /**
   * Kind: method. A simple table with a grey bold header row.
   * @param head    type `string[]` — the column titles.
   * @param rows    type `string[][]` — the rows, each a list of cell texts.
   * @param widths  type `number[]` — each column's width in points.
   */
  table(head: string[], rows: string[][], widths: number[]) {
    // An inner arrow function that draws one row. Arrow functions keep the class's `this`, so `this.page` works.
    const row = (cells: string[], font: PDFFont, color = INK) => {
      this.ensure(16);
      this.y -= 12;
      let x = MARGIN;
      // `.forEach((c, i) => …)` runs once per cell, with `i` = its position (0, 1, 2, …).
      cells.forEach((c, i) => {
        // Cells are cut to 48 characters so they don't overlap the next column.
        this.page.drawText(safe(c).slice(0, 48), { x, y: this.y, size: 9, font, color });
        // Move right by this column's width (`!` = the width is certainly there).
        x += widths[i]!;
      });
      this.y -= 4;
    };
    row(head, this.bold, MUTED);
    for (const r of rows) row(r, this.font);
  }
}

/**
 * Kind: constant holding an arrow function.
 * @param n  type `number` — a share between 0 and 1. @returns `string`: e.g. 0.456 → "46%".
 */
const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * Kind: async function (exported).
 * @param report  type `BuiltInReport` — which report to draw (title, summary, public or private).
 * @param s       type `MarketStats` — the live statistics from the database (provider counts, fee averages, …).
 * @returns       `Promise<Uint8Array>`: the finished PDF file as raw bytes (`Uint8Array` = a list of bytes).
 */
export async function renderReportPdf(report: BuiltInReport, s: MarketStats): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const period = currentQuarter();
  // PDF properties shown by PDF viewers (File → Properties).
  doc.setTitle(`${report.title} - ${period}`);
  doc.setAuthor("FundHub.lu");
  // Load the two built-in Helvetica fonts and create the writer with the footer text.
  // (Note: the private footer says "provider accounts only", although Data Intelligence members can read it too.)
  const w = new Writer(
    doc,
    await doc.embedFont(StandardFonts.Helvetica),
    await doc.embedFont(StandardFonts.HelveticaBold),
    `FundHub.lu · ${report.title} · ${period} · ${report.visibility === "private" ? "Confidential - provider accounts only" : "Public"}`,
  );

  // Title block. `new Date().toISOString().slice(0, 10)` = today's date as "2026-10-18".
  w.text("FUNDHUB · DATA INTELLIGENCE", { size: 9, bold: true, color: ACCENT });
  w.text(report.title, { size: 20, bold: true, gap: 6 });
  w.text(`${period} · generated ${new Date().toISOString().slice(0, 10)} from live platform data`, { color: MUTED });
  // The writer's `y` field is public, so we can add a little extra space directly.
  w.y -= 6;
  w.text(report.summary);

  // One-row table of headline figures. The Verified share is guarded against dividing by zero providers.
  w.heading("Market overview");
  w.table(
    ["Indexed providers", "FundHub Verified", "Service categories", "RFIs logged"],
    [[String(s.providers), `${s.verified} (${pct(s.providers ? s.verified / s.providers : 0)})`, String(s.byCategory.length), String(s.rfiCount)]],
    [125, 125, 125, 120],
  );

  // One table row per service category; `.map` turns each category's statistics into a list of cell texts.
  w.heading("Typical quarterly fees by category");
  w.text("Average of providers' empirical ranges (min-max), EUR per quarter. Excludes set-up fees and out-of-pocket expenses.", {
    size: 9,
    color: MUTED,
  });
  w.table(
    ["Category", "Providers", "Typical range", "Market spread"],
    s.byCategory.map((b) => [
      categoryLabel(b.category),
      String(b.providers),
      `${formatEur(b.avgMin)} - ${formatEur(b.avgMax)}`,
      `${formatEur(b.lowestMin)} - ${formatEur(b.highestMax)}`,
    ]),
    [215, 60, 115, 110],
  );

  // One row per provider type (size class).
  w.heading("Fees by provider size");
  w.table(
    ["Provider size", "Providers", "Avg. headcount", "Typical range"],
    s.byType.map((b) => [b.type, String(b.providers), String(b.avgHeadcount), `${formatEur(b.avgMin)} - ${formatEur(b.avgMax)}`]),
    [150, 80, 110, 160],
  );

  // The extra charts appear only in the private report.
  if (report.visibility === "private") {
    // Bar per category: the midpoint between the typical minimum and maximum fee.
    w.heading("Fee midpoint by category");
    w.bars(
      s.byCategory.map((b) => {
        const mid = Math.round((b.avgMin + b.avgMax) / 2);
        return { label: categoryLabel(b.category), value: mid, display: formatEur(mid) };
      }),
    );

    // How often each service was asked for in quote requests; a note instead if there is no data yet.
    w.heading("Most requested services (RFI demand)");
    if (s.demand.length) w.bars(s.demand.map((d) => ({ label: d.label, value: d.count, display: `${d.count} RFIs` })));
    else w.text("Not enough RFIs this quarter.", { color: MUTED });

    // Shares (0–1) of providers using each tool / holding each licence / covering each asset class. The top 10
    // tools only; the final `1` sets a full bar to mean 100%.
    w.heading("Software penetration");
    w.bars(s.techStack.slice(0, 10).map((t) => ({ label: t.label, value: t.share, display: pct(t.share) })), 1);

    w.heading("Licence coverage");
    w.bars(s.licences.map((t) => ({ label: t.label, value: t.share, display: pct(t.share) })), 1);

    w.heading("Asset-class coverage");
    w.bars(s.assetClasses.map((t) => ({ label: t.label, value: t.share, display: pct(t.share) })), 1);
  }

  // Closing notes on where the data comes from, in small grey text.
  w.heading("Methodology");
  w.text(
    "Fee ranges are empirical quarterly fees built from RFI responses, fee audits and provider disclosures. Data on licences comes from CSSF registers; headcount and legal status from RCS/RESA; technology from provider DDQs. Shares are the percentage of indexed providers listing each item. FundHub accepts no referral fees or commissions from service providers.",
    { size: 9, color: MUTED },
  );
  w.text("Public beta: figures are computed from illustrative sample data.", { size: 9, color: MUTED });

  // Turn the document into PDF bytes (async, hence the Promise in the return type).
  return doc.save();
}
