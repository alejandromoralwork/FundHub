"""Small drawing kit for FundHub diagrams (matplotlib): brand colours, boxes, arrows, legends.

Every diagram uses a 28 x 13.2 unit canvas (16:7.5, the free area of a 16:9 slide)
rendered at 9.5 x 4.48 inches, so text stays readable when placed on a slide.
"""

from __future__ import annotations

from dataclasses import dataclass

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch  # noqa: E402

# ------------------------------------------------------------------ brand (apps/web/src/app/globals.css)
EMERALD = "#0F9D78"
EMERALD_DARK = "#0C8265"
EMERALD_LIGHT = "#E7F6F1"
INK = "#1E2632"
INK_DEEP = "#1A212B"
INK_SOFT = "#3B4658"
SLATE = "#64748B"
LINE = "#CBD5E1"
CANVAS = "#F7F8FA"
AMBER = "#D97706"
AMBER_LIGHT = "#FEF3C7"
SKY = "#0284C7"
SKY_LIGHT = "#E0F2FE"
RED = "#B91C1C"
RED_LIGHT = "#FEE2E2"

# Segoe UI is close to the website's Inter; DejaVu Sans is the fallback (and has the tick/cross glyphs).
plt.rcParams["font.family"] = ["Segoe UI", "DejaVu Sans"]
plt.rcParams["font.size"] = 10.5

W, H = 28.0, 13.2
TITLE_PT = 12.5
SUB_PT = 9.8
LABEL_PT = 9.0

# kind -> (edge, face, title colour, sub colour, dashed)
KINDS = {
    "who": (INK, "white", INK, INK_SOFT, False),
    "product": (EMERALD_DARK, EMERALD_LIGHT, INK, INK_SOFT, False),
    "core": (INK_DEEP, INK_DEEP, "white", "#CBD5E1", False),
    "system": (SKY, SKY_LIGHT, INK, INK_SOFT, False),
    "external": (SLATE, CANVAS, INK, INK_SOFT, True),
    "warn": (RED, RED_LIGHT, RED, INK_SOFT, False),
    "good": (EMERALD_DARK, EMERALD_LIGHT, EMERALD_DARK, INK_SOFT, False),
    "amber": (AMBER, AMBER_LIGHT, INK, INK_SOFT, False),
}

# arrow kind -> (colour, line width, dashed)
ARROWS = {
    "lead": (INK_SOFT, 1.3, False),
    "service": (EMERALD_DARK, 1.6, False),
    "data": (SKY, 1.4, False),
    "money": (AMBER, 2.2, False),
    "blocked": (RED, 1.6, True),
    "soft": (SLATE, 1.1, True),
}


@dataclass
class Box:
    x: float  # centre
    y: float
    w: float
    h: float

    @property
    def left(self):
        return (self.x - self.w / 2, self.y)

    @property
    def right(self):
        return (self.x + self.w / 2, self.y)

    @property
    def top(self):
        return (self.x, self.y + self.h / 2)

    @property
    def bottom(self):
        return (self.x, self.y - self.h / 2)

    def at(self, side: str, offset: float = 0.0):
        """Point on a side, shifted along it: at('top', -1) is 1 unit left of the top centre."""
        if side in ("top", "bottom"):
            px, py = getattr(self, side)
            return (px + offset, py)
        px, py = getattr(self, side)
        return (px, py + offset)


def canvas():
    fig = plt.figure(figsize=(9.5, 9.5 * H / W))
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, W)
    ax.set_ylim(0, H)
    ax.axis("off")
    return fig, ax


def box(ax, x, y, w, h, title, sub="", kind="who", title_pt=TITLE_PT, sub_pt=SUB_PT, align="center") -> Box:
    edge, face, tcol, scol, dashed = KINDS[kind]
    ax.add_patch(
        FancyBboxPatch(
            (x - w / 2, y - h / 2), w, h,
            boxstyle="round,pad=0,rounding_size=0.28",
            linewidth=1.3, edgecolor=edge, facecolor=face,
            linestyle=(0, (4, 2.5)) if dashed else "solid", zorder=2,
        )
    )
    if align == "left":
        tx, ha = x - w / 2 + 0.35, "left"
    else:
        tx, ha = x, "center"
    if sub:
        # Title above, sub-lines below; vertical position balanced on the box centre.
        n_sub = sub.count("\n") + 1
        title_h, line_h = 0.55, 0.47
        total = title_h + n_sub * line_h
        top = y + total / 2
        ax.text(tx, top - title_h / 2, title, ha=ha, va="center", fontsize=title_pt, fontweight="bold", color=tcol, zorder=3)
        ax.text(tx, top - title_h - n_sub * line_h / 2, sub, ha=ha, va="center", fontsize=sub_pt, color=scol,
                linespacing=1.25, zorder=3)
    else:
        ax.text(tx, y, title, ha=ha, va="center", fontsize=title_pt, fontweight="bold", color=tcol, zorder=3)
    return Box(x, y, w, h)


def arrow(ax, a, b, kind="lead", label="", rad=0.0, both=False, label_pos=0.5, label_offset=(0, 0), label_color=None):
    colour, lw, dashed = ARROWS[kind]
    ax.add_patch(
        FancyArrowPatch(
            a, b,
            arrowstyle="<|-|>" if both else "-|>",
            mutation_scale=13 if kind != "money" else 15,
            linewidth=lw, color=colour,
            linestyle=(0, (4, 2.5)) if dashed else "solid",
            connectionstyle=f"arc3,rad={rad}", shrinkA=1, shrinkB=1, zorder=1,
        )
    )
    if label:
        mx = a[0] + (b[0] - a[0]) * label_pos + label_offset[0]
        my = a[1] + (b[1] - a[1]) * label_pos + label_offset[1]
        ax.text(mx, my, label, ha="center", va="center", fontsize=LABEL_PT, color=label_color or INK_SOFT,
                linespacing=1.2, zorder=4,
                bbox=dict(boxstyle="round,pad=0.18", facecolor="white", edgecolor="none"))


def polyline(ax, points, kind="data", label="", label_at=None):
    """Right-angled connector through the given points; arrow head on the last segment."""
    colour, lw, dashed = ARROWS[kind]
    style = (0, (4, 2.5)) if dashed else "solid"
    xs, ys = zip(*points[:-1])
    ax.plot(xs, ys, color=colour, linewidth=lw, linestyle=style, zorder=1, solid_capstyle="round")
    arrow(ax, points[-2], points[-1], kind)
    if label and label_at:
        ax.text(*label_at, label, ha="center", va="center", fontsize=LABEL_PT, color=INK_SOFT, zorder=4,
                bbox=dict(boxstyle="round,pad=0.18", facecolor="white", edgecolor="none"))


def heading(ax, x, y, text, colour=SLATE, size=10.5):
    ax.text(x, y, text.upper(), ha="left", va="center", fontsize=size, fontweight="bold", color=colour)


def frame(ax, x0, y0, x1, y1, colour=LINE, face=CANVAS):
    ax.add_patch(FancyBboxPatch((x0, y0), x1 - x0, y1 - y0, boxstyle="round,pad=0,rounding_size=0.35",
                                linewidth=1.0, edgecolor=colour, facecolor=face, zorder=0))


def legend(ax, items, x=0.4, y=0.35):
    """items: [(arrow kind, text)] drawn left to right along the bottom."""
    cx = x
    for kind, text in items:
        colour, lw, dashed = ARROWS[kind]
        ax.plot([cx, cx + 0.9], [y, y], color=colour, linewidth=lw, linestyle=(0, (4, 2.5)) if dashed else "solid")
        t = ax.text(cx + 1.1, y, text, ha="left", va="center", fontsize=LABEL_PT, color=SLATE)
        cx += 1.6 + 0.2 * len(text)
    return t


def note(ax, x, y, text, ha="left", colour=SLATE, size=LABEL_PT):
    ax.text(x, y, text, ha=ha, va="center", fontsize=size, color=colour, linespacing=1.3)


def save(fig, path):
    fig.savefig(path, dpi=220, facecolor="white")
    plt.close(fig)
