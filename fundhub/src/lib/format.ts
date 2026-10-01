const eur = new Intl.NumberFormat("en-LU", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("en-US");

export const formatEur = (n: number) => eur.format(n);
export const formatNumber = (n: number) => num.format(n);
export const formatPriceRange = (min: number, max: number) => `${formatEur(min)} – ${formatEur(max)}`;

export function formatPercent(n: number) {
  const rounded = Math.round(n);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

export function slugify(s: string) {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
