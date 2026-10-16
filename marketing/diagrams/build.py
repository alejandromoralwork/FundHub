"""Builds every FundHub diagram as a PNG next to this file (matplotlib, no LaTeX).

    python marketing/diagrams/build.py            # all diagrams
    python marketing/diagrams/build.py money-flow # one diagram
"""

from __future__ import annotations

import sys
import textwrap
from pathlib import Path

from fhdraw import (
    AMBER, EMERALD_DARK, INK, INK_DEEP, LINE, RED, SKY, SLATE,
    arrow, box, canvas, frame, heading, legend, note, polyline, save,
)

OUT = Path(__file__).resolve().parent


# ====================================================================== the problem
def referral_problem():
    fig, ax = canvas()

    # ---- left: today
    heading(ax, 0.4, 12.6, "Today: the referral loop", RED, 11.5)
    m = box(ax, 3.0, 10.0, 5.2, 2.0, "Fund manager", "needs an administrator,\ndepositary, ManCo…")
    a = box(ax, 10.7, 10.0, 5.4, 2.0, "“Trusted adviser”", "law firm, administrator\nor consultant")
    p = box(ax, 6.85, 5.4, 6.8, 1.9, "Recommended provider", "one name, rarely the best fit")
    arrow(ax, m.right, a.left, "lead", "“Who should\nwe use?”", label_offset=(0, 1.05))
    arrow(ax, a.at("bottom", -1.3), p.at("top", 1.2), "lead", "recommends", label_offset=(-0.9, 0))
    arrow(ax, p.right, a.at("bottom", 1.4), "blocked", "referral fee,\nretrocession", rad=0.35,
          label_offset=(1.0, -0.3), label_color=RED)
    arrow(ax, m.bottom, p.left, "money", "pays fees that\ninclude the\nreferral cost", rad=0.35, label_offset=(-1.0, -0.3))
    box(ax, 6.85, 1.75, 12.6, 2.4, "", "", "warn")
    note(ax, 1.0, 2.35, "✗  The manager doesn't see the incentive", colour=INK, size=9.8)
    note(ax, 1.0, 1.75, "✗  Few providers are considered; specialists are locked out", colour=INK, size=9.8)
    note(ax, 1.0, 1.15, "✗  No fee benchmark, so overpayment goes unnoticed", colour=INK, size=9.8)

    ax.plot([14.0, 14.0], [0.5, 12.9], color=LINE, linewidth=1.2)

    # ---- right: FundHub
    heading(ax, 14.6, 12.6, "With FundHub", EMERALD_DARK, 11.5)
    m2 = box(ax, 16.9, 10.0, 4.6, 2.0, "Fund manager", "client of FundHub")
    f = box(ax, 24.0, 10.0, 5.4, 2.0, "FundHub", "comparator + set-up &\nfee negotiation advisory", "core")
    pa = box(ax, 16.9, 5.4, 3.2, 1.4, "Provider A", kind="product", title_pt=11)
    pb = box(ax, 20.5, 5.4, 3.2, 1.4, "Provider B", kind="product", title_pt=11)
    pc = box(ax, 23.7, 5.4, 3.2, 1.4, "Provider C", kind="product", title_pt=11)
    arrow(ax, m2.right, f.left, "money", "advisory fee\n(only income)", label_offset=(0, 1.05))
    arrow(ax, f.at("bottom", -1.6), pa.at("top", 1.0), "service")
    arrow(ax, f.at("bottom", -0.6), pb.top, "service", "compares all,\nnegotiates", label_pos=0.45, label_offset=(-0.2, 0))
    arrow(ax, f.at("bottom", 0.6), pc.top, "service")
    arrow(ax, m2.at("bottom", -0.5), pa.at("top", -0.5), "money", "pays a\nnegotiated\nfee", label_offset=(-1.25, 0))
    arrow(ax, pc.right, f.at("bottom", 2.2), "blocked", "no referral\nfees, ever", rad=0.35, label_offset=(0.95, -0.5),
          label_color=RED)
    box(ax, 21.1, 1.75, 12.8, 2.4, "", "", "good")
    note(ax, 15.2, 2.35, "✓  Paid only by the client, confirmed in writing", colour=INK, size=9.8)
    note(ax, 15.2, 1.75, "✓  Every provider compared on fees, quality and score", colour=INK, size=9.8)
    note(ax, 15.2, 1.15, "✓  Market benchmarks make overpayment visible", colour=INK, size=9.8)
    save(fig, OUT / "referral-problem.png")


# ====================================================================== platform
def architecture():
    fig, ax = canvas()
    heading(ax, 0.4, 12.7, "People")
    heading(ax, 6.6, 12.7, "FundHub apps")
    heading(ax, 15.8, 12.7, "Data")
    heading(ax, 21.9, 12.7, "Connected services")

    clients = box(ax, 2.8, 10.6, 4.8, 1.8, "Fund managers", "& investors, members")
    providers = box(ax, 2.8, 6.9, 4.8, 1.8, "Service providers", "listing, claim,\nsubscription")
    team = box(ax, 2.8, 2.9, 4.8, 1.8, "FundHub team", "staff, 2FA, roles")

    web = box(ax, 10.4, 10.0, 7.8, 3.4, "FundHub Web · fundhub.lu",
              "comparator · FundHub Score · fees\nadvisory requests · Data Intelligence\nNews & Learn · Awards · accounts", "product")
    console = box(ax, 10.4, 3.2, 7.8, 3.4, "FundHub Console · /admin",
                  "moderation · inbox & CRM · content\nbilling · finance · analytics\ndatabase · data pipeline · GDPR", "core")

    db = box(ax, 17.9, 6.9, 4.4, 2.2, "Database", "Postgres (Neon)\none role per app", "system")
    pipeline = box(ax, 17.9, 2.2, 4.4, 2.2, "Data module", "GitHub Actions\nRCS + AI extractor", "system")

    services = box(ax, 24.7, 10.6, 5.6, 2.4, "Services", "Stripe · Resend\nClaude API", "external")
    tools = box(ax, 24.7, 6.6, 5.6, 2.4, "Self-hosted (EU)", "Nextcloud · Twenty CRM\nListmonk · Postiz\nlinked from the Console",
                "external")
    sources = box(ax, 24.7, 2.2, 5.6, 2.2, "Public sources", "RCS / LBR register\nprovider websites", "external")

    arrow(ax, clients.right, web.at("left", 0.6), "lead")
    arrow(ax, providers.right, web.at("left", -1.1), "lead")
    arrow(ax, team.right, console.left, "lead")
    arrow(ax, web.at("bottom", 3.0), db.at("left", 0.6), "data", "read", both=True, label_offset=(-0.2, 0.25))
    arrow(ax, console.at("top", 3.0), db.at("left", -0.6), "data", "read /\nwrite", both=True, label_offset=(-0.3, -0.2))
    arrow(ax, pipeline.top, db.bottom, "data", "staged\nchanges", label_offset=(1.0, 0))
    arrow(ax, sources.left, pipeline.right, "data", "crawl", label_offset=(0, 0.45))
    arrow(ax, web.at("right", 0.8), services.left, "money", "payments, email, AI", label_offset=(0, 0.5))
    legend(ax, [("lead", "use"), ("data", "data"), ("money", "payments & services")], x=0.4, y=0.6)
    save(fig, OUT / "architecture.png")


def data_pipeline():
    fig, ax = canvas()
    heading(ax, 0.4, 12.6, "Sources")
    heading(ax, 8.1, 12.6, "Processing")
    heading(ax, 14.4, 12.6, "Storage")
    heading(ax, 20.3, 12.6, "What it powers")

    rcs = box(ax, 3.0, 11.0, 5.6, 1.6, "RCS / LBR", "legal data, filings", "external")
    web = box(ax, 3.0, 8.9, 5.6, 1.6, "Provider websites", "services, licences, stack", "external")
    self_ = box(ax, 3.0, 6.8, 5.6, 1.6, "Provider self-edits", "subscribers' updates", "external")
    rfi = box(ax, 3.0, 4.7, 5.6, 1.6, "Advisory & RFIs", "anonymised fees", "external")
    rev = box(ax, 3.0, 2.6, 5.6, 1.6, "Verified reviews", "client ratings", "external")

    module = box(ax, 10.4, 11.0, 4.6, 1.8, "Data module", "weekly, GitHub Actions\nRCS + AI extractor", "system")
    queue = box(ax, 10.4, 8.0, 4.6, 1.8, "Ingest queue", "only changed fields", "system")
    review = box(ax, 10.4, 5.0, 4.6, 1.8, "Staff review", "approve, edit, reject", "core")
    index = box(ax, 16.4, 6.8, 4.0, 3.2, "Published index", "Postgres (Neon)\nproviders, fees,\nreviews", "system")

    arrow(ax, rcs.right, module.at("left", 0.3), "data")
    arrow(ax, web.right, module.at("left", -0.4), "data")
    arrow(ax, module.bottom, queue.top, "data")
    arrow(ax, queue.bottom, review.top, "data")
    arrow(ax, self_.right, review.left, "data", "live,\nlogged", label_offset=(0, 0.2))
    arrow(ax, review.right, index.at("left", -0.8), "data")
    polyline(ax, [rfi.right, (6.9, 4.7), (6.9, 3.4), (16.0, 3.4), (16.0, index.bottom[1])], "data")
    polyline(ax, [rev.right, (16.8, 2.6), (16.8, index.bottom[1])], "data")

    outs = ["Comparator & profiles", "FundHub Score", "Fees & rankings", "Data Intelligence", "Advisory & public API"]
    for i, title in enumerate(outs):
        b = box(ax, 23.9, 11.6 - 2.2 * i, 7.0, 1.45, title, kind="product", title_pt=11)
        arrow(ax, index.right, b.left, "data")

    note(ax, 0.4, 0.75, "Scraped changes never publish automatically: a person approves each one in the Console.\n"
         "Subscribers' own edits go live immediately and are logged; verified providers are re-checked twice a year.")
    save(fig, OUT / "data-pipeline.png")


# ====================================================================== data intelligence
def market_map():
    fig, ax = canvas()
    heading(ax, 0.4, 12.7, "Public sources")
    heading(ax, 12.6, 12.7, "The market map")
    heading(ax, 20.3, 12.7, "What it becomes")

    srcs = [
        ("RCS / LBR", "every fund entity: SICAV,\nSIF, RAIF, SCSp"),
        ("CSSF registers", "UCITS, AIFs, AIFMs,\nManCos, depositaries"),
        ("Fund documents", "prospectuses & annual\nreports name providers"),
        ("Provider websites", "services, licences, tech"),
        ("FundHub's own data", "verified reviews,\nanonymised RFI fees"),
    ]
    engine = box(ax, 9.9, 6.9, 4.0, 3.0, "Data module", "scraping +\nAI extraction\nstaff review", "system")
    for i, (t, s) in enumerate(srcs):
        b = box(ax, 3.0, 11.2 - 2.15 * i, 5.6, 1.75, t, s, "external", title_pt=11)
        arrow(ax, b.right, engine.at("left", 1.0 - 0.5 * i), "data")

    frame(ax, 12.6, 2.0, 19.6, 12.1)
    funds = [(13.8, y) for y in (11.0, 9.6, 8.2, 6.8, 5.4, 4.0)]
    provs = [(18.4, 10.2, "#0F9D78"), (18.4, 8.2, "#0F9D78"), (18.4, 6.2, SKY), (18.4, 4.2, AMBER)]
    links = [(0, 0), (0, 2), (1, 0), (1, 3), (2, 1), (2, 2), (3, 1), (3, 3), (4, 0), (4, 2), (5, 1), (5, 3)]
    for fi, pi in links:
        ax.plot([funds[fi][0], provs[pi][0]], [funds[fi][1], provs[pi][1]], color=LINE, linewidth=1.2, zorder=1)
    ax.plot([funds[0][0], provs[0][0]], [funds[0][1], provs[0][1]], color="#0F9D78", linewidth=2.4, zorder=1)
    for x, y in funds:
        ax.add_patch(__import__("matplotlib.patches", fromlist=["Circle"]).Circle((x, y), 0.32, color=INK_DEEP, zorder=2))
    for x, y, c in provs:
        ax.add_patch(__import__("matplotlib.patches", fromlist=["FancyBboxPatch"]).FancyBboxPatch(
            (x - 0.55, y - 0.35), 1.1, 0.7, boxstyle="round,pad=0,rounding_size=0.15", color=c, zorder=2))
    ax.text(13.8, 11.75, "Funds", ha="center", fontsize=9.5, fontweight="bold", color=INK)
    ax.text(18.4, 11.75, "Providers", ha="center", fontsize=9.5, fontweight="bold", color=INK)
    ax.text(16.1, 2.75, "administrator · depositary · AIFM\nauditor · legal · domiciliation", ha="center", va="center",
            fontsize=8.8, color=SLATE, linespacing=1.3)
    arrow(ax, engine.right, (12.6, 6.9), "data")

    outs = [
        ("For managers & investors", "who services funds like mine\nmarket fee levels\nprovider track record", "product"),
        ("For service providers", "market share by category\ncompetitors' client portfolios\nlead signals: launches, switches",
         "product"),
        ("For FundHub", "advisory prospects\nquarterly reports\nFundHub Score inputs", "core"),
    ]
    for i, (t, s, k) in enumerate(outs):
        b = box(ax, 24.0, 10.3 - 3.4 * i, 7.4, 2.9, t, s, k, title_pt=11.2)
        arrow(ax, (19.6, 6.9), b.left, "service")

    note(ax, 0.4, 0.7, "Public registers, public documents and FundHub's own consented data only. "
         "Company data about legal entities, never personal data for sale.")
    save(fig, OUT / "market-map.png")


# ====================================================================== business model
def money_flow():
    fig, ax = canvas()
    box(ax, 14, 12.45, 27.0, 1.1,
        "Free for everyone:  listing  ·  comparator & FundHub Score  ·  fees & rankings  ·  public stats & reports  ·  News & Learn",
        kind="external", title_pt=10.5)

    heading(ax, 0.5, 11.3, "Who pays")
    heading(ax, 7.9, 11.3, "For what")
    clients = box(ax, 3.3, 9.5, 5.6, 1.8, "Fund managers", "& investors")
    buyers = box(ax, 3.3, 6.6, 5.6, 1.8, "Data buyers", "managers, investors,\nconsultants")
    prov = box(ax, 3.3, 2.75, 5.6, 1.8, "Service providers", "admins, depositaries,\nAIFMs, law, tax…")

    adv = box(ax, 11.6, 9.5, 7.6, 1.9, "Set-up & fee negotiation advisory", "retainer, or % of first-year savings", "product",
              title_pt=11)
    data = box(ax, 11.6, 6.6, 7.6, 1.9, "Data Intelligence", "membership + bespoke studies", "product")
    subs = box(ax, 11.6, 3.75, 7.6, 2.1, "Provider subscription",
               "verification · data · lead signals\n~€500 / ~€1,500 per quarter or custom", "product")
    awards = box(ax, 11.6, 1.25, 7.6, 1.5, "FundHub Awards", "nomination & audit fees", "product")

    stripe = box(ax, 19.2, 5.4, 3.4, 1.9, "Stripe", "cards, SEPA,\nLU VAT invoices", "external")
    console = box(ax, 25.0, 5.4, 5.4, 2.2, "FundHub Console", "billing & invoices\nfinance: P&L, VAT", "core")

    arrow(ax, clients.right, adv.left, "money")
    arrow(ax, buyers.right, data.left, "money")
    arrow(ax, prov.at("right", 0.45), subs.left, "money")
    arrow(ax, prov.at("right", -0.45), awards.left, "money")
    for b in (adv, data, subs, awards):
        arrow(ax, b.right, stripe.left, "money")
    arrow(ax, stripe.right, console.left, "money", "revenue", label_offset=(0, 0.7))
    arrow(ax, data.at("bottom", 2.4), subs.at("top", 2.4), "soft", "included", label_offset=(0.9, 0))

    box(ax, 24.6, 9.6, 6.0, 2.6, "✗ No referral fees", "providers never pay FundHub\nto be recommended or ranked", "warn",
        title_pt=11.5)
    legend(ax, [("money", "payment to FundHub"), ("soft", "bundled")], x=17.0, y=1.3)
    note(ax, 17.0, 0.6, "Prices indicative; annual contracts billed quarterly.")
    save(fig, OUT / "money-flow.png")


def service_flow():
    fig, ax = canvas()
    xs = [2.0 + 3.95 * i for i in range(7)]
    client_steps = [
        ("Discover", "search, social,\narticles", "who"),
        ("Compare", "comparator,\nscore, fees", "product"),
        ("Request", "quotes or an\nadvisory call", "product"),
        ("Scoping call", "free,\n30 minutes", "product"),
        ("At the table", "set-up plan,\nnegotiation", "core"),
        ("Onboarding", "contracts,\nKYC, kick-off", "product"),
        ("Review", "verified, after\n6–12 months", "product"),
    ]
    provider_steps = [
        ("Free listing", "from RCS +\nwebsite data", "who"),
        ("Claim profile", "approved\nby staff", "product"),
        ("Subscribe", "Boutique, Mid,\nInstitutional", "product"),
        ("Verification", "audit; badge\nonly on a pass", "core"),
        ("Keep it live", "services, team,\nstack, clients", "product"),
        ("Get value", "RFIs, reports,\nlead signals", "product"),
        ("Re-check", "twice a year", "product"),
    ]
    heading(ax, 0.3, 12.35, "Fund managers & investors (clients)", EMERALD_DARK)
    c = [box(ax, x, 10.1, 3.45, 2.1, t, s, k, title_pt=11) for x, (t, s, k) in zip(xs, client_steps)]
    heading(ax, 0.3, 4.65, "Service providers", EMERALD_DARK)
    p = [box(ax, x, 2.9, 3.45, 2.1, t, s, k, title_pt=11) for x, (t, s, k) in zip(xs, provider_steps)]
    for row in (c, p):
        for a, b in zip(row, row[1:]):
            arrow(ax, a.right, b.left, "service")

    data = box(ax, 13.85, 6.5, 12.0, 1.5, "FundHub data", "profiles · fees · reviews · anonymised RFI & audit pools", "system")
    polyline(ax, [(7.85, 7.0), (c[1].x, 7.0), c[1].bottom], "data", "powers", label_at=(6.9, 7.0))
    polyline(ax, [(7.85, 6.1), (p[0].x, 6.1), p[0].top], "data", "listing data", label_at=(4.1, 6.1))
    arrow(ax, c[4].bottom, (c[4].x, 7.25), "data", "anonymised\nfees", label_offset=(1.25, 0))
    polyline(ax, [c[6].bottom, (c[6].x, 6.85), (19.85, 6.85)], "data", "ratings", label_at=(23.4, 6.85))
    arrow(ax, p[4].top, (p[4].x, 5.75), "data", "profile\nupdates", label_offset=(1.05, 0))
    arrow(ax, p[6].bottom, p[4].bottom, "service", "renew", rad=-0.18, label_offset=(0, -0.6))

    legend(ax, [("service", "service step"), ("data", "data")], x=0.3, y=0.35)
    note(ax, 0.3, 12.95, "Dark boxes: FundHub people at work. Quote requests reach providers only with the client's consent.")
    save(fig, OUT / "service-flow.png")


# ====================================================================== growth
def lead_engine():
    fig, ax = canvas()
    organic = [("SEO", "guides, provider pages"), ("News & Learn", "weekly articles"), ("Social media", "LinkedIn, X, FB, IG"),
               ("Free data", "stats & public reports"), ("FundHub Awards", "PR, winners' badges"),
               ("Verified reviews", "word of mouth")]
    paid = [("Paid ads", "LinkedIn, Google"), ("Events", "Luxembourg fund events"), ("Outbound sales", "CRM sequences"),
            ("Partnerships", "associations, consultants"), ("Newsletter", "Listmonk, monthly")]

    heading(ax, 0.4, 12.75, "Organic (earned)", EMERALD_DARK)
    frame(ax, 0.3, 7.1, 12.0, 12.35)
    for i, (t, s) in enumerate(organic):
        box(ax, 3.25 + 5.8 * (i % 2), 11.35 - 1.65 * (i // 2), 5.5, 1.4, t, s, "product", title_pt=10.8, sub_pt=9.2)
    heading(ax, 0.4, 6.7, "Paid & outbound", INK)
    frame(ax, 0.3, 0.95, 12.0, 6.3)
    for i, (t, s) in enumerate(paid):
        box(ax, 3.25 + 5.8 * (i % 2), 5.3 - 1.65 * (i // 2), 5.5, 1.4, t, s, "who", title_pt=10.8, sub_pt=9.2)

    site = box(ax, 15.4, 6.6, 4.6, 10.8, "FundHub Web",
               "comparator\nservice categories\nfees & rankings\nadvisory pages\nData Intelligence\nNews & Learn\nfor providers\nAI advisor chat",
               "core")
    arrow(ax, (12.0, 9.7), site.at("left", 3.1), "lead", "traffic", label_offset=(0, 0.4))
    arrow(ax, (12.0, 3.6), site.at("left", -3.0), "lead", "traffic", label_offset=(0, 0.4))

    leads = [("Quote request", "RFI"), ("Advisory request", "set-up & negotiation"), ("Membership", "paid reports"),
             ("Provider claim", "then subscription"), ("Newsletter", "nurture list")]
    crm = box(ax, 26.2, 8.6, 3.4, 2.2, "CRM", "Twenty,\nvia Console", "external")
    revenue = box(ax, 26.2, 3.6, 3.4, 2.2, "Revenue", "advisory, subs,\ndata, awards", "amber")
    for i, (t, s) in enumerate(leads):
        y = 11.6 - 2.3 * i
        b = box(ax, 20.9, y, 4.6, 1.55, t, s, "system", title_pt=10.8, sub_pt=9.2)
        arrow(ax, (site.right[0], y), b.left, "lead")
        if t == "Membership":
            arrow(ax, b.right, revenue.at("left", 0.4), "money")
        else:
            arrow(ax, b.right, crm.left, "lead")
    arrow(ax, crm.bottom, revenue.top, "money", "follow-up,\nclose", label_offset=(0.0, 0))
    save(fig, OUT / "lead-engine.png")


# ====================================================================== operations
def ops_cycle():
    fig, ax = canvas()
    cols = [
        ("Daily", "core", INK_DEEP, [
            "Inbox: reply to every request within 1 business day; send to the CRM",
            "Moderate claims, profile edits and reviews",
            "Clear the scraper ingest queue",
            "Advisory: client calls and negotiation meetings",
            "Social: publish the day's post, reply to comments",
            "Sales: CRM follow-ups",
            "Dashboard: failed payments, GDPR due dates",
        ]),
        ("Weekly", "product", EMERALD_DARK, [
            "1–2 News or Learn articles, AI-drafted and fact-checked",
            "Approve the week's social versions",
            "Data module crawls RCS and provider websites",
            "Pipeline review: deals by stage, proposals sent",
            "SEO: rankings check, refresh one guide",
            "Team board and calendar in Nextcloud",
        ]),
        ("Monthly", "system", SKY, [
            "Finance: revenue vs expenses, budgets",
            "Newsletter: best articles + one data insight",
            "Analytics: leads and conversion by channel",
            "Provider onboarding calls; renewals due",
            "Review FundHub Score movers and data anomalies",
            "Access review; test a backup restore",
        ]),
        ("Quarterly & yearly", "amber", AMBER, [
            "Publish public and member reports",
            "VAT return from the Finance module",
            "Subscription invoices; churn and upsell review",
            "Re-check verified providers (twice a year)",
            "Awards: nominations, audit, jury; yearly ceremony",
            "Strategy: pricing, roadmap, KPI targets",
        ]),
    ]
    for i, (title, kind, colour, items) in enumerate(cols):
        x = 3.55 + 7.0 * i
        box(ax, x, 12.2, 6.4, 1.0, title, kind=kind, title_pt=11.5)
        frame(ax, x - 3.2, 1.8, x + 3.2, 11.5, colour=colour, face="white")
        y = 11.0
        for item in items:
            lines = textwrap.wrap(item, 33)
            ax.text(x - 2.95, y, "•", ha="left", va="top", fontsize=9.6, color=colour, fontweight="bold")
            ax.text(x - 2.6, y, "\n".join(lines), ha="left", va="top", fontsize=9.3, color=INK, linespacing=1.25)
            y -= 0.47 * len(lines) + 0.42
        if i < 3:
            arrow(ax, (x + 3.2, 6.6), (x + 3.8, 6.6), "service")
    arrow(ax, (24.55, 1.8), (3.55, 1.8), "service", "lessons feed the next cycle", rad=0.12, label_offset=(0, -0.65))
    save(fig, OUT / "ops-cycle.png")


DIAGRAMS = {
    "referral-problem": referral_problem,
    "architecture": architecture,
    "data-pipeline": data_pipeline,
    "market-map": market_map,
    "money-flow": money_flow,
    "service-flow": service_flow,
    "lead-engine": lead_engine,
    "ops-cycle": ops_cycle,
}

if __name__ == "__main__":
    names = sys.argv[1:] or list(DIAGRAMS)
    for name in names:
        DIAGRAMS[name]()
        print("built", name)
