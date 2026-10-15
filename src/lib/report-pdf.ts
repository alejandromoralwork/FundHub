import "server-only";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { currentQuarter, type BuiltInReport } from "@/content/reports";
import type { MarketStats } from "@/db/queries";
import { formatEur } from "./format";
import { categoryLabel } from "./taxonomy";

const INK = rgb(0.118, 0.149, 0.196);
const MUTED = rgb(0.42, 0.46, 0.53);
const ACCENT = rgb(0.059, 0.616, 0.471);
const TRACK = rgb(0.91, 0.93, 0.95);
const A4: [number, number] = [595.28, 841.89];
const MARGIN = 50;

/** Standard PDF fonts only encode WinAnsi; replace anything else. */
const safe = (s: string) =>
  s.replace(/[^\x20-\x7E -ÿ€–—‘’“”•…]/g, "-");

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(
    private doc: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont,
    private footer: string,
  ) {
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage(A4);
    this.y = A4[1] - MARGIN;
    this.page.drawText(safe(this.footer), { x: MARGIN, y: 28, size: 8, font: this.font, color: MUTED });
  }

  ensure(h: number) {
    if (this.y - h < MARGIN + 20) this.newPage();
  }

  text(s: string, { size = 10, bold = false, color = INK, gap = 4 } = {}) {
    const font = bold ? this.bold : this.font;
    const width = A4[0] - 2 * MARGIN;
    // Greedy word wrap.
    const words = safe(s).split(/\s+/);
    let line = "";
    const lines: string[] = [];
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(candidate, size) > width && line) {
        lines.push(line);
        line = w;
      } else line = candidate;
    }
    if (line) lines.push(line);
    for (const l of lines) {
      this.ensure(size + gap);
      this.y -= size;
      this.page.drawText(l, { x: MARGIN, y: this.y, size, font, color });
      this.y -= gap;
    }
  }

  heading(s: string) {
    this.ensure(40);
    this.y -= 14;
    this.text(s, { size: 13, bold: true });
    this.page.drawRectangle({ x: MARGIN, y: this.y - 2, width: 40, height: 2, color: ACCENT });
    this.y -= 10;
  }

  /** Horizontal bar chart: one hue, value labels in ink (never color alone). */
  bars(rows: { label: string; value: number; display: string }[], max = Math.max(...rows.map((r) => r.value), 1)) {
    const labelW = 200;
    const barW = A4[0] - 2 * MARGIN - labelW - 90;
    for (const r of rows) {
      this.ensure(18);
      this.y -= 12;
      this.page.drawText(safe(r.label).slice(0, 42), { x: MARGIN, y: this.y, size: 9, font: this.font, color: INK });
      const x = MARGIN + labelW;
      this.page.drawRectangle({ x, y: this.y - 1, width: barW, height: 8, color: TRACK });
      this.page.drawRectangle({ x, y: this.y - 1, width: Math.max(2, (r.value / max) * barW), height: 8, color: ACCENT });
      this.page.drawText(safe(r.display), { x: x + barW + 8, y: this.y, size: 9, font: this.bold, color: INK });
      this.y -= 6;
    }
  }

  table(head: string[], rows: string[][], widths: number[]) {
    const row = (cells: string[], font: PDFFont, color = INK) => {
      this.ensure(16);
      this.y -= 12;
      let x = MARGIN;
      cells.forEach((c, i) => {
        this.page.drawText(safe(c).slice(0, 48), { x, y: this.y, size: 9, font, color });
        x += widths[i]!;
      });
      this.y -= 4;
    };
    row(head, this.bold, MUTED);
    for (const r of rows) row(r, this.font);
  }
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export async function renderReportPdf(report: BuiltInReport, s: MarketStats): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const period = currentQuarter();
  doc.setTitle(`${report.title} - ${period}`);
  doc.setAuthor("FundHub.lu");
  const w = new Writer(
    doc,
    await doc.embedFont(StandardFonts.Helvetica),
    await doc.embedFont(StandardFonts.HelveticaBold),
    `FundHub.lu · ${report.title} · ${period} · ${report.visibility === "private" ? "Confidential - provider accounts only" : "Public"}`,
  );

  w.text("FUNDHUB · DATA INTELLIGENCE", { size: 9, bold: true, color: ACCENT });
  w.text(report.title, { size: 20, bold: true, gap: 6 });
  w.text(`${period} · generated ${new Date().toISOString().slice(0, 10)} from live platform data`, { color: MUTED });
  w.y -= 6;
  w.text(report.summary);

  w.heading("Market overview");
  w.table(
    ["Indexed providers", "FundHub Verified", "Service categories", "RFIs logged"],
    [[String(s.providers), `${s.verified} (${pct(s.providers ? s.verified / s.providers : 0)})`, String(s.byCategory.length), String(s.rfiCount)]],
    [125, 125, 125, 120],
  );

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

  w.heading("Fees by provider size");
  w.table(
    ["Provider size", "Providers", "Avg. headcount", "Typical range"],
    s.byType.map((b) => [b.type, String(b.providers), String(b.avgHeadcount), `${formatEur(b.avgMin)} - ${formatEur(b.avgMax)}`]),
    [150, 80, 110, 160],
  );

  if (report.visibility === "private") {
    w.heading("Fee midpoint by category");
    w.bars(
      s.byCategory.map((b) => {
        const mid = Math.round((b.avgMin + b.avgMax) / 2);
        return { label: categoryLabel(b.category), value: mid, display: formatEur(mid) };
      }),
    );

    w.heading("Most requested services (RFI demand)");
    if (s.demand.length) w.bars(s.demand.map((d) => ({ label: d.label, value: d.count, display: `${d.count} RFIs` })));
    else w.text("Not enough RFIs this quarter.", { color: MUTED });

    w.heading("Software penetration");
    w.bars(s.techStack.slice(0, 10).map((t) => ({ label: t.label, value: t.share, display: pct(t.share) })), 1);

    w.heading("Licence coverage");
    w.bars(s.licences.map((t) => ({ label: t.label, value: t.share, display: pct(t.share) })), 1);

    w.heading("Asset-class coverage");
    w.bars(s.assetClasses.map((t) => ({ label: t.label, value: t.share, display: pct(t.share) })), 1);
  }

  w.heading("Methodology");
  w.text(
    "Fee ranges are empirical quarterly fees built from RFI responses, fee audits and provider disclosures. Data on licences comes from CSSF registers; headcount and legal status from RCS/RESA; technology from provider DDQs. Shares are the percentage of indexed providers listing each item. FundHub accepts no referral fees or commissions from service providers.",
    { size: 9, color: MUTED },
  );
  w.text("Public beta: figures are computed from illustrative sample data.", { size: 9, color: MUTED });

  return doc.save();
}
